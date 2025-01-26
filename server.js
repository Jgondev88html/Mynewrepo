const WebSocket = require("ws");
const http = require("http");

const server = http.createServer();
const wss = new WebSocket.Server({ server });

let users = {}; // Almacena usuarios y sus monedas

wss.on("connection", (ws) => {
    console.log("Nuevo cliente conectado");

    ws.on("message", (data) => {
        const message = JSON.parse(data);

        if (message.type === "login") {
            handleLogin(ws, message.username);
        } else if (message.type === "bet") {
            handleBet(ws, message);
        }
    });

    ws.on("close", () => {
        console.log("Cliente desconectado");
    });
});

function handleLogin(ws, username) {
    if (!users[username]) {
        users[username] = 100; // Asignar monedas iniciales a nuevos usuarios
    }

    ws.username = username;
    ws.send(JSON.stringify({ type: "login", coins: users[username] }));
    console.log(`Usuario ${username} inició sesión con ${users[username]} monedas`);
}

function handleBet(ws, { opponent, betAmount }) {
    if (!users[ws.username] || users[ws.username] < betAmount) {
        ws.send(JSON.stringify({ type: "error", message: "No tienes suficientes monedas" }));
        return;
    }

    if (!users[opponent] || users[opponent] < betAmount) {
        ws.send(JSON.stringify({ type: "error", message: "El oponente no tiene suficientes monedas" }));
        return;
    }

    const winner = Math.random() < 0.5 ? ws.username : opponent;

    if (winner === ws.username) {
        users[ws.username] += betAmount;
        users[opponent] -= betAmount;
    } else {
        users[ws.username] -= betAmount;
        users[opponent] += betAmount;
    }

    // Notificar a ambos jugadores el resultado
    notifyUser(ws.username, { type: "result", coins: users[ws.username], message: `Ganaste contra ${opponent}` });
    notifyUser(opponent, { type: "result", coins: users[opponent], message: `${ws.username} te ganó` });
}

function notifyUser(username, message) {
    wss.clients.forEach((client) => {
        if (client.username === username && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

server.listen(3000, () => {
    console.log("Servidor WebSocket ejecutándose en http://localhost:3000");
});
