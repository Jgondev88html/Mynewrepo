const express = require('express');
const WebSocket = require('ws');
const app = express();
const port = 3000;

// Configuración para servir los archivos estáticos (HTML, CSS, JS)
app.use(express.static('public'));

// Crear el servidor WebSocket
const wss = new WebSocket.Server({ noServer: true });

let activeUsers = {}; // Objeto para rastrear usuarios activos (clave: nombre de usuario)

wss.on('connection', (ws) => {
    let username = null;

    console.log('Cliente conectado');

    ws.on('message', (message) => {
        const data = JSON.parse(message);

        // Login del jugador
        if (data.type === 'login') {
            if (activeUsers[data.username]) {
                ws.send(JSON.stringify({ type: 'loginError', message: 'Este nombre de usuario ya está en uso.' }));
            } else {
                username = data.username;
                activeUsers[username] = ws; // Guardamos al usuario
                ws.send(JSON.stringify({ type: 'loginSuccess', username, coins: 100, attempts: 5 }));
                broadcastActiveUsers();
            }
        }

        // Juego - Adivina el número
        if (data.type === 'guess' && username) {
            const bet = data.bet; // Apuesta del cliente
            const randomNumber = Math.floor(Math.random() * 5) + 1; // Número aleatorio entre 1 y 5
            let response = { type: 'result', win: false, number: randomNumber };

            if (bet === randomNumber) {
                response.win = true;
                response.amount = bet * 2; // Ganancia: el doble del número apostado
            }

            ws.send(JSON.stringify(response));
        }
    });

    ws.on('close', () => {
        if (username) {
            delete activeUsers[username]; // Eliminar al usuario desconectado
            broadcastActiveUsers();
        }
        console.log('Cliente desconectado');
    });
});

// Función para enviar la lista de usuarios activos a todos los clientes
function broadcastActiveUsers() {
    const activeUsernames = Object.keys(activeUsers);
    const message = JSON.stringify({ type: 'activeUsers', users: activeUsernames });
    for (const user in activeUsers) {
        activeUsers[user].send(message);
    }
}

// Redirigir WebSocket a partir de la petición HTTP
app.server = app.listen(port, () => {
    console.log(`Servidor escuchando en http://localhost:${port}`);
});

app.server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});
