const express = require('express');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const path = require('path');

// Configura el servidor web
const app = express();
const port = process.env.PORT || 3000;

// Número del dueño (reemplaza con tu número en formato internacional)
let OWNER_NUMBER = '+5351755096'; // Ejemplo: '+521234567890'

// Configura el cliente de WhatsApp
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: path.join(__dirname, 'wwebjs_auth')
    })
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

    // Verifica si el mensaje proviene del dueño
    const isOwner = contact.number === OWNER_NUMBER.replace('', ''); // Elimina el '+' para comparar

    // Comandos exclusivos para el dueño
    if (isOwner) {
        // Apagar el bot
        if (message.body === '!apagar') {
            client.destroy();
            console.log('Bot apagado por el dueño.');
        }

        // Agregar un nuevo dueño (opcional)
        if (message.body.startsWith('!nuevodueño ')) {
            const newOwner = message.body.replace('!nuevodueño ', '');
            OWNER_NUMBER = newOwner; // Cambia el número del dueño
            message.reply(`Nuevo dueño asignado: ${newOwner}`);
        }

        // Reiniciar el bot
        if (message.body === '!reiniciar') {
            client.destroy();
            client.initialize();
            message.reply('Bot reiniciado.');
        }
    }

    // Comando !menu
    if (message.body === '!menu') {
        const menu = `
        *Comandos disponibles:*
        - !menu: Muestra este menú de comandos.
        - !apagar: Apaga el bot (solo dueño).
        - !nuevodueño [número]: Cambia el número del dueño (solo dueño).
        - !admin: Te asigna como admin en un grupo (solo en grupos).
        - !reiniciar: Reinicia el bot (solo dueño).
        `;
        message.reply(menu);
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

// Manejo de errores
client.on('auth_failure', (msg) => {
    console.error('Error de autenticación:', msg);
});

client.on('disconnected', (reason) => {
    console.error('Cliente desconectado:', reason);
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

// Ruta para mostrar la página web con el código QR
app.get('/qr', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Escanear Código QR</title>
        <style>
            body {
                font-family: Arial, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background-color: #f0f0f0;
            }
            #qr-container {
                text-align: center;
            }
            #qr-image {
                max-width: 100%;
                height: auto;
            }
        </style>
    </head>
    <body>
        <div id="qr-container">
            <h1>Escanee el Código QR</h1>
            <img id="qr-image" src="" alt="Código QR">
            <p>Use WhatsApp en su teléfono para escanear este código.</p>
        </div>

        <script>
            // Obtener el código QR del servidor
            async function fetchQRCode() {
                const response = await fetch('/qrcode');
                const data = await response.json();
                if (data.qr) {
                    document.getElementById('qr-image').src = data.qr;
                } else {
                    alert('Código QR no disponible. Intente nuevamente.');
                }
            }

            // Actualizar el código QR cada 5 segundos
            setInterval(fetchQRCode, 5000);
            fetchQRCode(); // Cargar el código QR al abrir la página
        </script>
    </body>
    </html>
    `;

    res.send(html);
});

// Inicia el servidor
app.listen(port, () => {
    console.log(`Servidor web corriendo en http://localhost:${port}/qr`);
});
