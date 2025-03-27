const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Configuración
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'wallets.db');
const INITIAL_BALANCE = 100;

// Inicializar la base de datos
const db = new sqlite3.Database(DB_FILE, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
  if (err) {
    console.error('Error abriendo la base de datos:', err.message);
  } else {
    console.log('Conectado a la base de datos SQLite.');
    // Habilitar el modo WAL para mejor concurrencia
    db.run('PRAGMA journal_mode = WAL;');
    db.run('PRAGMA synchronous = NORMAL;');
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
    year INTEGER,
    lastUpdated TEXT
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transactionId TEXT UNIQUE,
    walletId TEXT,
    direction TEXT,
    amount REAL,
    date TEXT,
    relatedWalletId TEXT,
    newBalance REAL,
    FOREIGN KEY(walletId) REFERENCES wallets(walletId)
  )`);

  // Índices para mejorar el rendimiento
  db.run('CREATE INDEX IF NOT EXISTS idx_wallets_clientId ON wallets(clientId)');
  db.run('CREATE INDEX IF NOT EXISTS idx_wallets_walletId ON wallets(walletId)');
  db.run('CREATE INDEX IF NOT EXISTS idx_transactions_walletId ON transactions(walletId)');
  db.run('CREATE INDEX IF NOT EXISTS idx_transactions_relatedWalletId ON transactions(relatedWalletId)');
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

const updateWallets = async () => {
  try {
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
  } catch (error) {
    console.error('Error en updateWallets:', error);
  }
};

// Servidor WebSocket
const wss = new WebSocket.Server({ port: PORT });

wss.on('connection', (ws) => {
  console.log('🔌 Nueva conexión');
  let clientId = null;

  // Manejo de errores del WebSocket
  ws.on('error', (error) => {
    console.error('Error en WebSocket:', error.message);
  });

  // Manejo del cierre de la conexión
  ws.on('close', (code, reason) => {
    console.log(`Conexión cerrada: código ${code}, motivo: ${reason.toString()}`);
  });

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log('Mensaje recibido:', data.action);

      if (data.action === 'init') {
        if (!data.clientId) {
          ws.send(JSON.stringify({ action: 'error', message: "clientId no proporcionado" }));
          return;
        }
        
        clientId = data.clientId;
        console.log(`Inicializando para clientId: ${clientId}`);
        
        // Verificar primero si ya tenemos una billetera para este clientId
        let wallet = await new Promise((resolve, reject) => {
          db.get("SELECT * FROM wallets WHERE clientId = ?", [clientId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });

        if (!wallet && data.walletId) {
          // Si no existe por clientId pero nos enviaron un walletId, buscar por walletId
          console.log(`Buscando billetera por walletId: ${data.walletId}`);
          wallet = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM wallets WHERE walletId = ?", [data.walletId], (err, row) => {
              if (err) reject(err);
              else resolve(row);
            });
          });

          if (wallet) {
            // Actualizar el clientId si encontramos una billetera con el walletId
            console.log(`Actualizando clientId para wallet ${wallet.walletId}`);
            await new Promise((resolve, reject) => {
              db.run("UPDATE wallets SET clientId = ?, lastUpdated = ? WHERE walletId = ?", 
                    [clientId, new Date().toISOString(), wallet.walletId], (err) => {
                if (err) reject(err);
                else resolve();
              });
            });
          }
        }

        if (!wallet) {
          // Solo crear nueva billetera si realmente no existe ninguna
          console.log(`Creando nueva billetera para clientId: ${clientId}`);
          const walletId = generateWalletId(clientId);
          const now = new Date().toISOString();
          const week = getWeekNumber(new Date());
          const year = new Date().getFullYear();
          
          await new Promise((resolve, reject) => {
            db.run("INSERT INTO wallets (walletId, clientId, balance, createdAt, week, year, lastUpdated) VALUES (?, ?, ?, ?, ?, ?, ?)",
              [walletId, clientId, INITIAL_BALANCE, now, week, year, now], function(err) {
                if (err) reject(err);
                else resolve();
              });
          });
          
          wallet = { walletId, clientId, balance: INITIAL_BALANCE, createdAt: now, week, year, lastUpdated: now };
        } else {
          console.log(`Billetera existente encontrada: ${wallet.walletId} con saldo ${wallet.balance}`);
        }
        
        ws.walletId = wallet.walletId;
        ws.send(JSON.stringify({ 
          action: 'wallet-info', 
          walletId: wallet.walletId,
          clientId: wallet.clientId,
          balance: wallet.balance,
          week: wallet.week,
          year: wallet.year
        }));
      }

      if (data.action === 'get-wallet-info' && ws.walletId) {
        const wallet = await new Promise((resolve, reject) => {
          db.get("SELECT * FROM wallets WHERE walletId = ?", [ws.walletId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });

        if (wallet) {
          ws.send(JSON.stringify({ 
            action: 'wallet-info', 
            walletId: wallet.walletId,
            balance: wallet.balance,
            week: wallet.week,
            year: wallet.year
          }));
        } else {
          ws.send(JSON.stringify({ action: 'error', message: "Billetera no encontrada" }));
        }
      }

      if (data.action === 'transfer' && ws.walletId) {
        console.log(`Iniciando transferencia desde ${ws.walletId} a ${data.receiverId}`);
        
        const sender = await new Promise((resolve, reject) => {
          db.get("SELECT * FROM wallets WHERE walletId = ?", [ws.walletId], (err, row) => {
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
          const errorMsg = !sender ? "Billetera emisora no encontrada" : "Billetera receptora no encontrada";
          console.error(errorMsg);
          ws.send(JSON.stringify({ action: 'error', message: errorMsg }));
          return;
        }

        if (sender.balance < data.amount) {
          console.error(`Saldo insuficiente: ${sender.balance} < ${data.amount}`);
          ws.send(JSON.stringify({ action: 'error', message: "Saldo insuficiente" }));
          return;
        }

        const senderNewBalance = sender.balance - data.amount;
        const receiverNewBalance = receiver.balance + data.amount;
        const now = new Date().toISOString();

        // Iniciar transacción
        await new Promise((resolve, reject) => {
          db.run("BEGIN TRANSACTION", (err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        try {
          // Actualizar saldo del emisor
          await new Promise((resolve, reject) => {
            db.run("UPDATE wallets SET balance = ?, lastUpdated = ? WHERE walletId = ?", 
                  [senderNewBalance, now, sender.walletId], (err) => {
              if (err) reject(err);
              else resolve();
            });
          });

          // Actualizar saldo del receptor
          await new Promise((resolve, reject) => {
            db.run("UPDATE wallets SET balance = ?, lastUpdated = ? WHERE walletId = ?", 
                  [receiverNewBalance, now, receiver.walletId], (err) => {
              if (err) reject(err);
              else resolve();
            });
          });

          // Registrar transacciones
          const transactionId = generateTransactionId();
          
          await new Promise((resolve, reject) => {
            db.run(`INSERT INTO transactions 
                   (transactionId, walletId, direction, amount, date, relatedWalletId, newBalance) 
                   VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [transactionId, sender.walletId, 'out', data.amount, now, receiver.walletId, senderNewBalance],
              (err) => { if (err) reject(err); else resolve(); }
            );
          });

          await new Promise((resolve, reject) => {
            db.run(`INSERT INTO transactions 
                   (transactionId, walletId, direction, amount, date, relatedWalletId, newBalance) 
                   VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [generateTransactionId(), receiver.walletId, 'in', data.amount, now, sender.walletId, receiverNewBalance],
              (err) => { if (err) reject(err); else resolve(); }
            );
          });

          // Confirmar transacción
          await new Promise((resolve, reject) => {
            db.run("COMMIT", (err) => {
              if (err) reject(err);
              else resolve();
            });
          });

          console.log(`Transferencia exitosa: ${data.amount} VN de ${sender.walletId} a ${receiver.walletId}`);

          // Notificar a los clientes involucrados
          const senderWs = Array.from(wss.clients).find(
            client => client.readyState === WebSocket.OPEN && client.walletId === sender.walletId
          );
          
          const receiverWs = Array.from(wss.clients).find(
            client => client.readyState === WebSocket.OPEN && client.walletId === receiver.walletId
          );

          if (senderWs) {
            senderWs.send(JSON.stringify({
              action: 'transfer-success',
              amount: data.amount,
              newBalance: senderNewBalance
            }));
          }

          if (receiverWs) {
            receiverWs.send(JSON.stringify({
              action: 'transfer-received',
              amount: data.amount,
              senderId: sender.walletId,
              newBalance: receiverNewBalance
            }));
          }

          // Actualizar lista de billeteras para todos
          await updateWallets();
        } catch (error) {
          // Revertir transacción en caso de error
          await new Promise((resolve, reject) => {
            db.run("ROLLBACK", (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
          console.error('Error en transferencia:', error);
          ws.send(JSON.stringify({ action: 'error', message: "Error procesando transferencia" }));
        }
      }

      if (data.action === 'get-history' && ws.walletId) {
        console.log(`Solicitando historial para ${ws.walletId}`);
        db.all(`SELECT * FROM transactions 
               WHERE walletId = ? OR relatedWalletId = ? 
               ORDER BY date DESC LIMIT 100`, 
               [ws.walletId, ws.walletId], (err, rows) => {
          if (err) {
            console.error('Error obteniendo historial:', err);
            ws.send(JSON.stringify({ action: 'error', message: err.message }));
          } else {
            ws.send(JSON.stringify({ action: 'wallet-history', history: rows }));
          }
        });
      }
    } catch (error) {
      console.error("Error handling message:", error);
      ws.send(JSON.stringify({ action: 'error', message: "Ocurrió un error procesando el mensaje." }));
    }
  });
});

// Manejar cierre limpio del servidor
process.on('SIGINT', () => {
  console.log('Cerrando servidor...');
  wss.close(() => {
    db.close((err) => {
      if (err) {
        console.error('Error cerrando la base de datos:', err.message);
      } else {
        console.log('Base de datos cerrada.');
      }
      process.exit();
    });
  });
});

console.log(`🚀 Servidor WebSocket escuchando en puerto ${PORT}`);
