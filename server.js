import fs from 'fs/promises';
import cron from 'node-cron';

// ================= CONFIGURACIÓN MEJORADA =================
const CONFIG = {
    // ADMINISTRADORES (NO se les eliminarán enlaces)
    ADMIN_NUMBERS: ['5351808981@c.us'], // TU NÚMERO
    
    // ENLACES PERMITIDOS PARA TODOS
    ALLOWED_LINKS: [
        'youtube.com', 'youtu.be',
        'instagram.com', 'facebook.com',
        'twitter.com', 'x.com',
        'tiktok.com',
        'drive.google.com', 'docs.google.com',
        'github.com', 'wikipedia.org'
    ],
    
    // ENLACES BLOQUEADOS (se eliminarán)
    BLOCKED_DOMAINS: [
        'bit.ly', 'short.url', 'tinyurl.com',
        'ow.ly', 't.co', 'goo.gl', 'is.gd',
        'buff.ly', 'whatsapp.com', 'adf.ly', 'shorte.st'
    ],
    
    // CONFIGURACIÓN DE RENDER
    PORT: process.env.PORT || 3000,
    AUTH_DIR: './auth_data',
    
    // AUTO-RECONEXIÓN
    AUTO_RECONNECT: true,
    RECONNECT_DELAY: 5000, // 5 segundos
    
    // KEEP-ALIVE PARA RENDER
    KEEP_ALIVE_INTERVAL: 55000, // 55 segundos (menos de 1 minuto)
    
    // CACHE PARA NO ELIMINAR BIENVENIDAS DUPLICADAS
    WELCOME_CACHE: new Map(),
    CACHE_TIMEOUT: 300000 // 5 minutos
};

// ================= VARIABLES GLOBALES =================
let makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion;
let express, http, socketIO, qrcode;
let sock = null;
let isConnected = false;
let currentQR = null;
let app, server, io;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

// ================= MEJORA 1: SISTEMA DE AUTO-RECONEXIÓN =================
class ConnectionManager {
    constructor() {
        this.isConnecting = false;
        this.lastConnectionTime = 0;
        this.sessionRestored = false;
    }
    
    async restoreSession() {
        try {
            // Verificar si existe sesión guardada
            const authFiles = await fs.readdir(CONFIG.AUTH_DIR).catch(() => []);
            
            if (authFiles.length > 0) {
                console.log('🔍 Sesión previa encontrada, intentando restaurar...');
                return true;
            }
            return false;
        } catch (error) {
            return false;
        }
    }
    
    async ensureAuthDir() {
        await fs.mkdir(CONFIG.AUTH_DIR, { recursive: true });
    }
}

const connectionManager = new ConnectionManager();

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

// ================= MEJORA 2: CONEXIÓN ROBUSTA =================
async function connectToWhatsApp() {
    if (connectionManager.isConnecting) return;
    
    try {
        connectionManager.isConnecting = true;
        console.log('📱 Conectando a WhatsApp...');
        
        // Intentar restaurar sesión primero
        const hasSession = await connectionManager.restoreSession();
        await connectionManager.ensureAuthDir();
        
        const { state, saveCreds } = await useMultiFileAuthState(CONFIG.AUTH_DIR);
        const { version } = await fetchLatestBaileysVersion();
        
        sock = makeWASocket({
            version,
            printQRInTerminal: false,
            auth: state,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 25000,
            emitOwnEvents: true,
            syncFullHistory: false,
            generateHighQualityLinkPreview: false,
            markOnlineOnConnect: false // IMPORTANTE: No marcar online
        });
        
        // ================= EVENTOS MEJORADOS =================
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('🔄 QR generado (sesión nueva)');
                currentQR = qr;
                qrcode.generate(qr, { small: true });
                
                if (io) {
                    io.emit('qr', qr);
                    io.emit('status', 'Escanea el QR');
                    io.emit('session', 'new');
                }
                
                connectionManager.sessionRestored = false;
            }
            
            if (connection === 'close') {
                console.log('🔌 Conexión cerrada');
                isConnected = false;
                connectionManager.isConnecting = false;
                
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                console.log('Código de desconexión:', statusCode);
                
                // NO reconectar si fue logout manual
                if (statusCode === DisconnectReason.loggedOut) {
                    console.log('❌ Sesión cerrada, necesita nuevo QR');
                    if (io) io.emit('status', 'Sesión cerrada - Escanea QR');
                    return;
                }
                
                // Auto-reconexión inteligente
                if (CONFIG.AUTO_RECONNECT && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttempts++;
                    const delay = Math.min(CONFIG.RECONNECT_DELAY * reconnectAttempts, 30000);
                    console.log(`🔄 Reconectando en ${delay/1000} segundos (intento ${reconnectAttempts})...`);
                    
                    if (io) io.emit('status', `Reconectando... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
                    
                    setTimeout(() => {
                        connectToWhatsApp();
                    }, delay);
                }
            } 
            else if (connection === 'open') {
                console.log('✅ CONECTADO A WHATSAPP');
                console.log('👤 ID del bot:', sock.user?.id);
                
                isConnected = true;
                currentQR = null;
                reconnectAttempts = 0;
                connectionManager.isConnecting = false;
                connectionManager.lastConnectionTime = Date.now();
                
                if (hasSession && !connectionManager.sessionRestored) {
                    console.log('🎉 Sesión restaurada automáticamente');
                    connectionManager.sessionRestored = true;
                }
                
                if (io) {
                    io.emit('connected', true);
                    io.emit('status', 'Conectado ✓');
                    io.emit('qr', null);
                    io.emit('session', hasSession ? 'restored' : 'new');
                }
                
                // Iniciar keep-alive
                startKeepAlive();
            }
        });
        
        // Guardar credenciales automáticamente
        sock.ev.on('creds.update', saveCreds);
        
        // ================= MEJORA 3: BIENVENIDAS INTELIGENTES =================
        sock.ev.on('group-participants.update', async (update) => {
            try {
                const { id, participants, action } = update;
                
                if (action === 'add') {
                    for (const participant of participants) {
                        const userNumber = participant.split('@')[0];
                        const cacheKey = `${id}-${participant}`;
                        
                        // Evitar bienvenidas duplicadas
                        if (CONFIG.WELCOME_CACHE.has(cacheKey)) {
                            console.log(`⚠️ Bienvenida reciente para ${userNumber}, omitiendo`);
                            return;
                        }
                        
                        // Agregar a cache
                        CONFIG.WELCOME_CACHE.set(cacheKey, Date.now());
                        
                        // Limpiar cache después de timeout
                        setTimeout(() => {
                            CONFIG.WELCOME_CACHE.delete(cacheKey);
                        }, CONFIG.CACHE_TIMEOUT);
                        
                        // Mensaje de bienvenida mejorado
                        const welcomeMsg = `🎊 *¡BIENVENIDO/A AL GRUPO!* 🎊

Hola @${userNumber} 👋

¡Nos alegra tenerte con nosotros! 

📜 *Para una mejor convivencia:*
• Respeta a todos los miembros
• Evita contenido inapropiado
• Disfruta las conversaciones

*Nota:* Algunos enlaces se eliminan automáticamente por seguridad.

¡Que tengas una excelente estadía! 😊`;
                        
                        if (sock) {
                            await sock.sendMessage(id, { text: welcomeMsg });
                            console.log(`✅ Bienvenida enviada a ${userNumber} en ${id}`);
                        }
                    }
                }
            } catch (error) {
                console.error('Error en bienvenida:', error.message);
            }
        });
        
        // ================= MEJORA 4: DETECCIÓN DE ENLACES MEJORADA =================
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
        
        console.log('🤖 Bot listo - Versión mejorada');
        
    } catch (error) {
        console.error('❌ Error en conexión:', error.message);
        connectionManager.isConnecting = false;
        
        if (CONFIG.AUTO_RECONNECT && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            setTimeout(() => connectToWhatsApp(), CONFIG.RECONNECT_DELAY);
        }
    }
}

// ================= MEJORA 5: KEEP-ALIVE PARA RENDER =================
function startKeepAlive() {
    // Tarea cada 55 segundos (Render free tier cierra a 60 segundos de inactividad)
    cron.schedule('*/55 * * * * *', async () => {
        if (sock && isConnected) {
            try {
                // Enviar presencia silenciosa
                await sock.sendPresenceUpdate('available');
                
                // También mantener vivo el servidor web
                if (Date.now() - connectionManager.lastConnectionTime > 300000) { // 5 minutos
                    console.log('♻️ Keep-alive activado');
                    connectionManager.lastConnectionTime = Date.now();
                }
            } catch (error) {
                console.log('Keep-alive error:', error.message);
            }
        }
    });
    
    console.log('⏱️ Sistema keep-alive activado (55 segundos)');
}

// ================= DETECCIÓN DE ENLACES =================
function detectLinks(text) {
    if (!text) return { hasLinks: false, links: [] };
    
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[^\s]+\.[a-z]{2,}(\/[^\s]*)?)/gi;
    const matches = text.match(urlRegex) || [];
    
    return {
        hasLinks: matches.length > 0,
        links: matches
    };
}

// ================= MEJORA 6: VERIFICACIÓN DE ADMINISTRADORES =================
async function isUserAdmin(groupId, userId) {
    try {
        // Si es administrador configurado, siempre permitir
        if (CONFIG.ADMIN_NUMBERS.includes(userId)) {
            return true;
        }
        
        // Verificar si es admin del grupo
        const metadata = await sock.groupMetadata(groupId).catch(() => null);
        if (!metadata) return false;
        
        const participant = metadata.participants.find(p => p.id === userId);
        return participant ? participant.admin : false;
        
    } catch (error) {
        console.log('Error verificando admin:', error.message);
        return false;
    }
}

// ================= MEJORA 7: NO ELIMINAR ENLACES DE ADMINS =================
function isLinkAllowed(url) {
    const lowerUrl = url.toLowerCase();
    
    // Permitir siempre whatsapp.com (es necesario para el bot)
    if (lowerUrl.includes('whatsapp.com') || lowerUrl.includes('web.whatsapp.com')) {
        return true;
    }
    
    // Verificar lista permitida
    for (const allowed of CONFIG.ALLOWED_LINKS) {
        if (lowerUrl.includes(allowed)) {
            return true;
        }
    }
    
    // Verificar lista bloqueada
    for (const blocked of CONFIG.BLOCKED_DOMAINS) {
        if (lowerUrl.includes(blocked)) {
            return false;
        }
    }
    
    // Por defecto: no permitido para usuarios normales
    return false;
}

// ================= PROCESAR MENSAJES MEJORADO =================
async function processGroupMessage(groupId, text, originalMessage) {
    try {
        const sender = originalMessage.key.participant || originalMessage.key.remoteJid;
        const userNumber = sender.split('@')[0];
        
        // MEJORA: Verificar si es administrador (configurado o del grupo)
        const isAdmin = await isUserAdmin(groupId, sender);
        
        // COMANDOS ESPECIALES MEJORADOS
        if (text.startsWith('!')) {
            const command = text.toLowerCase().trim();
            
            if (command === '!bot') {
                await sock.sendMessage(groupId, {
                    text: '🤖 *BOT WHATSAPP PRO*\n\n' +
                          '✅ *Funciones activas:*\n' +
                          '• Bienvenidas automáticas\n' +
                          '• Eliminación de enlaces sospechosos\n' +
                          '• Auto-reconexión\n' +
                          '• Sesión persistente\n\n' +
                          '📊 *Estado:* ' + (isConnected ? 'Conectado' : 'Desconectado') + '\n' +
                          '🔄 *Reconexiones:* ' + reconnectAttempts + '\n\n' +
                          '⚙️ *Comandos:* !bot, !admin, !links, !status'
                });
                return;
            }
            
            if (command === '!admin') {
                const response = isAdmin ? 
                    '👑 *Eres administrador* - Tus enlaces no serán eliminados' : 
                    '🔒 *No eres administrador* - Algunos enlaces serán bloqueados';
                
                await sock.sendMessage(groupId, { text: response });
                return;
            }
            
            if (command === '!links') {
                await sock.sendMessage(groupId, {
                    text: '🔗 *POLÍTICA DE ENLACES*\n\n' +
                          '✅ *PERMITIDOS para todos:*\n' +
                          CONFIG.ALLOWED_LINKS.slice(0, 8).map(l => `• ${l}`).join('\n') +
                          '\n\n❌ *BLOQUEADOS (acortadores):*\n' +
                          CONFIG.BLOCKED_DOMAINS.slice(0, 8).map(l => `• ${l}`).join('\n') +
                          '\n\n👑 *ADMINISTRADORES:* Pueden enviar cualquier enlace'
                });
                return;
            }
            
            if (command === '!status') {
                const statusMsg = `📊 *ESTADO DEL BOT*\n\n` +
                                 `• Conexión: ${isConnected ? '✅ Conectado' : '❌ Desconectado'}\n` +
                                 `• Sesión: ${connectionManager.sessionRestored ? '🔄 Restaurada' : '🆕 Nueva'}\n` +
                                 `• Reconexiones: ${reconnectAttempts}\n` +
                                 `• Admin: ${isAdmin ? '👑 Sí' : '🔒 No'}\n` +
                                 `• Grupo: ${groupId}`;
                
                await sock.sendMessage(groupId, { text: statusMsg });
                return;
            }
            
            // Comando secreto para forzar reconexión
            if (command === '!reconnect' && isAdmin) {
                await sock.sendMessage(groupId, { text: '🔄 Forzando reconexión...' });
                setTimeout(() => connectToWhatsApp(), 1000);
                return;
            }
        }
        
        // DETECTAR Y PROCESAR ENLACES
        const { hasLinks, links } = detectLinks(text);
        
        if (hasLinks && !isAdmin) { // MEJORA: NO eliminar enlaces de admins
            console.log(`🔍 Enlaces detectados de ${userNumber} (admin: ${isAdmin})`);
            
            let allLinksAllowed = true;
            const blockedLinks = [];
            
            for (const link of links) {
                if (!isLinkAllowed(link)) {
                    allLinksAllowed = false;
                    blockedLinks.push(link);
                }
            }
            
            // ELIMINAR SOLO SI NO ES ADMIN Y TIENE ENLACES BLOQUEADOS
            if (!allLinksAllowed && blockedLinks.length > 0) {
                console.log(`🚫 Eliminando ${blockedLinks.length} enlace(s) de ${userNumber}`);
                
                try {
                    // Intentar eliminar
                    await sock.sendMessage(groupId, {
                        delete: originalMessage.key
                    }).catch(async () => {
                        // Si falla, enviar advertencia
                        await sock.sendMessage(groupId, {
                            text: `@${userNumber} ⚠️ *ENLACE BLOQUEADO*\n\n` +
                                  `Has compartido un enlace no permitido.\n` +
                                  `Solo se permiten sitios conocidos.\n\n` +
                                  `👑 *Los administradores pueden enviar cualquier enlace.*`
                        });
                    });
                    
                    // Log para debugging
                    console.log(`✅ Acción tomada para ${userNumber}`);
                    
                } catch (error) {
                    console.log('Error en eliminación:', error.message);
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Error procesando mensaje:', error);
    }
}

// ================= MEJORA 8: SERVIDOR WEB OPTIMIZADO =================
async function setupWebServer() {
    try {
        app = express();
        server = http.createServer(app);
        io = new socketIO(server, {
            cors: { origin: "*", methods: ["GET", "POST"] },
            pingTimeout: 60000,
            pingInterval: 25000
        });
        
        // RUTA PRINCIPAL MEJORADA
        app.get('/', (req, res) => {
            res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>🤖 WhatsApp Bot Pro</title>
                <style>
                    body {
                        font-family: 'Segoe UI', Arial, sans-serif;
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
                        padding: 35px;
                        border-radius: 20px;
                        text-align: center;
                        max-width: 500px;
                        width: 100%;
                        box-shadow: 0 20px 50px rgba(0,0,0,0.3);
                    }
                    h1 { color: #333; margin-bottom: 10px; font-size: 28px; }
                    .subtitle { color: #666; margin-bottom: 25px; font-size: 14px; }
                    #status {
                        padding: 12px 30px;
                        border-radius: 30px;
                        margin: 20px 0;
                        font-weight: bold;
                        display: inline-block;
                        font-size: 16px;
                        transition: all 0.3s;
                    }
                    .connected { background: linear-gradient(135deg, #d4edda 0%, #a8e6a3 100%); color: #155724; }
                    .disconnected { background: linear-gradient(135deg, #f8d7da 0%, #ffb3b3 100%); color: #721c24; }
                    .restored { background: linear-gradient(135deg, #d1ecf1 0%, #bee5eb 100%); color: #0c5460; }
                    .qrcode-container {
                        margin: 25px 0;
                        padding: 25px;
                        background: #f8f9fa;
                        border-radius: 15px;
                        min-height: 350px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        border: 3px dashed #dee2e6;
                    }
                    .info {
                        background: #e3f2fd;
                        padding: 25px;
                        border-radius: 15px;
                        margin-top: 25px;
                        text-align: left;
                    }
                    .features { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 20px; }
                    .feature { background: white; padding: 15px; border-radius: 10px; text-align: center; }
                    .feature-icon { font-size: 24px; margin-bottom: 10px; }
                    .stats { display: flex; justify-content: space-around; margin-top: 20px; font-size: 12px; color: #666; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🤖 WhatsApp Bot Pro</h1>
                    <div class="subtitle">Versión Mejorada - Auto-reconexión & Sesión Persistente</div>
                    
                    <div id="status" class="disconnected">Desconectado</div>
                    
                    <div class="qrcode-container">
                        <div id="qrcode">
                            <p style="color: #666; font-size: 16px;">⌛ Inicializando bot...</p>
                        </div>
                    </div>
                    
                    <div class="info">
                        <h3 style="margin-top: 0;">✨ Mejoras Implementadas:</h3>
                        <div class="features">
                            <div class="feature">
                                <div class="feature-icon">🔄</div>
                                <div><strong>Auto-reconexión</strong></div>
                                <div style="font-size: 12px;">Se reconecta automáticamente</div>
                            </div>
                            <div class="feature">
                                <div class="feature-icon">💾</div>
                                <div><strong>Sesión persistente</strong></div>
                                <div style="font-size: 12px;">No pierde sesión en Render</div>
                            </div>
                            <div class="feature">
                                <div class="feature-icon">👑</div>
                                <div><strong>Admins protegidos</strong></div>
                                <div style="font-size: 12px;">No elimina sus enlaces</div>
                            </div>
                            <div class="feature">
                                <div class="feature-icon">⏱️</div>
                                <div><strong>Keep-alive</strong></div>
                                <div style="font-size: 12px;">Mantiene activo en Render</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="stats">
                        <span id="connStatus">Estado: Desconectado</span>
                        <span id="sessionType">Sesión: Nueva</span>
                        <span id="reconnCount">Reconexiones: 0</span>
                    </div>
                </div>
                
                <script src="/socket.io/socket.io.js"></script>
                <script>
                    const socket = io();
                    const statusEl = document.getElementById('status');
                    const qrcodeEl = document.getElementById('qrcode');
                    const connStatusEl = document.getElementById('connStatus');
                    const sessionTypeEl = document.getElementById('sessionType');
                    const reconnCountEl = document.getElementById('reconnCount');
                    let reconnectCount = 0;
                    
                    socket.on('connect', () => {
                        console.log('Conectado al servidor');
                    });
                    
                    socket.on('qr', (qrData) => {
                        qrcodeEl.innerHTML = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + 
                                            encodeURIComponent(qrData) + '" style="max-width:100%; border-radius:10px;">';
                        statusEl.textContent = '📱 Escanea el QR';
                        statusEl.className = 'disconnected';
                        connStatusEl.textContent = 'Estado: Esperando QR';
                    });
                    
                    socket.on('connected', (connected) => {
                        if (connected) {
                            statusEl.textContent = '✅ Conectado a WhatsApp';
                            statusEl.className = 'connected';
                            qrcodeEl.innerHTML = '<div style="color:#4caf50;font-size:60px;margin:20px;">✓</div>' +
                                                '<p style="color:#388e3c;font-weight:bold;font-size:18px;">Bot activo y funcionando</p>' +
                                                '<p style="color:#666;margin-top:10px;">Manteniendo conexión automáticamente</p>';
                            connStatusEl.textContent = 'Estado: Conectado';
                        }
                    });
                    
                    socket.on('session', (type) => {
                        if (type === 'restored') {
                            statusEl.textContent = '🔄 Sesión restaurada';
                            statusEl.className = 'restored';
                            sessionTypeEl.textContent = 'Sesión: Restaurada';
                        } else {
                            sessionTypeEl.textContent = 'Sesión: Nueva';
                        }
                    });
                    
                    socket.on('status', (status) => {
                        statusEl.textContent = status;
                        if (status.includes('Reconectando')) {
                            reconnectCount++;
                            reconnCountEl.textContent = 'Reconexiones: ' + reconnectCount;
                        }
                    });
                    
                    socket.on('disconnect', () => {
                        statusEl.textContent = 'Desconectado del servidor';
                        statusEl.className = 'disconnected';
                        connStatusEl.textContent = 'Estado: Desconectado';
                    });
                </script>
            </body>
            </html>
            `);
        });
        
        // HEALTH CHECK MEJORADO PARA RENDER
        app.get('/health', (req, res) => {
            res.json({
                status: isConnected ? 'connected' : 'disconnected',
                session_restored: connectionManager.sessionRestored,
                reconnect_attempts: reconnectAttempts,
                uptime: process.uptime(),
                timestamp: new Date().toISOString(),
                render_compatible: true,
                keep_alive: true
            });
        });
        
        // WEBSOCKET MEJORADO
        io.on('connection', (socket) => {
            socket.emit('status', isConnected ? 'Conectado ✓' : 'Desconectado');
            if (currentQR) socket.emit('qr', currentQR);
            socket.emit('connected', isConnected);
            socket.emit('session', connectionManager.sessionRestored ? 'restored' : 'new');
            
            socket.on('get_status', () => {
                socket.emit('status', isConnected ? 'Conectado ✓' : 'Desconectado');
                socket.emit('connected', isConnected);
                socket.emit('session', connectionManager.sessionRestored ? 'restored' : 'new');
            });
        });
        
        // INICIAR SERVIDOR
        server.listen(CONFIG.PORT, () => {
            console.log(`🚀 Servidor mejorado: http://localhost:${CONFIG.PORT}`);
            console.log(`🔧 Health check: http://localhost:${CONFIG.PORT}/health`);
            console.log(`⚡ Características: Auto-reconexión, Sesión persistente, Keep-alive`);
        });
        
        return true;
    } catch (error) {
        console.error('❌ Error servidor web:', error);
        return false;
    }
}

// ================= INICIAR TODO =================
async function main() {
    console.log('🚀 INICIANDO BOT WHATSAPP MEJORADO...');
    console.log('======================================');
    
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
    
    // 3. Conectar a WhatsApp
    await connectToWhatsApp();
    
    // 4. Tarea adicional para Render
    cron.schedule('*/30 * * * *', () => {
        console.log('🔄 Verificación de estado Render');
        if (io) {
            io.emit('status', isConnected ? 'Conectado ✓' : 'Verificando...');
        }
    });
    
    // 5. Manejar cierre limpio
    process.on('SIGINT', async () => {
        console.log('\n🔻 Apagando limpiamente...');
        try {
            if (sock) {
                // Cerrar conexión correctamente
                await sock.end();
            }
        } catch (error) {
            console.log('Error en cierre:', error.message);
        }
        process.exit(0);
    });
    
    console.log('✅ Bot mejorado completamente inicializado');
    console.log('📌 Recordatorio:');
    console.log('   1. El bot mantendrá sesión automáticamente');
    console.log('   2. Se reconectará si hay desconexión');
    console.log('   3. NO eliminará enlaces de administradores');
    console.log('   4. Keep-alive activado para Render');
}

// EJECUTAR
main().catch(error => {
    console.error('❌ Error fatal:', error);
    process.exit(1);
});
