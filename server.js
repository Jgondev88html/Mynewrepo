const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let messages = [];

// Maneja nuevas conexiones WebSocket
wss.on('connection', (ws) => {
    console.log('Nuevo cliente conectado');

    // Envía los mensajes anteriores al cliente recién conectado
    ws.send(JSON.stringify(messages));

    // Escucha los mensajes que recibe
    ws.on('message', (message) => {
        const newMessage = JSON.parse(message);
        console.log('Mensaje recibido:', newMessage);

        // Guarda el mensaje y lo envía a todos los clientes conectados
        if (newMessage.type !== 'clear') {
            messages.push(newMessage);
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify([newMessage]));
                }
            });
        } else {
            // Si es un mensaje de tipo "clear", borra los mensajes solo para el remitente
            ws.send(JSON.stringify([]));
        }
    });

    // Maneja cuando el cliente se desconecta
    ws.on('close', () => {
        console.log('Cliente desconectado');
    });

    // Maneja errores en la conexión WebSocket
    ws.on('error', (error) => {
        console.error('Error en WebSocket:', error);
    });
});

// Inicia el servidor
server.listen(3000, () => {
    console.log('Servidor escuchando en el puerto 3000');
});
