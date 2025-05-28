const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

// Configuración para Render
const PORT = process.env.PORT || 3000;
const SESSION_FILE_PATH = path.join(__dirname, '.wwebjs_auth', 'session.json');

// Verificar/Crear directorio de sesión
if (!fs.existsSync(path.dirname(SESSION_FILE_PATH))) {
  fs.mkdirSync(path.dirname(SESSION_FILE_PATH), { recursive: true };
}

// Variables de estado
let authCode = null;
let clientReady = false;
let lastGeneratedCodeTime = null;
const CODE_EXPIRATION_MINUTES = 5;
let qrCodeBackup = null;

// Configuración del cliente WhatsApp
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: path.dirname(SESSION_FILE_PATH)
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
  },
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
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
  qrCodeBackup = qr;
  console.log('Código QR generado (respaldo):', qr);
});

client.on('authenticated', () => {
  console.log('Autenticación exitosa!');
  qrCodeBackup = null;
});

client.on('ready', () => {
  console.log('Cliente de WhatsApp listo!');
  clientReady = true;
});

client.on('disconnected', (reason) => {
  console.log('Cliente desconectado:', reason);
  clientReady = false;
  // Reiniciar el cliente después de 5 segundos
  setTimeout(() => {
    console.log('Reiniciando cliente...');
    client.initialize();
  }, 5000);
});

client.on('auth_failure', msg => {
  console.error('Autenticación fallida:', msg);
});

client.initialize().catch(err => {
  console.error('Error al inicializar el cliente:', err);
});

// Configuración de Express
const app = express();
app.use(bodyParser.json());
app.use(express.static('public')); // Para servir archivos estáticos

// Endpoints de la API
app.get('/get-code', (req, res) => {
  const code = generateAuthCode();
  res.json({ 
    code,
    expires_in: `${CODE_EXPIRATION_MINUTES} minutos`,
    server_time: new Date().toISOString(),
    qr_code: qrCodeBackup // Opcional: enviar QR como respaldo
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
      lastMessage: chat.lastMessage?.body || 'Sin mensajes',
      timestamp: chat.lastMessage?.timestamp || 0,
      isGroup: chat.isGroup
    }));
    
    res.json({ chats: simplifiedChats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/qr-backup', (req, res) => {
  if (!qrCodeBackup) {
    return res.status(404).json({ error: 'No hay código QR disponible' });
  }
  res.json({ qr_code: qrCodeBackup });
});

app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    whatsapp_status: clientReady ? 'ready' : 'initializing',
    server_time: new Date().toISOString(),
    code_active: !isCodeExpired(),
    session_exists: fs.existsSync(SESSION_FILE_PATH)
  });
});

// Endpoint para enviar mensajes
app.post('/send-message', async (req, res) => {
  if (!clientReady) {
    return res.status(503).json({ error: 'Cliente no listo' });
  }

  const { number, message } = req.body;
  if (!number || !message) {
    return res.status(400).json({ error: 'Número y mensaje son requeridos' });
  }

  try {
    const chatId = number.includes('@') ? number : `${number}@c.us`;
    await client.sendMessage(chatId, message);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
  console.log(`Para vincular tu dispositivo:`);
  console.log(`1. Visita /get-code para obtener el código`);
  console.log(`2. O usa /qr-backup como alternativa`);
});
