const express = require('express');
const qrcode = require('qrcode');
const { useMultiFileAuthState, makeWASocket, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { Sticker, createSticker, StickerTypes } = require('wa-sticker-formatter');
const axios = require('axios'); // Para llamadas a APIs externas

const app = express();
const port = process.env.PORT || 3000;

const OWNER_NUMBER = '5358855203'; // Número del propietario
let qrCodeData = null;
let guessNumber = null;
let hangmanWord = '';
let guessedLetters = [];
const words = ['javascript', 'whatsapp', 'nodejs', 'express', 'baileys'];
let welcomeMessage = '🎉 ¡Bienvenido @user al grupo! 🎉'; // Mensaje de bienvenida personalizable
let groupTasks = {}; // Lista de tareas por grupo

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
        const isAdmin = admins.includes(sender) || sender.includes(OWNER_NUMBER); // Verifica si es admin o el propietario

        const text = msg.message.conversation?.toLowerCase() || '';

        if (text === '!menu') {
            const menu = `🎮 *GameBot - Menú de Comandos* 🎮\n\n` +
                `🛠️ *Comandos Generales:*\n` +
                `  - !sticker - Crea un sticker a partir de una imagen o video\n` +
                `  - !menu - Muestra este menú\n` +
                `  - !clima [ciudad] - Obtén el clima de una ciudad\n` +
                `  - !traducir [texto] - Traduce texto a otro idioma\n` +
                `  - !wiki [busqueda] - Busca en Wikipedia\n` +
                `  - !meme - Envía un meme aleatorio\n` +
                `  - !recordatorio [tiempo] [mensaje] - Establece un recordatorio\n` +
                `  - !tareas - Muestra la lista de tareas del grupo\n` +
                `  - !encuesta [pregunta] - Crea una encuesta\n\n` +
                `🎲 *Juegos:*\n` +
                `  - !guess - Adivina el número\n` +
                `  - !tor - Verdad o reto\n` +
                `  - !hangman - Jugar ahorcado\n` +
                `  - !trivia - Pregunta de cultura general\n` +
                `  - !ppt [piedra/papel/tijera] - Juega contra el bot\n\n` +
                `👑 *Comandos de Administración:*\n` +
                `  - !addadmin [@usuario] - Dar admin a un usuario\n` +
                `  - !removeadmin [@usuario] - Quitar admin a un usuario\n` +
                `  - !kick [@usuario] - Expulsar a un usuario del grupo\n` +
                `  - !bienvenida [mensaje] - Configurar mensaje de bienvenida\n` +
                `  - !info - Muestra información del grupo\n`;
            await socket.sendMessage(jid, { text: menu });
        }

        // Comando para crear stickers
        if (text === '!sticker' && (msg.message.imageMessage || msg.message.videoMessage)) {
            try {
                const media = msg.message.imageMessage || msg.message.videoMessage;
                const stream = await socket.downloadMediaMessage(msg);
                const buffer = Buffer.from(stream);

                const sticker = new Sticker(buffer, {
                    pack: 'GameBot Stickers',
                    author: 'GameBot',
                    type: StickerTypes.FULL,
                    categories: ['🎉'],
                    id: '12345',
                    quality: 100,
                    background: '#ffffff'
                });

                await sticker.toFile('sticker.webp');
                await socket.sendMessage(jid, { sticker: fs.readFileSync('sticker.webp') });
                fs.unlinkSync('sticker.webp'); // Eliminar el archivo temporal
            } catch (error) {
                console.error('Error al crear el sticker:', error);
                await socket.sendMessage(jid, { text: '❌ Ocurrió un error al crear el sticker.' });
            }
        }

        // Comando para obtener el clima
        if (text.startsWith('!clima')) {
            const city = text.split(' ')[1];
            if (city) {
                try {
                    const response = await axios.get(`https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=TU_API_KEY&units=metric&lang=es`);
                    const weather = response.data;
                    const weatherMessage = `🌤️ *Clima en ${weather.name}:*\n` +
                        `  - Temperatura: ${weather.main.temp}°C\n` +
                        `  - Humedad: ${weather.main.humidity}%\n` +
                        `  - Descripción: ${weather.weather[0].description}\n`;
                    await socket.sendMessage(jid, { text: weatherMessage });
                } catch (error) {
                    await socket.sendMessage(jid, { text: '❌ No se pudo obtener el clima. Verifica el nombre de la ciudad.' });
                }
            } else {
                await socket.sendMessage(jid, { text: '❌ Uso: !clima [ciudad]' });
            }
        }

        // Comando para traducir texto
        if (text.startsWith('!traducir')) {
            const textToTranslate = text.split(' ').slice(1).join(' ');
            if (textToTranslate) {
                try {
                    const response = await axios.get(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=es|en`);
                    const translation = response.data.responseData.translatedText;
                    await socket.sendMessage(jid, { text: `🌍 *Traducción:* ${translation}` });
                } catch (error) {
                    await socket.sendMessage(jid, { text: '❌ No se pudo traducir el texto.' });
                }
            } else {
                await socket.sendMessage(jid, { text: '❌ Uso: !traducir [texto]' });
            }
        }

        // Comando para buscar en Wikipedia
        if (text.startsWith('!wiki')) {
            const query = text.split(' ').slice(1).join(' ');
            if (query) {
                try {
                    const response = await axios.get(`https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`);
                    const summary = response.data.extract;
                    await socket.sendMessage(jid, { text: `📚 *Wikipedia:* ${summary}` });
                } catch (error) {
                    await socket.sendMessage(jid, { text: '❌ No se encontró información en Wikipedia.' });
                }
            } else {
                await socket.sendMessage(jid, { text: '❌ Uso: !wiki [busqueda]' });
            }
        }

        // Comando para enviar memes
        if (text === '!meme') {
            try {
                const response = await axios.get('https://meme-api.herokuapp.com/gimme');
                const memeUrl = response.data.url;
                await socket.sendMessage(jid, { image: { url: memeUrl } });
            } catch (error) {
                await socket.sendMessage(jid, { text: '❌ No se pudo obtener un meme.' });
            }
        }

        // Comando para establecer recordatorios
        if (text.startsWith('!recordatorio')) {
            const [time, ...reminderText] = text.split(' ').slice(1);
            if (time && reminderText.length > 0) {
                const reminderMessage = reminderText.join(' ');
                setTimeout(async () => {
                    await socket.sendMessage(jid, { text: `⏰ *Recordatorio:* ${reminderMessage}` });
                }, parseInt(time) * 1000);
                await socket.sendMessage(jid, { text: `⏰ Recordatorio establecido para ${time} segundos.` });
            } else {
                await socket.sendMessage(jid, { text: '❌ Uso: !recordatorio [tiempo en segundos] [mensaje]' });
            }
        }

        // Comando para gestionar tareas
        if (text === '!tareas') {
            if (!groupTasks[jid]) groupTasks[jid] = [];
            const tasks = groupTasks[jid].map((task, index) => `${index + 1}. ${task}`).join('\n');
            await socket.sendMessage(jid, { text: `📝 *Tareas del grupo:*\n${tasks || 'No hay tareas.'}` });
        }

        if (text.startsWith('!agregartarea')) {
            const task = text.split(' ').slice(1).join(' ');
            if (task) {
                if (!groupTasks[jid]) groupTasks[jid] = [];
                groupTasks[jid].push(task);
                await socket.sendMessage(jid, { text: `✅ Tarea agregada: ${task}` });
            } else {
                await socket.sendMessage(jid, { text: '❌ Uso: !agregartarea [tarea]' });
            }
        }

        if (text.startsWith('!eliminartarea')) {
            const taskIndex = parseInt(text.split(' ')[1]) - 1;
            if (!isNaN(taskIndex) && groupTasks[jid] && groupTasks[jid][taskIndex]) {
                const removedTask = groupTasks[jid].splice(taskIndex, 1)[0];
                await socket.sendMessage(jid, { text: `✅ Tarea eliminada: ${removedTask}` });
            } else {
                await socket.sendMessage(jid, { text: '❌ Tarea no encontrada.' });
            }
        }

        // Comando para crear encuestas
        if (text.startsWith('!encuesta')) {
            const question = text.split(' ').slice(1).join(' ');
            if (question) {
                await socket.sendMessage(jid, {
                    poll: {
                        name: question,
                        values: ['Sí', 'No'],
                        selectableCount: 1
                    }
                });
            } else {
                await socket.sendMessage(jid, { text: '❌ Uso: !encuesta [pregunta]' });
            }
        }

        // Comando para configurar el mensaje de bienvenida
        if (text.startsWith('!bienvenida') && isAdmin) {
            const newWelcomeMessage = text.split(' ').slice(1).join(' ');
            if (newWelcomeMessage) {
                welcomeMessage = newWelcomeMessage;
                await socket.sendMessage(jid, { text: '✅ Mensaje de bienvenida actualizado.' });
            } else {
                await socket.sendMessage(jid, { text: '❌ Uso: !bienvenida [mensaje]' });
            }
        }

        // Comando para mostrar información del grupo
        if (text === '!info' && isGroup) {
            const groupInfo = `📌 *Información del grupo:*\n` +
                `  - Nombre: ${metadata.subject}\n` +
                `  - Creador: @${metadata.owner.split('@')[0]}\n` +
                `  - Miembros: ${metadata.participants.length}\n` +
                `  - Descripción: ${metadata.desc || 'Sin descripción'}\n`;
            await socket.sendMessage(jid, { text: groupInfo });
        }

        // Comandos de juegos (existente)
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

        // Comandos de administración (existente)
        if (text.startsWith('!addadmin') && isAdmin) {
            const userJid = text.split(' ')[1];
            if (userJid) {
                await socket.groupParticipantsUpdate(jid, [userJid], 'promote');
                await socket.sendMessage(jid, { text: `👑 @${userJid.split('@')[0]} ahora es admin.`, mentions: [userJid] });
            }
        }

        if (text.startsWith('!removeadmin') && isAdmin) {
            const userJid = text.split(' ')[1];
            if (userJid) {
                await socket.groupParticipantsUpdate(jid, [userJid], 'demote');
                await socket.sendMessage(jid, { text: `👑 @${userJid.split('@')[0]} ya no es admin.`, mentions: [userJid] });
            }
        }

        if (text.startsWith('!kick') && isAdmin) {
            const userJid = text.split(' ')[1];
            if (userJid) {
                await socket.groupParticipantsUpdate(jid, [userJid], 'remove');
                await socket.sendMessage(jid, { text: `👋 @${userJid.split('@')[0]} ha sido expulsado del grupo.`, mentions: [userJid] });
            }
        }
    });

    socket.ev.on('group-participants.update', async ({ id, participants, action }) => {
        if (action === 'add') {
            const metadata = await socket.groupMetadata(id);
            const userJid = participants[0];
            const welcomeMsg = welcomeMessage.replace('@user', `@${userJid.split('@')[0]}`);
            await socket.sendMessage(id, { text: welcomeMsg, mentions: [userJid] });
        } else if (action === 'remove') {
            const userJid = participants[0];
            await socket.sendMessage(id, { text: `👋 @${userJid.split('@')[0]} ha abandonado el grupo.`, mentions: [userJid] });
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
