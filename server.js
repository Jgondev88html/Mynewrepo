const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });
const clients = new Map(); // Almacenamos cada conexión y su información (nombre y avatar)
const globalMessages = []; // Mensajes del chat global
const privateMessages = new Map(); // Mensajes privados pendientes

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
      
      // Reenviar mensajes privados pendientes
      if (privateMessages.has(msg.name)) {
        privateMessages.get(msg.name).forEach(pendingMsg => {
          ws.send(JSON.stringify(pendingMsg));
        });
        privateMessages.delete(msg.name);
      }
      broadcastParticipantsCount();
    }
    
    else if (msg.type === 'group_message') {
      const outgoing = {
        type: 'group_message',
        id: msg.id,
        sender: msg.sender,
        avatar: msg.avatar || '',
        content: msg.content,
        image: msg.image || null,
        timestamp: msg.timestamp,
        replyTo: msg.replyTo || null
      };
      globalMessages.push(outgoing);
      if (globalMessages.length > 70) globalMessages.shift();
      
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(outgoing));
        }
      });
    }
    
    else if (msg.type === 'private_message') {
      const outgoing = {
        type: 'private_message',
        id: msg.id,
        sender: msg.sender,
        avatar: msg.avatar || '',
        target: msg.target,
        content: msg.content,
        image: msg.image || null,
        timestamp: msg.timestamp,
        replyTo: msg.replyTo || null
      };
      
      let sent = false;
      wss.clients.forEach(client => {
        const clientInfo = clients.get(client);
        if (client.readyState === WebSocket.OPEN && clientInfo.name === msg.target) {
          client.send(JSON.stringify(outgoing));
          sent = true;
        }
      });
      
      if (!sent) {
        if (!privateMessages.has(msg.target)) {
          privateMessages.set(msg.target, []);
        }
        privateMessages.get(msg.target).push(outgoing);
      }
      
      ws.send(JSON.stringify(outgoing));
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    broadcastParticipantsCount();
  });
});

console.log('Servidor WebSocket corriendo en ws://localhost:8080');
