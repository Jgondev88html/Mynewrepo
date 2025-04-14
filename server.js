const WebSocket = require('ws');
const http = require('http');
const uuid = require('uuid');

// Crear servidor HTTP
const server = http.createServer((req, res) => {
res.writeHead(200, { 'Content-Type': 'text/plain' });
res.end('WebSocket Chat Server\n');
});

// Crear servidor WebSocket
const wss = new WebSocket.Server({ server });

// Almacenamiento de usuarios y parejas
const users = new Map(); // Map<userId, WebSocket>
  const waitingQueue = []; // Cola de usuarios esperando pareja
  const activePairs = new Map(); // Map<userId1, userId2>

    // Contador de usuarios activos
    let activeUsersCount = 0;

    // Actualizar contador y notificar a todos
    function updateActiveUsersCount() {
    activeUsersCount = users.size;
    broadcastActiveUsersCount();
    }

    // Enviar contador a todos los usuarios
    function broadcastActiveUsersCount() {
    const message = {
    type: 'activeUsers',
    count: activeUsersCount
    };

    users.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
    }
    });
    }

    // Emparejar usuarios
    function matchUsers() {
    while (waitingQueue.length >= 2) {
    const userId1 = waitingQueue.shift();
    const userId2 = waitingQueue.shift();

    activePairs.set(userId1, userId2);
    activePairs.set(userId2, userId1);

    const ws1 = users.get(userId1);
    const ws2 = users.get(userId2);

    if (ws1 && ws1.readyState === WebSocket.OPEN) {
    ws1.send(JSON.stringify({
    type: 'partnerFound',
    partnerId: userId2
    }));
    }

    if (ws2 && ws2.readyState === WebSocket.OPEN) {
    ws2.send(JSON.stringify({
    type: 'partnerFound',
    partnerId: userId1
    }));
    }
    }
    }

    // Manejar desconexión de usuario
    function handleDisconnect(userId) {
    const partnerId = activePairs.get(userId);

    if (partnerId) {
    // Notificar al compañero
    const partnerWs = users.get(partnerId);
    if (partnerWs && partnerWs.readyState === WebSocket.OPEN) {
    partnerWs.send(JSON.stringify({
    type: 'partnerDisconnected'
    }));

    // Poner al compañero en la cola de espera
    waitingQueue.push(partnerId);
    activePairs.delete(partnerId);
    }

    activePairs.delete(userId);
    } else {
    // Eliminar de la cola de espera si estaba esperando
    const index = waitingQueue.indexOf(userId);
    if (index !== -1) {
    waitingQueue.splice(index, 1);
    }
    }

    // Eliminar usuario
    users.delete(userId);
    updateActiveUsersCount();

    // Intentar emparejar usuarios restantes
    matchUsers();
    }

    // Evento de conexión WebSocket
    wss.on('connection', (ws) => {
    const userId = uuid.v4();
    users.set(userId, ws);
    updateActiveUsersCount();

    console.log(`Nuevo usuario conectado: ${userId}. Total: ${users.size}`);

    // Enviar ID al cliente (podría ser útil para depuración)
    ws.send(JSON.stringify({
    type: 'connection',
    userId: userId
    }));

    // Poner al usuario en la cola de espera
    waitingQueue.push(userId);
    matchUsers();

    // Manejar mensajes del cliente
    ws.on('message', (message) => {
    try {
    const data = JSON.parse(message);

    switch(data.type) {
    case 'message':
    handleMessage(userId, data);
    break;

    case 'typing':
    handleTyping(userId, data);
    break;

    default:
    console.log('Tipo de mensaje desconocido:', data.type);
    }
    } catch (error) {
    console.error('Error al procesar mensaje:', error);
    }
    });

    // Manejar cierre de conexión
    ws.on('close', () => {
    console.log(`Usuario desconectado: ${userId}`);
    handleDisconnect(userId);
    });

    // Manejar errores
    ws.on('error', (error) => {
    console.error(`Error en conexión con usuario ${userId}:`, error);
    handleDisconnect(userId);
    });
    });

    // Manejar mensajes de chat
    function handleMessage(senderId, data) {
    const recipientId = activePairs.get(senderId);

    if (!recipientId) {
    console.log(`Usuario ${senderId} intentó enviar mensaje sin pareja`);
    return;
    }

    const recipientWs = users.get(recipientId);

    if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
    recipientWs.send(JSON.stringify({
    type: 'message',
    message: data.text,
    senderId: senderId,
    timestamp: new Date().toISOString()
    }));
    }
    }

    // Manejar eventos de escritura
    function handleTyping(senderId, data) {
    const recipientId = activePairs.get(senderId);

    if (!recipientId) {
    return;
    }

    const recipientWs = users.get(recipientId);

    if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
    recipientWs.send(JSON.stringify({
    type: 'typing',
    typing: data.typing,
    senderId: senderId
    }));
    }
    }

    // Iniciar servidor
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
    });
