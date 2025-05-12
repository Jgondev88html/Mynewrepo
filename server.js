const WebSocket = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('FT Wallet Server\n');
});

const wss = new WebSocket.Server({ server });

const activeConnections = new Map(); // {userId: WebSocket}

wss.on('connection', (ws) => {
  let userId = null;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'register') {
        userId = data.userId;
        activeConnections.set(userId, ws);
        console.log(`[REGISTER] Usuario conectado: ${userId}`);
      }

      if (data.type === 'send') {
        const { recipientId, amount, timestamp } = data;
        const txId = generateId();
        
        // Notificar al destinatario (si está conectado)
        const recipientWs = activeConnections.get(recipientId);
        if (recipientWs) {
          recipientWs.send(JSON.stringify({
            type: 'receive',
            txId: txId,
            senderId: userId,
            amount: amount,
            timestamp: timestamp
          }));
        }
        
        // Opcional: Guardar transacción en memoria (volátil)
        console.log(`[TRANSACTION] ${userId} -> ${recipientId} (${amount} FT)`);
      }
    } catch (err) {
      console.error('Error:', err);
    }
  });

  ws.on('close', () => {
    if (userId) activeConnections.delete(userId);
  });
});

// Helpers
function generateId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// Iniciar servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor iniciado en puerto ${PORT}`);
});
