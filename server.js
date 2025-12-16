import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

// ================= CONFIGURACIÓN =================
const CONFIG = {
    // TU NÚMERO - FORMATO: 5215512345678@c.us
    ADMIN_NUMBERS: ['5351808981@c.us'],
    
    // ENLACES PERMITIDOS (NO se eliminarán)
    ALLOWED_LINKS: [
        'youtube.com',
        'youtu.be',
        'instagram.com',
        'facebook.com',
        'twitter.com',
        'x.com',
        'tiktok.com',
        'drive.google.com',
        'docs.google.com',
        'github.com',
        'wikipedia.org',
        'mercadolibre.com',
        'amazon.com',
        'paypal.com'
    ],
    
    // ENLACES BLOQUEADOS (SI se eliminarán)
    BLOCKED_DOMAINS: [
        'bit.ly',
        'short.url',
        'tinyurl.com',
        'ow.ly',
        'whatsapp.com',
        't.co',
        'goo.gl',
        'is.gd',
        'buff.ly',
        'adf.ly',
        'shorte.st',
        'bc.vc',
        'soo.gd',
        'ity.im',
        'v.gd',
        'tr.im',
        'qr.ae',
        'cur.lv',
        'u.to',
        'j.mp',
        'buzurl.com',
        'cutt.us',
        'u.bb',
        'x.co',
        'prettylinkpro.com',
        'vir.al',
        'scrnch.me',
        'filoops.info',
        'vurl.com',
        'vzturl.com',
        'link.zip'
    ],
    
    PORT: process.env.PORT || 3000,
    AUTH_DIR: './auth_data'
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
        console.log('📦 Cargando módulos...');
        
        // Cargar Baileys
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
        
        // Crear directorio de auth
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
        
        // ================= EVENTOS DE CONEXIÓN =================
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
                if (shouldReconnect) {
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
        
        // ================= MANEJAR MENSAJES =================
        sock.ev.on('messages.upsert', async (m) => {
            try {
                const message = m.messages[0];
                if (!message.message || message.key.fromMe) return;
                
                // Obtener texto del mensaje
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
                console.error('Error en messages.upsert:', error);
            }
        });
        
        // ================= BIENVENIDAS =================
        sock.ev.on('group-participants.update', async (update) => {
            try {
                const { id, participants, action } = update;
                
                if (action === 'add') {
                    console.log(`🎉 Nuevo miembro en ${id}`);
                    
                    for (const participant of participants) {
                        const userNumber = participant.split('@')[0];
                        
                        // Mensaje de bienvenida
                        const welcomeMsg = `🎊 *¡BIENVENIDO/A AL GRUPO!* 🎊

Hola @${userNumber} 👋

📜 *Reglas importantes:*
• Respetar a todos
• No spam ni enlaces sospechosos
• Los enlaces serán eliminados automáticamente
`;
                        
                        if (sock) {
                            await sock.sendMessage(id, { text: welcomeMsg });
                        }
                    }
                }
            } catch (error) {
                console.error('Error en bienvenida:', error);
            }
        });
        
        console.log('🤖 Bot listo para eliminar enlaces');
        
    } catch (error) {
        console.error('❌ Error conectando:', error);
        setTimeout(() => connectToWhatsApp(), 10000);
    }
}

// ================= DETECTAR ENLACES =================
function detectLinks(text) {
    if (!text) return { hasLinks: false, links: [] };
    
    // Expresión regular para encontrar URLs
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
    
    // 1. Verificar si está en la lista PERMITIDA
    for (const allowed of CONFIG.ALLOWED_LINKS) {
        if (lowerUrl.includes(allowed)) {
            return true; // ESTÁ PERMITIDO
        }
    }
    
    // 2. Verificar si está en la lista BLOQUEADA
    for (const blocked of CONFIG.BLOCKED_DOMAINS) {
        if (lowerUrl.includes(blocked)) {
            return false; // ESTÁ BLOQUEADO
        }
    }
    
    // 3. Por defecto: NO permitido (se eliminará)
    return false;
}

// ================= ELIMINAR MENSAJE =================
async function deleteMessage(groupId, message) {
    try {
        console.log('🔄 Intentando eliminar mensaje...');
        
        // Método 1: Eliminación directa (si el bot es admin)
        await sock.sendMessage(groupId, {
            delete: message.key
        });
        
        console.log('✅ Mensaje eliminado (método directo)');
        return { success: true, method: 'direct' };
        
    } catch (error) {
        console.log('⚠️ Método directo falló:', error.message);
        
        try {
            // Método 2: Enviar comando de eliminación
            await sock.sendMessage(groupId, {
                text: `/delete ${message.key.id}`,
                quoted: message
            });
            
            console.log('✅ Comando de eliminación enviado');
            return { success: true, method: 'command' };
            
        } catch (error2) {
            console.log('⚠️ Comando también falló:', error2.message);
            
            // Método 3: Sobreescribir con mensaje vacío
            await sock.sendMessage(groupId, {
                text: '🚫 [Mensaje eliminado por contener enlace no permitido]',
                quoted: message
            });
            
            console.log('✅ Mensaje sobreescrito');
            return { success: true, method: 'overwrite' };
        }
    }
}

// ================= PROCESAR MENSAJES EN GRUPO =================
async function processGroupMessage(groupId, text, originalMessage) {
    try {
        const sender = originalMessage.key.participant || originalMessage.key.remoteJid;
        const userNumber = sender.split('@')[0];
        const isAdmin = CONFIG.ADMIN_NUMBERS.includes(sender);
        
        // COMANDOS ESPECIALES
        if (text.startsWith('!')) {
            const command = text.toLowerCase().trim();
            
            if (command === '!bot') {
                await sock.sendMessage(groupId, {
                    text: '🤖 *BOT ACTIVO*\n\n' +
                          'Funciones:\n' +
                          '• Elimina enlaces automáticamente\n' +
                          '• Bienvenidas automáticas\n'
                });
                return;
            }
            
            if (command === '!admin') {
                const response = isAdmin ? 
                    '👑 Eres administrador' : 
                    '❌ No eres administrador';
                
                await sock.sendMessage(groupId, { text: response });
                return;
            }
            
            if (command === '!links') {
                await sock.sendMessage(groupId, {
                    text: '✅ *Enlaces permitidos:*\n' +
                          CONFIG.ALLOWED_LINKS.slice(0, 10).map(l => `• ${l}`).join('\n') +
                          '\n\n❌ *Enlaces bloqueados:*\n' +
                          CONFIG.BLOCKED_DOMAINS.slice(0, 10).map(l => `• ${l}`).join('\n')
                });
                return;
            }
            
            if (command === '!test') {
                await sock.sendMessage(groupId, {
                    text: '✅ Bot funcionando correctamente\n' +
                          'ID: ' + groupId
                });
                return;
            }
        }
        
        // DETECTAR ENLACES EN EL MENSAJE
        const { hasLinks, links } = detectLinks(text);
        
        if (hasLinks && !isAdmin) {
            console.log(`🔍 Enlaces detectados: ${links.length}`);
            
            let allLinksAllowed = true;
            const blockedLinks = [];
            
            // Verificar cada enlace
            for (const link of links) {
                if (!isLinkAllowed(link)) {
                    allLinksAllowed = false;
                    blockedLinks.push(link);
                }
            }
            
            // SI HAY ENLACES NO PERMITIDOS → ELIMINAR
            if (!allLinksAllowed && blockedLinks.length > 0) {
                console.log(`🚫 Enlaces bloqueados: ${blockedLinks.join(', ')}`);
                
                // 1. Intentar eliminar el mensaje
                const deleteResult = await deleteMessage(groupId, originalMessage);
                
                // 2. Notificar al usuario
                const warningMsg = `@${userNumber} 🚫 *ENLACE ELIMINADO*\n\n` +
                                  `Has compartido ${blockedLinks.length} enlace(s) no permitido(s).\n\n`;
                
                await sock.sendMessage(groupId, { text: warningMsg });
                
                // 3. Notificar a los admins
                for (const admin of CONFIG.ADMIN_NUMBERS) {
                    try {
                        await sock.sendMessage(admin, {
                            text: `🚨 *ENLACE ELIMINADO*\n\n` +
                                  `Usuario: @${userNumber}\n` +
                                  `Grupo: ${groupId}\n` +
                                  `Método: ${deleteResult.method}`
                        });
                    } catch (error) {
                        console.log('No se pudo notificar al admin:', admin);
                    }
                }
                
                console.log(`✅ Acción completada para ${userNumber}`);
            }
        }
        
    } catch (error) {
        console.error('❌ Error procesando mensaje:', error);
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
                <title>🤖 WhatsApp Bot - Elimina Enlaces</title>
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
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🤖 WhatsApp Bot Pro</h1>
                    <div><strong>ELIMINADOR DE ENLACES</strong></div>
                    
                    <div id="status" class="disconnected">Desconectado</div>
                    
                    <div class="qrcode-container">
                        <div id="qrcode">
                            <p style="color: #666;">⌛ Cargando QR...</p>
                        </div>
                    </div>
                    
                    <div class="info">
                        <h3>🚫 Enlaces que ELIMINA automáticamente:</h3>
                        <ul>
                            <li>Acortadores (bit.ly, tinyurl.com, etc.)</li>
                            <li>Sitios sospechosos o desconocidos</li>
                            <li>Cualquier enlace no autorizado</li>
                        </ul>
                        
                        <h3>✅ Enlaces PERMITIDOS:</h3>
                        <ul>
                            <li>YouTube, Instagram, Facebook</li>
                            <li>Google Drive, WhatsApp Web</li>
                            <li>Sitios conocidos y seguros</li>
                        </ul>
                        
                        <p><strong>⚠️ IMPORTANTE:</strong> El bot debe ser ADMIN del grupo para eliminar mensajes.</p>
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
                            statusEl.textContent = '✅ Conectado a WhatsApp';
                            statusEl.className = 'connected';
                            qrcodeEl.innerHTML = '<div style="color:#4caf50;font-size:50px;">✓</div>' +
                                                '<p style="color:#388e3c;font-weight:bold;">Bot activo</p>' +
                                                '<p>Eliminando enlaces automáticamente</p>';
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
        });
        
        return true;
    } catch (error) {
        console.error('❌ Error servidor web:', error);
        return false;
    }
}

// ================= INICIAR TODO =================
async function main() {
    console.log('🚀 INICIANDO BOT WHATSAPP...');
    console.log('================================');
    
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
    
    // 4. Manejar cierre
    process.on('SIGINT', () => {
        console.log('\n🔻 Apagando...');
        process.exit(0);
    });
    
    console.log('✅ Bot completamente inicializado');
}

// EJECUTAR
main().catch(error => {
    console.error('❌ Error fatal:', error);
    process.exit(1);
});
