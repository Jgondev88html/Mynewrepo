const WebSocket = require('ws');
const http = require('http');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Configuración de SQLite
const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);

// Inicializar base de datos
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      userId TEXT PRIMARY KEY,
      balance REAL DEFAULT 0,
      lastUpdated TEXT DEFAULT CURRENT_TIMESTAMP
    ) WITHOUT ROWID
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      txId TEXT PRIMARY KEY,
      senderId TEXT,
      recipientId TEXT,
      amount REAL,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      status TEXT,
      isMint INTEGER DEFAULT 0,
      FOREIGN KEY(senderId) REFERENCES users(userId),
      FOREIGN KEY(recipientId) REFERENCES users(userId)
    ) WITHOUT ROWID
  `);
});

// Configuración del servidor
const MINT_AMOUNT = 10;
const MINT_INTERVAL = 30000; // 30 segundos
const INITIAL_BALANCE = 0;
let firstUserId = null;

// Obtener el primer usuario al iniciar
db.get('SELECT userId FROM users ORDER BY lastUpdated ASC LIMIT 1', (err, row) => {
  if (!err && row) firstUserId = row.userId;
});

const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('FT Wallet Server\n');
});

const wss = new WebSocket.Server({ server });

// Función para generar tokens
async function mintTokens() {
  if (!firstUserId) return;

  const txId = generateId();
  const timestamp = new Date().toISOString();

  db.serialize(() => {
    db.run(
      `INSERT INTO transactions (txId, senderId, recipientId, amount, timestamp, status, isMint)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [txId, 'system', firstUserId, MINT_AMOUNT, timestamp, 'completed', 1]
    );

    db.run(
      'UPDATE users SET balance = balance + ?, lastUpdated = ? WHERE userId = ?',
      [MINT_AMOUNT, timestamp, firstUserId],
      (err) => {
        if (!err) {
          console.log(`[MINT] ${MINT_AMOUNT} tokens para ${shortenId(firstUserId)}`);
          sendUserState(firstUserId);
        }
      }
    );
  });
}

// Conexiones WebSocket
const activeConnections = new Map(); // {userId: WebSocket}

wss.on('connection', (ws) => {
  let userId = null;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'register') {
        userId = data.userId;
        activeConnections.set(userId, ws);

        await db.run(
          'INSERT OR IGNORE INTO users (userId, balance) VALUES (?, ?)',
          [userId, INITIAL_BALANCE]
        );

        if (!firstUserId) {
          firstUserId = userId;
          console.log(`[REGISTER] Primer usuario: ${shortenId(userId)}`);
        }

        sendUserState(userId);
      }

      if (data.type === 'send') {
        const { recipientId, amount } = data;
        const txId = generateId();

        // Verificar fondos
        db.get('SELECT balance FROM users WHERE userId = ?', [userId], (err, sender) => {
          if (err || !sender || sender.balance < amount) {
            return ws.send(JSON.stringify({
              type: 'error',
              message: 'Fondos insuficientes'
            }));
          }

          // Procesar transacción
          db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            db.run(
              'UPDATE users SET balance = balance - ? WHERE userId = ?',
              [amount, userId]
            );

            db.run(
              'INSERT OR IGNORE INTO users (userId, balance) VALUES (?, ?)',
              [recipientId, INITIAL_BALANCE]
            );

            db.run(
              'UPDATE users SET balance = balance + ? WHERE userId = ?',
              [amount, recipientId]
            );

            db.run(
              `INSERT INTO transactions 
               (txId, senderId, recipientId, amount, status)
               VALUES (?, ?, ?, ?, ?)`,
              [txId, userId, recipientId, amount, 'completed']
            );

            db.run('COMMIT', (err) => {
              if (err) {
                db.run('ROLLBACK');
                return ws.send(JSON.stringify({
                  type: 'error',
                  message: 'Error en la transacción'
                }));
              }

              sendUserState(userId);
              sendUserState(recipientId);
            });
          });
        });
      }
    } catch (err) {
      console.error('Error:', err);
    }
  });

  ws.on('close', () => {
    if (userId) activeConnections.delete(userId);
  });
});

// Función para enviar estado al usuario
function sendUserState(userId) {
  db.serialize(() => {
    db.get('SELECT balance FROM users WHERE userId = ?', [userId], (err, user) => {
      if (err || !user) return;

      db.all(
        `SELECT * FROM transactions 
         WHERE senderId = ? OR recipientId = ?
         ORDER BY timestamp DESC`,
        [userId, userId],
        (err, txs) => {
          if (err) return;

          const ws = activeConnections.get(userId);
          if (ws) {
            ws.send(JSON.stringify({
              type: 'state',
              balance: user.balance,
              transactions: txs.map(tx => ({
                ...tx,
                isMint: tx.isMint === 1
              }))
            }));
          }
        }
      );
    });
  });
}

// Helpers
function generateId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function shortenId(id) {
  return id ? `${id.substring(0, 6)}...${id.substring(id.length - 4)}` : 'null';
}

// Iniciar generación de tokens
setInterval(mintTokens, MINT_INTERVAL);

// Manejar cierre limpio
process.on('SIGINT', () => {
  db.close();
  server.close();
  process.exit(0);
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor iniciado en puerto ${PORT}`);
  console.log(`Generando ${MINT_AMOUNT} tokens cada ${MINT_INTERVAL/1000} segundos`);
});
