require('dotenv').config();
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');

// Configuración
const PORT = process.env.PORT || 3000;
const SESSIONS_DIR = './sessions';

// Crear directorio de sesiones si no existe
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR);
}

// Configuración de Express
app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Almacén de clientes activos y códigos de verificación
const activeClients = new Map();
const verificationCodes = new Map();

// HTML del index
const indexHTML = `
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WhatsApp Monitor - Autenticación por Código</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
        .container { max-width: 800px; margin: 0 auto; }
        .auth-panel { border: 1px solid #ddd; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        input { width: 100%; padding: 8px; box-sizing: border-box; }
        button { background-color: #4CAF50; color: white; padding: 10px 15px; border: none; border-radius: 4px; cursor: pointer; }
        button:hover { background-color: #45a049; }
        .session-panel { border: 1px solid #ddd; padding: 15px; margin-bottom: 20px; border-radius: 5px; }
        .message-log { height: 400px; overflow-y: auto; border: 1px solid #eee; padding: 10px; margin-top: 10px; }
        .message { margin-bottom: 10px; padding: 8px; border-radius: 4px; }
        .incoming { background-color: #e3f2fd; }
        .outgoing { background-color: #e8f5e9; }
        .status { font-weight: bold; margin: 10px 0; }
        .connected { color: green; }
        .disconnected { color: red; }
        .hidden { display: none; }
    </style>
</head>
<body>
    <div class="container">
        <h1>WhatsApp Monitor - Autenticación por Código</h1>
        
        <div id="authPanel" class="auth-panel">
            <div class="form-group">
                <label for="phoneNumber">Número de teléfono (con código de país):</label>
                <input type="text" id="phoneNumber" placeholder="Ej: +51987654321">
            </div>
            <div id="codeGroup" class="form-group hidden">
                <label for="verificationCode">Código de verificación (6 dígitos):</label>
                <input type="text" id="verificationCode" placeholder="123456">
            </div>
            <button id="authButton">Iniciar Sesión</button>
            <div id="statusMessage" class="status"></div>
        </div>
        
        <div id="sessionPanel" class="session-panel hidden">
            <h2>Sesión Activa</h2>
            <div id="sessionStatus" class="status disconnected">Desconectado</div>
            <div class="message-log" id="messageLog"></div>
            <button id="disconnectButton">Desconectar</button>
        </div>
        
        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket = io();
            let currentSessionId = null;
            
            // Elementos del DOM
            const authPanel = document.getElementById('authPanel');
            const phoneNumberInput = document.getElementById('phoneNumber');
            const codeGroup = document.getElementById('codeGroup');
            const verificationCodeInput = document.getElementById('verificationCode');
            const authButton = document.getElementById('authButton');
            const statusMessage = document.getElementById('statusMessage');
            const sessionPanel = document.getElementById('sessionPanel');
            const sessionStatus = document.getElementById('sessionStatus');
            const messageLog = document.getElementById('messageLog');
            const disconnectButton = document.getElementById('disconnectButton');
            
            // Estado de autenticación
            let authState = 'initial'; // 'initial', 'waiting_code', 'authenticated'
            
            // Manejar clic en el botón de autenticación
            authButton.addEventListener('click', () => {
                const phoneNumber = phoneNumberInput.value.trim();
                
                if (authState === 'initial') {
                    if (!phoneNumber || !phoneNumber.startsWith('+')) {
                        statusMessage.textContent = 'Ingresa un número válido con código de país (ej: +51987654321)';
                        statusMessage.style.color = 'red';
                        return;
                    }
                    
                    socket.emit('start_auth', { phoneNumber });
                    statusMessage.textContent = 'Enviando código de verificación...';
                    statusMessage.style.color = 'black';
                    
                } else if (authState === 'waiting_code') {
                    const code = verificationCodeInput.value.trim();
                    if (!code || code.length !== 6 || isNaN(code)) {
                        statusMessage.textContent = 'Ingresa un código de 6 dígitos válido';
                        statusMessage.style.color = 'red';
                        return;
                    }
                    
                    socket.emit('verify_code', { 
                        sessionId: currentSessionId,
                        code 
                    });
                    statusMessage.textContent = 'Verificando código...';
                    statusMessage.style.color = 'black';
                }
            });
            
            // Manejar desconexión
            disconnectButton.addEventListener('click', () => {
                socket.emit('disconnect_session', { sessionId: currentSessionId });
            });
            
            // Escuchar eventos del servidor
            socket.on('auth_state', (data) => {
                currentSessionId = data.sessionId;
                
                if (data.state === 'code_sent') {
                    authState = 'waiting_code';
                    codeGroup.classList.remove('hidden');
                    authButton.textContent = 'Verificar Código';
                    statusMessage.textContent = 'Se ha enviado un código a tu WhatsApp. Ingrésalo arriba.';
                    statusMessage.style.color = 'green';
                } else if (data.state === 'authenticated') {
                    authState = 'authenticated';
                    authPanel.classList.add('hidden');
                    sessionPanel.classList.remove('hidden');
                    sessionStatus.textContent = 'Conectado';
                    sessionStatus.className = 'status connected';
                } else if (data.state === 'failed') {
                    authState = 'initial';
                    codeGroup.classList.add('hidden');
                    authButton.textContent = 'Iniciar Sesión';
                    statusMessage.textContent = data.message || 'Error de autenticación';
                    statusMessage.style.color = 'red';
                }
            });
            
            socket.on('status_change', (data) => {
                sessionStatus.textContent = data.status;
                sessionStatus.className = `status ${data.status.toLowerCase()}`;
            });
            
            socket.on('new_message', (data) => {
                const messageClass = data.direction === 'incoming' ? 'incoming' : 'outgoing';
                const messageDiv = document.createElement('div');
                messageDiv.className = `message ${messageClass}`;
                messageDiv.innerHTML = `
                    <strong>${data.from}</strong> (${new Date(data.timestamp * 1000).toLocaleString()}):
                    <p>${data.body}</p>
                `;
                messageLog.appendChild(messageDiv);
                messageLog.scrollTop = messageLog.scrollHeight;
            });
            
            socket.on('disconnected', () => {
                resetUI();
            });
            
            function resetUI() {
                authState = 'initial';
                currentSessionId = null;
                phoneNumberInput.value = '';
                verificationCodeInput.value = '';
                codeGroup.classList.add('hidden');
                authButton.textContent = 'Iniciar Sesión';
                statusMessage.textContent = '';
                authPanel.classList.remove('hidden');
                sessionPanel.classList.add('hidden');
                messageLog.innerHTML = '';
            }
        </script>
    </div>
</body>
</html>
`;

// Ruta principal
app.get('/', (req, res) => {
    res.send(indexHTML);
});

// Socket.io
io.on('connection', (socket) => {
    console.log('Cliente conectado');
    
    socket.on('start_auth', (data) => {
        const sessionId = `wa_${Date.now()}`;
        const phoneNumber = data.phoneNumber;
        
        // Generar un código de 6 dígitos aleatorio
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        verificationCodes.set(sessionId, verificationCode);
        
        // Simular envío del código al número de WhatsApp
        console.log(`Código de verificación para ${phoneNumber}: ${verificationCode}`);
        
        // Crear cliente WhatsApp (pero no inicializarlo todavía)
        const client = new Client({
            authStrategy: new LocalAuth({
                clientId: sessionId,
                dataPath: path.join(SESSIONS_DIR, sessionId)
            }),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox']
            }
        });
        
        activeClients.set(sessionId, client);
        socket.emit('auth_state', {
            sessionId,
            state: 'code_sent'
        });
    });
    
    socket.on('verify_code', (data) => {
        const sessionId = data.sessionId;
        const client = activeClients.get(sessionId);
        const submittedCode = data.code;
        const storedCode = verificationCodes.get(sessionId);
        
        if (!client || !storedCode) {
            socket.emit('auth_state', {
                sessionId,
                state: 'failed',
                message: 'Sesión no encontrada'
            });
            return;
        }
        
        if (submittedCode !== storedCode) {
            socket.emit('auth_state', {
                sessionId,
                state: 'failed',
                message: 'Código incorrecto'
            });
            return;
        }
        
        // Código correcto - inicializar cliente WhatsApp
        initializeWhatsAppClient(client, sessionId, socket);
        
        socket.emit('auth_state', {
            sessionId,
            state: 'authenticated'
        });
    });
    
    socket.on('disconnect_session', (data) => {
        const client = activeClients.get(data.sessionId);
        if (client) {
            client.destroy();
        }
    });
});

function initializeWhatsAppClient(client, sessionId, socket) {
    client.on('ready', () => {
        console.log(`Cliente ${sessionId} listo`);
        socket.emit('status_change', {
            sessionId,
            status: 'Conectado'
        });
    });
    
    client.on('disconnected', (reason) => {
        console.log(`Cliente ${sessionId} desconectado:`, reason);
        socket.emit('status_change', {
            sessionId,
            status: 'Desconectado'
        });
        socket.emit('disconnected');
        activeClients.delete(sessionId);
        verificationCodes.delete(sessionId);
    });
    
    client.on('message', async (msg) => {
        const contact = await msg.getContact();
        socket.emit('new_message', {
            sessionId,
            direction: 'incoming',
            from: contact.name || contact.number,
            body: msg.body,
            timestamp: msg.timestamp
        });
    });
    
    client.on('message_create', async (msg) => {
        if (msg.fromMe) {
            const contact = await msg.getContact();
            socket.emit('new_message', {
                sessionId,
                direction: 'outgoing',
                from: `Tú → ${contact.name || contact.number}`,
                body: msg.body,
                timestamp: msg.timestamp
            });
        }
    });
    
    client.initialize();
}

// Iniciar servidor
http.listen(PORT, () => {
    console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
