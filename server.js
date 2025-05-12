const WebSocket = require('ws');
const http = require('http');

// Base de datos simple en memoria
const users = new Map(); // {userId: {balance: number, pending: array}}
const transactions = new Map(); // {txId: transaction}
let firstUserId = null; // Almacena el ID del primer usuario registrado
const MINT_AMOUNT = 100; // Cantidad de tokens a generar
const MINT_INTERVAL = 300000; // Intervalo en milisegundos (30 segundos)
const INITIAL_BALANCE = 0; // Balance inicial para nuevos usuarios

// Crear servidor HTTP
const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Token Wallet Server\n');
});

// Crear servidor WebSocket
const wss = new WebSocket.Server({ server });

// Función para generar y enviar tokens al primer usuario
function mintTokens() {
  if (firstUserId && users.has(firstUserId)) {
    const txId = generateId();
    const transaction = {
      txId,
      senderId: 'system', // ID especial para el sistema
      recipientId: firstUserId,
      amount: MINT_AMOUNT,
      timestamp: new Date().toISOString(),
      status: 'completed',
      isMint: true // Marcar como generación de tokens
    };

    transactions.set(txId, transaction);
    
    // Acreditar tokens al primer usuario
    const recipient = users.get(firstUserId);
    recipient.balance += MINT_AMOUNT;
    sendUserState(firstUserId);

    console.log(`[MINT] Generados ${MINT_AMOUNT} tokens para ${shortenId(firstUserId)}`);
  }
}

// Configurar intervalo para generación periódica
const mintInterval = setInterval(mintTokens, MINT_INTERVAL);

wss.on('connection', (ws) => {
  let userId = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'register') {
        userId = data.userId;

        // Registrar como primer usuario si es el primero
        if (!firstUserId) {
          firstUserId = userId;
          console.log(`[REGISTER] Primer usuario registrado: ${shortenId(userId)}`);
        }

        // Inicializar usuario si no existe
        if (!users.has(userId)) {
          users.set(userId, {
            balance: INITIAL_BALANCE,
            pending: [],
            ws: null
          });
          console.log(`[REGISTER] Nuevo usuario creado: ${shortenId(userId)} con balance inicial de ${INITIAL_BALANCE}`);
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

        // Validaciones básicas
        if (!userId) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Usuario no registrado'
          }));
          return;
        }

        if (!users.has(userId)) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Usuario no encontrado'
          }));
          return;
        }

        if (amount <= 0) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Cantidad inválida'
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
          status: 'pending'
        };

        transactions.set(txId, transaction);

        // Descontar fondos del remitente
        sender.balance -= amount;
        sendUserState(userId);

        // Procesar transacción
        processTransaction(transaction);
      }

      if (data.type === 'delete_transaction') {
        const { txId } = data;
        const tx = transactions.get(txId);

        // Verificar que la transacción pertenece al usuario
        if (tx && (tx.senderId === userId || tx.recipientId === userId)) {
          transactions.delete(txId);
          sendUserState(userId);
          ws.send(JSON.stringify({
            type: 'success',
            message: 'Transacción eliminada'
          }));
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

  ws.on('close', () => {
    if (userId && users.has(userId)) {
      users.get(userId).ws = null;
      console.log(`[DISCONNECT] Usuario ${shortenId(userId)} desconectado`);
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
    console.log(`[NEW USER] Creado usuario receptor: ${shortenId(recipientId)}`);
  }

  const recipient = users.get(recipientId);

  // Actualizar estado de la transacción
  transaction.status = 'completed';
  
  // Si el destinatario está conectado, procesar inmediatamente
  if (recipient.ws) {
    recipient.balance += amount;
    sendUserState(recipientId);
    console.log(`[TX COMPLETED] Transacción ${txId} completada inmediatamente`);
  } else {
    // Agregar a pendientes
    recipient.pending.push(txId);
    console.log(`[TX PENDING] Transacción ${txId} en cola para ${shortenId(recipientId)}`);
  }

  // Notificar al remitente
  const sender = users.get(transaction.senderId);
  if (sender && sender.ws) {
    sendUserState(transaction.senderId);
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
      console.log(`[PROCESS PENDING] Transacción ${txId} procesada para ${shortenId(userId)}`);
    }
  }

  sendUserState(userId);
}

function sendUserState(userId) {
  const user = users.get(userId);
  if (user && user.ws) {
    const userTransactions = Array.from(transactions.values())
      .filter(tx => tx.senderId === userId || tx.recipientId === userId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    user.ws.send(JSON.stringify({
      type: 'state',
      balance: user.balance,
      transactions: userTransactions
    }));
  }
}

function generateId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function shortenId(id) {
  return id ? `${id.substring(0, 6)}...${id.substring(id.length - 4)}` : 'null';
}

// Manejar cierre limpio del servidor
process.on('SIGINT', () => {
  console.log('\nDeteniendo servidor...');
  clearInterval(mintInterval);
  wss.close(() => {
    server.close(() => {
      console.log('Servidor detenido correctamente');
      process.exit(0);
    });
  });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
  console.log(`Configuración de generación de tokens:`);
  console.log(`- Cantidad: ${MINT_AMOUNT} tokens cada ${MINT_INTERVAL/1000} segundos`);
  console.log(`- Destinatario: Primer usuario registrado (${firstUserId || 'ninguno aún'})`);
  console.log(`- Balance inicial para nuevos usuarios: ${INITIAL_BALANCE}`);
});
