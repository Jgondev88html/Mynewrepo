require('dotenv').config();
const mongoose = require('mongoose');
const WebSocket = require('ws');
const http = require('http');
const User = require('./models/User');

// Deshabilitar la advertencia de `strictQuery`
mongoose.set('strictQuery', false);

// Conexión a MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost/juego_apuestas', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
    .then(() => console.log('Conectado a la base de datos'))
    .catch((err) => {
        console.log('Error al conectar a la base de datos', err);
        process.exit(1); // Salir si no se puede conectar a la base de datos
    });

const server = http.createServer();
const wss = new WebSocket.Server({ server });

let activeUsers = {}; // Guardar los WebSockets de usuarios activos

wss.on('connection', (ws) => {
    console.log('Nuevo cliente conectado');

    ws.on('message', async (data) => {
        const message = JSON.parse(data);

        if (message.type === 'login') {
            await handleLogin(ws, message.username);
        } else if (message.type === 'betRequest') {
            await handleBetRequest(ws, message.opponent);
        } else if (message.type === 'acceptBet') {
            await handleAcceptBet(ws, message.opponent, message.betAmount);
        } else if (message.type === 'adminCredit') {
            await handleAdminCredit(ws, message.username, message.amount);
        }
    });

    ws.on('close', () => {
        console.log('Cliente desconectado');
        if (ws.username) {
            activeUsers[ws.username] = false;
        }
    });
});

async function handleLogin(ws, username) {
    let user = await User.findOne({ username });

    if (!user) {
        user = new User({ username });
        await user.save();
    }

    ws.username = username;
    activeUsers[username] = true;
    ws.send(JSON.stringify({ type: 'login', coins: user.coins, username }));

    console.log(`Usuario ${username} ha iniciado sesión`);
}

async function handleBetRequest(ws, opponent) {
    if (ws.username === opponent) {
        ws.send(JSON.stringify({ type: 'error', message: 'No puedes retarte a ti mismo' }));
        return;
    }

    const opponentWs = activeUsers[opponent];

    if (!opponentWs) {
        ws.send(JSON.stringify({ type: 'error', message: 'El oponente no está activo' }));
        return;
    }

    // Aquí debes manejar la lógica de la solicitud de apuesta, por ejemplo,
    // guardar la solicitud en la base de datos para que el oponente pueda aceptarla.

    ws.send(JSON.stringify({ type: 'betRequestSent', opponent }));
}

async function handleAcceptBet(ws, opponent, betAmount) {
    const user = await User.findOne({ username: ws.username });
    const opponentUser = await User.findOne({ username: opponent });

    if (user.coins < betAmount) {
        ws.send(JSON.stringify({ type: 'error', message: 'No tienes suficientes monedas' }));
        return;
    }

    const winner = Math.random() < 0.5 ? ws.username : opponent;
    if (winner === ws.username) {
        user.coins += betAmount;
        opponentUser.coins -= betAmount;
    } else {
        user.coins -= betAmount;
        opponentUser.coins += betAmount;
    }

    await user.save();
    await opponentUser.save();

    ws.send(JSON.stringify({ type: 'result', winner, coins: user.coins }));
    activeUsers[opponent].send(JSON.stringify({ type: 'result', winner, coins: opponentUser.coins }));

    console.log(`La apuesta entre ${ws.username} y ${opponent} ha sido resuelta`);
}

async function handleAdminCredit(ws, username, amount) {
    if (!ws.isAdmin) {
        ws.send(JSON.stringify({ type: 'error', message: 'No tienes permisos de administrador' }));
        return;
    }

    const user = await User.findOne({ username });
    if (!user) {
        ws.send(JSON.stringify({ type: 'error', message: 'Usuario no encontrado' }));
        return;
    }

    user.coins += amount;
    await user.save();

    ws.send(JSON.stringify({ type: 'success', message: `Se han acreditado ${amount} monedas a ${username}` }));
}

server.listen(process.env.PORT || 3000, () => {
    console.log('Servidor WebSocket ejecutándose');
});
