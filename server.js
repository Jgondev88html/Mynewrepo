const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const users = new Map(); // Almacena usuarios conectados: { username, balance, loginAttempts }
const adminPassword = "admin123"; // Contraseña del administrador

wss.on('connection', (ws) => {
    console.log('Nuevo cliente conectado');

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        if (data.type === 'login') {
            const username = data.username;
            const user = users.get(username);

            if (user && user.loginAttempts >= 3) {
                ws.send(JSON.stringify({ type: 'error', message: 'Cuenta bloqueada. Contacta al administrador.' }));
                return;
            }

            if (users.has(username)) {
                if (!user.loginAttempts) user.loginAttempts = 0;
                user.loginAttempts++;
                ws.send(JSON.stringify({ type: 'error', message: 'Nombre de usuario ya existe' }));
                if (user.loginAttempts >= 3) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Cuenta bloqueada. Contacta al administrador.' }));
                }
            } else {
                users.set(username, { balance: 50, ws, loginAttempts: 0 });
                ws.username = username;
                ws.send(JSON.stringify({ type: 'loginSuccess', balance: 50, username }));
                console.log(`Usuario ${username} ha iniciado sesión`);
            }
        } else if (data.type === 'restoreSession') {
            const username = data.username;
            if (users.has(username)) {
                const user = users.get(username);
                if (user.loginAttempts >= 3) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Cuenta bloqueada. Contacta al administrador.' }));
                    return;
                }
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

            if (withdrawAmount < 250) {
                ws.send(JSON.stringify({ type: 'error', message: 'El mínimo de retiro es 250 monedas' }));
            } else if (user.balance >= withdrawAmount) {
                user.balance -= withdrawAmount;
                ws.send(JSON.stringify({ type: 'withdraw', balance: user.balance }));
                console.log(`Usuario ${username} ha retirado ${withdrawAmount} monedas`);
            } else {
                ws.send(JSON.stringify({ type: 'error', message: 'Saldo insuficiente para retirar' }));
            }
        } else if (data.type === 'adminLogin') {
            if (data.password === adminPassword) {
                ws.isAdmin = true;
                ws.send(JSON.stringify({ type: 'adminLoginSuccess' }));
                console.log('Administrador ha iniciado sesión');
            } else {
                ws.send(JSON.stringify({ type: 'error', message: 'Contraseña incorrecta' }));
            }
        } else if (data.type === 'creditAttempts') {
            if (ws.isAdmin) {
                const username = data.username;
                if (users.has(username)) {
                    const user = users.get(username);
                    user.loginAttempts = 0; // Restablecer intentos
                    ws.send(JSON.stringify({ type: 'success', message: `Intentos restablecidos para ${username}` }));
                    console.log(`Administrador restableció los intentos de ${username}`);
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Usuario no encontrado' }));
                }
            } else {
                ws.send(JSON.stringify({ type: 'error', message: 'No tienes permisos de administrador' }));
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
