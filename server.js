const WebSocket = require('ws');

let messages = [];

// WebSocket handler
const handler = (req, res) => {
    // Solo permite conexiones WebSocket en esta ruta
    if (req.method === 'GET' && req.url === '/ws') {
        const { socket } = req;

        const ws = new WebSocket({ socket });

        ws.on('connection', (ws) => {
            console.log('Nuevo cliente conectado');

            // Envía todos los mensajes previos al nuevo cliente
            ws.send(JSON.stringify(messages));

            // Manejo de mensajes recibidos
            ws.on('message', (message) => {
                const newMessage = JSON.parse(message);

                if (newMessage.type === 'clear') {
                    // Limpiar solo para el usuario que envía la petición
                    ws.send(JSON.stringify([]));
                } else {
                    // Agregar el mensaje a la lista global de mensajes
                    messages.push(newMessage);

                    // Limitar la cantidad de mensajes a 100 más recientes
                    if (messages.length > 100) {
                        messages.shift(); // Elimina el mensaje más antiguo
                    }

                    // Enviar el mensaje a todos los demás clientes conectados
                    ws.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify([newMessage]));
                        }
                    });
                }
            });
        });
    } else {
        // Si no es WebSocket, respondemos con un mensaje de error
        res.status(404).send('Not Found');
    }
};

module.exports = handler;
