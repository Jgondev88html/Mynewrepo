const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;

// Configura el cliente de WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(), // Almacena la autenticación localmente
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'], // Necesario para Render
    },
});

// Escanea el código QR
client.on('qr', (qr) => {
    console.log('Escanea el código QR con tu teléfono:');
    qrcode.generate(qr, { small: true });
});

// Cuando esté listo
client.on('ready', () => {
    console.log('Cliente de WhatsApp listo!');
});

// Escucha mensajes entrantes
client.on('message', (message) => {
    console.log(`Mensaje recibido de ${message.from}: ${message.body}`);

    // Respuesta automática
    if (message.body.toLowerCase() === 'hola') {
        message.reply('Hola, soy un bot de WhatsApp. ¿En qué puedo ayudarte?');
    }
});

// Inicia el cliente de WhatsApp
client.initialize();

// Inicia el servidor Express
app.get('/', (req, res) => {
    res.send('Bot de WhatsApp está en línea!');
});

app.listen(port, () => {
    console.log(`Servidor escuchando en http://localhost:${port}`);
});
