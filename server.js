require('dotenv').config(); // Asegúrate de tener el paquete dotenv instalado
const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

// Configuración de entorno
const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (isProduction ? null : 'admin9910');

if (isProduction && !ADMIN_PASSWORD) {
  console.error('ERROR: ADMIN_PASSWORD no está configurado en producción');
  process.exit(1);
}

// Inicialización de la app
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middlewares
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Forzar HTTPS en producción
if (isProduction) {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(`https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// Datos en memoria (en producción usa una DB)
const users = {};
const transactions = [];
const adminConnections = new Set();

// Rutas
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Health Check para Render
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    websocketClients: wss.clients.size,
    users: Object.keys(users).length
  });
});

// WebSocket Server
wss.on('connection', (ws) => {
  console.log('Nueva conexión WebSocket');
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'admin-auth') {
        handleAdminAuth(ws, data);
        return;
      }
      
      if (ws.isAdmin) {
        handleAdminMessage(ws, data);
        return;
      }
      
      handleClientMessage(ws, data);
      
    } catch (error) {
      console.error('Error procesando mensaje:', error);
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: 'Error procesando la solicitud' 
      }));
    }
  });
  
  ws.on('close', () => {
    if (ws.isAdmin) {
      adminConnections.delete(ws);
      console.log('Admin desconectado');
    }
    console.log('Cliente desconectado');
  });
  
  ws.on('error', (error) => {
    console.error('Error en WebSocket:', error);
  });
});

// Funciones de manejo de mensajes
function handleAdminAuth(ws, data) {
  if (data.password === ADMIN_PASSWORD) {
    adminConnections.add(ws);
    ws.isAdmin = true;
    console.log('Admin conectado');
    sendAdminData(ws);
    ws.send(JSON.stringify({ 
      type: 'auth-success',
      message: 'Autenticación exitosa' 
    }));
  } else {
    ws.send(JSON.stringify({ 
      type: 'auth-error', 
      message: 'Contraseña incorrecta' 
    }));
    ws.close();
  }
}

function handleClientMessage(ws, data) {
  switch (data.type) {
    case 'register':
      registerUser(ws, data);
      break;
    case 'deposit':
      processDeposit(ws, data);
      break;
    case 'withdraw-request':
      processWithdrawRequest(ws, data);
      break;
    case 'trade':
      processTrade(ws, data);
      break;
    case 'close-position':
      closePosition(data.userId, data.positionId);
      break;
    default:
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Tipo de mensaje no reconocido'
      }));
  }
}

function handleAdminMessage(ws, data) {
  switch (data.type) {
    case 'approve-withdraw':
      approveWithdrawal(data.userId, data.amount);
      break;
    case 'reject-withdraw':
      rejectWithdrawal(data.userId, data.amount);
      break;
    case 'update-balance':
      updateUserBalance(data.userId, data.amount);
      break;
    default:
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Comando de admin no reconocido'
      }));
  }
}

// Funciones de negocio
function registerUser(ws, data) {
  if (!users[data.userId]) {
    users[data.userId] = {
      id: data.userId,
      balance: 0,
      positions: [],
      createdAt: new Date()
    };
  }
  ws.userId = data.userId;
  sendUserData(ws, data.userId);
  notifyAdmins('new-user', { userId: data.userId });
}

function processDeposit(ws, data) {
  const amount = parseFloat(data.amount);
  if (isNaN(amount) || amount <= 0) return;

  users[data.userId].balance += amount;
  transactions.push({
    type: 'deposit',
    userId: data.userId,
    amount,
    date: new Date()
  });

  sendUserData(ws, data.userId);
  notifyAdmins('transaction', {
    type: 'deposit',
    userId: data.userId,
    amount
  });
}

function processWithdrawRequest(ws, data) {
  const amount = parseFloat(data.amount);
  if (isNaN(amount) return;

  transactions.push({
    type: 'withdraw-request',
    userId: data.userId,
    amount,
    wallet: data.wallet,
    date: new Date(),
    status: 'pending'
  });

  notifyAdmins('withdraw-request', {
    userId: data.userId,
    amount,
    wallet: data.wallet
  });

  ws.send(JSON.stringify({
    type: 'withdraw-requested',
    message: 'Solicitud de retiro enviada'
  }));
}

function processTrade(ws, data) {
  const user = users[data.userId];
  if (!user) return;

  const position = {
    id: Date.now(),
    type: data.tradeType,
    amount: parseFloat(data.amount),
    leverage: parseInt(data.leverage),
    entryPrice: parseFloat(data.entryPrice),
    timestamp: new Date()
  };

  user.positions.push(position);
  user.balance -= position.amount;

  sendUserData(ws, data.userId);
  notifyAdmins('new-position', {
    userId: data.userId,
    position
  });

  setTimeout(() => {
    closePosition(data.userId, position.id);
  }, 10000);
}

// Funciones de utilidad
function sendUserData(ws, userId) {
  const user = users[userId];
  if (!user) return;

  ws.send(JSON.stringify({
    type: 'user-data',
    userId,
    balance: user.balance,
    positions: user.positions
  }));
}

function sendAdminData(ws) {
  ws.send(JSON.stringify({
    type: 'admin-data',
    users: Object.values(users),
    transactions: transactions.filter(t => t.type !== 'trade'),
    pendingWithdrawals: transactions.filter(t => 
      t.type === 'withdraw-request' && t.status === 'pending'
    )
  }));
}

function notifyAdmins(eventType, data) {
  adminConnections.forEach(admin => {
    admin.send(JSON.stringify({
      type: 'admin-notification',
      event: eventType,
      data
    }));
  });
}

function closePosition(userId, positionId) {
  const user = users[userId];
  if (!user) return;

  const positionIndex = user.positions.findIndex(p => p.id === positionId);
  if (positionIndex === -1) return;

  const position = user.positions[positionIndex];
  const priceChange = (Math.random() - 0.4) * 10;
  const profit = position.amount * position.leverage * priceChange / 100;

  user.balance += position.amount + profit;
  user.positions.splice(positionIndex, 1);

  broadcastToUser(userId, {
    type: 'position-closed',
    positionId,
    profit,
    balance: user.balance
  });

  notifyAdmins('position-closed', {
    userId,
    positionId,
    profit,
    newBalance: user.balance
  });
}

function broadcastToUser(userId, message) {
  wss.clients.forEach(client => {
    if (client.userId === userId) {
      client.send(JSON.stringify(message));
    }
  });
}

// Iniciar servidor
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en http://0.0.0.0:${PORT}`);
  if (!isProduction) {
    console.log(`Modo desarrollo - Admin password: ${ADMIN_PASSWORD}`);
  }
});

// Keep-alive para Render
setInterval(() => {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.ping();
    }
  });
}, 30000);

// Manejo de errores globales
process.on('uncaughtException', (err) => {
  console.error('Error no capturado:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Promise rechazada no capturada:', err);
});
