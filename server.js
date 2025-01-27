const express = require('express');
const WebSocket = require('ws');
const app = express();
const port = 3000;

// Configuración para servir archivos estáticos
app.use(express.static('public'));

// Crear el servidor WebSocket
const wss = new WebSocket.Server({ noServer: true });
const users = new Map(); // Guardar usuarios y sus datos

wss.on('connection', (ws, req) => {
    let currentUser = null;

    console.log('Cliente conectado');

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        // Login
        if (data.type === 'login') {
            const username = data.username.trim();
            if (users.has(username)) {
                ws.send(JSON.stringify({ type: 'loginError', message: 'Nombre de usuario en uso.' }));
                return;
            }
            currentUser = { username, coins: 100, attempts: 5 };
            users.set(username, currentUser);
            broadcastActiveUsers();
            ws.send(JSON.stringify({
                type: 'loginSuccess',
                username,
                coins: currentUser.coins,
                attempts: currentUser.attempts
            }));
        }

        // Reconexión
        if (data.type === 'reconnect') {
            const username = data.username.trim();
            if (users.has(username)) {
                currentUser = users.get(username);
                ws.send(JSON.stringify({
                    type: 'loginSuccess',
                    username,
                    coins: currentUser.coins,
                    attempts: currentUser.attempts
                }));
                broadcastActiveUsers();
            } else {
                ws.send(JSON.stringify({ type: 'loginError', message: 'Usuario no encontrado, vuelve a iniciar sesión.' }));
            }
        }

        // Adivinar número
        if (data.type === 'guess') {
            if (!currentUser) return;
            if (currentUser.attempts <= 0) {
                ws.send(JSON.stringify({ type: 'result', win: false, message: '¡No te quedan intentos!' }));
                return;
            }

            const bet = data.bet;
            const randomNumber = Math.floor(Math.random() * 5) + 1; // Números del 1 al 5
            currentUser.attempts -= 1;

            if (bet === randomNumber) {
                const winAmount = randomNumber * 2;
                currentUser.coins += winAmount;
                ws.send(JSON.stringify({
                    type: 'result',
                    win: true,
                    amount: winAmount,
                    number: randomNumber,
                    newCoins: currentUser.coins,
                    remainingAttempts: currentUser.attempts
                }));
            } else {
                ws.send(JSON.stringify({
                    type: 'result',
                    win: false,
                    number: randomNumber,
                    newCoins: currentUser.coins,
                    remainingAttempts: currentUser.attempts
                }));
            }
        }
    });

    ws.on('close', () => {
        if (currentUser) {
            users.delete(currentUser.username);
            broadcastActiveUsers();
        }
        console.log('Cliente desconectado');
    });
});

// Función para enviar la lista de usuarios activos
function broadcastActiveUsers() {
    const activeUsers = Array.from(users.keys());
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'activeUsers', users: activeUsers }));
        }
    });
}

// Configuración para manejar la actualización de WebSocket
app.server = app.listen(port, () => {
    console.log(`Servidor escuchando en http://localhost:${port}`);
});

app.server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});
