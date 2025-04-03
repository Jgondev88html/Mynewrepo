// server.js
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

let users = {};        // Objeto: { username: { saldo: number } }
let solicitudes = [];  // Array de solicitudes de retiro

function broadcast(data) {
  const mensaje = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(mensaje);
    }
  });
}

// Envía la lista actualizada de usuarios a todos los clientes
function sendUserList() {
  const listaUsuarios = Object.keys(users).map(username => ({
    username,
    saldo: users[username].saldo
  }));
  broadcast({ type: 'listaUsuarios', usuarios: listaUsuarios });
}

wss.on('connection', ws => {
  console.log('Nuevo cliente conectado');

  ws.on('message', message => {
    try {
      const data = JSON.parse(message);
      console.log('Mensaje recibido:', data);

      if (data.type === 'login') {
        const username = data.username;
        if (!users[username]) {
          // Crear el usuario con saldo inicial (por ejemplo, 100)
          users[username] = { saldo: 100 };
          sendUserList();
        }
        // Responder al cliente que hizo login
        ws.send(JSON.stringify({ type: 'loginResponse', success: true, username }));
      
      } else if (data.type === 'updateSaldo') {
        // Actualiza el saldo del usuario (para recargar o descontar)
        const username = data.username;
        if (users[username] !== undefined) {
          users[username].saldo += data.amount;
          broadcast({ type: 'saldoActualizado', username, saldo: users[username].saldo });
          sendUserList();
        }
      
      } else if (data.type === 'solicitudRetiro') {
        // Agrega una solicitud de retiro
        const solicitud = {
          id: solicitudes.length + 1,
          username: data.username,
          monto: data.monto,
          confirmado: false
        };
        solicitudes.push(solicitud);
        broadcast({ type: 'nuevaSolicitud', solicitudes });
      
      } else if (data.type === 'confirmarRetiro') {
        // Confirma la solicitud de retiro y descuenta el saldo si es posible
        const solicitud = solicitudes.find(s => s.id === data.id);
        if (solicitud && !solicitud.confirmado) {
          const username = solicitud.username;
          if (users[username] && users[username].saldo >= solicitud.monto) {
            users[username].saldo -= solicitud.monto;
            solicitud.confirmado = true;
            broadcast({ type: 'retiroConfirmado', solicitudes });
            broadcast({ type: 'saldoActualizado', username, saldo: users[username].saldo });
            sendUserList();
          }
        }
      }
    } catch (err) {
      console.error('Error al procesar el mensaje:', err);
    }
  });

  ws.on('close', () => console.log('Cliente desconectado'));
});

console.log('Servidor WebSocket iniciado en ws://localhost:8080');
