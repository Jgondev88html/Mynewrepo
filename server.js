// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let messages = [];

// Serve static files
app.use(express.static('public'));

// WebSocket connection
wss.on('connection', (ws) => {
    // Send previous messages to the new client
    ws.send(JSON.stringify(messages));

    // Broadcast new message to all clients
    ws.on('message', (message) => {
        const newMessage = JSON.parse(message);

        if (newMessage.type === 'clear') {
            // Handle clearing chat only for the sender
            ws.send(JSON.stringify([])); // Send empty array to clear chat for this user
        } else {
            messages.push(newMessage);
            // Broadcast to all other connected clients
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify([newMessage]));
                }
            });
        }
    });
});

// Start server
module.exports = server.listen(3000, () => {
    console.log('Server is listening on port 3000');
});
