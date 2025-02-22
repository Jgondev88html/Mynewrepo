const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });
const clients = new Map(); // Almacena cada conexión y su información (nombre y avatar)
const pendingMessages = new Map(); // Almacena mensajes privados no entregados
const globalMessages = []; // Almacena los últimos 70 mensajes del chat global

function broadcastParticipantsCount() {
  const count = Array.from(clients.values()).filter(client => client.name).length;
  const message = JSON.stringify({
    type: 'update_participants',
    count: count
  });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

wss.on('connection', (ws) => {
  console.log('Nuevo cliente conectado');
  clients.set(ws, { name: null, avatar: '' });
  broadcastParticipantsCount();

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      console.error('JSON inválido', e);
      return;
    }

    if (msg.type === 'login') {
      clients.set(ws, { name: msg.name, avatar: msg.avatar || '' });
      
      // Enviar mensajes pendientes al usuario
      if (pendingMessages.has(msg.name)) {
        pendingMessages.get(msg.name).forEach(pendingMsg => {
          ws.send(JSON.stringify(pendingMsg));
        });
        pendingMessages.delete(msg.name);
      }
      
      broadcastParticipantsCount();
    }
    
    else if (msg.type === 'group_message') {
      if (globalMessages.length >= 70) {
        globalMessages.shift(); // Elimina el mensaje más antiguo
      }
      globalMessages.push(msg);

      const outgoing = JSON.stringify(msg);
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(outgoing);
        }
      });
    }
    
    else if (msg.type === 'private_message') {
      let delivered = false;

      wss.clients.forEach(client => {
        const clientInfo = clients.get(client);
        if (client.readyState === WebSocket.OPEN && clientInfo.name === msg.target) {
          client.send(JSON.stringify(msg));
          delivered = true;
        }
      });

      // Guardar en mensajes pendientes si no se entregó
      if (!delivered) {
        if (!pendingMessages.has(msg.target)) {
          pendingMessages.set(msg.target, []);
        }
        pendingMessages.get(msg.target).push(msg);
      }
      
      // También reenviar el mensaje al remitente para que se almacene en su chat
      ws.send(JSON.stringify(msg));
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    broadcastParticipantsCount();
  });
});

console.log('Servidor WebSocket corriendo en ws://localhost:8080');
