// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const users = {}; // Almacena usuarios por username
const MAX_LIVES = 3;
const COIN_PENALTY = 50;
const WITHDRAW_THRESHOLD = 250;

// Configuración de Nodemailer (reemplaza con tus credenciales)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'tuemail@gmail.com',
    pass: 'tucontraseña'
  }
});

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'login':
          handleLogin(ws, data);
          break;
          
        case 'gameOver':
          handleGameOver(ws, data);
          break;
          
        case 'withdraw':
          handleWithdraw(ws, data);
          break;
      }
    } catch (error) {
      console.error('Error procesando mensaje:', error);
    }
  });

  ws.on('close', () => {
    // Limpiar recursos si es necesario
  });
});

function handleLogin(ws, data) {
  if (!data.username) {
    ws.send(JSON.stringify({ type: 'error', message: 'Username requerido' }));
    return;
  }

  // Crear nuevo usuario si no existe
  if (!users[data.username]) {
    users[data.username] = {
      username: data.username,
      lives: MAX_LIVES,
      coins: 0,
      ws: ws
    };
  }

  // Actualizar conexión WebSocket
  users[data.username].ws = ws;

  // Enviar datos actualizados al cliente
  ws.send(JSON.stringify({
    type: 'loginSuccess',
    user: {
      username: users[data.username].username,
      lives: users[data.username].lives,
      coins: users[data.username].coins
    }
  }));
}

function handleGameOver(ws, data) {
  const username = Object.keys(users).find(key => users[key].ws === ws);
  
  if (username && users[username]) {
    users[username].lives = Math.max(0, users[username].lives - 1);
    users[username].coins = Math.max(0, users[username].coins - COIN_PENALTY);
    
    ws.send(JSON.stringify({
      type: 'update',
      user: users[username]
    }));
  }
}

function handleWithdraw(ws, data) {
  const username = Object.keys(users).find(key => users[key].ws === ws);
  
  if (username && users[username]) {
    if (users[username].coins >= WITHDRAW_THRESHOLD) {
      sendWithdrawalEmail(data.email, data.phone, data.amount);
      users[username].coins -= data.amount;
      
      ws.send(JSON.stringify({
        type: 'update',
        user: users[username]
      }));
    }
  }
}

function sendWithdrawalEmail(phone, amount) {
  const mailOptions = {
    from: 'tuemail@gmail.com',
    to: 'tuemail@gmail.com',
    subject: 'Solicitud de Retiro',
    text: `Solicitud de retiro:
           - Número: ${phone}
           - Monto: ${amount} monedas`
  };

  transporter.sendMail(mailOptions, (error) => {
    if (error) console.error('Error enviando email:', error);
  });
}

server.listen(3000, () => {
  console.log('Servidor escuchando en http://localhost:3000');
});
