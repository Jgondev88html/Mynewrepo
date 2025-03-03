const express = require('express');
const qrcode = require('qrcode');
const { useMultiFileAuthState, makeWASocket, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const ytdl = require('ytdl-core');
const { Sticker, createSticker, StickerTypes } = require('wa-sticker-formatter');

const app = express();
const port = process.env.PORT || 3000;

const OWNER_NUMBER = '521234567890';
let qrCodeData = null;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'baileys_auth'));
    
    const socket = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
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
        const isGroup = jid.endsWith('@g.us');

        if (msg.message.conversation?.toLowerCase() === '!menu') {
            const menu = '*🤖 CodeBot - Menú de Comandos*\n\n' +
                '!menu - Ver este menú\n' +
                '!sticker - Crear sticker desde imagen\n' +
                '!yt [URL] - Descargar video de YouTube\n' +
                (isGroup ? '!tagall - Mencionar a todos (Solo admins)\n' : '');
            await socket.sendMessage(jid, { text: menu });
        }

        if (msg.message.conversation?.startsWith('!yt ')) {
            const url = msg.message.conversation.split(' ')[1];
            if (ytdl.validateURL(url)) {
                const info = await ytdl.getInfo(url);
                const format = ytdl.chooseFormat(info.formats, { quality: '18' });
                await socket.sendMessage(jid, { text: `Descargando: ${info.videoDetails.title}` });
                await socket.sendMessage(jid, { video: { url: format.url }, caption: info.videoDetails.title });
            } else {
                await socket.sendMessage(jid, { text: '❌ URL inválida' });
            }
        }
    });

    socket.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
            setTimeout(startBot, 5000);
        }
    });

    socket.ev.on('creds.update', saveCreds);
}

app.get('/qr', (req, res) => {
    res.send(`<html><body><img src="${qrCodeData || ''}" style="width: 300px"/><script>setInterval(() => location.reload(), 5000)</script></body></html>`);
});

startBot();
app.listen(port, () => console.log(`Servidor en http://localhost:${port}/qr`));
