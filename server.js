const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode-terminal');

// Configuración
const PORT = process.env.PORT || 3000;
const SESSION_DIR = path.join(__dirname, '.wwebjs_auth');
const SESSION_FILE_PATH = path.join(SESSION_DIR, 'session.json');

// Crear directorio de sesión si no existe
if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

// Estado del servidor
let authCode = null;
let clientReady = false;
let lastGeneratedCodeTime = null;
const CODE_EXPIRATION_MINUTES = 5;
let qrCodeBackup = null;

// Cliente WhatsApp
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
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

// Generar código de autenticación
function generateAuthCode() {
  authCode = Math.floor(100000 + Math.random() * 900000).toString();
  lastGeneratedCodeTime = new Date();
  console.log(`[${new Date().toISOString()}] Código generado: ${authCode}`);
  return authCode;
}

// Verificar expiración del código
function isCodeExpired() {
  if (!lastGeneratedCodeTime) return true;
  const expirationTime = new Date(lastGeneratedCodeTime.getTime() + CODE_EXPIRATION_MINUTES * 60000);
  return new Date() > expirationTime;
}

// Eventos del cliente
client.on('qr', qr => {
  qrCodeBackup = qr;
  qrcode.generate(qr, { small: true });
  console.log('Escanea este QR en WhatsApp:');
});

client.on('authenticated', () => {
  console.log('Autenticación exitosa!');
  qrCodeBackup = null;
});

client.on('ready', () => {
  console.log('Cliente listo!');
  clientReady = true;
});

client.on('disconnected', (reason) => {
  console.log('Cliente desconectado:', reason);
  clientReady = false;
  setTimeout(() => client.initialize(), 5000);
});

client.initialize().catch(err => console.error('Error al iniciar:', err));

// Configuración de Express
const app = express();
app.use(bodyParser.json());

// Endpoints
app.get('/get-code', (req, res) => {
  res.json({
    code: generateAuthCode(),
    qr_code: qrCodeBackup,
    expires_in: `${CODE_EXPIRATION_MINUTES} minutos`,
    server_time: new Date().toISOString()
  });
});

app.post('/verify-code', (req, res) => {
  const { code } = req.body;
  
  if (!code) return res.status(400).json({ error: 'Código requerido' });
  if (isCodeExpired()) return res.status(403).json({ error: 'Código expirado' });
  if (code !== authCode) return res.status(403).json({ error: 'Código inválido' });

  res.json({
    success: true,
    status: clientReady ? 'ready' : 'initializing',
    session_exists: fs.existsSync(SESSION_FILE_PATH)
  });
});

app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    whatsapp_status: clientReady ? 'ready' : 'initializing',
    code_active: !isCodeExpired()
  });
});

app.post('/send-message', async (req, res) => {
  if (!clientReady) return res.status(503).json({ error: 'Cliente no listo' });

  try {
    const { number, message } = req.body;
    const chatId = number.includes('@') ? number : `${number}@c.us`;
    await client.sendMessage(chatId, message);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor en http://localhost:${PORT}`);
  console.log(`• Use /get-code para obtener código de vinculación`);
  console.log(`• Estado actual: ${clientReady ? 'READY' : 'INITIALIZING'}`);
});
