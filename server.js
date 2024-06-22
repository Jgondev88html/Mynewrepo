const WebSocket = require('ws');
const PORT = process.env.PORT || 3000; 

let wss;
let activeUsers = new Set();

function createWebSocketServer() {
  wss = new WebSocket.Server({ port: PORT });

  wss.on('connection', ws => {
    console.log('Nuevo cliente conectado');

    ws.on('message', message => {
      const data = JSON.parse(message);

      if (data.action === 'join') {
        ws.username = data.username;
        activeUsers.add(data.username);
        broadcastUsers();
      } else if (data.action === 'leave') {
        activeUsers.delete(data.username);
        broadcastUsers();
      } else {
        broadcastMessage(data);
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

  console.log(`Servidor ejecutando en el puerto ${PORT}`);
}

createWebSocketServer();

wss.on('close', () => {
  console.log('Conexión perdida. Intentando reconectar...');
  setTimeout(() => {
    createWebSocketServer();
  }, 5000); // Intenta reconectar cada 5 segundos
});
