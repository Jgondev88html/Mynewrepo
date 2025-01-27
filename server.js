const WebSocket = require('ws');

// Crear el servidor WebSocket
const wss = new WebSocket.Server({ port: 3000 });

// Almacén para los usuarios (monedas e intentos)
const users = {};

wss.on('connection', (ws) => {
    console.log('Nuevo cliente conectado');

    // Escuchar mensajes del cliente
    ws.on('message', (message) => {
        const data = JSON.parse(message);

        if (data.type === 'login') {
            const username = data.username;

            // Inicializar al usuario si no existe
            if (!users[username]) {
                users[username] = {
                    coins: 100,  // Monedas iniciales
                    attempts: 5  // Intentos iniciales
                };
            }

            console.log(`Usuario conectado: ${username}`);
            ws.send(
                JSON.stringify({
                    type: 'loginSuccess',
                    coins: users[username].coins,
                    attempts: users[username].attempts
                })
            );
        }

        if (data.type === 'guess') {
            const username = data.username;
            const bet = data.bet;

            // Verificar si el usuario existe
            if (!users[username]) {
                ws.send(JSON.stringify({ type: 'error', message: 'Usuario no encontrado' }));
                return;
            }

            // Verificar intentos disponibles
            if (users[username].attempts <= 0) {
                ws.send(
                    JSON.stringify({
                        type: 'result',
                        message: 'No tienes más intentos disponibles.',
                        newCoins: users[username].coins,
                        remainingAttempts: users[username].attempts
                    })
                );
                return;
            }

            // Verificar si la apuesta está en el rango permitido (1-5)
            if (bet < 1 || bet > 5) {
                ws.send(
                    JSON.stringify({
                        type: 'error',
                        message: 'La apuesta debe estar entre 1 y 5.'
                    })
                );
                return;
            }

            // Generar el número aleatorio entre 1 y 5
            const randomNumber = Math.floor(Math.random() * 5) + 1;

            // Reducir los intentos
            users[username].attempts -= 1;

            // Lógica de la apuesta
            if (bet === randomNumber) {
                // Ganó la apuesta
                const reward = bet * 10; // Recompensa: apuesta * 10
                users[username].coins += reward;

                ws.send(
                    JSON.stringify({
                        type: 'result',
                        win: true,
                        amount: reward,
                        newCoins: users[username].coins,
                        remainingAttempts: users[username].attempts,
                        number: randomNumber
                    })
                );
            } else {
                // Perdió la apuesta
                ws.send(
                    JSON.stringify({
                        type: 'result',
                        win: false,
                        newCoins: users[username].coins,
                        remainingAttempts: users[username].attempts,
                        number: randomNumber
                    })
                );
            }
        }
    });

    // Manejo de cierre de conexión
    ws.on('close', () => {
        console.log('Cliente desconectado');
    });
});

console.log('Servidor WebSocket escuchando en ws://localhost:3000');
