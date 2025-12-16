// server.js - BOT WHATSAPP COMPLETO PARA RENDER
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
import fs from 'fs/promises';
import os from 'os';

// Configuración global
const CONFIG = {
    ADMIN_NUMBERS: ['5351808981@c.us'], // TU NÚMERO
    ALLOWED_LINKS: [
        'youtube.com',
        'youtu.be',
        'drive.google.com',
        'docs.google.com',
        'instagram.com',
        'facebook.com',
        'twitter.com',
        'x.com',
        'tiktok.com',
        'whatsapp.com',
        'github.com',
        'wikipedia.org'
    ],
    PORT: process.env.PORT || 3000,
    AUTH_DIR: './auth_data'
};

// Variables globales
let makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion;
let sock = null;
let isConnected = false;
let currentQR = null;
let express, http, socketIO, qrcode, cron;

async function loadModules() {
    try {
        console.log('📦 Cargando módulos...');
        
        // Cargar Baileys dinámicamente
        const baileysModule = await import('@whiskeysockets/baileys');
        makeWASocket = baileysModule.default;
        useMultiFileAuthState = baileysModule.useMultiFileAuthState;
        DisconnectReason = baileysModule.DisconnectReason;
        fetchLatestBaileysVersion = baileysModule.fetchLatestBaileysVersion;
        
        // Cargar otros módulos
        const expressModule = await import('express');
        express = expressModule.default;
        
        const httpModule = await import('http');
        http = httpModule.default;
        
        const socketModule = await import('socket.io');
        socketIO = socketModule.Server;
        
        const qrcodeModule = await import('qrcode-terminal');
        qrcode = qrcodeModule.default;
        
        const cronModule = await import('node-cron');
        cron = cronModule.default;
        
        console.log('✅ Módulos cargados correctamente');
        return true;
    } catch (error) {
        console.error('❌ Error cargando módulos:', error);
        return false;
    }
}

// Crear directorio de autenticación
async function ensureAuthDir() {
    try {
        await fs.mkdir(CONFIG.AUTH_DIR, { recursive: true });
        console.log(`📁 Directorio de auth: ${CONFIG.AUTH_DIR}`);
    } catch (error) {
        console.error('Error creando directorio auth:', error);
    }
}

// Conectar a WhatsApp
async function connectToWhatsApp() {
    try {
        console.log('📱 Conectando a WhatsApp...');
        
        const { state, saveCreds } = await useMultiFileAuthState(CONFIG.AUTH_DIR);
        const { version } = await fetchLatestBaileysVersion();
        
        sock = makeWASocket({
            version,
            printQRInTerminal: false,
            auth: state,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            emitOwnEvents: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            markOnlineOnConnect: false
        });
        
        // Manejar eventos de conexión
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('🔄 Nuevo QR generado');
                currentQR = qr;
                // Mostrar QR en consola
                qrcode.generate(qr, { small: true });
                
                // Emitir a sockets
                if (io) {
                    io.emit('qr', qr);
                    io.emit('status', 'Escanea el QR');
                }
            }
            
            if (connection === 'close') {
                console.log('🔌 Conexión cerrada');
                isConnected = false;
                
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                if (shouldReconnect) {
                    console.log('🔄 Reconectando en 5 segundos...');
                    if (io) io.emit('status', 'Reconectando...');
                    setTimeout(() => connectToWhatsApp(), 5000);
                } else {
                    console.log('❌ Sesión cerrada, necesita nuevo QR');
                    if (io) io.emit('status', 'Necesita nuevo QR');
                }
            } 
            else if (connection === 'open') {
                console.log('✅ CONECTADO A WHATSAPP');
                isConnected = true;
                currentQR = null;
                
                if (io) {
                    io.emit('connected', true);
                    io.emit('status', 'Conectado ✓');
                    io.emit('qr', null);
                }
                
                // Enviar estado activo
                sendPresenceUpdate();
            }
        });
        
        // Guardar credenciales
        sock.ev.on('creds.update', saveCreds);
        
        // Manejar mensajes
        sock.ev.on('messages.upsert', async (m) => {
            try {
                const message = m.messages[0];
                if (!message.message || message.key.fromMe) return;
                
                // Obtener tipo de mensaje y texto
                const messageType = Object.keys(message.message)[0];
                let text = '';
                
                if (messageType === 'conversation') {
                    text = message.message.conversation || '';
                } else if (messageType === 'extendedTextMessage') {
                    text = message.message.extendedTextMessage?.text || '';
                }
                
                const sender = message.key.remoteJid;
                const isGroup = sender.endsWith('@g.us');
                
                // Solo procesar grupos
                if (isGroup && text) {
                    await processGroupMessage(sender, text, message);
                }
            } catch (error) {
                console.error('Error procesando mensaje:', error);
            }
        });
        
        // Manejar participantes del grupo (bienvenidas)
        sock.ev.on('group-participants.update', async (update) => {
            try {
                const { id, participants, action } = update;
                
                if (action === 'add') {
                    console.log(`🎉 Nuevo miembro en grupo: ${id}`);
                    
                    for (const participant of participants) {
                        const userNumber = participant.split('@')[0];
                        await sendWelcomeMessage(id, userNumber);
                    }
                }
                
                if (action === 'remove') {
                    console.log(`👋 Miembro salió del grupo: ${id}`);
                    
                    for (const participant of participants) {
                        const userNumber = participant.split('@')[0];
                        await sendGoodbyeMessage(id, userNumber);
                    }
                }
            } catch (error) {
                console.error('Error en evento grupo:', error);
            }
        });
        
        console.log('🤖 Bot listo para recibir mensajes');
        
    } catch (error) {
        console.error('❌ Error conectando a WhatsApp:', error);
        if (io) io.emit('status', 'Error de conexión');
        
        // Reintentar en 10 segundos
        setTimeout(() => connectToWhatsApp(), 10000);
    }
}

// Procesar mensajes en grupos
async function processGroupMessage(groupId, text, originalMessage) {
    const sender = originalMessage.key.participant || originalMessage.key.remoteJid;
    const isAdmin = CONFIG.ADMIN_NUMBERS.includes(sender);
    
    // 1. BIENVENIDA AUTOMÁTICA
    const lowerText = text.toLowerCase();
    if (lowerText.includes('hola') || lowerText.includes('buenas') || lowerText.includes('saludos')) {
        const userName = sender.split('@')[0];
        await sock.sendMessage(groupId, { 
            text: `👋 ¡Hola @${userName}! Bienvenido al grupo.` 
        });
    }
    
    // 2. DETECTAR Y ELIMINAR ENLACES
    const hasLink = text.includes('http') || text.includes('www.') || text.includes('.com') || text.includes('.net');
    
    if (hasLink && !isAdmin) {
        let linkPermitido = false;
        
        // Verificar si es enlace permitido
        for (const allowedLink of CONFIG.ALLOWED_LINKS) {
            if (text.toLowerCase().includes(allowedLink)) {
                linkPermitido = true;
                break;
            }
        }
        
        // Si NO está permitido, tomar acción
        if (!linkPermitido) {
            console.log(`🚫 Enlace prohibido detectado de: ${sender}`);
            
            try {
                // Intentar eliminar el mensaje
                await sock.sendMessage(groupId, {
                    delete: originalMessage.key
                });
                
                console.log('✅ Mensaje eliminado');
                
                // Notificar en el grupo
                const userName = sender.split('@')[0];
                await sock.sendMessage(groupId, {
                    text: `@${userName} 🚫 *ENLACE ELIMINADO*\n\n` +
                          `No se permiten enlaces externos en este grupo.\n` +
                          `Solo administradores pueden compartir enlaces.\n\n` +
                          `📜 *Enlaces permitidos:*\n` +
                          CONFIG.ALLOWED_LINKS.map(l => `• ${l}`).join('\n')
                });
                
            } catch (deleteError) {
                console.log('⚠️ No se pudo eliminar (bot necesita ser admin)');
                
                // Si no puede eliminar, al menos advertir
                const userName = sender.split('@')[0];
                await sock.sendMessage(groupId, {
                    text: `@${userName} ⚠️ *ENLACE NO PERMITIDO*\n\n` +
                          `Tu mensaje contiene enlaces no autorizados.\n` +
                          `Por favor, no compartas enlaces externos.`
                });
            }
        }
    }
}

// Mensaje de bienvenida
async function sendWelcomeMessage(groupId, userNumber) {
    try {
        const welcomeMsg = `🎊 *¡BIENVENIDO/A AL GRUPO!* 🎊

Hola @${userNumber} 👋

¡Nos alegra tenerte aquí! 

📜 *Reglas importantes:*
• Respetar a todos los miembros
• No enviar spam o enlaces no permitidos
• Mantener conversaciones cordiales
• Los administradores pueden eliminar contenido inapropiado

💡 *Consejo:* Preséntate y cuéntanos de qué te gustaría hablar.

¡Disfruta tu estadía! 😊`;
        
        await sock.sendMessage(groupId, { text: welcomeMsg });
        console.log(`✅ Bienvenida enviada a ${userNumber}`);
    } catch (error) {
        console.error('Error enviando bienvenida:', error);
    }
}

// Mensaje de despedida
async function sendGoodbyeMessage(groupId, userNumber) {
    try {
        await sock.sendMessage(groupId, {
            text: `👋 @${userNumber} ha abandonado el grupo.\n¡Que le vaya bien! ✨`
        });
    } catch (error) {
        // Ignorar errores de despedida
    }
}

// Mantener presencia activa
function sendPresenceUpdate() {
    if (sock && isConnected) {
        sock.sendPresenceUpdate('available');
    }
}

// Configurar servidor web
let app, server, io;

async function setupWebServer() {
    try {
        app = express();
        server = http.createServer(app);
        io = new socketIO(server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            }
        });
        
        // Middleware
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
        
        // Ruta principal con QR
        app.get('/', (req, res) => {
            res.send(`
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>🤖 WhatsApp Bot - Control Panel</title>
                <style>
                    * {
                        margin: 0;
                        padding: 0;
                        box-sizing: border-box;
                        font-family: 'Segoe UI', Arial, sans-serif;
                    }
                    
                    body {
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        min-height: 100vh;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        padding: 20px;
                    }
                    
                    .container {
                        background: white;
                        border-radius: 20px;
                        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                        padding: 40px;
                        max-width: 500px;
                        width: 100%;
                        text-align: center;
                    }
                    
                    h1 {
                        color: #333;
                        margin-bottom: 10px;
                        font-size: 28px;
                    }
                    
                    .subtitle {
                        color: #666;
                        margin-bottom: 30px;
                        font-size: 14px;
                    }
                    
                    .status-container {
                        margin: 25px 0;
                    }
                    
                    #status {
                        background: #f0f0f0;
                        padding: 12px 25px;
                        border-radius: 50px;
                        display: inline-block;
                        font-weight: bold;
                        color: #666;
                        font-size: 16px;
                        transition: all 0.3s;
                    }
                    
                    #status.connected {
                        background: #d4edda;
                        color: #155724;
                        box-shadow: 0 4px 15px rgba(76, 175, 80, 0.3);
                    }
                    
                    #status.disconnected {
                        background: #f8d7da;
                        color: #721c24;
                    }
                    
                    .qrcode-container {
                        margin: 30px 0;
                        padding: 25px;
                        background: #f8f9fa;
                        border-radius: 15px;
                        border: 3px dashed #dee2e6;
                        min-height: 350px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    
                    #qrcode img {
                        max-width: 280px;
                        width: 100%;
                        height: auto;
                        border: 8px solid white;
                        border-radius: 10px;
                        box-shadow: 0 8px 25px rgba(0,0,0,0.1);
                    }
                    
                    .instructions {
                        background: #e3f2fd;
                        padding: 20px;
                        border-radius: 12px;
                        margin-top: 25px;
                        text-align: left;
                    }
                    
                    .instructions h3 {
                        color: #1565c0;
                        margin-bottom: 15px;
                        display: flex;
                        align-items: center;
                        gap: 10px;
                    }
                    
                    .instructions ol {
                        padding-left: 20px;
                        color: #37474f;
                    }
                    
                    .instructions li {
                        margin-bottom: 10px;
                        font-size: 14px;
                    }
                    
                    .bot-info {
                        margin-top: 25px;
                        padding: 15px;
                        background: #f5f5f5;
                        border-radius: 10px;
                        font-size: 13px;
                        color: #666;
                    }
                    
                    .stats {
                        display: flex;
                        justify-content: space-around;
                        margin-top: 20px;
                        font-size: 12px;
                        color: #888;
                    }
                    
                    @media (max-width: 600px) {
                        .container {
                            padding: 25px;
                        }
                        
                        h1 {
                            font-size: 24px;
                        }
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🤖 WhatsApp Bot Pro</h1>
                    <div class="subtitle">Panel de Control - Bienvenidas Automáticas</div>
                    
                    <div class="status-container">
                        <div id="status" class="disconnected">Desconectado</div>
                    </div>
                    
                    <div class="qrcode-container">
                        <div id="qrcode">
                            <p style="color: #6c757d;">⌛ Cargando código QR...</p>
                        </div>
                    </div>
                    
                    <div class="instructions">
                        <h3>📱 Instrucciones:</h3>
                        <ol>
                            <li>Abre WhatsApp en tu teléfono</li>
                            <li>Ve a Configuración → Dispositivos vinculados</li>
                            <li>Selecciona "Vincular un dispositivo"</li>
                            <li>Escanea el código QR de arriba</li>
                            <li>¡Listo! El bot estará activo</li>
                        </ol>
                    </div>
                    
                    <div class="bot-info">
                        <p><strong>✨ Funciones activas:</strong></p>
                        <p>• Bienvenida automática al unirse</p>
                        <p>• Elimina enlaces no permitidos</p>
                        <p>• Mensaje de despedida automático</p>
                        <p>• Solo admins pueden enviar cualquier enlace</p>
                    </div>
                    
                    <div class="stats">
                        <span>🔄 Tiempo real</span>
                        <span>⚡ Alta velocidad</span>
                        <span>🔒 Sesión segura</span>
                    </div>
                </div>
                
                <script src="/socket.io/socket.io.js"></script>
                <script>
                    const socket = io();
                    const statusElement = document.getElementById('status');
                    const qrcodeElement = document.getElementById('qrcode');
                    
                    // Conectar al servidor
                    socket.on('connect', () => {
                        console.log('Conectado al servidor');
                        socket.emit('get_status');
                    });
                    
                    // Recibir estado
                    socket.on('status', (status) => {
                        statusElement.textContent = status;
                        if (status.includes('Conectado')) {
                            statusElement.className = 'status connected';
                        } else {
                            statusElement.className = 'status disconnected';
                        }
                    });
                    
                    // Recibir QR
                    socket.on('qr', (qrData) => {
                        if (qrData) {
                            qrcodeElement.innerHTML = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qrData) + '" alt="QR Code">';
                        } else {
                            qrcodeElement.innerHTML = '<div style="text-align: center;"><div style="color: #4caf50; font-size: 50px; margin: 20px;">✓</div><p style="color: #388e3c; font-weight: bold; font-size: 18px;">✅ Bot conectado</p><p style="color: #666; margin-top: 10px;">Sesión activa y funcionando</p></div>';
                        }
                    });
                    
                    // Recibir estado de conexión
                    socket.on('connected', (connected) => {
                        if (connected) {
                            statusElement.textContent = '✅ Conectado a WhatsApp';
                            statusElement.className = 'status connected';
                        }
                    });
                    
                    // Manejar desconexión
                    socket.on('disconnect', () => {
                        statusElement.textContent = 'Desconectado del servidor';
                        statusElement.className = 'status disconnected';
                    });
                    
                    // Solicitar estado cada 30 segundos
                    setInterval(() => {
                        socket.emit('get_status');
                    }, 30000);
                </script>
            </body>
            </html>
            `);
        });
        
        // Health check para Render
        app.get('/health', (req, res) => {
            res.json({
                status: isConnected ? 'connected' : 'disconnected',
                timestamp: new Date().toISOString(),
                qr_available: !!currentQR,
                uptime: process.uptime()
            });
        });
        
        // WebSocket events
        io.on('connection', (socket) => {
            console.log('👤 Nuevo cliente conectado');
            
            // Enviar estado actual
            socket.emit('status', isConnected ? 'Conectado ✓' : 'Desconectado');
            if (currentQR) {
                socket.emit('qr', currentQR);
                socket.emit('status', 'Escanea el QR');
            }
            if (isConnected) {
                socket.emit('connected', true);
            }
            
            socket.on('get_status', () => {
                socket.emit('status', isConnected ? 'Conectado ✓' : 'Desconectado');
                if (currentQR) socket.emit('qr', currentQR);
                socket.emit('connected', isConnected);
            });
            
            socket.on('disconnect', () => {
                console.log('👤 Cliente desconectado');
            });
        });
        
        // Iniciar servidor
        server.listen(CONFIG.PORT, () => {
            console.log(`🚀 Servidor web iniciado en puerto ${CONFIG.PORT}`);
            console.log(`🌐 URL: http://localhost:${CONFIG.PORT}`);
            console.log(`🔧 Health check: http://localhost:${CONFIG.PORT}/health`);
        });
        
        return true;
    } catch (error) {
        console.error('❌ Error configurando servidor web:', error);
        return false;
    }
}

// Tarea cron para mantener activo
function setupCronJobs() {
    // Enviar presencia cada minuto
    cron.schedule('* * * * *', () => {
        if (isConnected) {
            sendPresenceUpdate();
        }
    });
    
    console.log('⏰ Tareas cron configuradas');
}

// Función principal
async function main() {
    console.log('🚀 INICIANDO WHATSAPP BOT...');
    console.log('===============================');
    
    // 1. Crear directorio auth
    await ensureAuthDir();
    
    // 2. Cargar módulos
    const modulesLoaded = await loadModules();
    if (!modulesLoaded) {
        console.error('❌ No se pudieron cargar los módulos necesarios');
        process.exit(1);
    }
    
    // 3. Configurar servidor web
    const serverReady = await setupWebServer();
    if (!serverReady) {
        console.error('❌ No se pudo iniciar el servidor web');
        process.exit(1);
    }
    
    // 4. Configurar tareas cron
    setupCronJobs();
    
    // 5. Conectar a WhatsApp
    await connectToWhatsApp();
    
    // 6. Manejar cierre limpio
    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);
    
    console.log('✅ Bot completamente inicializado');
    console.log('📱 Esperando conexión de WhatsApp...');
}

// Apagado limpio
function gracefulShutdown() {
    console.log('\n🔻 Recibida señal de apagado...');
    
    if (sock) {
        console.log('Desconectando de WhatsApp...');
        // sock.end() si está disponible
    }
    
    if (server) {
        console.log('Cerrando servidor web...');
        server.close(() => {
            console.log('✅ Servidor cerrado correctamente');
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
}

// Iniciar la aplicación
main().catch(error => {
    console.error('❌ Error fatal en la aplicación:', error);
    process.exit(1);
});
