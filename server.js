const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

// Configuración del cliente WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

let authCode = null;
let clientReady = false;

// Generar un código de autenticación aleatorio
function generateAuthCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Evento cuando se genera el QR (por si acaso)
client.on('qr', qr => {
    qrcode.generate(qr, {small: true});
});

// Evento cuando el cliente está listo
client.on('ready', () => {
    console.log('Client is ready!');
    clientReady = true;
});

// Inicializar el cliente
client.initialize();

// API para obtener el código de autenticación
app.get('/get-code', (req, res) => {
    authCode = generateAuthCode();
    console.log(`Código de autenticación generado: ${authCode}`);
    res.json({ code: authCode });
});

// API para vincular el dispositivo
app.post('/link-device', (req, res) => {
    const { code } = req.body;
    
    if (!code) {
        return res.status(400).json({ error: 'Código requerido' });
    }
    
    if (code !== authCode) {
        return res.status(403).json({ error: 'Código inválido' });
    }
    
    if (!clientReady) {
        return res.status(503).json({ error: 'Cliente de WhatsApp no listo' });
    }
    
    // Aquí podrías implementar lógica adicional para confirmar la vinculación
    res.json({ success: true, message: 'Dispositivo vinculado correctamente' });
});

// API para leer mensajes
app.get('/messages', async (req, res) => {
    if (!clientReady) {
        return res.status(503).json({ error: 'Cliente de WhatsApp no listo' });
    }
    
    try {
        const chats = await client.getChats();
        res.json({ chats });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Iniciar el servidor
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
