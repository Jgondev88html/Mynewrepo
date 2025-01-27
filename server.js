const express = require('express');
const WebSocket = require('ws');
const app = express();
const port = 3000;

app.use(express.static('public'));

const wss = new WebSocket.Server({ noServer: true });

let users = {}; // Almacena usuarios activos con sus monedas e intentos.

wss.on('connection', (ws) => {
    let currentUser = null;

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        // Manejar login
        if (data.type === 'login') {
            if (users[data.username]) {
                ws.send(JSON.stringify({ type: 'loginError', message: 'El nombre de usuario ya está en uso.' }));
            } else {
                currentUser = data.username;
                users[currentUser] = { coins: 100, attempts: 5 };
                ws.send(JSON.stringify({ type: 'loginSuccess', username: currentUser, coins: 100, attempts: 5 }));
                broadcastActiveUsers();
            }
        }

        // Manejar reconexión
        if (data.type === 'reconnect') {
            if (users[data.username]) {
                currentUser = data.username;
                const { coins, attempts } = users[currentUser];
                ws.send(JSON.stringify({ type: 'loginSuccess', username: currentUser, coins, attempts }));
                broadcastActiveUsers();
            } else {
                ws.send(JSON.stringify({ type: 'loginError', message: 'Usuario no encontrado. Por favor, inicia sesión nuevamente.' }));
            }
        }

        // Manejar juego
        if (data.type === 'guess' && currentUser) {
            const user = users[currentUser];
            if (user.attempts > 0) {
                const bet = data.bet;
                const randomNumber = Math.floor(Math.random() * 5) + 1;
                user.attempts--;

                if (bet === randomNumber) {
                    user.coins += randomNumber * 2;
                    ws.send(JSON.stringify({
                        type: 'result',
                        win: true,
                        number: randomNumber,
                        newCoins: user.coins,
                        remainingAttempts: user.attempts,
                    }));
                } else {
                    ws.send(JSON.stringify({
                        type: 'result',
                        win: false,
                        number: randomNumber,
                        newCoins: user.coins,
                        remainingAttempts: user.attempts,
                    }));
                }
            } else {
                ws.send(JSON.stringify({
                    type: 'result',
                    win: false,
                    message: 'Sin intentos restantes.',
                    newCoins: users[currentUser].coins,
                    remainingAttempts: 0,
                }));
            }
        }
    });

    ws.on('close', () => {
        if (currentUser && users[currentUser]) {
            // Mantenemos al usuario registrado aunque pierda la conexión temporalmente
            broadcastActiveUsers();
        }
    });
});

// Broadcast para actualizar usuarios activos
function broadcastActiveUsers() {
    const activeUsers = Object.keys(users);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'activeUsers', users: activeUsers }));
        }
    });
}

app.listen(port, () => {
    console.log(`Servidor escuchando en http://localhost:${port}`);
});
