const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const users = new Map(); // Almacena usuarios conectados: { username, balance }

wss.on('connection', (ws) => {
    console.log('Nuevo cliente conectado');

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        if (data.type === 'login') {
            const username = data.username;
            if (users.has(username)) {
                ws.send(JSON.stringify({ type: 'error', message: 'Nombre de usuario ya existe' }));
            } else {
                users.set(username, { balance: 1000, ws });
                ws.username = username;
                ws.send(JSON.stringify({ type: 'loginSuccess', balance: 1000, username }));
                console.log(`Usuario ${username} ha iniciado sesión`);
            }
        } else if (data.type === 'restoreSession') {
            const username = data.username;
            if (users.has(username)) {
                const user = users.get(username);
                ws.username = username;
                ws.send(JSON.stringify({ type: 'loginSuccess', balance: user.balance, username }));
                console.log(`Usuario ${username} ha restaurado su sesión`);
            } else {
                ws.send(JSON.stringify({ type: 'error', message: 'Sesión no encontrada' }));
            }
        } else if (data.type === 'bet') {
            const username = ws.username;
            const user = users.get(username);
            const betAmount = data.amount;

            if (user.balance >= betAmount) {
                const win = Math.random() < 0.5; // 50% de probabilidad de ganar
                if (win) {
                    user.balance += betAmount;
                } else {
                    user.balance -= betAmount;
                }
                ws.send(JSON.stringify({ type: 'result', result: win ? 'win' : 'lose', balance: user.balance }));
            } else {
                ws.send(JSON.stringify({ type: 'error', message: 'Saldo insuficiente' }));
            }
        } else if (data.type === 'withdraw') {
            const username = ws.username;
            const user = users.get(username);
            const withdrawAmount = data.amount;

            if (user.balance >= withdrawAmount) {
                user.balance -= withdrawAmount;
                ws.send(JSON.stringify({ type: 'withdraw', balance: user.balance }));
                console.log(`Usuario ${username} ha retirado ${withdrawAmount} monedas`);
            } else {
                ws.send(JSON.stringify({ type: 'error', message: 'Saldo insuficiente para retirar' }));
            }
        }
    });

    ws.on('close', () => {
        if (ws.username) {
            console.log(`Usuario ${ws.username} ha cerrado sesión`);
        }
    });
});

server.listen(process.env.PORT || 3000, () => {
    console.log(`Servidor escuchando en el puerto ${server.address().port}`);
});
