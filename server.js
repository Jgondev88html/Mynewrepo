const express = require('express');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const path = require('path');

// Configura el servidor web
const app = express();
const port = process.env.PORT || 3000;

// Middleware para servir archivos estáticos
app.use(express.static('public'));

// Ruta para mostrar el código QR
app.get('/qr', (req, res) => {
    res.sendFile(path.join(__dirname, 'qr.html'));
});

// Inicia el servidor
app.listen(port, () => {
    console.log(`Servidor web corriendo en http://localhost:${port}/qr`);
});

// Configura el cliente de WhatsApp
const client = new Client({
    authStrategy: new LocalAuth()
});

// Variable para almacenar el código QR
let qrCodeData = null;

// Genera el código QR
client.on('qr', (qr) => {
    qrcode.toDataURL(qr, (err, url) => {
        if (err) {
            console.error('Error al generar el código QR:', err);
            return;
        }
        qrCodeData = url; // Almacena el código QR como una URL de datos
        console.log('Código QR generado. Escanea desde la página web.');
    });
});

// Cuando el cliente esté listo
client.on('ready', () => {
    console.log('Client is ready!');
});

// Escucha los mensajes
client.on('message', async (message) => {
    const chat = await message.getChat();
    const contact = await message.getContact();

    // Comandos desde el número del dueño
    if (contact.number === 'TU_NUMERO_AQUI') {
        // Apagar el bot
        if (message.body === '!apagar') {
            client.destroy();
            console.log('Bot apagado por el dueño.');
        }
    }

    // Bienvenida automática en grupos
    if (chat.isGroup) {
        const admins = await chat.getParticipants().filter(participant => participant.isAdmin);
        const isAdmin = admins.some(admin => admin.id._serialized === contact.id._serialized);

        // Expulsar si se envía un link y no es admin
        if (message.body.includes('http') && !isAdmin) {
            chat.sendMessage(`@${contact.number} ha sido expulsado por enviar un link.`);
            chat.removeParticipants([contact.id._serialized]);
        }

        // Asignar admin
        if (message.body === '!admin' && chat.isGroup) {
            chat.promoteParticipants([contact.id._serialized]);
            chat.sendMessage(`@${contact.number} ahora es admin.`);
        }
    }

    // Bienvenida automática en privados
    if (!chat.isGroup && !message.fromMe) {
        const userName = contact.pushname || contact.number;
        message.reply(`¡Hola, ${userName}! 👋\n\nGracias por contactarme. ¿En qué puedo ayudarte hoy?`);
    }
});

// Inicia el cliente
client.initialize();

// Ruta para obtener el código QR
app.get('/qrcode', (req, res) => {
    if (qrCodeData) {
        res.send({ qr: qrCodeData });
    } else {
        res.status(404).send('Código QR no disponible.');
    }
});
