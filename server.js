const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

let users = {};        // Objeto: { username: { saldo: number } }
let solicitudes = [];  // Array de solicitudes de retiro

// Función para enviar un mensaje a todos los clientes conectados
function broadcast(data) {
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
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
        // Crear el usuario si no existe (saldo inicial: 100)
        const username = data.username;
        if (!users[username]) {
          users[username] = { saldo: 100 };
        }
        ws.send(JSON.stringify({ type: 'loginResponse', success: true, username }));
        sendUserList();

      } else if (data.type === 'getUsuarios') {
        // Enviar la lista de usuarios solo a este cliente
        const listaUsuarios = Object.keys(users).map(username => ({
          username,
          saldo: users[username].saldo
        }));
        ws.send(JSON.stringify({ type: 'listaUsuarios', usuarios: listaUsuarios }));

      } else if (data.type === 'getSaldo') {
        // Enviar el saldo actual del usuario que lo solicita
        const username = data.username;
        if (users[username]) {
          ws.send(JSON.stringify({ type: 'saldoActualizado', username, saldo: users[username].saldo }));
        } else {
          ws.send(JSON.stringify({ type: 'saldoActualizado', username, saldo: 0 }));
        }

      } else if (data.type === 'updateSaldo') {
        // Actualiza el saldo de un usuario
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
        // Confirma la solicitud de retiro y descuenta el saldo
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
      console.error('Error procesando el mensaje:', err);
    }
  });

  ws.on('close', () => console.log('Cliente desconectado'));
});

console.log('Servidor WebSocket iniciado en ws://localhost:8080');
