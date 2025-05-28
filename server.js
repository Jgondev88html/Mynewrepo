const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

// Configuración para Render
const PORT = process.env.PORT || 3000;

// Variables de estado
let authCode = null;
let clientReady = false;
let lastGeneratedCodeTime = null;
const CODE_EXPIRATION_MINUTES = 5;

// Configuración del cliente WhatsApp
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './.wwebjs_auth' // Ruta para guardar la sesión
    }),
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

// Generar código con expiración
function generateAuthCode() {
    authCode = Math.floor(100000 + Math.random() * 900000).toString();
    lastGeneratedCodeTime = new Date();
    console.log(`[${new Date().toISOString()}] Código generado: ${authCode}`);
    return authCode;
}

// Verificar si el código ha expirado
function isCodeExpired() {
    if (!lastGeneratedCodeTime) return true;
    const expirationTime = new Date(lastGeneratedCodeTime.getTime() + CODE_EXPIRATION_MINUTES * 60000);
    return new Date() > expirationTime;
}

// Eventos del cliente WhatsApp
client.on('qr', qr => {
    console.log('Se generó un código QR (como respaldo):', qr);
});

client.on('authenticated', () => {
    console.log('Autenticación exitosa!');
});

client.on('ready', () => {
    console.log('Cliente de WhatsApp listo!');
    clientReady = true;
});

client.on('disconnected', (reason) => {
    console.log('Cliente desconectado:', reason);
    clientReady = false;
});

client.initialize();

// Endpoints de la API
app.get('/get-code', (req, res) => {
    const code = generateAuthCode();
    res.json({ 
        code,
        expires_in: `${CODE_EXPIRATION_MINUTES} minutos`,
        server_time: new Date().toISOString()
    });
});

app.post('/verify-code', (req, res) => {
    const { code } = req.body;
    
    if (!code) {
        return res.status(400).json({ error: 'Código requerido' });
    }
    
    if (isCodeExpired()) {
        return res.status(403).json({ error: 'El código ha expirado' });
    }
    
    if (code !== authCode) {
        return res.status(403).json({ error: 'Código inválido' });
    }
    
    res.json({ 
        success: true,
        status: clientReady ? 'ready' : 'initializing',
        message: clientReady ? 
            'Dispositivo vinculado y cliente listo' : 
            'Dispositivo vinculado, esperando inicialización del cliente'
    });
});

app.get('/chat-list', async (req, res) => {
    if (!clientReady) {
        return res.status(503).json({ error: 'Cliente de WhatsApp no listo' });
    }
    
    try {
        const chats = await client.getChats();
        const simplifiedChats = chats.map(chat => ({
            id: chat.id._serialized,
            name: chat.name,
            lastMessage: chat.lastMessage?.body || 'No messages',
            timestamp: chat.lastMessage?.timestamp || 0,
            isGroup: chat.isGroup
        }));
        
        res.json({ chats: simplifiedChats });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint de estado del servidor
app.get('/status', (req, res) => {
    res.json({
        status: 'running',
        whatsapp_status: clientReady ? 'ready' : 'initializing',
        server_time: new Date().toISOString(),
        code_active: !isCodeExpired()
    });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
    console.log(`Para vincular tu dispositivo, visita: https://mynewrepo-udix.onrender.com/get-code`);
});
