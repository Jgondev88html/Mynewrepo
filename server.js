const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let messages = [];
let users = new Map();

app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (ws) => {
  let userId = Date.now();
  let username = '';

  ws.on('message', (message) => {
    const data = JSON.parse(message);

    switch(data.type) {
      case 'login':
        // Verifica si el nombre de usuario ya existe
        const usernameExists = Array.from(users.values())
          .some(user => user.username.toLowerCase() === data.username.toLowerCase());

        if (usernameExists) {
          // Si el nombre de usuario existe, agrega un número aleatorio
          const randomNumber = Math.floor(Math.random() * 1000);
          username = data.username + randomNumber;
          ws.send(JSON.stringify({
            type: 'error',
            message: `⚠️ Nombre de usuario ya en uso. Te hemos asignado el nombre: ${username}`
          }));
        } else {
          username = data.username;
        }

        users.set(userId, {
          username: username,
          ws: ws
        });
        broadcastUsers();
        break;

      case 'message':
        // Procesamos los enlaces en los mensajes
        const messageWithLinks = data.text.replace(/(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig, '<a href="$1" target="_blank">$1</a>');

        const messageData = {
          user: username,
          text: messageWithLinks,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: 'message'
        };

        messages.push(messageData);
        if (messages.length > 100) messages.shift();
        broadcast(JSON.stringify([messageData]));
        break;

      case 'privateMessage':
        // Enviar un mensaje privado a un usuario específico
        const recipient = data.recipient;
        const recipientUser = Array.from(users.values()).find(user => user.username === recipient);

        if (recipientUser) {
          const privateMessage = {
            user: username,
            text: data.text,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            type: 'privateMessage'
          };
          recipientUser.ws.send(JSON.stringify([privateMessage])); // Enviar al usuario receptor
        } else {
          ws.send(JSON.stringify({
            type: 'error',
            message: `⚠️ El usuario ${recipient} no está disponible.`
          }));
        }
        break;

      case 'clear':
        messages = [];
        broadcast(JSON.stringify({ type: 'clear' }));
        break;

      case 'getUsers':
        ws.send(JSON.stringify({
          type: 'activeUsers',
          users: Array.from(users.values()).map(u => u.username)
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
  // Enviar a todos los clientes la lista actualizada de usuarios
  const userList = Array.from(users.values()).map(u => u.username);
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
  // Enviar un mensaje a todos los clientes
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

server.listen(3000, () => {
  console.log('🚀 Servidor corriendo en http://localhost:3000');
});
