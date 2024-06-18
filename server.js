const WebSocket = require('ws');
const PORT = 3000;
let wss;

function createWebSocketServer() {
  wss = new WebSocket.Server({ port: PORT });

  wss.on('connection', ws => {
    console.log('Nuevo cliente conectado');

    wss.clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send('¡Se ha conectado un nuevo cliente!');
      }
    });

    ws.on('message', message => {
      const data = JSON.parse(message);
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          if (data.image) {
            client.send(JSON.stringify({ username: data.username, image: data.image }));
          } else {
            client.send(JSON.stringify({ username: data.username, message: data.message }));
          }
        }
      });
    });

    ws.on('close', () => {
      console.log('Cliente desconectado');
    });
  });

  console.log(`Servidor ejecutando en el puerto ${PORT}`);
}

createWebSocketServer();

wss.on('close', () => {
  console.log('Conexión perdida. Intentando reconectar...');
  setTimeout(() => {
    createWebSocketServer();
  }, 5000); // Intenta reconectar cada 5 segundos
});
