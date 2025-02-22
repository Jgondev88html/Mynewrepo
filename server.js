const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });
const clients = new Map(); // Almacenamos cada conexión y su información (nombre, avatar y mensajes privados)

// Función para broadcast de la cantidad de participantes
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
  // Inicialmente sin nombre (login pendiente)
  clients.set(ws, { name: null, avatar: '', privateMessages: {} });
  broadcastParticipantsCount();

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch (e) {
      console.error('JSON inválido', e);
      return;
    }

    // Login: se envían nombre y avatar
    if (msg.type === 'login') {
      clients.set(ws, { name: msg.name, avatar: msg.avatar || '', privateMessages: {} });
      broadcastParticipantsCount();
    }

    // Mensaje grupal: se reenvía a todos los clientes
    else if (msg.type === 'group_message') {
      const avatar = msg.avatar || '👤'; // Avatar predeterminado si no hay avatar

      const outgoing = JSON.stringify({
        type: 'group_message',
        id: msg.id,
        sender: msg.sender,
        avatar: avatar,  // Avatar predeterminado si no hay avatar
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

    // Mensaje privado: se guarda y se envía al destinatario
    else if (msg.type === 'private_message') {
      // Guardar el mensaje privado en el historial del remitente
      const senderInfo = clients.get(ws);
      if (!senderInfo.privateMessages[msg.target]) {
        senderInfo.privateMessages[msg.target] = [];
      }
      senderInfo.privateMessages[msg.target].push({
        sender: msg.sender,
        avatar: msg.avatar || '👤',  // Avatar predeterminado si no hay avatar
        content: msg.content,
        timestamp: msg.timestamp,
        image: msg.image || null,
        replyTo: msg.replyTo || null
      });

      // Enviar al destinatario
      wss.clients.forEach(client => {
        const clientInfo = clients.get(client);
        if (client.readyState === WebSocket.OPEN && clientInfo.name === msg.target) {
          client.send(JSON.stringify({
            type: 'private_message',
            id: msg.id,
            sender: msg.sender,
            avatar: msg.avatar || '👤',
            target: msg.target,
            content: msg.content,
            timestamp: msg.timestamp,
            image: msg.image || null,
            replyTo: msg.replyTo || null
          }));
        }
      });

      // También enviar al remitente para que lo vea en su historial
      ws.send(JSON.stringify({
        type: 'private_message',
        id: msg.id,
        sender: msg.sender,
        avatar: msg.avatar || '👤',
        target: msg.target,
        content: msg.content,
        timestamp: msg.timestamp,
        image: msg.image || null,
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
