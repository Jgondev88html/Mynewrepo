const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const QRCode = require('qrcode');
const http = require('http');
const socketIO = require('socket.io');

// Configuración
const ADMIN_NUMBERS = ['5351808981@c.us'];
const ALLOWED_LINKS = ['youtube.com', 'instagram.com', 'facebook.com', 'drive.google.com'];

// Crear servidor web
const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const PORT = process.env.PORT || 3000;

// Variables para el QR
let qrImage = null;
let botConnected = false;

// Configurar cliente WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// Evento QR
client.on('qr', async (qr) => {
    console.log('🔄 Generando QR para la web...');
    try {
        qrImage = await QRCode.toDataURL(qr);
        io.emit('qr_update', qrImage);
    } catch (err) {
        console.error('Error QR:', err);
    }
});

// Bot listo
client.on('ready', () => {
    console.log('✅ Bot conectado a WhatsApp');
    botConnected = true;
    qrImage = null;
    io.emit('connected', true);
});

// Procesar mensajes (igual que antes)
client.on('message', async (message) => {
    if (message.fromMe) return;
    
    const chat = await message.getChat();
    const isGroup = chat.isGroup;
    const sender = message.author || message.from;
    const isAdmin = ADMIN_NUMBERS.includes(sender);
    const text = message.body || '';
    
    if (isGroup) {
        // Bienvenida
        if (text.toLowerCase().includes('hola')) {
            await message.reply('👋 ¡Bienvenido al grupo!');
        }
        
        // Eliminar enlaces
        if (!isAdmin && (text.includes('http') || text.includes('www.') || text.includes('.com'))) {
            let isAllowed = false;
            for (const allowed of ALLOWED_LINKS) {
                if (text.includes(allowed)) {
                    isAllowed = true;
                    break;
                }
            }
            
            if (!isAllowed) {
                try {
                    await message.delete(true);
                    await message.reply('🚫 Enlace eliminado. Solo admins pueden enviar links.');
                } catch (error) {
                    console.log('Error eliminando mensaje');
                }
            }
        }
    }
});

// Manejo de errores
client.on('auth_failure', () => {
    console.log('❌ Error de autenticación');
    botConnected = false;
    io.emit('connected', false);
});

client.on('disconnected', () => {
    console.log('🔌 Bot desconectado');
    botConnected = false;
    io.emit('connected', false);
    setTimeout(() => client.initialize(), 10000);
});

// Página web con QR
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WhatsApp Bot QR</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                margin: 0;
                padding: 20px;
                min-height: 100vh;
                display: flex;
                justify-content: center;
                align-items: center;
            }
            .container {
                background: white;
                padding: 30px;
                border-radius: 15px;
                box-shadow: 0 10px 30px rgba(0,0,0,0.2);
                text-align: center;
                max-width: 400px;
                width: 100%;
            }
            h1 {
                color: #333;
                margin-bottom: 20px;
            }
            #qr-container {
                margin: 20px 0;
                padding: 20px;
                background: #f5f5f5;
                border-radius: 10px;
            }
            #qr-img {
                max-width: 300px;
                width: 100%;
                height: auto;
                border: 5px solid white;
                border-radius: 10px;
            }
            .status {
                padding: 10px;
                border-radius: 5px;
                margin: 10px 0;
                font-weight: bold;
            }
            .connected {
                background: #d4edda;
                color: #155724;
            }
            .disconnected {
                background: #f8d7da;
                color: #721c24;
            }
            .instructions {
                background: #e3f2fd;
                padding: 15px;
                border-radius: 10px;
                margin-top: 20px;
                text-align: left;
                font-size: 14px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🤖 WhatsApp Bot</h1>
            <div id="status" class="status disconnected">Desconectado</div>
            
            <div id="qr-container">
                <div id="qr-placeholder">
                    <p>Esperando código QR...</p>
                </div>
                <img id="qr-img" style="display:none;">
            </div>
            
            <div class="instructions">
                <h3>Instrucciones:</h3>
                <ol>
                    <li>Abre WhatsApp en tu teléfono</li>
                    <li>Configuración → Dispositivos vinculados</li>
                    <li>"Vincular un dispositivo"</li>
                    <li>Escanea el código QR</li>
                </ol>
            </div>
            
            <div style="margin-top: 20px; font-size: 12px; color: #666;">
                Bot activo | Elimina enlaces automáticamente
            </div>
        </div>
        
        <script src="/socket.io/socket.io.js"></script>
        <script>
            const socket = io();
            const statusEl = document.getElementById('status');
            const qrPlaceholder = document.getElementById('qr-placeholder');
            const qrImg = document.getElementById('qr-img');
            
            socket.on('qr_update', (qrData) => {
                qrPlaceholder.style.display = 'none';
                qrImg.src = qrData;
                qrImg.style.display = 'block';
                statusEl.textContent = 'Escanea el QR';
                statusEl.className = 'status disconnected';
            });
            
            socket.on('connected', (connected) => {
                if (connected) {
                    statusEl.textContent = '✅ Conectado a WhatsApp';
                    statusEl.className = 'status connected';
                    qrPlaceholder.innerHTML = '<p>✅ Sesión activa</p>';
                    qrPlaceholder.style.display = 'block';
                    qrImg.style.display = 'none';
                } else {
                    statusEl.textContent = 'Desconectado';
                    statusEl.className = 'status disconnected';
                }
            });
        </script>
    </body>
    </html>
    `);
});

// Iniciar todo
server.listen(PORT, () => {
    console.log(`🌐 Servidor: http://localhost:${PORT}`);
    console.log(`📱 Abre esa URL para escanear el QR`);
    client.initialize();
});
