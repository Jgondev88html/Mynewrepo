const express = require('express');
const qrcode = require('qrcode');
const { useMultiFileAuthState, makeWASocket, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const pino = require('pino');

const app = express();
const port = process.env.PORT || 3000;

const OWNER_NUMBER = '5358855203';
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
        const metadata = isGroup ? await socket.groupMetadata(jid) : null;
        const admins = metadata ? metadata.participants.filter(p => p.admin).map(p => p.id) : [];
        const isAdmin = msg.key.participant ? admins.includes(msg.key.participant) || msg.key.participant.includes(OWNER_NUMBER) : false;

        if (msg.message.conversation?.toLowerCase() === '!menu') {
            const menu = `*🌟 CodeBot - Menú de Comandos 🌟*\n\n` +
                `🔹 *Generales:*\n` +
                `  - !menu - Ver este menú\n` +
                (isGroup ? `\n🔹 *Comandos para grupos:*\n` +
                `  - !tagall - Mencionar a todos (Solo admins)\n` : '');
            await socket.sendMessage(jid, { text: menu });
        }

        if (isGroup && msg.message.conversation?.toLowerCase() === '!tagall' && isAdmin) {
            const mentions = metadata.participants.map(p => p.id);
            const text = '📢 Mención a todos:\n' + mentions.map(id => `@${id.split('@')[0]}`).join(' ');
            await socket.sendMessage(jid, { text, mentions });
        }
    });

    socket.ev.on('group-participants.update', async ({ id, participants, action }) => {
        if (action === 'add') {
            const metadata = await socket.groupMetadata(id);
            const groupDesc = metadata.desc || 'No hay descripción disponible';
            const newMember = participants[0];

            console.log(`Nuevo miembro detectado: ${newMember} en el grupo ${metadata.subject}`);

            const welcomeMessage = `🎉 ¡Bienvenido @${newMember.split('@')[0]} al grupo *${metadata.subject}*! 🎉\n\n📌 *Descripción del grupo:*\n${groupDesc}`;
            await socket.sendMessage(id, { text: welcomeMessage, mentions: [newMember] });
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
