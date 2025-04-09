const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Datos almacenados en memoria (en producción usaría una base de datos)
const users = {};
const transactions = [];
const adminConnections = new Set();

// Configuración del servidor
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ruta para la página del cliente
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Ruta para el panel de administración
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// WebSocket Server
wss.on('connection', (ws) => {
  console.log('Nueva conexión WebSocket');
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'admin-auth') {
        // Autenticación del panel de administración
        if (data.password === 'admin123') {
          adminConnections.add(ws);
          ws.isAdmin = true;
          console.log('Admin conectado');
          sendAdminData(ws);
        } else {
          ws.send(JSON.stringify({ type: 'auth-error', message: 'Contraseña incorrecta' }));
          ws.close();
        }
        return;
      }
      
      if (ws.isAdmin) {
        handleAdminMessage(ws, data);
        return;
      }
      
      // Mensajes de clientes normales
      handleClientMessage(ws, data);
      
    } catch (error) {
      console.error('Error procesando mensaje:', error);
    }
  });
  
  ws.on('close', () => {
    if (ws.isAdmin) {
      adminConnections.delete(ws);
      console.log('Admin desconectado');
    }
    console.log('Cliente desconectado');
  });
});

function handleClientMessage(ws, data) {
  switch (data.type) {
    case 'register':
      // Registrar nuevo usuario
      if (!users[data.userId]) {
        users[data.userId] = {
          id: data.userId,
          balance: 0,
          positions: [],
          createdAt: new Date()
        };
        ws.userId = data.userId;
        ws.send(JSON.stringify({ 
          type: 'registered', 
          userId: data.userId,
          balance: 0
        }));
        notifyAdmins('new-user', { userId: data.userId });
      } else {
        ws.userId = data.userId;
        sendUserData(ws, data.userId);
      }
      break;
      
    case 'deposit':
      // Procesar depósito
      const amount = parseFloat(data.amount);
      if (isNaN(amount) return;
      
      users[data.userId].balance += amount;
      transactions.push({
        type: 'deposit',
        userId: data.userId,
        amount,
        date: new Date()
      });
      
      ws.send(JSON.stringify({
        type: 'balance-update',
        balance: users[data.userId].balance
      }));
      
      notifyAdmins('transaction', {
        type: 'deposit',
        userId: data.userId,
        amount
      });
      break;
      
    case 'withdraw-request':
      // Solicitud de retiro
      const withdrawAmount = parseFloat(data.amount);
      if (isNaN(withdrawAmount) return;
      
      transactions.push({
        type: 'withdraw-request',
        userId: data.userId,
        amount: withdrawAmount,
        wallet: data.wallet,
        date: new Date(),
        status: 'pending'
      });
      
      notifyAdmins('withdraw-request', {
        userId: data.userId,
        amount: withdrawAmount,
        wallet: data.wallet
      });
      
      ws.send(JSON.stringify({
        type: 'withdraw-requested',
        message: 'Solicitud de retiro enviada'
      }));
      break;
      
    case 'trade':
      // Procesar apuesta
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
      
      ws.send(JSON.stringify({
        type: 'position-opened',
        position,
        balance: user.balance
      }));
      
      notifyAdmins('new-position', {
        userId: data.userId,
        position
      });
      
      // Cerrar posición automáticamente después de 10 segundos
      setTimeout(() => {
        closePosition(data.userId, position.id);
      }, 10000);
      break;
      
    case 'close-position':
      // Cerrar posición manualmente
      closePosition(data.userId, data.positionId);
      break;
  }
}

function handleAdminMessage(ws, data) {
  switch (data.type) {
    case 'approve-withdraw':
      // Aprobar retiro
      const transaction = transactions.find(t => 
        t.type === 'withdraw-request' && 
        t.userId === data.userId && 
        t.amount === data.amount &&
        t.status === 'pending'
      );
      
      if (transaction) {
        transaction.status = 'approved';
        const user = users[data.userId];
        if (user) {
          user.balance -= data.amount;
          
          // Notificar al usuario si está conectado
          wss.clients.forEach(client => {
            if (client.userId === data.userId) {
              client.send(JSON.stringify({
                type: 'withdraw-approved',
                amount: data.amount,
                balance: user.balance
              }));
            }
          });
          
          notifyAdmins('withdraw-approved', {
            userId: data.userId,
            amount: data.amount
          });
        }
      }
      break;
      
    case 'reject-withdraw':
      // Rechazar retiro
      const trans = transactions.find(t => 
        t.type === 'withdraw-request' && 
        t.userId === data.userId && 
        t.amount === data.amount &&
        t.status === 'pending'
      );
      
      if (trans) {
        trans.status = 'rejected';
        
        // Notificar al usuario si está conectado
        wss.clients.forEach(client => {
          if (client.userId === data.userId) {
            client.send(JSON.stringify({
              type: 'withdraw-rejected',
              amount: data.amount
            }));
          }
        });
        
        notifyAdmins('withdraw-rejected', {
          userId: data.userId,
          amount: data.amount
        });
      }
      break;
      
    case 'update-balance':
      // Actualizar balance manualmente (admin)
      const user = users[data.userId];
      if (user) {
        user.balance += parseFloat(data.amount);
        
        transactions.push({
          type: 'admin-adjustment',
          userId: data.userId,
          amount: parseFloat(data.amount),
          admin: 'admin',
          date: new Date()
        });
        
        // Notificar al usuario si está conectado
        wss.clients.forEach(client => {
          if (client.userId === data.userId) {
            client.send(JSON.stringify({
              type: 'balance-update',
              balance: user.balance
            }));
          }
        });
        
        notifyAdmins('balance-updated', {
          userId: data.userId,
          amount: parseFloat(data.amount),
          newBalance: user.balance
        });
      }
      break;
  }
}

function closePosition(userId, positionId) {
  const user = users[userId];
  if (!user) return;
  
  const positionIndex = user.positions.findIndex(p => p.id === positionId);
  if (positionIndex === -1) return;
  
  const position = user.positions[positionIndex];
  
  // Calcular ganancia/pérdida (simulado)
  const priceChange = (Math.random() - 0.4) * 10; // -4% a +6%
  const profit = position.amount * position.leverage * priceChange / 100;
  
  user.balance += position.amount + profit;
  user.positions.splice(positionIndex, 1);
  
  // Notificar al usuario si está conectado
  wss.clients.forEach(client => {
    if (client.userId === userId) {
      client.send(JSON.stringify({
        type: 'position-closed',
        positionId,
        profit,
        balance: user.balance
      }));
    }
  });
  
  notifyAdmins('position-closed', {
    userId,
    positionId,
    profit,
    newBalance: user.balance
  });
}

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
    transactions: transactions.filter(t => t.type !== 'trade' && t.type !== 'position-closed'),
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

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
