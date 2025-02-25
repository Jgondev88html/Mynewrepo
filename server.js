const express = require('express');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
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
client.on('message', (message) => {
    console.log(`Mensaje recibido de ${message.from}: ${message.body}`);

    // Respuesta automática
    if (message.body.toLowerCase() === 'hola') {
        message.reply('Hola, soy un bot de WhatsApp. ¿En qué puedo ayudarte?');
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
