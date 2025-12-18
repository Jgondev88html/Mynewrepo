import fs from 'fs/promises';
import cron from 'node-cron';

// ================= CONFIGURACIÓN ACTUALIZADA =================
const CONFIG = {
    // ADMINISTRADORES - NO se les eliminarán enlaces
    ADMIN_NUMBERS: ['5351808981@c.us'], // TU NÚMERO AQUÍ
    
    // ENLACES PERMITIDOS PARA TODOS (whatsapp.com REMOVIDO)
    ALLOWED_LINKS: [
        'youtube.com', 'youtu.be',
        'instagram.com', 'facebook.com',
        'twitter.com', 'x.com',
        'tiktok.com',
        'drive.google.com', 'docs.google.com',
        'github.com', 'wikipedia.org',
        'mercadolibre.com', 'amazon.com',
        'paypal.com', 'netflix.com',
        'spotify.com', 'twitch.tv'
    ],
    
    // ENLACES BLOQUEADOS (se eliminarán de NO admins)
    // AHORA INCLUYE whatsapp.com
    BLOCKED_DOMAINS: [
        'bit.ly', 'short.url', 'tinyurl.com',
        'ow.ly', 't.co', 'goo.gl', 'is.gd',
        'buff.ly', 'adf.ly', 'shorte.st',
        'bc.vc', 'soo.gd', 'ity.im', 'v.gd',
        'whatsapp.com', 'web.whatsapp.com', // AÑADIDOS AQUÍ
        'wa.me', 'chat.whatsapp.com'
    ],
    
    PORT: process.env.PORT || 3000,
    AUTH_DIR: './auth_data',
    
    AUTO_RECONNECT: true,
    RECONNECT_DELAY: 5000
};

// ================= VARIABLES GLOBALES =================
let makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion;
let express, http, socketIO, qrcode;
let sock = null;
let isConnected = false;
let currentQR = null;
let app, server, io;

// ================= CARGAR MÓDULOS =================
async function loadModules() {
    try {
        const baileysModule = await import('@whiskeysockets/baileys');
        makeWASocket = baileysModule.default;
        useMultiFileAuthState = baileysModule.useMultiFileAuthState;
        DisconnectReason = baileysModule.DisconnectReason;
        fetchLatestBaileysVersion = baileysModule.fetchLatestBaileysVersion;
        
        const expressModule = await import('express');
        express = expressModule.default;
        
        const httpModule = await import('http');
        http = httpModule.default;
        
        const socketModule = await import('socket.io');
        socketIO = socketModule.Server;
        
        const qrcodeModule = await import('qrcode-terminal');
        qrcode = qrcodeModule.default;
        
        console.log('✅ Módulos cargados');
        return true;
    } catch (error) {
        console.error('❌ Error cargando módulos:', error);
        return false;
    }
}

// ================= CONECTAR WHATSAPP =================
async function connectToWhatsApp() {
    try {
        console.log('📱 Conectando a WhatsApp...');
        
        await fs.mkdir(CONFIG.AUTH_DIR, { recursive: true });
        
        const { state, saveCreds } = await useMultiFileAuthState(CONFIG.AUTH_DIR);
        const { version } = await fetchLatestBaileysVersion();
        
        sock = makeWASocket({
            version,
            printQRInTerminal: false,
            auth: state,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000
        });
        
        // EVENTOS DE CONEXIÓN
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('🔄 QR generado');
                currentQR = qr;
                qrcode.generate(qr, { small: true });
                
                if (io) {
                    io.emit('qr', qr);
                    io.emit('status', 'Escanea el QR');
                }
            }
            
            if (connection === 'close') {
                console.log('🔌 Conexión cerrada');
                isConnected = false;
                
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect && CONFIG.AUTO_RECONNECT) {
                    console.log('🔄 Reconectando en 5 segundos...');
                    setTimeout(() => connectToWhatsApp(), 5000);
                }
            } 
            else if (connection === 'open') {
                console.log('✅ CONECTADO A WHATSAPP');
                console.log('👤 ID del bot:', sock.user?.id);
                isConnected = true;
                currentQR = null;
                
                if (io) {
                    io.emit('connected', true);
                    io.emit('status', 'Conectado ✓');
                    io.emit('qr', null);
                }
            }
        });
        
        // Guardar credenciales
        sock.ev.on('creds.update', saveCreds);
        
        // ================= BIENVENIDAS MEJORADAS =================
        sock.ev.on('group-participants.update', async (update) => {
            try {
                const { id, participants, action } = update;
                
                if (action === 'add') {
                    console.log(`🎉 Nuevo(s) miembro(s) en el grupo`);
                    
                    // Mensaje de bienvenida general (sin mencionar números)
                    const welcomeMessage = `🎊 *¡BIENVENIDO(S) AL GRUPO!* 🎉

¡Hola! 👋

Nos alegra tener nuevo(s) integrante(s) con nosotros.

📜 *Para una mejor convivencia:*
• Respeta a todos los miembros
• Comparte contenido relevante
• Disfruta las conversaciones

💡 *Sugerencia:* Preséntate cuando tengas un momento.

¡Que tengas una excelente estadía! 😊`;
                    
                    // Enviar con delay
                    setTimeout(async () => {
                        try {
                            await sock.sendMessage(id, { text: welcomeMessage });
                            console.log(`✅ Bienvenida enviada a ${participants.length} nuevo(s) miembro(s)`);
                        } catch (error) {
                            console.log('Error enviando bienvenida:', error.message);
                        }
                    }, 2000);
                }
            } catch (error) {
                console.error('Error en bienvenida:', error.message);
            }
        });
        
        // ================= DETECCIÓN DE ENLACES =================
        sock.ev.on('messages.upsert', async (m) => {
            try {
                const message = m.messages[0];
                if (!message.message || message.key.fromMe) return;
                
                // Obtener texto
                const messageType = Object.keys(message.message)[0];
                let text = '';
                
                if (messageType === 'conversation') {
                    text = message.message.conversation || '';
                } else if (messageType === 'extendedTextMessage') {
                    text = message.message.extendedTextMessage?.text || '';
                }
                
                const sender = message.key.remoteJid;
                const isGroup = sender.endsWith('@g.us');
                
                if (isGroup && text) {
                    await processGroupMessage(sender, text, message);
                }
            } catch (error) {
                console.error('Error procesando mensaje:', error);
            }
        });
        
        console.log('🤖 Bot listo - Elimina whatsapp.com de NO admins');
        
    } catch (error) {
        console.error('❌ Error conectando:', error);
        setTimeout(() => connectToWhatsApp(), 10000);
    }
}

// ================= DETECTAR ENLACES =================
function detectLinks(text) {
    if (!text) return { hasLinks: false, links: [] };
    
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[^\s]+\.[a-z]{2,}(\/[^\s]*)?)/gi;
    const matches = text.match(urlRegex) || [];
    
    return {
        hasLinks: matches.length > 0,
        links: matches
    };
}

// ================= VERIFICAR SI ES ENLACE PERMITIDO =================
function isLinkAllowed(url) {
    const lowerUrl = url.toLowerCase();
    
    // Verificar lista permitida
    for (const allowed of CONFIG.ALLOWED_LINKS) {
        if (lowerUrl.includes(allowed)) {
            return true;
        }
    }
    
    // Verificar lista bloqueada (AHORA INCLUYE whatsapp.com)
    for (const blocked of CONFIG.BLOCKED_DOMAINS) {
        if (lowerUrl.includes(blocked)) {
            return false;
        }
    }
    
    // Por defecto: no permitido
    return false;
}

// ================= VERIFICAR SI ES ADMINISTRADOR =================
async function isUserAdmin(groupId, userId) {
    try {
        console.log(`🔍 Verificando admin: ${userId}`);
        
        // 1. Verificar si está en la lista de administradores configurados
        if (CONFIG.ADMIN_NUMBERS.includes(userId)) {
            console.log(`✅ ${userId.split('@')[0]} es ADMIN configurado`);
            return true;
        }
        
        // 2. Verificar si es admin del grupo
        if (!sock || !isConnected) {
            return false;
        }
        
        try {
            const metadata = await sock.groupMetadata(groupId);
            const participant = metadata.participants.find(p => p.id === userId);
            
            if (participant && participant.admin) {
                console.log(`👑 ${userId.split('@')[0]} es ADMIN del grupo`);
                return true;
            }
        } catch (error) {
            console.log('Error verificando admin del grupo:', error.message);
        }
        
        return false;
        
    } catch (error) {
        console.log('Error en isUserAdmin:', error.message);
        return false;
    }
}

// ================= PROCESAR MENSAJES =================
async function processGroupMessage(groupId, text, originalMessage) {
    try {
        const sender = originalMessage.key.participant || originalMessage.key.remoteJid;
        const userNumber = sender.split('@')[0];
        
        // VERIFICAR SI ES ADMIN
        const isAdmin = await isUserAdmin(groupId, sender);
        
        console.log(`👤 ${userNumber} - Admin: ${isAdmin ? 'SÍ' : 'NO'}`);
        
        // COMANDOS ESPECIALES
        if (text.startsWith('!')) {
            const command = text.toLowerCase().trim();
            
            if (command === '!bot') {
                await sock.sendMessage(groupId, {
                    text: '🤖 *BOT WHATSAPP*\n\n' +
                          '✅ *Funciones activas:*\n' +
                          '• Elimina enlaces de NO admins\n' +
                          '• Bienvenidas automáticas\n' +
                          '• Auto-reconexión\n\n' +
                          '🚫 *whatsapp.com ahora está BLOQUEADO*\n' +
                          '👑 *Admins pueden enviar cualquier enlace*'
                });
                return;
            }
            
            if (command === '!admin') {
                const response = isAdmin ? 
                    '👑 *Eres ADMINISTRADOR*\nTus enlaces NO serán eliminados' : 
                    '🔒 *NO eres administrador*\nAlgunos enlaces serán eliminados';
                
                await sock.sendMessage(groupId, { text: response });
                return;
            }
            
            if (command === '!links') {
                await sock.sendMessage(groupId, {
                    text: '🔗 *POLÍTICA DE ENLACES*\n\n' +
                          '✅ *PERMITIDOS:*\n' +
                          'YouTube, Instagram, Facebook, TikTok\n' +
                          'Google Drive, GitHub, Wikipedia, etc.\n\n' +
                          '❌ *BLOQUEADOS (para NO admins):*\n' +
                          'whatsapp.com, bit.ly, tinyurl.com\n' +
                          'y otros acortadores\n\n' +
                          '👑 *ADMINS:* Pueden enviar cualquier enlace'
                });
                return;
            }
            
            if (command === '!test') {
                await sock.sendMessage(groupId, {
                    text: `✅ Bot funcionando\n` +
                          `👤 Usuario: ${userNumber}\n` +
                          `👑 Admin: ${isAdmin ? 'SÍ' : 'NO'}\n` +
                          `🔗 whatsapp.com: ${isAdmin ? 'PERMITIDO' : 'BLOQUEADO'}`
                });
                return;
            }
        }
        
        // DETECTAR ENLACES
        const { hasLinks, links } = detectLinks(text);
        
        // ✅ SOLO PROCESAR SI TIENE ENLACES Y NO ES ADMIN
        if (hasLinks && !isAdmin) {
            console.log(`🔍 Procesando enlaces de NO admin: ${userNumber}`);
            
            let hasBlockedLinks = false;
            const blockedLinks = [];
            
            // Verificar cada enlace
            for (const link of links) {
                if (!isLinkAllowed(link)) {
                    hasBlockedLinks = true;
                    blockedLinks.push(link);
                }
            }
            
            // ✅ SI TIENE ENLACES BLOQUEADOS → ELIMINAR
            if (hasBlockedLinks && blockedLinks.length > 0) {
                console.log(`🚫 ${blockedLinks.length} enlace(s) bloqueado(s) de ${userNumber}`);
                
                try {
                    // 1. Intentar eliminar el mensaje
                    await sock.sendMessage(groupId, {
                        delete: originalMessage.key
                    });
                    
                    console.log(`✅ Mensaje eliminado de ${userNumber}`);
                    
                    // 2. Enviar advertencia
                    const warningMsg = `@${userNumber} 🚫 *ENLACE ELIMINADO*\n\n` +
                                     `Has compartido ${blockedLinks.length} enlace(s) no permitido(s).\n\n`;
                    
                    let blockedList = '';
                    if (blockedLinks.some(l => l.includes('whatsapp.com'))) {
                        blockedList = '❌ *Enlaces de WhatsApp están BLOQUEADOS*\n';
                    }
                    
                    blockedList += '❌ *Acortadores (bit.ly, tinyurl, etc.) están BLOQUEADOS*\n\n' +
                                  '✅ *Usa enlaces completos de sitios conocidos*\n' +
                                  '👑 *Solo ADMINS pueden enviar cualquier enlace*';
                    
                    await sock.sendMessage(groupId, { 
                        text: warningMsg + blockedList 
                    });
                    
                } catch (deleteError) {
                    console.log('No se pudo eliminar:', deleteError.message);
                    
                    // Si no puede eliminar, al menos advertir
                    await sock.sendMessage(groupId, {
                        text: `@${userNumber} ⚠️ *ENLACE NO PERMITIDO*\n\n` +
                              `whatsapp.com y acortadores están BLOQUEADOS.\n` +
                              `Usa enlaces completos de sitios conocidos.\n\n` +
                              `🔒 *Esta regla aplica a NO administradores*`
                    });
                }
            }
            
        } else if (hasLinks && isAdmin) {
            // ✅ ADMIN ENVIÓ ENLACE - PERMITIR SIEMPRE
            console.log(`✅ Admin ${userNumber} envió enlace - PERMITIDO`);
            
            // Opcional: Confirmar que fue permitido
            if (links.some(l => l.includes('whatsapp.com'))) {
                console.log(`✅ Admin ${userNumber} envió whatsapp.com - PERMITIDO`);
            }
        }
        
    } catch (error) {
        console.error('❌ Error en processGroupMessage:', error);
    }
}

// ================= SERVIDOR WEB =================
async function setupWebServer() {
    try {
        app = express();
        server = http.createServer(app);
        io = new socketIO(server, {
            cors: { origin: "*", methods: ["GET", "POST"] }
        });
        
        // RUTAS
        app.get('/', (req, res) => {
            res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>🤖 WhatsApp Bot - Elimina whatsapp.com</title>
                <style>
                    body {
                        font-family: Arial;
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
                        text-align: center;
                        max-width: 500px;
                        width: 100%;
                        box-shadow: 0 15px 35px rgba(0,0,0,0.3);
                    }
                    h1 { color: #333; margin-bottom: 10px; }
                    #status {
                        padding: 12px 25px;
                        border-radius: 25px;
                        margin: 20px 0;
                        font-weight: bold;
                        display: inline-block;
                    }
                    .connected { background: #d4edda; color: #155724; }
                    .disconnected { background: #f8d7da; color: #721c24; }
                    .qrcode-container {
                        margin: 25px 0;
                        padding: 20px;
                        background: #f8f9fa;
                        border-radius: 12px;
                        min-height: 350px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    .info {
                        background: #e3f2fd;
                        padding: 20px;
                        border-radius: 10px;
                        margin-top: 20px;
                        text-align: left;
                    }
                    .blocked { color: #dc3545; font-weight: bold; }
                    .allowed { color: #28a745; font-weight: bold; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🤖 WhatsApp Bot Pro</h1>
                    <div><strong>ELIMINA whatsapp.com de NO admins</strong></div>
                    
                    <div id="status" class="disconnected">Desconectado</div>
                    
                    <div class="qrcode-container">
                        <div id="qrcode">
                            <p style="color: #666;">⌛ Cargando QR...</p>
                        </div>
                    </div>
                    
                    <div class="info">
                        <h3>🚫 <span class="blocked">whatsapp.com AHORA BLOQUEADO</span></h3>
                        <ul>
                            <li><span class="blocked">❌ whatsapp.com</span> - Eliminado automáticamente</li>
                            <li><span class="blocked">❌ web.whatsapp.com</span> - Eliminado automáticamente</li>
                            <li><span class="blocked">❌ Acortadores (bit.ly, tinyurl)</span> - Eliminados</li>
                            <li><span class="allowed">✅ YouTube, Instagram, Facebook</span> - Permitidos</li>
                            <li><span class="allowed">✅ Google Drive, GitHub</span> - Permitidos</li>
                        </ul>
                        
                        <p><strong>👑 IMPORTANTE:</strong> Solo ADMINISTRADORES pueden enviar cualquier enlace.</p>
                        <p><strong>🔧 Comandos:</strong> !bot, !admin, !links, !test</p>
                    </div>
                </div>
                
                <script src="/socket.io/socket.io.js"></script>
                <script>
                    const socket = io();
                    const statusEl = document.getElementById('status');
                    const qrcodeEl = document.getElementById('qrcode');
                    
                    socket.on('qr', (qrData) => {
                        qrcodeEl.innerHTML = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + 
                                            encodeURIComponent(qrData) + '" style="max-width:100%;">';
                        statusEl.textContent = '📱 Escanea el QR';
                        statusEl.className = 'disconnected';
                    });
                    
                    socket.on('connected', (connected) => {
                        if (connected) {
                            statusEl.textContent = '✅ Conectado - Elimina whatsapp.com';
                            statusEl.className = 'connected';
                            qrcodeEl.innerHTML = '<div style="color:#4caf50;font-size:50px;">✓</div>' +
                                                '<p style="color:#388e3c;font-weight:bold;">Bot activo</p>' +
                                                '<p>whatsapp.com bloqueado para NO admins</p>';
                        }
                    });
                    
                    socket.on('status', (status) => {
                        statusEl.textContent = status;
                    });
                </script>
            </body>
            </html>
            `);
        });
        
        app.get('/health', (req, res) => {
            res.json({
                status: isConnected ? 'connected' : 'disconnected',
                whatsapp_blocked: true,
                timestamp: new Date().toISOString()
            });
        });
        
        // WEBSOCKET
        io.on('connection', (socket) => {
            socket.emit('status', isConnected ? 'Conectado ✓' : 'Desconectado');
            if (currentQR) socket.emit('qr', currentQR);
            socket.emit('connected', isConnected);
        });
        
        // INICIAR SERVIDOR
        server.listen(CONFIG.PORT, () => {
            console.log(`🚀 Servidor: http://localhost:${CONFIG.PORT}`);
            console.log(`🔧 Health: http://localhost:${CONFIG.PORT}/health`);
            console.log(`🚫 whatsapp.com ahora está BLOQUEADO para NO administradores`);
        });
        
        return true;
    } catch (error) {
        console.error('❌ Error servidor web:', error);
        return false;
    }
}

// ================= KEEP-ALIVE PARA RENDER =================
function setupKeepAlive() {
    // Tarea cada 50 segundos para mantener activo en Render
    cron.schedule('*/50 * * * * *', () => {
        if (isConnected && sock) {
            // Enviar presencia silenciosa
            sock.sendPresenceUpdate('available').catch(() => {});
        }
    });
    
    console.log('⏱️ Keep-alive activado (50 segundos)');
}

// ================= INICIAR TODO =================
async function main() {
    console.log('🚀 INICIANDO BOT WHATSAPP...');
    console.log('================================');
    console.log('🚫 whatsapp.com BLOQUEADO para NO admins');
    console.log('👑 Admins pueden enviar cualquier enlace');
    
    // 1. Cargar módulos
    if (!await loadModules()) {
        console.error('❌ No se pudieron cargar módulos');
        process.exit(1);
    }
    
    // 2. Iniciar servidor web
    if (!await setupWebServer()) {
        console.error('❌ No se pudo iniciar servidor web');
        process.exit(1);
    }
    
    // 3. Configurar keep-alive
    setupKeepAlive();
    
    // 4. Conectar a WhatsApp
    await connectToWhatsApp();
    
    // 5. Manejar cierre
    process.on('SIGINT', () => {
        console.log('\n🔻 Apagando...');
        process.exit(0);
    });
    
    console.log('✅ Bot inicializado');
    console.log('📋 Reglas:');
    console.log('   • whatsapp.com BLOQUEADO para NO admins');
    console.log('   • Acortadores BLOQUEADOS para NO admins');
    console.log('   • Admins pueden enviar cualquier enlace');
    console.log('   • Bienvenidas automáticas activadas');
}

// EJECUTAR
main().catch(error => {
    console.error('❌ Error fatal:', error);
    process.exit(1);
});
