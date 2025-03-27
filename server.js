const express = require('express');
const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');

// Configuración
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'wallets.db');
const INITIAL_BALANCE = 0;
const SALT_ROUNDS = 10;

// Inicializar Express y WebSocket
const app = express();
const server = app.listen(PORT, () => {
  console.log(`🚀 Servidor HTTP/WebSocket escuchando en puerto ${PORT}`);
});
const wss = new WebSocket.Server({ server });

// Middleware para sesiones
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Cambiar a true en producción con HTTPS
}));

// Middleware para parsear JSON y formularios
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configurar archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Inicializar la base de datos
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error('Error abriendo la base de datos:', err.message);
  } else {
    console.log('Conectado a la base de datos SQLite.');
    initializeDatabase();
  }
});

// Funciones de ayuda
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

const generateAdminId = () => {
  return `ADM-${Date.now()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
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

// Inicialización de la base de datos
const initializeDatabase = async () => {
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
    
    db.run(`CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      adminId TEXT UNIQUE,
      username TEXT UNIQUE,
      passwordHash TEXT,
      permissions TEXT,
      createdAt TEXT
    )`);
  });

  // Crear admin inicial si no existe
  const adminCount = await new Promise((resolve, reject) => {
    db.get("SELECT COUNT(*) as count FROM admins", [], (err, row) => {
      if (err) reject(err);
      else resolve(row ? row.count : 0);
    });
  });

  if (adminCount === 0) {
    const passwordHash = await bcrypt.hash('admin123', SALT_ROUNDS);
    const adminId = generateAdminId();
    const now = new Date().toISOString();
    
    await new Promise((resolve, reject) => {
      db.run("INSERT INTO admins (adminId, username, passwordHash, permissions, createdAt) VALUES (?, ?, ?, ?, ?)",
        [adminId, 'admin', passwordHash, 'super', now],
        (err) => { if (err) reject(err); else resolve(); }
      );
    });
    console.log('✅ Admin inicial creado - usuario: admin, contraseña: admin123');
  }
};

// RUTAS DE ADMINISTRACIÓN
app.get('/admin', (req, res) => {
  if (!req.session.admin) {
    return res.redirect('/admin/login');
  }
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Admin Dashboard</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
        .header { display: flex; justify-content: space-between; margin-bottom: 20px; }
        .card { border: 1px solid #ddd; border-radius: 5px; padding: 15px; margin-bottom: 15px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
        button { padding: 5px 10px; cursor: pointer; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Admin Dashboard</h1>
        <a href="/admin/logout">Cerrar sesión</a>
      </div>
      
      <div class="card">
        <h2>Acreditar VN Coins</h2>
        <form id="creditForm">
          <input type="text" id="walletId" placeholder="Wallet ID" required>
          <input type="number" id="amount" placeholder="Cantidad" required>
          <button type="submit">Acreditar</button>
        </form>
      </div>
      
      <div class="card">
        <h2>Últimas Transacciones</h2>
        <div id="transactionsList"></div>
      </div>
      
      <script>
        document.getElementById('creditForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const walletId = document.getElementById('walletId').value;
          const amount = parseFloat(document.getElementById('amount').value);
          
          const response = await fetch('/admin/credit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ walletId, amount })
          });
          
          const result = await response.json();
          alert(result.message);
          if (response.ok) {
            document.getElementById('creditForm').reset();
          }
        });
        
        // Cargar transacciones al iniciar
        async function loadTransactions() {
          const response = await fetch('/admin/transactions');
          const transactions = await response.json();
          
          const html = transactions.map(t => \`
            <div>
              <p><strong>\${t.transactionId}</strong> - \${t.amount} VN (Saldo: \${t.newBalance})</p>
              <p>\${t.date} - \${t.walletId}</p>
            </div>
          \`).join('');
          
          document.getElementById('transactionsList').innerHTML = html;
        }
        
        loadTransactions();
      </script>
    </body>
    </html>
  `);
});

app.get('/admin/login', (req, res) => {
  if (req.session.admin) {
    return res.redirect('/admin');
  }
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Admin Login</title>
    </head>
    <body>
      <h1>Admin Login</h1>
      <form action="/admin/login" method="POST">
        <input type="text" name="username" placeholder="Username" required><br>
        <input type="password" name="password" placeholder="Password" required><br>
        <button type="submit">Login</button>
      </form>
    </body>
    </html>
  `);
});

app.post('/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await new Promise((resolve, reject) => {
      db.get("SELECT * FROM admins WHERE username = ?", [username], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!admin) {
      return res.status(401).send('Credenciales inválidas');
    }

    const match = await bcrypt.compare(password, admin.passwordHash);
    if (!match) {
      return res.status(401).send('Credenciales inválidas');
    }

    req.session.admin = {
      adminId: admin.adminId,
      username: admin.username,
      permissions: admin.permissions
    };

    res.redirect('/admin');
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).send('Error interno del servidor');
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

app.post('/admin/credit', async (req, res) => {
  if (!req.session.admin) {
    return res.status(401).json({ message: 'No autorizado' });
  }

  try {
    const { walletId, amount } = req.body;
    if (!walletId || !amount || amount <= 0) {
      return res.status(400).json({ message: 'Datos inválidos' });
    }

    // Obtener la wallet
    const wallet = await new Promise((resolve, reject) => {
      db.get("SELECT * FROM wallets WHERE walletId = ?", [walletId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!wallet) {
      return res.status(404).json({ message: 'Wallet no encontrada' });
    }

    const newBalance = wallet.balance + amount;
    const transactionId = generateTransactionId();
    const now = new Date().toISOString();

    // Actualizar balance
    await new Promise((resolve, reject) => {
      db.run("UPDATE wallets SET balance = ? WHERE walletId = ?", 
        [newBalance, walletId], (err) => {
          if (err) reject(err);
          else resolve();
        });
    });

    // Registrar transacción
    await new Promise((resolve, reject) => {
      db.run(`INSERT INTO transactions 
        (transactionId, walletId, direction, amount, date, relatedWalletId, newBalance) 
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [transactionId, walletId, 'in', amount, now, 'ADMIN_CREDIT', newBalance],
        (err) => { if (err) reject(err); else resolve(); }
      );
    });

    // Notificar a los clientes WebSocket
    updateWallets();

    res.json({ message: `Se acreditaron ${amount} VN Coins a ${walletId}` });
  } catch (error) {
    console.error('Error acreditando fondos:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

app.get('/admin/transactions', async (req, res) => {
  if (!req.session.admin) {
    return res.status(401).json({ message: 'No autorizado' });
  }

  try {
    const transactions = await new Promise((resolve, reject) => {
      db.all("SELECT * FROM transactions ORDER BY date DESC LIMIT 20", [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    res.json(transactions);
  } catch (error) {
    console.error('Error obteniendo transacciones:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// WebSocket Server (código original)
wss.on('connection', (ws) => {
  console.log('🔌 Nueva conexión');
  let clientId = null;

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
        ws.walletId = wallet.walletId;
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
    } catch (error) {
      console.error("Error handling message:", error);
      ws.send(JSON.stringify({ action: 'error', message: "Ocurrió un error procesando el mensaje." }));
    }
  });
});

console.log(`✅ Servidor listo en http://localhost:${PORT}`);
