const express = require('express');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');

// Configura Express
const app = express();
const port = process.env.PORT || 3000;

// Configura el cliente de WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(), // Almacena la autenticación localmente
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'], // Necesario para Render
    },
});

let qrCodeUrl = ''; // Almacena la URL del código QR
const welcomeMessages = {}; // Almacena los mensajes de bienvenida por grupo

// Cargar mensajes de bienvenida desde un archivo (si existe)
if (fs.existsSync('welcomeMessages.json')) {
    const data = fs.readFileSync('welcomeMessages.json');
    Object.assign(welcomeMessages, JSON.parse(data));
}

// Escanea el código QR
client.on('qr', (qr) => {
    console.log('Generando código QR...');
    qrcode.toDataURL(qr, (err, url) => {
        if (err) {
            console.error('Error al generar el código QR:', err);
            return;
        }
        qrCodeUrl = url; // Guarda la URL del código QR
        console.log('Código QR generado. Abre http://localhost:3000/qr en tu navegador.');
    });
});

// Cuando el cliente esté listo
client.on('ready', () => {
    console.log('Cliente de WhatsApp listo!');
});

// Escucha mensajes entrantes
client.on('message', async (message) => {
    console.log(`Mensaje recibido de ${message.from}: ${message.body}`);

    const command = message.body.toLowerCase();

    // Comandos para administradores
    if (command.startsWith('/bienvenida ')) {
        const [_, groupId, ...welcomeText] = command.split(' ');
        const welcomeMessage = welcomeText.join(' ');

        if (groupId && welcomeMessage) {
            welcomeMessages[groupId] = welcomeMessage; // Guarda el mensaje de bienvenida
            fs.writeFileSync('welcomeMessages.json', JSON.stringify(welcomeMessages)); // Guarda en un archivo
            message.reply(`Mensaje de bienvenida configurado para el grupo: ${welcomeMessage}`);
        } else {
            message.reply('Formato incorrecto. Usa: /bienvenida [ID del grupo] [mensaje]');
        }
    }
});

// Escucha cuando alguien se une al grupo
client.on('group_join', (notification) => {
    const groupId = notification.chatId; // ID del grupo
    const newMember = notification.recipientIds[0]; // ID del nuevo miembro

    // Obtén el mensaje de bienvenida para el grupo
    const welcomeMessage = welcomeMessages[groupId];

    if (welcomeMessage) {
        // Envía el mensaje de bienvenida
        client.sendMessage(groupId, `@${newMember.split('@')[0]} ${welcomeMessage}`);
    } else {
        // Mensaje de bienvenida por defecto
        client.sendMessage(groupId, `¡Bienvenido al grupo, @${newMember.split('@')[0]}! 🎉`);
    }
});

// Inicia el cliente de WhatsApp
client.initialize();

// Sirve la página web para escanear el código QR
app.get('/qr', (req, res) => {
    if (qrCodeUrl) {
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Escanear Código QR</title>
                <style>
                    body {
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                        background-color: #f0f0f0;
                    }
                    img {
                        max-width: 100%;
                        height: auto;
                    }
                </style>
            </head>
            <body>
                <img src="${qrCodeUrl}" alt="QR Code"/>
            </body>
            </html>
        `);
    } else {
        res.send('Esperando a que se genere el código QR...');
    }
});

// Ruta principal
app.get('/', (req, res) => {
    res.send('Bot de WhatsApp está en línea. Visita /qr para escanear el código QR.');
});

// Inicia el servidor
app.listen(port, () => {
    console.log(`Servidor escuchando en http://localhost:${port}`);
});
