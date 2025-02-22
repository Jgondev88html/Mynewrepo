const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });
const clients = new Map(); // Almacenamos cada conexión y su información (nombre y avatar)
const offlineMessages = new Map(); // Almacena mensajes para usuarios desconectados
let globalMessages = []; // Lista de mensajes globales
const MAX_GLOBAL_MESSAGES = 70;

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
      
      // Enviar mensajes almacenados si los hay
      if (offlineMessages.has(msg.name)) {
        offlineMessages.get(msg.name).forEach(message => ws.send(message));
        offlineMessages.delete(msg.name);
      }
      
      broadcastParticipantsCount();
    }
    // Mensaje grupal
    else if (msg.type === 'group_message') {
      const outgoing = JSON.stringify({
        type: 'group_message',
        id: msg.id,
        sender: msg.sender,
        avatar: msg.avatar || '',
        content: msg.content,
        image: msg.image || null,
        timestamp: msg.timestamp,
        replyTo: msg.replyTo || null
      });
      
      globalMessages.push(outgoing);
      if (globalMessages.length > MAX_GLOBAL_MESSAGES) {
        globalMessages.shift(); // Eliminar el mensaje más antiguo
      }
      
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(outgoing);
        }
      });
    }
    // Mensaje privado
    else if (msg.type === 'private_message') {
      const outgoing = JSON.stringify({
        type: 'private_message',
        id: msg.id,
        sender: msg.sender,
        avatar: msg.avatar || '',
        target: msg.target,
        content: msg.content,
        timestamp: msg.timestamp,
        replyTo: msg.replyTo || null
      });
      
      let sent = false;
      wss.clients.forEach(client => {
        const clientInfo = clients.get(client);
        if (client.readyState === WebSocket.OPEN && clientInfo.name === msg.target) {
          client.send(outgoing);
          sent = true;
        }
      });
      
      // Si el destinatario no está en línea, almacenar el mensaje
      if (!sent) {
        if (!offlineMessages.has(msg.target)) {
          offlineMessages.set(msg.target, []);
        }
        offlineMessages.get(msg.target).push(outgoing);
      }
      
      // También guardar el mensaje en el almacenamiento del remitente
      ws.send(outgoing);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    broadcastParticipantsCount();
  });
});

console.log('Servidor WebSocket corriendo en ws://localhost:8080');
