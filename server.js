const express = require('express');
const qrcode = require('qrcode');
const { useMultiFileAuthState, makeWASocket, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { Sticker, createSticker, StickerTypes } = require('wa-sticker-formatter');

const app = express();
const port = process.env.PORT || 3000;

const OWNER_NUMBER = '5358855203';
let qrCodeData = null;
let guessNumber = null;
let hangmanWord = '';
let guessedLetters = [];
const words = ['javascript', 'whatsapp', 'nodejs', 'express', 'baileys'];

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, 'baileys_auth'));
    
    const socket = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ['GameBot', 'Chrome', '1.0.0']
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
        const sender = msg.key.participant || msg.key.remoteJid;
        const isAdmin = admins.includes(sender) || sender.includes(OWNER_NUMBER);

        const text = msg.message.conversation?.toLowerCase() || '';

        if (text === '!menu') {
            const menu = `🎮 *GameBot - Menú de Juegos* 🎮\n\n` +
                `🎲 *Juegos:*\n` +
                `  - !guess - Adivina el número\n` +
                `  - !tor - Verdad o reto\n` +
                `  - !hangman - Jugar ahorcado\n` +
                `  - !trivia - Pregunta de cultura general\n` +
                `  - !ppt [piedra/papel/tijera] - Juega contra el bot\n`;
            await socket.sendMessage(jid, { text: menu });
        }

        if (text === '!guess') {
            guessNumber = Math.floor(Math.random() * 100) + 1;
            await socket.sendMessage(jid, { text: '🎯 He pensado en un número entre 1 y 100. ¡Adivina cuál es!' });
        }

        if (!isNaN(text) && guessNumber) {
            const guess = parseInt(text);
            if (guess === guessNumber) {
                await socket.sendMessage(jid, { text: `🎉 ¡Correcto! El número era ${guessNumber}.` });
                guessNumber = null;
            } else {
                await socket.sendMessage(jid, { text: guess < guessNumber ? '⬆️ Más alto' : '⬇️ Más bajo' });
            }
        }

        if (text === '!hangman') {
            hangmanWord = words[Math.floor(Math.random() * words.length)];
            guessedLetters = [];
            let displayWord = hangmanWord.split('').map(l => '_').join(' ');
            await socket.sendMessage(jid, { text: `🎭 Ahorcado: ${displayWord}` });
        }

        if (text.length === 1 && hangmanWord.includes(text)) {
            guessedLetters.push(text);
            let displayWord = hangmanWord.split('').map(l => guessedLetters.includes(l) ? l : '_').join(' ');
            await socket.sendMessage(jid, { text: `🎭 Ahorcado: ${displayWord}` });
            if (!displayWord.includes('_')) {
                await socket.sendMessage(jid, { text: '🎉 ¡Ganaste! La palabra era ' + hangmanWord });
                hangmanWord = '';
            }
        }
    });

    socket.ev.on('group-participants.update', async ({ id, participants, action }) => {
        if (action === 'add') {
            const metadata = await socket.groupMetadata(id);
            const userJid = participants[0];
            const welcomeMessage = `🎉 ¡Bienvenido @${userJid.split('@')[0]} al grupo *${metadata.subject}*! 🎉`;
            await socket.sendMessage(id, { text: welcomeMessage, mentions: [userJid] });
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
