const WebSocket = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;
const server = http.createServer();
const wss = new WebSocket.Server({ server });

const walletsDB = new Map();

wss.on('connection', (ws) => {
  console.log('Cliente conectado');

  // Manejo de errores para cada conexión para evitar cierres anormales
  ws.on('error', (error) => {
    console.error('Error en la conexión WebSocket:', error);
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Mensaje recibido:', data.type);

      switch (data.type) {
        case 'register':
          handleRegistration(ws, data);
          break;
        case 'transfer':
          handleTransfer(ws, data);
          break;
        case 'sync':
          handleSync(ws, data);
          break;
        default:
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Tipo de operación no válido'
          }));
      }
    } catch (err) {
      console.error('Error procesando mensaje:', err);
    }
  });

  ws.on('close', () => {
    console.log('Cliente desconectado');
  });
});

function handleRegistration(ws, data) {
  const { userId, balance = 10.0, transactions = [] } = data;

  // Crear wallet si no existe
  if (!walletsDB.has(userId)) {
    walletsDB.set(userId, {
      balance: balance,
      transactions: transactions.length > 0 ? transactions : [{
        id: uuidv4(),
        desc: 'Depósito inicial',
        amount: 10.0,
        type: 'receive',
        date: new Date().toISOString(),
        status: 'confirmed'
      }]
    });
    console.log(`Nuevo wallet registrado: ${userId}`);
  }

  ws.userId = userId;
  sendWalletData(ws, userId);
}

function handleTransfer(ws, data) {
  const { senderId, recipientId, amount, transactionId } = data;

  // Validaciones básicas
  if (!walletsDB.has(senderId) || !walletsDB.has(recipientId)) {
    return ws.send(JSON.stringify({
      type: 'transfer_error',
      message: 'ID de usuario no válido',
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

  // Procesar transacción
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

  // Notificar a los clientes involucrados
  notifyClients(senderId, recipientId, {
    sender: { balance: sender.balance, transaction: sendTx },
    recipient: { balance: recipient.balance, transaction: receiveTx }
  });
}

function handleSync(ws, data) {
  const { userId, transactions = [] } = data;

  if (!walletsDB.has(userId)) {
    return ws.send(JSON.stringify({
      type: 'sync_error',
      message: 'Wallet no registrado'
    }));
  }

  const wallet = walletsDB.get(userId);
  const newTransactions = transactions.filter(tx =>
    !wallet.transactions.some(wtx => wtx.id === tx.id)
  );

  // Fusionar transacciones y recalcular el balance partiendo del depósito inicial de 10.0
  wallet.transactions = [...wallet.transactions, ...newTransactions];
  wallet.balance = wallet.transactions.reduce((total, tx) => {
    return tx.type === 'receive' ? total + tx.amount : total - tx.amount;
  }, 10.0);

  sendWalletData(ws, userId);
}

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

function sendWalletData(ws, userId) {
  const wallet = walletsDB.get(userId) || { balance: 10.0, transactions: [] };
  ws.send(JSON.stringify({
    type: 'wallet_data',
    balance: wallet.balance,
    transactions: wallet.transactions
  }));
}

server.listen(PORT, () => {
  console.log(`Servidor WebSocket corriendo en ws://localhost:${PORT}`);
});
    
