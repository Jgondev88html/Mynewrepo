// server.js
const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });
const clients = new Map(); // Almacenamos cada conexión y su información (nombre y avatar)

function broadcastParticipantsCount() {
  // Se cuentan sólo los usuarios que hayan hecho login (tienen nombre)
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
  // Inicialmente el cliente no tiene nombre (login pendiente)
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
    // Al hacer login se envía el nombre y la foto de avatar
    if (msg.type === 'login') {
      clients.set(ws, { name: msg.name, avatar: msg.avatar || '' });
      broadcastParticipantsCount();
    }
    // Mensaje grupal: se reenvía a todos los clientes conectados
    else if (msg.type === 'group_message') {
      const outgoing = JSON.stringify({
        type: 'group_message',
        sender: msg.sender,
        avatar: msg.avatar || '',
        content: msg.content,
        image: msg.image || null,
        timestamp: msg.timestamp,
        replyTo: msg.replyTo || null
      });
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(outgoing);
        }
      });
    }
    // Mensaje privado: se envía solo al destinatario y se devuelve al emisor
    else if (msg.type === 'private_message') {
      wss.clients.forEach(client => {
        const clientInfo = clients.get(client);
        if (client.readyState === WebSocket.OPEN && clientInfo.name === msg.target) {
          client.send(JSON.stringify({
            type: 'private_message',
            sender: msg.sender,
            avatar: msg.avatar || '',
            target: msg.target,
            content: msg.content,
            timestamp: msg.timestamp,
            replyTo: msg.replyTo || null
          }));
        }
      });
      // Se envía también de vuelta al remitente para su visualización
      ws.send(JSON.stringify({
        type: 'private_message',
        sender: msg.sender,
        avatar: msg.avatar || '',
        target: msg.target,
        content: msg.content,
        timestamp: msg.timestamp,
        replyTo: msg.replyTo || null
      }));
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    broadcastParticipantsCount();
  });
});

console.log('Servidor WebSocket corriendo en ws://localhost:8080');
