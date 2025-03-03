const express = require('express');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const ytdl = require('ytdl-core');
const { useMultiFileAuthState, makeWASocket, DisconnectReason } = require('@whiskeysockets/baileys');
const { Sticker, createSticker, StickerTypes } = require('wa-sticker-formatter');

const app = express();
const port = process.env.PORT || 3000;

// Configuración
const OWNER_NUMBER = '5351808981'; // Reemplázalo con tu número
const BOT_NAME = 'CodeBot';
const BOT_IMAGE = './codebot.jpg'; // Asegúrate de tener una imagen en esta ruta
let qrCodeData = null;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'baileys_auth'));
    const socket = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: console,
        browser: ['CodeBot', 'Chrome', '1.0.0']
    });

    socket.ev.on('connection.update', ({ qr }) => {
        if (qr) {
            qrcode.toDataURL(qr, (err, url) => {
                if (!err) qrCodeData = url;
            });
        }
    });

    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const jid = msg.key.remoteJid;
        const user = msg.pushName || 'Usuario';
        const isGroup = jid.endsWith('@g.us');
        const metadata = isGroup ? await socket.groupMetadata(jid) : null;
        const admins = isGroup ? metadata.participants.filter(p => p.admin).map(p => p.id) : [];
        const isAdmin = isGroup && admins.includes(msg.key.participant);

        // Comando !menu con imagen del bot
        if (msg.message.conversation?.toLowerCase() === '!menu') {
            const menuText = `
🌟 *${BOT_NAME} - Menú de Comandos* 🌟

🔹 *Generales:*
  - !menu → Ver este menú
  - !sticker → Crear sticker desde imagen
  - !vidsticker → Crear sticker desde video
  - !play [nombre] → Descargar música de YouTube
  - !yt [url] → Descargar video de YouTube
  - !insta [url] → Descargar video de Instagram

🔹 *Comandos de grupo:* (solo admins)
  - !tagall → Mencionar a todos
  - !promote @user → Hacer admin
  - !demote @user → Quitar admin
  - !kick @user → Expulsar usuario
  - !groupinfo → Info del grupo
`;
            
            const imageBuffer = fs.existsSync(BOT_IMAGE) ? fs.readFileSync(BOT_IMAGE) : null;
            if (imageBuffer) {
                await socket.sendMessage(jid, { image: imageBuffer, caption: menuText });
            } else {
                await socket.sendMessage(jid, { text: menuText });
            }
        }

        // Descargar videos de YouTube
        if (msg.message.conversation?.startsWith('!yt ')) {
            const url = msg.message.conversation.split(' ')[1];
            if (ytdl.validateURL(url)) {
                const videoStream = ytdl(url, { filter: 'audioandvideo', quality: 'highest' });
                const filePath = path.join(__dirname, 'video.mp4');
                
                videoStream.pipe(fs.createWriteStream(filePath)).on('finish', async () => {
                    await socket.sendMessage(jid, { video: fs.readFileSync(filePath) });
                    fs.unlinkSync(filePath);
                });
            } else {
                await socket.sendMessage(jid, { text: '❌ URL de YouTube no válida.' });
            }
        }

        // Mencionar a todos (solo admins)
        if (msg.message.conversation?.toLowerCase() === '!tagall' && isAdmin) {
            const mentions = metadata.participants.map(p => p.id);
            await socket.sendMessage(jid, { text: '📢 Mención a todos:', mentions });
        }
    });

    // Bienvenida con descripción del grupo
    socket.ev.on('group-participants.update', async ({ id, participants, action }) => {
        if (action === 'add') {
            const metadata = await socket.groupMetadata(id);
            const description = metadata.desc || 'Sin descripción';
            const userJid = participants[0];
            const userProfilePicture = await socket.profilePictureUrl(userJid, 'image').catch(() => null);
            const welcomeMessage = `🎉 ¡Bienvenido @${userJid.split('@')[0]}! 🎉\n📌 *Descripción del grupo:*\n${description}`;

            if (userProfilePicture) {
                const imageBuffer = await axios.get(userProfilePicture, { responseType: 'arraybuffer' }).then(res => res.data);
                await socket.sendMessage(id, { image: imageBuffer, caption: welcomeMessage, mentions: [userJid] });
            } else {
                await socket.sendMessage(id, { text: welcomeMessage, mentions: [userJid] });
            }
        }
    });

    socket.ev.on('connection.update', (update) => {
        if (update.connection === 'close' && update.lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
            setTimeout(startBot, 5000);
        }
    });

    socket.ev.on('creds.update', saveCreds);
}

// Servidor web para QR
app.get('/qr', (req, res) => {
    res.send(`<html><body><img src="${qrCodeData || ''}" width="300"/><script>setInterval(() => location.reload(), 5000)</script></body></html>`);
});

// Iniciar
startBot();
app.listen(port, () => console.log(`Servidor en http://localhost:${port}/qr`));
