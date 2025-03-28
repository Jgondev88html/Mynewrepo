// server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const path = require('path');

// Configuración del servidor
const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Conexión a la base de datos persistente (archivo en disco)
const dbPath = path.resolve(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error al conectar a la base de datos", err);
  } else {
    console.log("Conectado a la base de datos en", dbPath);
  }
});

// Crear tablas en la base de datos (si no existen)
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY,
      balance REAL DEFAULT 100
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id TEXT,
      receiver_id TEXT,
      amount REAL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sender_id) REFERENCES wallets(id),
      FOREIGN KEY (receiver_id) REFERENCES wallets(id)
    )
  `);
});

// Configuración del servidor HTTP y WebSocket
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

// Almacén de conexiones WebSocket
const clients = new Map();

// Manejo de conexiones WebSocket
wss.on('connection', (ws) => {
  console.log('Nuevo cliente conectado.');
  const clientId = uuidv4();
  clients.set(clientId, ws);

  ws.on('message', (message) => {
    console.log(`Mensaje recibido del cliente ${clientId}:`, message);
  });

  ws.on('close', () => {
    console.log(`Cliente ${clientId} desconectado.`);
    clients.delete(clientId);
  });
});

// Función para enviar un mensaje a todos los clientes conectados
const broadcast = (message) => {
  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  });
};

// Rutas

// Crear una nueva wallet (inicializada con 100 VNC si no se especifica otro balance)
app.post('/api/wallets', (req, res) => {
  const walletId = `VNC_${uuidv4()}`;
  const initialBalance = req.body.balance !== undefined ? req.body.balance : 100;

  db.run(
    'INSERT INTO wallets (id, balance) VALUES (?, ?)',
    [walletId, initialBalance],
    (err) => {
      if (err) {
        console.error(err);
        res.status(500).json({ message: 'Error al crear la wallet' });
      } else {
        res.status(201).json({ wallet_id: walletId, balance: initialBalance });
      }
    }
  );
});

// Obtener el balance de una wallet
app.get('/api/wallets/:id', (req, res) => {
  const walletId = req.params.id;
  db.get('SELECT id, balance FROM wallets WHERE id = ?', [walletId], (err, row) => {
    if (err) {
      console.error(err);
      res.status(500).json({ message: 'Error al obtener la wallet' });
    } else if (!row) {
      res.status(404).json({ message: 'Wallet no encontrada' });
    } else {
      res.json(row);
    }
  });
});

// Realizar una transferencia
app.post('/api/transactions', (req, res) => {
  const { sender_id, receiver_id, amount } = req.body;
  if (!sender_id || !receiver_id || amount <= 0) {
    return res.status(400).json({ message: 'Datos inválidos' });
  }

  db.serialize(() => {
    db.get('SELECT balance FROM wallets WHERE id = ?', [sender_id], (err, sender) => {
      if (err || !sender) {
        return res.status(404).json({ message: 'Wallet del remitente no encontrada' });
      }
      if (sender.balance < amount) {
        return res.status(400).json({ message: 'Fondos insuficientes' });
      }

      // Actualizar balance del remitente
      db.run('UPDATE wallets SET balance = balance - ? WHERE id = ?', [amount, sender_id]);
      // Actualizar balance del receptor
      db.run('UPDATE wallets SET balance = balance + ? WHERE id = ?', [amount, receiver_id], function(err) {
        if (err) {
          return res.status(404).json({ message: 'Wallet del receptor no encontrada' });
        }
        // Registrar la transacción
        db.run(
          'INSERT INTO transactions (sender_id, receiver_id, amount) VALUES (?, ?, ?)',
          [sender_id, receiver_id, amount],
          (err) => {
            if (err) {
              console.error(err);
              res.status(500).json({ message: 'Error al realizar la transacción' });
            } else {
              broadcast({
                type: 'transaction',
                sender_id,
                receiver_id,
                amount,
                timestamp: new Date(),
              });
              res.status(201).json({ message: 'Transacción realizada con éxito' });
            }
          }
        );
      });
    });
  });
});

// Obtener historial de transacciones
app.get('/api/transactions/:walletId', (req, res) => {
  const walletId = req.params.walletId;
  db.all(
    'SELECT * FROM transactions WHERE sender_id = ? OR receiver_id = ? ORDER BY timestamp DESC',
    [walletId, walletId],
    (err, rows) => {
      if (err) {
        console.error(err);
        res.status(500).json({ message: 'Error al obtener transacciones' });
      } else {
        res.json(rows);
      }
    }
  );
});

// Iniciar el servidor
server.listen(PORT, () => {
  console.log(`Servidor HTTP y WebSocket corriendo en http://localhost:${PORT}`);
});
