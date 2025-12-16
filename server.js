const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');

const app = express();
const PORT = 3000;

// Configuración
const ADMIN_NUMBERS = ['5351808981@c.us']; // Cambia esto
const ALLOWED_LINKS = ['youtube.com', 'instagram.com', 'facebook.com', 'drive.google.com'];

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// QR Code
client.on('qr', (qr) => {
    console.log('📱 ESCANEA ESTE CÓDIGO QR CON WHATSAPP:');
    qrcode.generate(qr, { small: true });
});

// Bot listo
client.on('ready', () => {
    console.log('✅ BOT LISTO PARA USARSE');
});

// Procesar mensajes
client.on('message', async (message) => {
    if (message.fromMe) return;
    
    const chat = await message.getChat();
    const isGroup = chat.isGroup;
    const sender = message.author || message.from;
    const isAdmin = ADMIN_NUMBERS.includes(sender);
    const text = message.body || '';
    
    // Solo actuar en grupos
    if (isGroup) {
        // BIENVENIDA automática
        if (text.toLowerCase().includes('hola')) {
            await message.reply('👋 ¡Bienvenido al grupo!');
        }
        
        // DETECTAR Y ELIMINAR ENLACES (excepto admin)
        if (!isAdmin && (text.includes('http') || text.includes('www.') || text.includes('.com'))) {
            // Verificar si es enlace permitido
            let isAllowed = false;
            for (const allowed of ALLOWED_LINKS) {
                if (text.includes(allowed)) {
                    isAllowed = true;
                    break;
                }
            }
            
            // Si no está permitido, eliminar
            if (!isAllowed) {
                try {
                    await message.delete(true);
                    console.log(`🗑️ Enlace eliminado de: ${sender}`);
                    
                    // Notificar al usuario
                    await message.reply('🚫 Enlace eliminado. Solo admins pueden enviar links.');
                } catch (error) {
                    console.log('Error eliminando mensaje');
                }
            }
        }
    }
});

// Manejo de errores
client.on('auth_failure', (msg) => {
    console.error('❌ Error de autenticación:', msg);
});

client.on('disconnected', (reason) => {
    console.log('🔌 Bot desconectado:', reason);
    console.log('🔄 Reiniciando en 10 segundos...');
    setTimeout(() => {
        client.initialize();
    }, 10000);
});

// Iniciar bot
client.initialize();

// Servidor web simple
app.get('/', (req, res) => {
    res.send('Bot WhatsApp activo');
});

app.listen(PORT, () => {
    console.log(`🌐 Servidor web en puerto ${PORT}`);
});
