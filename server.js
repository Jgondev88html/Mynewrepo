const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let messages = [];
let users = new Map();

// Función para escapar caracteres HTML
function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}

app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (ws) => {
  let userId = Date.now();
  let username = '';

  ws.on('message', (message) => {
    const data = JSON.parse(message);

    switch (data.type) {
      case 'login':
        const usernameExists = Array.from(users.values())
          .some(user => user.username.toLowerCase() === data.username.toLowerCase());

        if (usernameExists) {
          const randomNumber = Math.floor(Math.random() * 1000);
          username = data.username + randomNumber;
          ws.send(JSON.stringify({
            type: 'error',
            message: `⚠️ Nombre de usuario ya en uso. Te hemos asignado el nombre: ${escapeHtml(username)}`
          }));
        } else {
          username = data.username;
        }

        users.set(userId, { username: username, ws: ws });
        broadcastUsers();
        break;

      case 'message':
        const urlRegex = /(\b(?:https?|ftp|file):\/\/\S+)/gi;
        const parts = data.text.split(urlRegex);
        let processedText = '';
        
        for (let i = 0; i < parts.length; i++) {
          if (i % 2 === 0) {
            processedText += escapeHtml(parts[i]);
          } else {
            const url = parts[i];
            const escapedUrl = escapeHtml(url);
            processedText += `<a href="${escapedUrl}" target="_blank" rel="noopener">${escapedUrl}</a>`;
          }
        }

        const messageData = {
          user: escapeHtml(username),
          text: processedText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: 'message'
        };

        messages.push(messageData);
        if (messages.length > 100) messages.shift();
        broadcast(JSON.stringify([messageData]));
        break;

      case 'privateMessage':
        const recipientUser = Array.from(users.values()).find(user => 
          escapeHtml(user.username) === data.recipient
        );

        if (recipientUser) {
          const privateMessage = {
            user: escapeHtml(username),
            text: escapeHtml(data.text),
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            type: 'privateMessage'
          };
          recipientUser.ws.send(JSON.stringify([privateMessage]));
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            message: '⚠️ Usuario no encontrado'
          }));
        }
        break;

      case 'clear':
        ws.send(JSON.stringify({ type: 'clear' }));
        break;

      case 'getUsers':
        ws.send(JSON.stringify({
          type: 'activeUsers',
          users: Array.from(users.values()).map(u => escapeHtml(u.username))
        }));
        break;
    }
  });

  ws.on('close', () => {
    users.delete(userId);
    broadcastUsers();
  });
});

function broadcastUsers() {
  const userList = Array.from(users.values()).map(u => escapeHtml(u.username));
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'activeUsers',
        users: userList
      }));
    }
  });
}

function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

server.listen(3000, () => {
  console.log('🚀 Servidor seguro corriendo en http://localhost:3000');
});
