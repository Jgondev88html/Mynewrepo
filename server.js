const express = require('express');
const WebSocket = require('ws');
const app = express();
const port = 3000;

// Configuración para servir los archivos estáticos (HTML, CSS, JS)
app.use(express.static('public'));

// Crear el servidor WebSocket
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws) => {
    let userCoins = 100; // Monedas iniciales
    let userAttempts = 5; // Intentos iniciales
    let username = null;  // Usuario

    console.log('Cliente conectado');
    
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        
        // Login del jugador
        if (data.type === 'login') {
            username = data.username;

            // Enviar respuesta de login exitoso
            ws.send(JSON.stringify({
                type: 'loginSuccess',
                coins: userCoins,
                attempts: userAttempts
            }));
            console.log(`Usuario ${username} ha iniciado sesión`);
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
                    ws.send(JSON.stringify({
                        type: 'result', 
                        win: true, 
                        number: randomNumber, 
                        winAmount: winAmount, 
                        newCoins: userCoins, 
                        remainingAttempts: userAttempts
                    }));
                } else {
                    ws.send(JSON.stringify({
                        type: 'result', 
                        win: false, 
                        number: randomNumber, 
                        newCoins: userCoins, 
                        remainingAttempts: userAttempts
                    }));
                }
            } else {
                ws.send(JSON.stringify({
                    type: 'result',
                    win: false,
                    message: '¡Has quedado sin intentos! El juego ha terminado.',
                    newCoins: userCoins,
                    remainingAttempts: userAttempts
                }));
            }
        }
    });

    ws.on('close', () => {
        console.log('Cliente desconectado');
    });
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
