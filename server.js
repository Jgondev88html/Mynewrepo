const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

// Configuración directa de WebSocket (sin HTTP)
const wss = new WebSocket.Server({ port: 3000 });
const walletsDB = new Map();

// Función para enviar datos del wallet al cliente
function sendWalletData(ws, userId) {
  const wallet = walletsDB.get(userId) || { 
    balance: 10.0, 
    transactions: [{
      id: uuidv4(),
      desc: 'Depósito inicial',
      amount: 10.0,
      type: 'receive',
      date: new Date().toISOString(),
      status: 'confirmed'
    }]
  };
  
  ws.send(JSON.stringify({
    type: 'wallet_data',
    balance: wallet.balance,
    transactions: wallet.transactions
  }));
}

// Notificar a clientes afectados por transferencias
function notifyClients(senderId, recipientId, data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      if (client.userId === senderId) {
        client.send(JSON.stringify({
          type: 'balance_updated',
          balance: data.sender.balance,
          transaction: data.sender.transaction
        }));
      } else if (client.userId === recipientId) {
        client.send(JSON.stringify({
          type: 'balance_updated',
          balance: data.recipient.balance,
          transaction: data.recipient.transaction
        }));
      }
    }
  });
}

// Manejo de conexiones WebSocket
wss.on('connection', (ws) => {
  console.log('Nuevo cliente conectado');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log(`Operación solicitada: ${data.type}`);

      switch(data.type) {
        case 'register':
          if (!walletsDB.has(data.userId)) {
            walletsDB.set(data.userId, {
              balance: data.balance || 10.0,
              transactions: data.transactions || [{
                id: uuidv4(),
                desc: 'Depósito inicial',
                amount: 10.0,
                type: 'receive',
                date: new Date().toISOString(),
                status: 'confirmed'
              }]
            });
          }
          ws.userId = data.userId;
          sendWalletData(ws, data.userId);
          break;

        case 'transfer':
          const { senderId, recipientId, amount, transactionId } = data;
          
          if (!walletsDB.has(senderId) || !walletsDB.has(recipientId)) {
            return ws.send(JSON.stringify({
              type: 'transfer_error',
              message: 'Usuario no registrado',
              transactionId
            }));
          }

          const sender = walletsDB.get(senderId);
          const recipient = walletsDB.get(recipientId);

          if (sender.balance < amount) {
            return ws.send(JSON.stringify({
              type: 'transfer_error',
              message: 'Saldo insuficiente',
              transactionId
            }));
          }

          // Procesar transferencia
          const timestamp = new Date().toISOString();
          const sendTx = {
            id: transactionId,
            desc: `Enviado a ${recipientId}`,
            amount: amount,
            type: 'send',
            date: timestamp,
            status: 'confirmed'
          };

          const receiveTx = {
            id: uuidv4(),
            desc: `Recibido de ${senderId}`,
            amount: amount,
            type: 'receive',
            date: timestamp,
            status: 'confirmed'
          };

          // Actualizar saldos y transacciones
          sender.balance -= amount;
          recipient.balance += amount;
          sender.transactions.push(sendTx);
          recipient.transactions.push(receiveTx);

          notifyClients(senderId, recipientId, {
            sender: { balance: sender.balance, transaction: sendTx },
            recipient: { balance: recipient.balance, transaction: receiveTx }
          });
          break;

        case 'sync':
          if (!walletsDB.has(data.userId)) {
            return ws.send(JSON.stringify({
              type: 'sync_error',
              message: 'Wallet no registrado'
            }));
          }

          const wallet = walletsDB.get(data.userId);
          const newTransactions = data.transactions.filter(tx =>
            !wallet.transactions.some(wtx => wtx.id === tx.id)
          );

          wallet.transactions = [...wallet.transactions, ...newTransactions];
          wallet.balance = wallet.transactions.reduce((total, tx) => {
            return tx.type === 'receive' ? total + tx.amount : total - tx.amount;
          }, 10.0);

          sendWalletData(ws, data.userId);
          break;

        default:
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Operación no válida'
          }));
      }
    } catch (err) {
      console.error('Error procesando mensaje:', err);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Error en el formato del mensaje'
      }));
    }
  });

  ws.on('close', () => {
    console.log(`Cliente desconectado: ${ws.userId || 'ID no asignado'}`);
  });
});

console.log('🚀 Servidor WebSocket puro iniciado en ws://0.0.0.0:3000');
