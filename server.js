const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Configuración
const PORT = process.env.PORT || 3000;

// Almacén de usuarios conectados
const users = new Map();

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// WebSocket server
wss.on('connection', (ws) => {
    let user = { id: '', name: '', room: 'public', ws };

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        switch (data.type) {
            case 'register':
                // Registrar nuevo usuario
                user.id = data.id;
                user.name = data.name;
                user.room = data.room || 'privado';
                users.set(data.id, user);
                
                // Notificar a todos
                broadcastUserList();
                broadcastSystemMessage(`${user.name} se ha unido al chat ${user.room}.`, user.room);
                break;
                
            case 'public':
                // Mensaje público a la sala actual
                broadcastMessage({
                    type: 'public',
                    sender: { id: user.id, name: user.name },
                    message: data.message,
                    timestamp: new Date().toISOString()
                }, user.room);
                break;
                
            case 'private':
                // Mensaje privado
                sendPrivateMessage(
                    user,
                    data.recipientId,
                    data.message
                );
                break;
                
            case 'changeRoom':
                // Cambiar de sala
                const oldRoom = user.room;
                user.room = data.room;
                users.set(user.id, user);
                
                // Notificar cambio de sala
                broadcastSystemMessage(`${user.name} ha dejado el chat.`, oldRoom);
                broadcastSystemMessage(`${user.name} se ha unido al chat.`);
                broadcastUserList();
                break;
        }
    });

    ws.on('close', () => {
        if (user.id) {
            users.delete(user.id);
            broadcastSystemMessage(`${user.name} se ha desconectado.`, user.room);
            broadcastUserList();
        }
    });
});

// Funciones auxiliares
function broadcastUserList() {
    const userList = Array.from(users.values()).map(u => ({
        id: u.id,
        name: u.name,
        room: u.room
    }));
    
    const message = JSON.stringify({
        type: 'userList',
        users: userList
    });
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

function broadcastMessage(message, room = 'public') {
    const formattedMessage = JSON.stringify(message);
    
    wss.clients.forEach(client => {
        const user = getUserByClient(client);
        if (client.readyState === WebSocket.OPEN && user && user.room === room) {
            client.send(formattedMessage);
        }
    });
}

function broadcastSystemMessage(text, room = 'public') {
    broadcastMessage({
        type: 'system',
        message: text,
        timestamp: new Date().toISOString()
    }, room);
}

function sendPrivateMessage(sender, recipientId, messageText) {
    const recipient = users.get(recipientId);
    if (!recipient) return;

    const message = {
        type: 'private',
        sender: { id: sender.id, name: sender.name },
        recipientId: recipient.id,
        message: messageText,
        timestamp: new Date().toISOString(),
        sent: false
    };
    
    // Enviar al destinatario
    if (recipient.ws.readyState === WebSocket.OPEN) {
        recipient.ws.send(JSON.stringify(message));
    }
    
    // Enviar copia al remitente
    if (sender.ws.readyState === WebSocket.OPEN) {
        sender.ws.send(JSON.stringify({
            ...message,
            sent: true
        }));
    }
}

function getUserByClient(client) {
    return Array.from(users.values()).find(u => u.ws === client);
}

// Iniciar servidor
server.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
