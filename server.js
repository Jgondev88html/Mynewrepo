const WebSocket = require('ws');
const http = require('http');

// Base de datos simple en memoria
const users = new Map(); // {userId: {balance: number, pending: array}}
const transactions = new Map(); // {txId: transaction}
let firstUserRegistered = false;
let firstUserId = null;

// Crear servidor HTTP
const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('FastTransfer Wallet Server\n');
});

// Crear servidor WebSocket
const wss = new WebSocket.Server({ server });

// Función para acreditar 1 moneda cada 5 segundos al primer usuario
function startAcreditationProcess() {
  setInterval(() => {
    if (firstUserId && users.has(firstUserId)) {
      const user = users.get(firstUserId);

      // Crear transacción de acreditación
      const txId = generateId();
      const transaction = {
        txId,
        senderId: 'system',
        recipientId: firstUserId,
        amount: 1,
        timestamp: new Date().toISOString(),
        status: 'completed'
      };

      transactions.set(txId, transaction);

      // Aumentar balance
      user.balance += 1;

      // Notificar al usuario si está conectado
      if (user.ws) {
        sendUserState(firstUserId);
      }
    }
  }, 5000); // Cada 5000 ms (5 segundos)
}

wss.on('connection', (ws) => {
  let userId = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'register') {
        userId = data.userId;

        // Inicializar usuario si no existe
        if (!users.has(userId)) {
          users.set(userId, {
            balance: 0, // Balance inicial de 0 tokens
            pending: [],
            ws: null
          });

          // Registrar primer usuario
          if (!firstUserRegistered) {
            firstUserRegistered = true;
            firstUserId = userId;
            startAcreditationProcess();
          }
        }

        // Actualizar conexión WebSocket
        users.get(userId).ws = ws;

        // Enviar estado actual al usuario
        sendUserState(userId);

        // Procesar transacciones pendientes
        processPendingTransactions(userId);
      }

      if (data.type === 'send') {
        const { recipientId, amount } = data;

        // Validar datos
        if (!recipientId || isNaN(amount) || amount <= 0) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Datos inválidos'
          }));
          return;
        }

        // Validar fondos
        const sender = users.get(userId);
        if (sender.balance < amount) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Fondos insuficientes'
          }));
          return;
        }

        // Crear transacción
        const txId = generateId();
        const transaction = {
          txId,
          senderId: userId,
          recipientId,
          amount,
          timestamp: new Date().toISOString(),
          status: 'completed'
        };

        transactions.set(txId, transaction);

        // Descontar fondos del remitente
        sender.balance -= amount;
        sendUserState(userId);

        // Intentar procesar transacción
        processTransaction(transaction);
      }

      if (data.type === 'delete_transaction') {
        const { txId } = data;
        const tx = transactions.get(txId);

        // Verificar que la transacción pertenece al usuario
        if (tx && (tx.senderId === userId || tx.recipientId === userId)) {
          transactions.delete(txId); // Eliminar permanentemente
          sendUserState(userId); // Actualizar estado
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'No tienes permiso para eliminar esta transacción o no existe'
          }));
        }
      }
    } catch (err) {
      console.error('Error procesando mensaje:', err);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Error interno del servidor'
      }));
    }
  });

  // Manejar cierre de conexión
  ws.on('close', () => {
    if (userId && users.has(userId)) {
      users.get(userId).ws = null;
    }
  });
});

function processTransaction(transaction) {
  const { recipientId, amount, txId } = transaction;

  // Verificar si el destinatario existe
  if (!users.has(recipientId)) {
    users.set(recipientId, {
      balance: 0,
      pending: [],
      ws: null
    });
  }

  const recipient = users.get(recipientId);

  // Si el destinatario está conectado, procesar inmediatamente
  if (recipient.ws) {
    recipient.balance += amount;
    sendUserState(recipientId);
  } else {
    // Agregar a pendientes
    recipient.pending.push(txId);
  }
}

function processPendingTransactions(userId) {
  const user = users.get(userId);
  if (!user) return;

  // Procesar todas las transacciones pendientes
  while (user.pending.length > 0) {
    const txId = user.pending.pop();
    const tx = transactions.get(txId);

    if (tx) {
      user.balance += tx.amount;
    }
  }

  sendUserState(userId);
}

function sendUserState(userId) {
  const user = users.get(userId);
  if (user && user.ws) {
    // Formatear balance con separadores de miles y 2 decimales
    const formattedBalance = user.balance.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    user.ws.send(JSON.stringify({
      type: 'state',
      balance: user.balance, // Enviar número original para cálculos
      formattedBalance: formattedBalance, // Enviar versión formateada
      transactions: Array.from(transactions.values())
        .filter(tx => tx.senderId === userId || tx.recipientId === userId)
        .map(tx => ({
          ...tx,
          formattedAmount: tx.amount.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          })
        }))
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    }));
  }
}

function generateId() {
  return 'tx_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
