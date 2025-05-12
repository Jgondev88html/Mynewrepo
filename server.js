const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Configuración del servidor HTTP básico
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/healthcheck') {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    return res.end('FT Wallet Server - Operational\n');
  }
  
  res.writeHead(404);
  res.end();
});

// Crear servidor WebSocket
const wss = new WebSocket.Server({ server });

// Almacenamiento en memoria (en producción usarías una base de datos)
const activeConnections = new Map(); // { userId: WebSocket }
const pendingTransactions = new Map(); // { recipientId: [transactions] }
const userBalances = new Map(); // { userId: balance }

// Función para generar IDs únicos
function generateTransactionId() {
  return 'tx_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Manejar conexiones WebSocket
wss.on('connection', (ws) => {
  let userId = null;
  console.log('Nueva conexión WebSocket establecida');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log(`Mensaje recibido de ${userId || 'usuario desconocido'}:`, data.type);

      // Registrar usuario
      if (data.type === 'register') {
        userId = data.userId;
        activeConnections.set(userId, ws);
        
        // Inicializar balance si no existe
        if (!userBalances.has(userId)) {
          userBalances.set(userId, 0);
        }
        
        console.log(`Usuario registrado: ${userId}`);
        
        // Enviar transacciones pendientes si las hay
        if (pendingTransactions.has(userId)) {
          const transactions = pendingTransactions.get(userId);
          transactions.forEach(tx => {
            ws.send(JSON.stringify({
              type: 'receive',
              ...tx
            }));
            
            // Actualizar balance
            const newBalance = userBalances.get(userId) + tx.amount;
            userBalances.set(userId, newBalance);
          });
          
          pendingTransactions.delete(userId);
          console.log(`Enviadas ${transactions.length} transacciones pendientes a ${userId}`);
        }
        
        // Confirmar registro
        ws.send(JSON.stringify({
          type: 'registered',
          userId: userId,
          balance: userBalances.get(userId)
        }));
      }

      // Procesar envío de fondos
      if (data.type === 'send') {
        if (!userId) {
          return ws.send(JSON.stringify({
            type: 'error',
            message: 'Debes registrarte primero'
          }));
        }

        const { recipientId, amount } = data;
        
        // Validaciones
        if (!recipientId || typeof amount !== 'number' || amount <= 0) {
          return ws.send(JSON.stringify({
            type: 'error',
            message: 'Datos de transacción inválidos'
          }));
        }

        if (userId === recipientId) {
          return ws.send(JSON.stringify({
            type: 'error',
            message: 'No puedes enviarte fondos a ti mismo'
          }));
        }

        const senderBalance = userBalances.get(userId) || 0;
        if (senderBalance < amount) {
          return ws.send(JSON.stringify({
            type: 'error',
            message: 'Fondos insuficientes'
          }));
        }

        // Crear transacción
        const txId = generateTransactionId();
        const txData = {
          txId,
          senderId: userId,
          recipientId,
          amount,
          timestamp: new Date().toISOString()
        };

        // Actualizar balances
        userBalances.set(userId, senderBalance - amount);
        
        // Enviar confirmación al remitente
        ws.send(JSON.stringify({
          type: 'send_success',
          txId,
          newBalance: userBalances.get(userId)
        }));

        // Enviar fondos al destinatario (si está conectado)
        if (activeConnections.has(recipientId)) {
          activeConnections.get(recipientId).send(JSON.stringify({
            type: 'receive',
            ...txData
          }));
          
          // Actualizar balance del destinatario
          const recipientBalance = userBalances.get(recipientId) || 0;
          userBalances.set(recipientId, recipientBalance + amount);
        } else {
          // Guardar transacción pendiente
          if (!pendingTransactions.has(recipientId)) {
            pendingTransactions.set(recipientId, []);
          }
          pendingTransactions.get(recipientId).push(txData);
          console.log(`Transacción pendiente para ${recipientId}`);
        }

        console.log(`Transacción completada: ${userId} -> ${recipientId} (${amount} FT)`);
        
        // Registrar transacción (en producción guardarías en una base de datos)
        logTransaction(txData);
      }

      // Consultar balance
      if (data.type === 'get_balance') {
        if (!userId) {
          return ws.send(JSON.stringify({
            type: 'error',
            message: 'Debes registrarte primero'
          }));
        }
        
        ws.send(JSON.stringify({
          type: 'balance',
          userId,
          balance: userBalances.get(userId) || 0
        }));
      }

    } catch (err) {
      console.error('Error procesando mensaje:', err);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Error procesando la solicitud'
      }));
    }
  });

  // Manejar cierre de conexión
  ws.on('close', () => {
    if (userId) {
      activeConnections.delete(userId);
      console.log(`Usuario desconectado: ${userId}`);
    }
  });

  // Manejar errores
  ws.on('error', (err) => {
    console.error(`Error en conexión ${userId || 'desconocida'}:`, err);
  });
});

// Función para registrar transacciones (simulado)
function logTransaction(tx) {
  const logEntry = {
    ...tx,
    loggedAt: new Date().toISOString()
  };
  
  // En producción, guardarías en una base de datos
  console.log('Transacción registrada:', logEntry);
}

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor iniciado en puerto ${PORT}`);
  console.log(`WebSocket disponible en ws://localhost:${PORT}`);
});

// Manejar cierre limpio del servidor
process.on('SIGINT', () => {
  console.log('\nApagando servidor...');
  
  // Cerrar todas las conexiones WebSocket
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.close(1000, 'El servidor se está apagando');
    }
  });
  
  // Cerrar servidor HTTP
  server.close(() => {
    console.log('Servidor apagado correctamente');
    process.exit(0);
  });
});
