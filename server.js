const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 3000 });

let users = {};        // Almacena los datos de saldo de cada usuario
let solicitudes = [];  // Lista de solicitudes de retiro

wss.on('connection', function connection(ws) {
  console.log('Cliente conectado');

  ws.on('message', function incoming(message) {
    console.log('Mensaje recibido:', message);
    try {
      const data = JSON.parse(message);

      if (data.type === 'login') {
        // Registro de usuario (en este ejemplo se acepta cualquier usuario)
        // Asigna un saldo inicial (por ejemplo, 100)
        users[data.username] = { saldo: users[data.username]?.saldo || 100 };
        ws.send(JSON.stringify({ type: 'loginResponse', success: true, username: data.username }));

      } else if (data.type === 'updateSaldo') {
        // Actualiza el saldo del usuario (para recargar o descontar)
        if (users[data.username] !== undefined) {
          users[data.username].saldo += data.amount;
          broadcast({ type: 'saldoActualizado', username: data.username, saldo: users[data.username].saldo });
        }

      } else if (data.type === 'solicitudRetiro') {
        // Agrega solicitud de retiro
        const solicitud = {
          id: solicitudes.length + 1,
          username: data.username,
          monto: data.monto,
          confirmado: false
        };
        solicitudes.push(solicitud);
        broadcast({ type: 'nuevaSolicitud', solicitudes });

      } else if (data.type === 'confirmarRetiro') {
        // Confirma la solicitud de retiro y descuenta el saldo
        let solicitud = solicitudes.find(s => s.id === data.id);
        if (solicitud && users[solicitud.username] && users[solicitud.username].saldo >= solicitud.monto) {
          users[solicitud.username].saldo -= solicitud.monto;
          solicitud.confirmado = true;
          broadcast({ type: 'retiroConfirmado', solicitudes });
          broadcast({ type: 'saldoActualizado', username: solicitud.username, saldo: users[solicitud.username].saldo });
        }
      }

    } catch (err) {
      console.error('Error al procesar el mensaje:', err);
    }
  });

  ws.on('close', () => console.log('Cliente desconectado'));
});

function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

console.log('Servidor WebSocket iniciado en ws://localhost:3000');
