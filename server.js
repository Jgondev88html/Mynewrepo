const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode-terminal');

// Configuración
const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_DIR = path.join(__dirname, '.wwebjs_auth');

// Crear directorio de sesión
if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

// Estado del servidor
let authCode = null;
let clientReady = false;
let lastGeneratedCodeTime = null;
const CODE_EXPIRATION_MINUTES = 5;
let qrCodeBackup = null;

// Configuración de WhatsApp
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  }
});

// Generar código de autenticación
function generateAuthCode() {
  authCode = Math.floor(100000 + Math.random() * 900000).toString();
  lastGeneratedCodeTime = new Date();
  return authCode;
}

function isCodeExpired() {
  if (!lastGeneratedCodeTime) return true;
  const expirationTime = new Date(lastGeneratedCodeTime.getTime() + CODE_EXPIRATION_MINUTES * 60000);
  return new Date() > expirationTime;
}

// Eventos de WhatsApp
client.on('qr', qr => {
  qrCodeBackup = qr;
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ Cliente de WhatsApp listo');
  clientReady = true;
});

client.on('disconnected', () => {
  clientReady = false;
  setTimeout(() => client.initialize(), 5000);
});

client.initialize();

// Middlewares
app.use(express.json());
app.use(express.static('public'));

// Endpoints
app.get('/api/get-code', (req, res) => {
  const code = generateAuthCode();
  res.json({
    code,
    qr_code: qrCodeBackup,
    expires_in: CODE_EXPIRATION_MINUTES
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    status: clientReady ? 'ready' : 'initializing',
    session_exists: fs.existsSync(path.join(SESSION_DIR, 'session.json'))
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor en http://localhost:${PORT}`);
});
