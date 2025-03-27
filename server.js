const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Configuración
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'wallets.db');
const INITIAL_BALANCE = 100;

// Inicializar la base de datos
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error('Error abriendo la base de datos:', err.message);
  } else {
    console.log('Conectado a la base de datos SQLite.');
  }
});

// Crear tablas si no existen
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    walletId TEXT UNIQUE,
    clientId TEXT UNIQUE,
    balance REAL,
    createdAt TEXT,
    week INTEGER,
    year INTEGER
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transactionId TEXT UNIQUE,
    walletId TEXT,
    direction TEXT,
    amount REAL,
    date TEXT,
    relatedWalletId TEXT,
    newBalance REAL
  )`);
});

// Helpers
const getWeekNumber = (date) => {
  const firstDay = new Date(date.getFullYear(), 0, 1);
  return Math.ceil((((date - firstDay) / 86400000) + firstDay.getDay() + 1) / 7);
};

const generateWalletId = (clientId) => {
  if (!clientId) {
    throw new Error("clientId es requerido para generar el Wallet ID");
  }
  const now = new Date();
  return `VC-${now.getFullYear()}-W${getWeekNumber(now)}-${clientId.slice(-8).toUpperCase()}`;
};

const generateTransactionId = () => {
  return `TX-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
};

const updateWallets = async () => {
  const wallets = await new Promise((resolve, reject) => {
    db.all("SELECT * FROM wallets", [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  // Enviar actualización a todos los clientes conectados
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ action: 'wallets-update', wallets }));
    }
  });
};

// Servidor WebSocket
const wss = new WebSocket.Server({ port: PORT });

wss.on('connection', (ws) => {
  console.log('🔌 Nueva conexión');
  let clientId = null;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      // Inicialización del cliente
      if (data.action === 'init') {
        if (!data.clientId) {
          ws.send(JSON.stringify({ action: 'error', message: "clientId no proporcionado" }));
          return;
        }
        clientId = data.clientId;
        let wallet = await new Promise((resolve, reject) => {
          db.get("SELECT * FROM wallets WHERE clientId = ?", [clientId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });
        if (!wallet) {
          const walletId = generateWalletId(clientId);
          const now = new Date().toISOString();
          const week = getWeekNumber(new Date());
          const year = new Date().getFullYear();
          await new Promise((resolve, reject) => {
            db.run("INSERT INTO wallets (walletId, clientId, balance, createdAt, week, year) VALUES (?, ?, ?, ?, ?, ?)",
              [walletId, clientId, INITIAL_BALANCE, now, week, year], function(err) {
                if (err) reject(err);
                else resolve();
              });
          });
          wallet = { walletId, clientId, balance: INITIAL_BALANCE, createdAt: now, week, year };
        }
        // Almacenar walletId en la conexión para usar en el historial
        ws.walletId = wallet.walletId;
        ws.send(JSON.stringify({ action: 'wallet-info', ...wallet }));
      }

      // Solicitar información actualizada de la billetera
      if (data.action === 'get-wallet-info' && clientId) {
        const wallet = await new Promise((resolve, reject) => {
          db.get("SELECT * FROM wallets WHERE clientId = ?", [clientId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });
        ws.send(JSON.stringify({ action: 'wallet-info', ...wallet }));
      }

      // Transferencia
      if (data.action === 'transfer' && clientId) {
        const sender = await new Promise((resolve, reject) => {
          db.get("SELECT * FROM wallets WHERE clientId = ?", [clientId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });
        const receiver = await new Promise((resolve, reject) => {
          db.get("SELECT * FROM wallets WHERE walletId = ?", [data.receiverId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });

        if (!sender || !receiver) throw new Error("Billetera no encontrada");
        if (sender.balance < data.amount) throw new Error("Saldo insuficiente");

        const senderNewBalance = sender.balance - data.amount;
        const receiverNewBalance = receiver.balance + data.amount;

        // Actualizar saldo del emisor
        await new Promise((resolve, reject) => {
          db.run("UPDATE wallets SET balance = ? WHERE walletId = ?", [senderNewBalance, sender.walletId], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        // Actualizar saldo del receptor
        await new Promise((resolve, reject) => {
          db.run("UPDATE wallets SET balance = ? WHERE walletId = ?", [receiverNewBalance, receiver.walletId], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        const transactionId = generateTransactionId();
        const now = new Date().toISOString();
        // Guardar transacción de salida para el emisor
        await new Promise((resolve, reject) => {
          db.run("INSERT INTO transactions (transactionId, walletId, direction, amount, date, relatedWalletId, newBalance) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [transactionId, sender.walletId, 'out', data.amount, now, receiver.walletId, senderNewBalance],
            (err) => { if (err) reject(err); else resolve(); }
          );
        });
        // Guardar transacción de entrada para el receptor
        await new Promise((resolve, reject) => {
          db.run("INSERT INTO transactions (transactionId, walletId, direction, amount, date, relatedWalletId, newBalance) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [generateTransactionId(), receiver.walletId, 'in', data.amount, now, sender.walletId, receiverNewBalance],
            (err) => { if (err) reject(err); else resolve(); }
          );
        });

        // Enviar actualización a todos los clientes
        await updateWallets();
      }

      // Solicitud de historial de transacciones
      if (data.action === 'get-history' && ws.walletId) {
        db.all("SELECT * FROM transactions WHERE walletId = ? OR relatedWalletId = ? ORDER BY date DESC", [ws.walletId, ws.walletId], (err, rows) => {
          if (err) {
            ws.send(JSON.stringify({ action: 'error', message: err.message }));
          } else {
            ws.send(JSON.stringify({ action: 'wallet-history', history: rows }));
          }
        });
      }
    } catch (error) {
      ws.send(JSON.stringify({ action: 'error', message: error.message }));
    }
  });
});

console.log(`🚀 Servidor WebSocket escuchando en puerto ${PORT}`);
