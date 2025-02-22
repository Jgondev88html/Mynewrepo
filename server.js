const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let connectedUsers = new Set();

app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (ws) => {
    let currentUser = null;

    ws.on('message', (data) => {
        const message = JSON.parse(data);
        
        switch (message.type) {
            case 'login':
                currentUser = message.user;
                connectedUsers.add(currentUser.id);
                broadcastUserCount();
                break;
            
            case 'globalMessage':
                broadcastMessage(message);
                break;
            
            case 'privateMessage':
                handlePrivateMessage(message);
                break;
        }
    });

    ws.on('close', () => {
        if (currentUser) {
            connectedUsers.delete(currentUser.id);
            broadcastUserCount();
        }
    });
});

function broadcastUserCount() {
    const countMessage = JSON.stringify({
        type: 'userCount',
        count: connectedUsers.size
    });
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(countMessage);
        }
    });
}

function broadcastMessage(message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                ...message,
                timestamp: new Date().toISOString()
            }));
        }
    });
}

server.listen(3000, () => {
    console.log('Servidor iniciado en http://localhost:3000');
});
