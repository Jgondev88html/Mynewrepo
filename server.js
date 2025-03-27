const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');

// Configuración
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'wallets.db');
const INITIAL_BALANCE = 100;
const DAILY_REWARD = 5;

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
    lastRewardDate TEXT,
    deviceHash TEXT,
    ipHash TEXT
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
  
  db.run(`CREATE TABLE IF NOT EXISTS banned_hashes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT UNIQUE,
    reason TEXT,
    bannedAt TEXT
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
  return `VC-${now.getFullYear()}-W${getWeekNumber(now)}-${clientId.substring(clientId.length - 8).toUpperCase()}`;
};

const generateTransactionId = () => {
  return `TX-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
};

const hashData = (data) => {
  return crypto.createHash('sha256').update(data).digest('hex');
};

const checkIfBanned = async (deviceHash, ipHash) => {
  return new Promise((resolve, reject) => {
    db.get("SELECT * FROM banned_hashes WHERE hash = ? OR hash = ?", [deviceHash, ipHash], (err, row) => {
      if (err) reject(err);
      else resolve(!!row);
    });
  });
};

const updateWallets = async () => {
  const wallets = await new Promise((resolve, reject) => {
    db.all("SELECT * FROM wallets", [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ action: 'wallets-update', wallets }));
    }
  });
};

// Servidor WebSocket
const wss = new WebSocket.Server({ port: PORT });

wss.on('connection', (ws, req) => {
  console.log('🔌 Nueva conexión');
  let clientId = null;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const ipHash = hashData(ip);

  ws.on('error', (error) => {
    console.error('Error en WebSocket:', error.message);
  });

  ws.on('close', (code, reason) => {
    console.log(`Conexión cerrada: código ${code}, motivo: ${reason}`);
  });

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.action === 'init') {
        if (!data.clientId || !data.deviceId) {
          ws.send(JSON.stringify({ action: 'error', message: "Se requieren clientId y deviceId" }));
          return;
        }
        
        const deviceHash = hashData(data.deviceId);
        const isBanned = await checkIfBanned(deviceHash, ipHash);
        
        if (isBanned) {
          ws.send(JSON.stringify({ action: 'error', message: "Acceso denegado. Cuenta suspendida." }));
          ws.close();
          return;
        }
        
        clientId = data.clientId;
        
        const existingWallet = await new Promise((resolve, reject) => {
          db.get("SELECT * FROM wallets WHERE deviceHash = ?", [deviceHash], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });
        
        if (existingWallet && existingWallet.clientId !== clientId) {
          ws.send(JSON.stringify({ action: 'error', message: "Dispositivo ya registrado con otra cuenta" }));
          ws.close();
          return;
        }
        
        let wallet = await new Promise((resolve, reject) => {
          db.get("SELECT * FROM wallets WHERE clientId = ?", [clientId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });
        
        if (!wallet) {
          const walletId = generateWalletId(clientId);
          const now = new Date().toISOString();
          
          await new Promise((resolve, reject) => {
            db.run(`INSERT INTO wallets 
              (walletId, clientId, balance, createdAt, lastRewardDate, deviceHash, ipHash) 
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [walletId, clientId, INITIAL_BALANCE, now, null, deviceHash, ipHash], 
              function(err) {
                if (err) reject(err);
                else resolve();
              });
          });
          
          wallet = { 
            walletId, 
            clientId, 
            balance: INITIAL_BALANCE, 
            createdAt: now,
            deviceHash,
            ipHash
          };
        }
        
        ws.walletId = wallet.walletId;
        ws.deviceHash = wallet.deviceHash;
        ws.send(JSON.stringify({ action: 'wallet-info', ...wallet }));
      }

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

        if (!sender || !receiver) {
          ws.send(JSON.stringify({ action: 'error', message: "Billetera no encontrada" }));
          return;
        }

        if (sender.balance < data.amount) {
          ws.send(JSON.stringify({ action: 'error', message: "Saldo insuficiente" }));
          return;
        }

        const senderNewBalance = sender.balance - data.amount;
        const receiverNewBalance = receiver.balance + data.amount;

        await new Promise((resolve, reject) => {
          db.run("UPDATE wallets SET balance = ? WHERE walletId = ?", [senderNewBalance, sender.walletId], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        await new Promise((resolve, reject) => {
          db.run("UPDATE wallets SET balance = ? WHERE walletId = ?", [receiverNewBalance, receiver.walletId], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        const transactionId = generateTransactionId();
        const now = new Date().toISOString();

        await new Promise((resolve, reject) => {
          db.run("INSERT INTO transactions (transactionId, walletId, direction, amount, date, relatedWalletId, newBalance) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [transactionId, sender.walletId, 'out', data.amount, now, receiver.walletId, senderNewBalance],
            (err) => { if (err) reject(err); else resolve(); }
          );
        });

        await new Promise((resolve, reject) => {
          db.run("INSERT INTO transactions (transactionId, walletId, direction, amount, date, relatedWalletId, newBalance) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [generateTransactionId(), receiver.walletId, 'in', data.amount, now, sender.walletId, receiverNewBalance],
            (err) => { if (err) reject(err); else resolve(); }
          );
        });

        await updateWallets();
      }

      if (data.action === 'get-history' && ws.walletId) {
        db.all("SELECT * FROM transactions WHERE walletId = ? OR relatedWalletId = ? ORDER BY date DESC", [ws.walletId, ws.walletId], (err, rows) => {
          if (err) {
            ws.send(JSON.stringify({ action: 'error', message: err.message }));
          } else {
            ws.send(JSON.stringify({ action: 'wallet-history', history: rows }));
          }
        });
      }

      if (data.action === 'claim-daily') {
        if (!ws.walletId || !ws.deviceHash) {
          ws.send(JSON.stringify({ action: 'error', message: "Debes iniciar sesión primero" }));
          return;
        }
        
        const today = new Date().toISOString().split('T')[0];
        const wallet = await new Promise((resolve, reject) => {
          db.get("SELECT * FROM wallets WHERE walletId = ?", [ws.walletId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });
        
        if (wallet.lastRewardDate === today) {
          ws.send(JSON.stringify({ action: 'error', message: "Ya reclamaste tu recompensa diaria hoy" }));
          return;
        }
        
        const newBalance = wallet.balance + DAILY_REWARD;
        const transactionId = generateTransactionId();
        const now = new Date().toISOString();
        
        await new Promise((resolve, reject) => {
          db.run("UPDATE wallets SET balance = ?, lastRewardDate = ? WHERE walletId = ?",
            [newBalance, today, ws.walletId], (err) => {
              if (err) reject(err);
              else resolve();
            });
        });
        
        await new Promise((resolve, reject) => {
          db.run(`INSERT INTO transactions 
            (transactionId, walletId, direction, amount, date, relatedWalletId, newBalance) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [transactionId, ws.walletId, 'in', DAILY_REWARD, now, 'DAILY_REWARD', newBalance],
            (err) => { if (err) reject(err); else resolve(); }
          );
        });
        
        ws.send(JSON.stringify({ 
          action: 'daily-reward', 
          amount: DAILY_REWARD,
          newBalance,
          message: `¡Recompensa diaria de ${DAILY_REWARD} monedas recibida!`
        }));
        
        await updateWallets();
      }
    } catch (error) {
      console.error("Error handling message:", error);
      ws.send(JSON.stringify({ action: 'error', message: "Ocurrió un error procesando el mensaje." }));
    }
  });
});

console.log(`🚀 Servidor WebSocket escuchando en puerto ${PORT}`);
