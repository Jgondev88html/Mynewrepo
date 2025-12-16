const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const QRCode = require('qrcode');
const http = require('http');
const socketIO = require('socket.io');

// Configuración
const ADMIN_NUMBERS = ['5351808981@c.us'];
const ALLOWED_LINKS = ['youtube.com', 'instagram.com', 'facebook.com', 'drive.google.com'];

// Cache para evitar bienvenidas duplicadas
const welcomeCache = new Map();
const MAX_CACHE_TIME = 60000;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const PORT = process.env.PORT || 3000;

let qrImage = null;
let botConnected = false;

// Cliente optimizado
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

// QR
client.on('qr', async (qr) => {
    console.log('🔄 QR generado');
    try {
        qrImage = await QRCode.toDataURL(qr, { width: 300, margin: 1 });
        io.emit('qr_update', qrImage);
    } catch (err) {
        console.log('Error generando QR:', err.message);
    }
});

client.on('ready', () => {
    console.log('✅ Bot listo - Bienvenidas activas');
    botConnected = true;
    qrImage = null;
    io.emit('connected', true);
});

// DETECTAR cuando alguien SE UNE al grupo
client.on('group_join', async (notification) => {
    console.log('🎉 Alguien se unió al grupo');
    
    try {
        const chat = await notification.getChat();
        const contact = await notification.getContact();
        
        // Prevenir bienvenidas duplicadas
        const cacheKey = `${chat.id._serialized}-${contact.id._serialized}`;
        const now = Date.now();
        
        if (welcomeCache.has(cacheKey)) {
            const lastWelcome = welcomeCache.get(cacheKey);
            if (now - lastWelcome < MAX_CACHE_TIME) {
                console.log('⚠️ Bienvenida reciente, ignorando');
                return;
            }
        }
        
        welcomeCache.set(cacheKey, now);
        
        // Limpiar cache viejo
        setTimeout(() => {
            welcomeCache.delete(cacheKey);
        }, MAX_CACHE_TIME);
        
        // Enviar mensaje de bienvenida
        const welcomeMessage = `🎊 *¡BIENVENIDO/A AL GRUPO!* 🎊

Hola @${contact.id.user} 👋

¡Nos alegra tenerte aquí! 

📜 *Reglas del grupo:*
• Respetar a todos los miembros
• No enviar spam
• Mantener conversaciones cordiales
• Disfrutar y compartir

💡 *Consejo:* Preséntate y cuéntanos de qué te gustaría hablar.

¡Disfruta tu estadía! 😊`;
        
        await chat.sendMessage(welcomeMessage);
        console.log(`✅ Bienvenida enviada a ${contact.pushname || contact.id.user}`);
        
    } catch (error) {
        console.log('❌ Error en bienvenida:', error.message);
    }
});

// DETECTAR cuando alguien SALE del grupo
client.on('group_leave', async (notification) => {
    console.log('👋 Alguien salió del grupo');
    
    try {
        const chat = await notification.getChat();
        const contact = await notification.getContact();
        
        await chat.sendMessage(
            `👋 @${contact.id.user} ha abandonado el grupo.\n` +
            `¡Que le vaya bien!`
        );
    } catch (error) {
        // Ignorar errores
    }
});

// DETECCIÓN RÁPIDA DE ENLACES
client.on('message', async (message) => {
    if (message.fromMe) return;
    
    const texto = message.body || '';
    const sender = message.author || message.from;
    
    // Filtro rápido
    const ahora = Date.now();
    const timestampMsg = message.timestamp * 1000;
    if (ahora - timestampMsg > 30000) return;
    
    // DETECCIÓN RÁPIDA DE ENLACES
    if (texto.includes('http') || texto.includes('www.') || texto.includes('.com')) {
        let esPermitido = false;
        for (const allowed of ALLOWED_LINKS) {
            if (texto.toLowerCase().includes(allowed)) {
                esPermitido = true;
                break;
            }
        }
        
        if (!esPermitido) {
            const esAdmin = ADMIN_NUMBERS.includes(sender);
            
            if (!esAdmin) {
                try {
                    await message.delete(true).catch(e => {});
                    await message.reply(`🚫 Enlace no permitido eliminado`).catch(e => {});
                } catch (error) {
                    console.log('⚠️ No se pudo eliminar');
                }
            }
        }
    }
});

// WebSocket
io.on('connection', (socket) => {
    socket.emit('connected', botConnected);
    if (qrImage) socket.emit('qr_update', qrImage);
});

// Página web CORREGIDA (sin errores de sintaxis)
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WhatsApp Bot - Bienvenidas</title>
        <style>
            body {
                font-family: 'Segoe UI', Arial, sans-serif;
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
                box-shadow: 0 15px 35px rgba(0,0,0,0.2);
                text-align: center;
                max-width: 400px;
                width: 100%;
            }
            h1 {
                color: #333;
                margin-bottom: 10px;
                font-size: 24px;
            }
            .subtitle {
                color: #666;
                margin-bottom: 20px;
                font-size: 14px;
            }
            #status {
                padding: 10px 20px;
                border-radius: 25px;
                margin: 15px 0;
                font-weight: bold;
                display: inline-block;
                font-size: 14px;
            }
            .connected {
                background: linear-gradient(135deg, #d1f7c4 0%, #a8e6a3 100%);
                color: #0d5c00;
                box-shadow: 0 4px 15px rgba(0, 150, 0, 0.2);
            }
            .disconnected {
                background: linear-gradient(135deg, #ffd6d6 0%, #ffb3b3 100%);
                color: #c40000;
            }
            #qr-container {
                margin: 20px 0;
                padding: 20px;
                background: #f8f9fa;
                border-radius: 12px;
                border: 2px dashed #dee2e6;
            }
            #qr-img {
                max-width: 280px;
                width: 100%;
                height: auto;
                border: 5px solid white;
                border-radius: 8px;
                box-shadow: 0 5px 15px rgba(0,0,0,0.1);
            }
            .features {
                background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
                padding: 20px;
                border-radius: 10px;
                margin-top: 20px;
                text-align: left;
            }
            .features h3 {
                margin: 0 0 15px 0;
                color: #1565c0;
                font-size: 16px;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .features ul {
                margin: 0;
                padding-left: 20px;
                color: #37474f;
            }
            .features li {
                margin-bottom: 8px;
                font-size: 13px;
            }
            .features li:before {
                content: "✅ ";
                color: #4caf50;
            }
            .counter {
                background: #fff3cd;
                padding: 10px;
                border-radius: 8px;
                margin-top: 15px;
                font-size: 12px;
                color: #856404;
                border: 1px solid #ffeaa7;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🤖 WhatsApp Bot Pro</h1>
            <div class="subtitle">Bienvenidas automáticas + Elimina enlaces</div>
            
            <div id="status" class="disconnected">Desconectado</div>
            
            <div id="qr-container">
                <div id="qr-placeholder">
                    <p style="color: #6c757d; font-size: 14px;">⌛ Cargando código QR...</p>
                </div>
                <img id="qr-img" style="display:none;">
            </div>
            
            <div class="features">
                <h3>✨ Funciones activas:</h3>
                <ul>
                    <li>Bienvenida automática al unirse</li>
                    <li>Elimina enlaces no permitidos</li>
                    <li>Mensaje de despedida automático</li>
                    <li>Detección inteligente de URLs</li>
                    <li>Solo admins pueden enviar enlaces</li>
                    <li>Respuesta en menos de 2 segundos</li>
                </ul>
            </div>
            
            <div class="counter">
                ⏱️ Tiempo real | 🚀 Alta velocidad | 🔒 Seguro
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
                statusEl.textContent = '📱 Escanea el QR';
                statusEl.className = 'disconnected';
            });
            
            socket.on('connected', (connected) => {
                if (connected) {
                    statusEl.textContent = '✅ Bot conectado y activo';
                    statusEl.className = 'connected';
                    qrPlaceholder.innerHTML = '<div style="text-align: center;"><div style="color: #4caf50; font-size: 40px; margin: 10px 0;">✓</div><p style="color: #388e3c; font-weight: bold;">Bot funcionando correctamente</p><p style="color: #666; font-size: 12px; margin-top: 5px;">Bienvenidas automáticas activadas</p></div>';
                    qrPlaceholder.style.display = 'block';
                    qrImg.style.display = 'none';
                }
            });
        </script>
    </body>
    </html>
    `);
});

// Iniciar
server.listen(PORT, () => {
    console.log(\`🚀 Bot con bienvenidas en: http://localhost:\${PORT}\`);
    console.log(\`🎉 Funciones:\`);
    console.log(\`   • Bienvenida automática al unirse\`);
    console.log(\`   • Mensaje de despedida\`);
    console.log(\`   • Elimina enlaces no permitidos\`);
    console.log(\`   • Solo admins pueden enviar links\`);
    client.initialize();
});
