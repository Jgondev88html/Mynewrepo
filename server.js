const express = require('express');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const app = express();

// Configuración de la base de datos
const db = new sqlite3.Database('./nvcoin.db', (err) => {
  if (err) {
    console.error('Error al abrir la base de datos', err);
  } else {
    console.log('Conectado a la base de datos SQLite');
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.serialize(() => {
    // Crear tabla de wallets si no existe
    db.run(`
      CREATE TABLE IF NOT EXISTS wallets (
        id TEXT PRIMARY KEY,
        balance REAL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Crear tabla de transacciones si no existe
    db.run(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id TEXT,
        receiver_id TEXT,
        amount REAL,
        status TEXT DEFAULT 'completed',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(sender_id) REFERENCES wallets(id),
        FOREIGN KEY(receiver_id) REFERENCES wallets(id)
      )
    `);
  });
}

// Configuración del servidor Express
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Iniciar servidor HTTP
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Servidor HTTP escuchando en puerto ${PORT}`);
});

// Configuración del servidor WebSocket
const wss = new WebSocket.Server({ server });

// Almacén de clientes conectados
const clients = new Map();

wss.on('connection', (ws) => {
  console.log('Nuevo cliente conectado');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleMessage(ws, data);
    } catch (error) {
      console.error('Error al procesar mensaje:', error);
      ws.send(JSON.stringify({
        action: 'error',
        message: 'Mensaje inválido'
      }));
    }
  });

  ws.on('close', () => {
    console.log('Cliente desconectado');
    // Eliminar de la lista de clientes conectados
    for (let [walletId, client] of clients.entries()) {
      if (client === ws) {
        clients.delete(walletId);
        break;
      }
    }
  });
});

// Manejo de mensajes WebSocket
function handleMessage(ws, data) {
  switch(data.action) {
    case 'register-wallet':
      registerWallet(ws, data.walletId);
      break;

    case 'send-transaction':
      processTransaction(ws, data);
      break;

    case 'get-transaction-history':
      getTransactionHistory(ws, data.walletId);
      break;

    default:
      ws.send(JSON.stringify({
        action: 'error',
        message: 'Acción no reconocida'
      }));
  }
}

// Registrar una nueva wallet
function registerWallet(ws, walletId) {
  if (!walletId) {
    // Crear nueva wallet
    walletId = 'NV_' + Math.random().toString(36).substr(2, 9).toUpperCase();

    db.run(
      'INSERT INTO wallets (id, balance) VALUES (?, ?)',
      [walletId, 1000], // Balance inicial de 1000 NV
      function(err) {
        if (err) {
          console.error('Error al crear wallet:', err);
          ws.send(JSON.stringify({
            action: 'error',
            message: 'Error al crear wallet'
          }));
          return;
        }

        clients.set(walletId, ws);
        notifyWalletRegistered(ws, walletId, 1000);
      }
    );
  } else {
    // Wallet existente
    db.get(
      'SELECT * FROM wallets WHERE id = ?',
      [walletId],
      (err, row) => {
        if (err || !row) {
          console.error('Wallet no encontrada:', err);
          ws.send(JSON.stringify({
            action: 'error',
            message: 'Wallet no encontrada'
          }));
          return;
        }

        clients.set(walletId, ws);
        notifyWalletRegistered(ws, walletId, row.balance);
      }
    );
  }
}

function notifyWalletRegistered(ws, walletId, balance) {
  ws.send(JSON.stringify({
    action: 'wallet-registered',
    walletId,
    balance
  }));

  // Enviar historial de transacciones
  getTransactionHistory(ws, walletId);
}

// Procesar transacción
function processTransaction(ws, data) {
  const { senderId, receiverId, amount } = data;

  // Validaciones básicas
  if (!senderId || !receiverId || !amount || amount <= 0) {
    ws.send(JSON.stringify({
      action: 'error',
      message: 'Datos de transacción inválidos'
    }));
    return;
  }

  if (senderId === receiverId) {
    ws.send(JSON.stringify({
      action: 'error',
      message: 'No puedes enviarte NV a ti mismo'
    }));
    return;
  }

  // Verificar saldo suficiente
  db.get(
    'SELECT balance FROM wallets WHERE id = ?',
    [senderId],
    (err, sender) => {
      if (err || !sender) {
        ws.send(JSON.stringify({
          action: 'error',
          message: 'Wallet remitente no encontrada'
        }));
        return;
      }

      if (sender.balance < amount) {
        ws.send(JSON.stringify({
          action: 'error',
          message: 'Saldo insuficiente'
        }));
        return;
      }

      // Verificar wallet receptora
      db.get(
        'SELECT id FROM wallets WHERE id = ?',
        [receiverId],
        (err, receiver) => {
          if (err || !receiver) {
            ws.send(JSON.stringify({
              action: 'error',
              message: 'Wallet destinatario no encontrada'
            }));
            return;
          }

          // Iniciar transacción
          db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            // Actualizar saldo del remitente
            db.run(
              'UPDATE wallets SET balance = balance - ? WHERE id = ?',
              [amount, senderId],
              function(err) {
                if (err) {
                  db.run('ROLLBACK');
                  ws.send(JSON.stringify({
                    action: 'error',
                    message: 'Error al actualizar saldo remitente'
                  }));
                  return;
                }

                // Actualizar saldo del destinatario
                db.run(
                  'UPDATE wallets SET balance = balance + ? WHERE id = ?',
                  [amount, receiverId],
                  function(err) {
                    if (err) {
                      db.run('ROLLBACK');
                      ws.send(JSON.stringify({
                        action: 'error',
                        message: 'Error al actualizar saldo destinatario'
                      }));
                      return;
                    }

                    // Registrar transacción
                    db.run(
                      'INSERT INTO transactions (sender_id, receiver_id, amount) VALUES (?, ?, ?)',
                      [senderId, receiverId, amount],
                      function(err) {
                        if (err) {
                          db.run('ROLLBACK');
                          ws.send(JSON.stringify({
                            action: 'error',
                            message: 'Error al registrar transacción'
                          }));
                          return;
                        }

                        db.run('COMMIT');

                        // Notificar a ambas wallets
                        notifyTransactionSuccess(senderId, receiverId, amount);
                      }
                    );
                  }
                );
              }
            );
          });
        }
      );
    }
  );
}

function notifyTransactionSuccess(senderId, receiverId, amount) {
  // Obtener nuevos balances
  db.get(
    'SELECT balance FROM wallets WHERE id = ?',
    [senderId],
    (err, sender) => {
      if (!err && sender) {
        const senderWs = clients.get(senderId);
        if (senderWs) {
          senderWs.send(JSON.stringify({
            action: 'transaction-success',
            newBalance: sender.balance
          }));

          // Enviar historial actualizado
          getTransactionHistory(senderWs, senderId);
        }
      }
    }
  );

  db.get(
    'SELECT balance FROM wallets WHERE id = ?',
    [receiverId],
    (err, receiver) => {
      if (!err && receiver) {
        const receiverWs = clients.get(receiverId);
        if (receiverWs) {
          receiverWs.send(JSON.stringify({
            action: 'balance-updated',
            balance: receiver.balance
          }));

          // Enviar historial actualizado
          getTransactionHistory(receiverWs, receiverId);
        }
      }
    }
  );
}

// Obtener historial de transacciones
function getTransactionHistory(ws, walletId) {
  db.all(
    `SELECT * FROM transactions
     WHERE sender_id = ? OR receiver_id = ?
     ORDER BY created_at DESC LIMIT 50`,
    [walletId, walletId],
    (err, rows) => {
      if (err) {
        console.error('Error al obtener historial:', err);
        return;
      }

      const transactions = rows.map(row => ({
        id: row.id,
        type: row.sender_id === walletId ? 'sent' : 'received',
        senderId: row.sender_id,
        receiverId: row.receiver_id,
        amount: row.amount,
        date: row.created_at
      }));

      ws.send(JSON.stringify({
        action: 'transaction-history',
        transactions
      }));
    }
  );
}

// Endpoint HTTP para verificar el saldo (opcional)
app.get('/api/balance/:walletId', (req, res) => {
  const { walletId } = req.params;

  db.get(
    'SELECT balance FROM wallets WHERE id = ?',
    [walletId],
    (err, row) => {
      if (err || !row) {
        return res.status(404).json({ error: 'Wallet no encontrada' });
      }

      res.json({ balance: row.balance });
    }
  );
});

// Manejo de errores
process.on('uncaughtException', (err) => {
  console.error('Error no capturado:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Promesa rechazada no manejada:', err);
});
