const express = require('express');
const WebSocket = require('ws');
const app = express();
const port = 3000;

// Configuración para servir los archivos estáticos (HTML, CSS, JS)
app.use(express.static('public'));

// Crear el servidor WebSocket
const wss = new WebSocket.Server({ noServer: true });

// Lista para almacenar los usuarios activos
let activeUsers = [];

wss.on('connection', (ws) => {
    let userCoins = 100; // Monedas iniciales
    let userAttempts = 5; // Intentos iniciales
    let username = null;

    console.log('Cliente conectado');

    // Escuchar mensajes del cliente
    ws.on('message', (message) => {
        const data = JSON.parse(message);

        // Login del jugador
        if (data.type === 'login') {
            if (activeUsers.includes(data.username)) {
                // Si el usuario ya está logueado, enviamos un error
                ws.send(JSON.stringify({ type: 'loginError', message: 'Este nombre de usuario ya está en uso.' }));
            } else {
                // Si no está en uso, lo agregamos a la lista de usuarios activos
                username = data.username;
                activeUsers.push(username);
                console.log(`Usuario ${username} ha iniciado sesión`);
                ws.send(JSON.stringify({ type: 'loginSuccess', coins: userCoins, attempts: userAttempts }));
                broadcastActiveUsers();
            }
        }

        // Juego - Adivina el número
        if (data.type === 'guess') {
            if (userAttempts > 0) {
                const bet = data.bet; // Apuesta en número
                const randomNumber = Math.floor(Math.random() * 5) + 1; // Número aleatorio entre 1 y 5
                userAttempts -= 1; // Restamos un intento

                if (bet === randomNumber) {
                    const winAmount = randomNumber * 2; // El jugador gana el doble del número que adivina
                    userCoins += winAmount;
                    ws.send(JSON.stringify({ type: 'result', win: true, amount: winAmount, newCoins: userCoins, remainingAttempts: userAttempts }));
                } else {
                    ws.send(JSON.stringify({ type: 'result', win: false, number: randomNumber, newCoins: userCoins, remainingAttempts: userAttempts }));
                }
            } else {
                ws.send(JSON.stringify({ type: 'result', win: false, message: '¡Has quedado sin intentos! El juego ha terminado.', newCoins: userCoins, remainingAttempts: userAttempts }));
            }
        }
    });

    // Cuando un cliente se desconecta, eliminamos su nombre de la lista de usuarios activos
    ws.on('close', () => {
        console.log('Cliente desconectado');
        if (username) {
            activeUsers = activeUsers.filter(user => user !== username);
            broadcastActiveUsers();
        }
    });

    // Función para enviar la lista de usuarios activos a todos los clientes
    function broadcastActiveUsers() {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'activeUsers', users: activeUsers }));
            }
        });
    }
});

// Redirige WebSocket a partir de la petición HTTP
app.server = app.listen(port, () => {
    console.log(`Servidor escuchando en http://localhost:${port}`);
});

// Crear un objeto para almacenar a los usuarios y sus conexiones
app.server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});
