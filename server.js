const express = require('express');
const http = require('http');
const WebSocket = require('ws'); // Cambié 'constante' por 'const'
const path = require('path');

// Crear aplicación Express
const app = express();

// Crear servidor HTTP con Express
const server = http.createServer(app);

// Crear servidor WebSocket que usa el servidor HTTP
const wss = new WebSocket.Server({ server });

let messages = []; // Cambié 'dejar' por 'let'

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
                * {
                    box-sizing: border-box;
                    margin: 0;
                    padding: 0;
                    font-family: 'Arial', sans-serif;
                }

                body {
                    background: #f0f2f5;
                    height: 100vh;
                }

                /* Login */
                #login-container {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    padding: 20px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                }

                .login-form {
                    background: white;
                    padding: 2rem;
                    border-radius: 10px;
                    box-shadow: 0 0 20px rgba(0,0,0,0.1);
                    width: 100%;
                    max-width: 400px;
                }

                .login-form h1 {
                    color: #2d3748;
                    text-align: center;
                    margin-bottom: 2rem;
                }

                .input-group {
                    margin-bottom: 1.5rem;
                }

                input {
                    width: 100%;
                    padding: 12px;
                    border: 1px solid #e2e8f0;
                    border-radius: 5px;
                    font-size: 16px;
                    margin-left: 10px;
                    outline-color: green;
                }

                button {
                    width: 18%;
                    padding: 12px;
                    background: #48bb78;
                    color: white;
                    border: none;
                    border-radius: 5px;
                    font-size: 16px;
                    cursor: pointer;
                    transition: background 0.3s;
                    margin-right: 8px;
                }

                button:hover {
                    background: #38a169;
                }

                /* Chat */
                #chat-container {
                    display: none;
                    height: 100vh;
                    flex-direction: column;
                    max-width: 800px;
                    margin: 0 auto;
                    padding: 20px;
                }

                #chat-header {
                    background: #48bb78;
                    color: white;
                    padding: 1rem;
                    border-radius: 10px 10px 0 0;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                #chat-messages {
                    flex-grow: 1;
                    background: white;
                    padding: 20px;
                    overflow-y: auto;
                    border: 1px solid #e2e8f0;
                    max-height: 75vh;
                }

                .message {
                    margin-bottom: 15px;
                    padding: 10px;
                    border-radius: 8px;
                    background: #f7fafc;
                    max-width: 80%;
                }

                .message span {
                    display: block;
                    font-size: 0.8rem;
                    color: #718096;
                    margin-top: 5px;
                }

                #message-input {
                    display: flex;
                    padding: 20px 0;
                    background: #48bb78;
                    border-radius: 10px;
                    position: sticky;
                    bottom: 0;
                    z-index: 10;
                }

                #message-text {
                    flex-grow: 1;
                    padding: 12px;
                    border: 1px solid #e2e8f0;
                    border-radius: 5px;
                    width: 90%;
                    background: white;
                }

                /* Responsive */
                @media (max-width: 600px) {
                    .login-form {
                        padding: 1.5rem;
                    }

                    #chat-container {
                        padding: 10px;
                    }

                    .message {
                        max-width: 90%;
                    }
                }
            </style>
        </head>
        <body>
            <!-- Login -->
            <div id="login-container">
                <form class="login-form" id="loginForm">
                    <h1>ChatSphere</h1>
                    <div class="input-group">
                        <input class="us" type="text" id="username" placeholder="Usuario" required>
                    </div>
                    <button class="btn" type="submit">Ingresar</button>
                </form>
            </div>

            <!-- Chat -->
            <div id="chat-container">
                <div id="chat-header">
                    <h1>ChatSphere</h1>
                    <button onclick="clearChat()">🗑️</button>
                </div>
                <div id="chat-messages"></div>
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

                // Login
                document.getElementById('loginForm').addEventListener('submit', function(e) {
                    e.preventDefault();
                    
                    const username = document.getElementById('username').value;
                    
                    if (username) {
                        localStorage.setItem('username', username);
                        document.getElementById('login-container').style.display = 'none';
                        document.getElementById('chat-container').style.display = 'flex';
                        loadMessages();
                    } else {
                        alert('Por favor completa el campo de usuario');
                    }
                });

                // Chat
                function sendMessage() {
                    const messageInput = document.getElementById('message-text');
                    const message = messageInput.value.trim();
                    
                    if(message) {
                        const newMessage = {
                            user: localStorage.getItem('username'),
                            text: message,
                            timestamp: new Date().toLocaleTimeString(),
                            type: 'message'
                        };
                        
                        socket.send(JSON.stringify(newMessage));
                        messageInput.value = '';
                    }
                }

                function appendMessage(message) {
                    const chatMessages = document.getElementById('chat-messages');
                    const messageDiv = document.createElement('div');
                    messageDiv.className = 'message';
                    messageDiv.innerHTML = `
                        <strong>${message.user}</strong>
                        <p>${message.text}</p>
                        <span>${message.timestamp}</span>
                    `;
                    chatMessages.appendChild(messageDiv);
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                }

                function loadMessages() {
                    const messages = JSON.parse(localStorage.getItem('chatMessages') || '[]');
                    messages.forEach(appendMessage);
                }

                function clearChat() {
                    const chatMessages = document.getElementById('chat-messages');
                    chatMessages.innerHTML = '';
                    localStorage.setItem('chatMessages', JSON.stringify([]));
                }

                function saveMessages(messages) {
                    localStorage.setItem('chatMessages', JSON.stringify(messages));
                }

                window.addEventListener('DOMContentLoaded', () => {
                    if(localStorage.getItem('username')) {
                        document.getElementById('login-container').style.display = 'none';
                        document.getElementById('chat-container').style.display = 'flex';
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
