const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let messages = [];
let users = new Map(); // Almacena los usuarios activos

app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (ws) => {
  let userId = Date.now(); // Usamos la fecha para un identificador único por sesión
  let username = '';

  ws.on('message', (message) => {
    const data = JSON.parse(message);

    switch(data.type) {
      case 'login':
        // Verificar si el nombre de usuario ya existe
        const usernameExists = Array.from(users.values())
          .some(user => user.username.toLowerCase() === data.username.toLowerCase());

        if (usernameExists) {
          const randomNumber = Math.floor(Math.random() * 1000);
          username = data.username + randomNumber; // Modificar nombre si ya existe
          ws.send(JSON.stringify({
            type: 'error',
            message: `⚠️ Nombre de usuario ya en uso. Te hemos asignado el nombre: ${username}`
          }));
        } else {
          username = data.username;
        }

        // Guardar el usuario con su ID y WebSocket
        users.set(userId, { username: username, ws: ws });

        // Enviar a todos los clientes la lista actualizada de usuarios activos
        broadcastUsers();
        break;

      case 'message':
        // Procesar el mensaje con enlaces
        const messageWithLinks = data.text.replace(/(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig, '<a href="$1" target="_blank">$1</a>');
        
        const messageData = {
          user: username,
          text: messageWithLinks,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: 'message'
        };

        messages.push(messageData);
        if (messages.length > 100) messages.shift(); // Mantener solo los últimos 100 mensajes
        broadcast(JSON.stringify([messageData])); // Enviar a todos los usuarios
        break;

      case 'privateMessage':
        // Enviar un mensaje privado a un usuario específico
        const recipientUser = Array.from(users.values()).find(user => user.username === data.recipient);

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
            message: `⚠️ El usuario ${data.recipient} no está disponible.`
          }));
        }
        break;

      case 'clear':
        // Solo se limpia el chat para el usuario que lo solicita
        ws.send(JSON.stringify({ type: 'clear' }));
        break;

      case 'getUsers':
        // Enviar la lista de usuarios activos
        ws.send(JSON.stringify({
          type: 'activeUsers',
          users: Array.from(users.values()).map(u => u.username)
        }));
        break;
    }
  });

  // Cuando un cliente se desconecta
  ws.on('close', () => {
    users.delete(userId); // Eliminar al usuario desconectado
    broadcastUsers(); // Actualizar lista de usuarios activos
  });
});

// Enviar a todos los clientes la lista actualizada de usuarios activos
function broadcastUsers() {
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

// Enviar un mensaje a todos los clientes
function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

server.listen(3000, () => {
  console.log('🚀 Servidor corriendo en http://localhost:3000');
});
