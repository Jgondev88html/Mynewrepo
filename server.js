const express = require('express');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Almacén de usuarios
const waitingUsers = new Set();
const activePairs = new Map();

// Crear servidor HTTP
const server = app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});

// Crear servidor WebSocket
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('Nueva conexión WebSocket');

  ws.on('message', (message) => {
    const data = JSON.parse(message);
    handleMessage(ws, data);
  });

  ws.on('close', () => {
    handleDisconnection(ws);
  });
});

function handleMessage(ws, data) {
  switch (data.type) {
    case 'find_chat':
      handleFindChat(ws);
      break;
    case 'send_message':
      handleSendMessage(ws, data.message);
      break;
    case 'disconnect':
      handleDisconnect(ws);
      break;
  }
}

function handleFindChat(ws) {
  if (activePairs.has(ws)) return;

  waitingUsers.add(ws);
  broadcastWaitingCount();
  sendToClient(ws, { type: 'status', message: 'Buscando otro usuario...' });

  if (waitingUsers.size >= 2) {
    const [user1, user2] = Array.from(waitingUsers);
    waitingUsers.delete(user1);
    waitingUsers.delete(user2);

    activePairs.set(user1, user2);
    activePairs.set(user2, user1);

    sendToClient(user1, { type: 'status', message: 'Conectado con un usuario aleatorio' });
    sendToClient(user1, { type: 'chat_started' });
    sendToClient(user2, { type: 'status', message: 'Conectado con un usuario aleatorio' });
    sendToClient(user2, { type: 'chat_started' });

    broadcastWaitingCount();
  }
}

function handleSendMessage(ws, message) {
  const partner = activePairs.get(ws);
  if (partner && partner.readyState === WebSocket.OPEN) {
    sendToClient(partner, { type: 'receive_message', message });
  }
}

function handleDisconnect(ws) {
  const partner = activePairs.get(ws);
  if (partner && partner.readyState === WebSocket.OPEN) {
    sendToClient(partner, { type: 'status', message: 'El otro usuario se ha desconectado' });
    sendToClient(partner, { type: 'chat_ended' });
    activePairs.delete(partner);
  }

  activePairs.delete(ws);
  waitingUsers.delete(ws);
  broadcastWaitingCount();
}

function handleDisconnection(ws) {
  console.log('Usuario desconectado');
  handleDisconnect(ws);
}

function sendToClient(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastWaitingCount() {
  const count = waitingUsers.size;
  const message = JSON.stringify({ type: 'waiting_count', count });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}
