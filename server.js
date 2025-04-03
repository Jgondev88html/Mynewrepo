const http = require('http');
const WebSocket = require('ws');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Servidor WebSocket para Administración');
});

const wss = new WebSocket.Server({ server });
let users = {}; // Almacena usuarios y su saldo
let solicitudes = []; // Solicitudes de retiro

wss.on('connection', (ws) => {
  console.log('Administrador conectado');

  ws.on('message', (message) => {
    const data = JSON.parse(message);

    if (data.type === 'updateSaldo') {
      users[data.username] = (users[data.username] || 0) + data.amount;
      broadcast({ type: 'saldoActualizado', username: data.username, saldo: users[data.username] });
    }

    if (data.type === 'solicitudRetiro') {
      solicitudes.push({ username: data.username, monto: data.monto, id: solicitudes.length + 1 });
      broadcast({ type: 'nuevaSolicitud', solicitudes });
    }

    if (data.type === 'confirmarRetiro') {
      solicitudes = solicitudes.filter(sol => sol.id !== data.id);
      broadcast({ type: 'retiroConfirmado', id: data.id, solicitudes });
    }
  });

  ws.on('close', () => {
    console.log('Administrador desconectado');
  });
});

function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

server.listen(3000, () => {
  console.log('Servidor WebSocket en el puerto 3000');
});
