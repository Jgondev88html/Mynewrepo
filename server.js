const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });
const clients = new Map(); // Almacena las conexiones con su nombre y avatar
let globalMessages = []; // Almacena mensajes globales
const privateMessages = new Map(); // Almacena mensajes privados por usuario

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
      broadcastParticipantsCount();
    }

    const clientInfo = clients.get(ws);

    if (msg.type === 'group_message') {
      globalMessages.push(msg);
      if (globalMessages.length > 70) {
        globalMessages = globalMessages.slice(-70);
      }
      const outgoing = JSON.stringify({
        type: 'group_message',
        id: msg.id,
        sender: clientInfo.name,
        avatar: clientInfo.avatar,
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

    if (msg.type === 'private_message') {
      if (!privateMessages.has(msg.target)) {
        privateMessages.set(msg.target, []);
      }
      const userMessages = privateMessages.get(msg.target);
      userMessages.push(msg);
      if (userMessages.length > 20) {
        privateMessages.set(msg.target, userMessages.slice(-20));
      }

      wss.clients.forEach(client => {
        const targetInfo = clients.get(client);
        if (client.readyState === WebSocket.OPEN && targetInfo.name === msg.target) {
          client.send(JSON.stringify({
            type: 'private_message',
            id: msg.id,
            sender: clientInfo.name,
            avatar: clientInfo.avatar,
            target: msg.target,
            content: msg.content,
            timestamp: msg.timestamp,
            replyTo: msg.replyTo || null
          }));
        }
      });

      ws.send(JSON.stringify({
        type: 'private_message',
        id: msg.id,
        sender: clientInfo.name,
        avatar: clientInfo.avatar,
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
