const express = require('express');
const http = require('http');
const WebSocket = require('ws');

// Crear aplicación Express
const app = express();

// Crear servidor HTTP con Express
const server = http.createServer(app);

// Crear servidor WebSocket que usa el servidor HTTP
const wss = new WebSocket.Server({ server });

let messages = [];

// Manejar la conexión WebSocket
wss.on('connection', (ws) => {
    console.log('Nuevo cliente conectado');

    // Enviar los mensajes guardados al cliente
    ws.send(JSON.stringify(messages));

    // Recibir mensajes de los clientes y distribuirlos
    ws.on('message', (message) => {
        const newMessage = JSON.parse(message);
        console.log('Mensaje recibido:', newMessage);

        // Guardar el mensaje y enviarlo a todos los clientes conectados
        messages.push(newMessage);
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify([newMessage]));
            }
        });
    });

    // Manejar desconexión de clientes
    ws.on('close', () => {
        console.log('Cliente desconectado');
    });

    // Manejar errores de WebSocket
    ws.on('error', (error) => {
        console.error('Error en WebSocket:', error);
    });
});

// Servir el archivo HTML directamente
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>ChatSphere</title>
            <style>
                /* Estilos básicos */
                body {
                    font-family: Arial, sans-serif;
                    background: #f0f2f5;
                    margin: 0;
                }
                /* Agregar más estilos aquí */
            </style>
        </head>
        <body>
            <!-- Contenedor de inicio de sesión -->
            <div id="login-container">
                <form id="login-form">
                    <input type="text" id="username" placeholder="Nombre de usuario" required>
                    <button type="submit">Ingresar</button>
                </form>
            </div>

            <!-- Contenedor de chat -->
            <div id="chat-container" style="display:none;">
                <div id="chat-header">
                    <h1>ChatSphere</h1>
                    <button onclick="clearChat()">🗑️</button>
                </div>
                <div id="messages"></div>
                <div id="message-input">
                    <input type="text" id="message-text" placeholder="Escribe un mensaje...">
                    <button onclick="sendMessage()">Enviar</button>
                </div>
            </div>

            <script>
                // Configuración de WebSocket
                const socket = new WebSocket('ws://localhost:3000');

                socket.onopen = () => {
                    console.log('Conectado al servidor WebSocket');
                };

                socket.onmessage = (event) => {
                    const messages = JSON.parse(event.data);
                    saveMessages(messages);
                    messages.forEach(appendMessage);
                };

                // Función de login
                document.getElementById('login-form').addEventListener('submit', function(e) {
                    e.preventDefault();
                    const username = document.getElementById('username').value;
                    if (username) {
                        localStorage.setItem('username', username);
                        document.getElementById('login-container').style.display = 'none';
                        document.getElementById('chat-container').style.display = 'block';
                        loadMessages();
                    } else {
                        alert('Por favor ingresa un nombre de usuario');
                    }
                });

                // Función para enviar mensajes
                function sendMessage() {
                    const messageInput = document.getElementById('message-text');
                    const message = messageInput.value.trim();
                    if (message) {
                        const newMessage = {
                            username: localStorage.getItem('username'),
                            text: message,
                            timestamp: new Date().toLocaleTimeString(),
                        };
                        socket.send(JSON.stringify(newMessage));
                        messageInput.value = '';
                    }
                }

                // Función para mostrar mensajes en el chat
                function appendMessage(message) {
                    const messagesContainer = document.getElementById('messages');
                    const messageDiv = document.createElement('div');
                    messageDiv.className = 'message';
                    messageDiv.innerHTML = `
                        <strong>${message.username}</strong>
                        <p>${message.text}</p>
                        <span>${message.timestamp}</span>
                    `;
                    messagesContainer.appendChild(messageDiv);
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;
                }

                // Función para cargar mensajes del localStorage
                function loadMessages() {
                    const messages = JSON.parse(localStorage.getItem('chatMessages') || '[]');
                    messages.forEach(appendMessage);
                }

                // Función para limpiar el chat
                function clearChat() {
                    const messagesContainer = document.getElementById('messages');
                    messagesContainer.innerHTML = '';
                    localStorage.setItem('chatMessages', JSON.stringify([]));
                }

                // Función para guardar mensajes en localStorage
                function saveMessages(messages) {
                    localStorage.setItem('chatMessages', JSON.stringify(messages));
                }

                // Al cargar la página, si ya hay un usuario registrado, mostrar el chat
                window.addEventListener('DOMContentLoaded', () => {
                    if (localStorage.getItem('username')) {
                        document.getElementById('login-container').style.display = 'none';
                        document.getElementById('chat-container').style.display = 'block';
                        loadMessages();
                    }
                });
            </script>
        </body>
        </html>
    `);
});

// Iniciar servidor en el puerto 3000
server.listen(3000, () => {
    console.log('Servidor escuchando en http://localhost:3000');
});
</script>
