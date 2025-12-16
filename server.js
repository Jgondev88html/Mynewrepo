const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const qrcode = require('qrcode-terminal');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const PORT = process.env.PORT || 3000;

// Configuración
const ADMIN_NUMBERS = ['5351808981@c.us'];
const ALLOWED_LINKS = ['youtube.com', 'instagram.com', 'facebook.com', 'drive.google.com'];

let qrCode = null;
let isConnected = false;
let sock = null;

// Crear directorio de auth si no existe
const authFolder = './auth_info';
try {
    fs.mkdir(authFolder, { recursive: true });
} catch(e) {}

// Función para iniciar WhatsApp
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();
    
    sock = makeWASocket({
        version,
        printQRInTerminal: false,
        auth: state,
        defaultQueryTimeoutMs: 60_000,
        connectTimeoutMs: 60_000,
        keepAliveIntervalMs: 10_000,
        emitOwnEvents: true,
        retryRequestDelayMs: 250
    });
    
    // Manejar eventos
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCode = qr;
            console.log('🔄 Nuevo QR generado');
            qrcode.generate(qr, { small: true });
            io.emit('qr_update', qr);
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔌 Conexión cerrada, reconectando...', lastDisconnect?.error);
            
            if (shouldReconnect) {
                setTimeout(() => connectToWhatsApp(), 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ Conectado a WhatsApp');
            isConnected = true;
            qrCode = null;
            io.emit('connected', true);
        }
    });
    
    // Guardar credenciales
    sock.ev.on('creds.update', saveCreds);
    
    // Manejar mensajes
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        
        // Ignorar si no es mensaje de texto o si es del bot
        if (!msg.message || msg.key.fromMe) return;
        
        const messageType = Object.keys(msg.message)[0];
        if (messageType !== 'conversation' && messageType !== 'extendedTextMessage') return;
        
        const texto = msg.message[messageType]?.text || '';
        const sender = msg.key.remoteJid;
        const isGroup = sender.endsWith('@g.us');
        
        // Solo procesar grupos
        if (isGroup) {
            // BIENVENIDA automática
            if (texto.toLowerCase().includes('hola') || texto.toLowerCase().includes('holis')) {
                await sock.sendMessage(sender, { text: '👋 ¡Bienvenido al grupo!' });
            }
            
            // DETECTAR ENLACES
            if (texto.includes('http') || texto.includes('www.') || texto.includes('.com')) {
                const esAdmin = ADMIN_NUMBERS.includes(sender);
                
                if (!esAdmin) {
                    let esPermitido = false;
                    for (const allowed of ALLOWED_LINKS) {
                        if (texto.toLowerCase().includes(allowed)) {
                            esPermitido = true;
                            break;
                        }
                    }
                    
                    if (!esPermitido) {
                        try {
                            // Eliminar mensaje (solo si el bot es admin)
                            await sock.sendMessage(sender, {
                                delete: msg.key
                            }).catch(e => console.log('No se pudo eliminar:', e.message));
                            
                            // Advertir
                            await sock.sendMessage(sender, {
                                text: '🚫 Enlace no permitido eliminado'
                            });
                        } catch (error) {
                            console.log('Error:', error.message);
                        }
                    }
                }
            }
        }
    });
    
    // Cuando alguien se une al grupo
    sock.ev.on('group-participants.update', async (update) => {
        const { id, participants, action } = update;
        
        if (action === 'add') {
            console.log('🎉 Alguien se unió al grupo');
            
            for (const participant of participants) {
                const welcomeMessage = `🎊 *¡BIENVENIDO/A AL GRUPO!* 🎊

Hola @${participant.split('@')[0]} 👋

¡Nos alegra tenerte aquí! 

📜 *Reglas del grupo:*
• Respetar a todos los miembros
• No enviar spam
• Mantener conversaciones cordiales
• Disfrutar y compartir

💡 *Consejo:* Preséntate y cuéntanos de qué te gustaría hablar.

¡Disfruta tu estadía! 😊`;
                
                await sock.sendMessage(id, { text: welcomeMessage });
            }
        }
        
        if (action === 'remove') {
            console.log('👋 Alguien salió del grupo');
            
            for (const participant of participants) {
                await sock.sendMessage(id, {
                    text: `👋 @${participant.split('@')[0]} ha abandonado el grupo.\n¡Que le vaya bien!`
                });
            }
        }
    });
}

// WebSocket para la página web
io.on('connection', (socket) => {
    socket.emit('connected', isConnected);
    if (qrCode) socket.emit('qr_update', qrCode);
});

// Página web simple
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WhatsApp Bot - Baileys</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                margin: 0;
                padding: 20px;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .container {
                background: white;
                padding: 30px;
                border-radius: 15px;
                text-align: center;
                max-width: 400px;
                width: 100%;
                box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            }
            h1 {
                color: #333;
                margin-bottom: 20px;
            }
            #status {
                padding: 10px 20px;
                border-radius: 25px;
                margin: 20px 0;
                font-weight: bold;
                display: inline-block;
            }
            .connected {
                background: #d4edda;
                color: #155724;
            }
            .disconnected {
                background: #f8d7da;
                color: #721c24;
            }
            #qr-container {
                margin: 20px 0;
                padding: 20px;
                background: #f8f9fa;
                border-radius: 10px;
                min-height: 300px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            #qr-placeholder {
                color: #666;
            }
            .features {
                background: #e3f2fd;
                padding: 15px;
                border-radius: 10px;
                margin-top: 20px;
                text-align: left;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🤖 WhatsApp Bot (Baileys)</h1>
            <div id="status" class="disconnected">Desconectado</div>
            
            <div id="qr-container">
                <div id="qr-placeholder">
                    Esperando QR...
                </div>
            </div>
            
            <div class="features">
                <h3>Funciones:</h3>
                <ul>
                    <li>Bienvenida automática</li>
                    <li>Elimina enlaces</li>
                    <li>Más rápido y ligero</li>
                    <li>Sesiones persistentes</li>
                </ul>
            </div>
        </div>
        
        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket = io();
            const statusEl = document.getElementById('status');
            const qrContainer = document.getElementById('qr-container');
            const qrPlaceholder = document.getElementById('qr-placeholder');
            
            socket.on('qr_update', (qrData) => {
                qrPlaceholder.innerHTML = '';
                
                // Generar QR en el navegador
                const qrImg = document.createElement('img');
                qrImg.src = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qrData);
                qrImg.style.maxWidth = '100%';
                qrContainer.appendChild(qrImg);
                
                statusEl.textContent = 'Escanea el QR';
                statusEl.className = 'disconnected';
            });
            
            socket.on('connected', (connected) => {
                if (connected) {
                    statusEl.textContent = '✅ Conectado';
                    statusEl.className = 'connected';
                    qrPlaceholder.innerHTML = '<p>Bot activo y funcionando</p>';
                    qrPlaceholder.style.display = 'block';
                    qrContainer.innerHTML = '';
                    qrContainer.appendChild(qrPlaceholder);
                }
            });
        </script>
    </body>
    </html>
    `);
});

// Iniciar
server.listen(PORT, async () => {
    console.log(`🚀 Servidor en: http://localhost:${PORT}`);
    console.log(`⚡ Usando Baileys (más ligero)`);
    console.log(`📱 Conectando a WhatsApp...`);
    
    // Intentar conectar
    try {
        await connectToWhatsApp();
    } catch (error) {
        console.error('Error inicial:', error);
    }
});
