const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const QRCode = require('qrcode');
const http = require('http');
const socketIO = require('socket.io');

// Configuración
const ADMIN_NUMBERS = ['5351808981@c.us']; // TU NÚMERO
const ALLOWED_LINKS = ['youtube.com', 'instagram.com', 'facebook.com', 'drive.google.com'];

// Crear servidor web
const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const PORT = process.env.PORT || 3000;

// Variables
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

// SOLUCIÓN: Esta función SÍ puede eliminar mensajes de otros
async function eliminarMensaje(chat, message) {
    try {
        // Intentar eliminar como admin
        if (chat.isGroup) {
            const chatObj = await client.getChatById(chat.id._serialized);
            
            // Verificar si el bot es admin
            const participants = await chatObj.participants;
            const botParticipant = participants.find(p => p.id._serialized === client.info.wid._serialized);
            
            if (botParticipant && botParticipant.isAdmin) {
                // El bot es admin, puede eliminar
                await message.delete(true);
                console.log(`✅ Mensaje eliminado por admin`);
                return true;
            } else {
                // El bot NO es admin, advertir y mencionar admins
                console.log(`⚠️ Bot no es admin, no puede eliminar`);
                
                // Encontrar admins del grupo
                const admins = participants.filter(p => p.isAdmin).map(p => p.id._serialized);
                
                // Notificar a todos los admins
                for (const adminId of admins) {
                    try {
                        await client.sendMessage(adminId, 
                            `🚫 *ENLACE NO PERMITIDO*\n\n` +
                            `Usuario: @${message.author.split('@')[0]}\n` +
                            `Mensaje: ${message.body.substring(0, 50)}...\n` +
                            `Grupo: ${chat.name}\n\n` +
                            `⚠️ *Elimina este mensaje manualmente*`
                        );
                    } catch (e) {
                        console.log('No se pudo notificar al admin:', adminId);
                    }
                }
                
                // Advertir al usuario que envió el enlace
                await message.reply(
                    `@${message.author.split('@')[0]} 🚫 *ENLACE NO PERMITIDO*\n\n` +
                    `Tu mensaje será revisado por los administradores.\n` +
                    `Solo se permiten enlaces de:\n` +
                    ALLOWED_LINKS.map(l => `• ${l}`).join('\n')
                );
                
                return false;
            }
        }
    } catch (error) {
        console.log('❌ Error al intentar eliminar:', error.message);
        return false;
    }
}

// Procesar mensajes CORREGIDO
client.on('message', async (message) => {
    if (message.fromMe) return;
    
    const chat = await message.getChat();
    const isGroup = chat.isGroup;
    const sender = message.author || message.from;
    const isAdmin = ADMIN_NUMBERS.includes(sender);
    const text = message.body || '';
    
    if (isGroup) {
        // Bienvenida
        if (text.toLowerCase().includes('hola') || text.toLowerCase().includes('holis')) {
            await message.reply('👋 ¡Bienvenido al grupo!');
        }
        
        // Detectar enlaces (excepto admin)
        if (!isAdmin && (text.includes('http') || text.includes('www.') || text.includes('.com'))) {
            let isAllowed = false;
            for (const allowed of ALLOWED_LINKS) {
                if (text.toLowerCase().includes(allowed)) {
                    isAllowed = true;
                    break;
                }
            }
            
            if (!isAllowed) {
                console.log(`🚫 Enlace detectado de ${sender}: ${text.substring(0, 50)}...`);
                
                // Intentar eliminar el mensaje
                const eliminado = await eliminarMensaje(chat, message);
                
                if (!eliminado) {
                    // Si no se pudo eliminar, advertir en el grupo
                    await message.reply(
                        `🚫 *ADVERTENCIA*\n\n` +
                        `@${sender.split('@')[0]} envió un enlace no permitido.\n` +
                        `Los administradores han sido notificados.\n\n` +
                        `📜 Enlaces permitidos:\n` +
                        ALLOWED_LINKS.map(l => `• ${l}`).join('\n')
                    );
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

// Página web con QR (igual que antes)
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
                <h3>⚠️ IMPORTANTE:</h3>
                <p>Para que el bot pueda eliminar mensajes:</p>
                <ol>
                    <li>El bot DEBE ser administrador del grupo</li>
                    <li>Agrega el bot como admin en cada grupo</li>
                    <li>Solo así podrá eliminar enlaces</li>
                </ol>
            </div>
            
            <div style="margin-top: 20px; font-size: 12px; color: #666;">
                Funciones: Elimina enlaces + Da bienvenidas
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
    console.log(`⚠️ IMPORTANTE: El bot DEBE ser ADMIN de los grupos`);
    client.initialize();
});
