const WebSocket = require('ws');
const PORT = process.env.PORT || 3000;

let wss;
let activeUsers = new Set();

// Lista de palabras inapropiadas
const inappropriateWords = ['pinga', 'verga', 'culo', 'bollo', 'asesino', 'estupido', 'maricon', 'gay', 'polla', 'mierda'];

function createWebSocketServer() {
  wss = new WebSocket.Server({ port: PORT });

  wss.on('connection', ws => {
    console.log('Nuevo cliente conectado');

    ws.on('message', message => {
      const data = JSON.parse(message);

      if (data.action === 'join') {
        ws.username = data.username;
        activeUsers.add(data.username);
        sendWelcomeMessage(data.username);
        broadcastUsers();
      } else if (data.action === 'leave') {
        activeUsers.delete(data.username);
        broadcastUsers();
      } else {
        if (containsInappropriateContent(data.message)) {
          ws.send(JSON.stringify({ username: 'Bot', message: 'Tu mensaje contiene contenido inapropiado y ha sido eliminado.' }));
          sendAlertMessage(ws.username, data.message);
        } else {
          if (data.private && activeUsers.has(data.to)) {
            sendPrivateMessage(data);
          } else {
            broadcastMessage(data);
          }
        }
      }
    });

    ws.on('close', () => {
      console.log('Cliente desconectado');
      if (ws.username) {
        activeUsers.delete(ws.username);
        broadcastUsers();
      }
    });
  });

  function broadcastUsers() {
    const data = JSON.stringify({ action: 'updateUsers', users: Array.from(activeUsers) });
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  function broadcastMessage(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  function sendPrivateMessage(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN && client.username === data.to) {
        client.send(message);
      }
    });
  }

  function sendWelcomeMessage(username) {
    const message = JSON.stringify({ username: 'Bot🤖', message: `Bienvenido, ${username}! a FriendlyChat, Chat para hacer amigos🫂... (Funciones)=> 'Enviar mensajes', 'Responder mensajes tocando el mensaje que quiera responder💌', 'Enviar imagenes🏖️', 'Ver a los usuarios activos💬', 'Enviar emojis✅', 'Chat privado😁' Espero que el Chat sea de su agrado diviertese!` });
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  function sendAlertMessage(username, originalMessage) {
    const message = JSON.stringify({ username: 'Bot', message: `El usuario ${username} ha intentado enviar un mensaje inapropiado: "${originalMessage}".` });
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  function containsInappropriateContent(message) {
    for (let word of inappropriateWords) {
      if (message.toLowerCase().includes(word)) {
        return true;
      }
    }
    return false;
  }

  console.log(`Servidor ejecutando en el puerto ${PORT}`);
}

createWebSocketServer();

wss.on('close', () => {
  console.log('Conexión perdida. Intentando reconectar...');
  setTimeout(() => {
    createWebSocketServer();
  }, 5000); // Intenta reconectar cada 5 segundos
});
