const http = require("http");
const fs = require("fs");
const WebSocket = require("ws");

const server = http.createServer((req, res) => {
    if (req.url === "/" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(fs.readFileSync("index.html"));
    }
});

const wss = new WebSocket.Server({ server });
const users = {}; // Guardará usuarios en memoria

wss.on("connection", (ws) => {
    ws.on("message", (message) => {
        const data = JSON.parse(message);

        if (data.type === "register") {
            if (users[data.username]) {
                ws.send(JSON.stringify({ type: "error", message: "Usuario ya existe" }));
            } else {
                users[data.username] = { password: data.password, coins: 100 };
                ws.send(JSON.stringify({ type: "success", message: "Registro exitoso", coins: 100 }));
            }
        }

        if (data.type === "login") {
            if (!users[data.username] || users[data.username].password !== data.password) {
                ws.send(JSON.stringify({ type: "error", message: "Credenciales incorrectas" }));
            } else {
                ws.send(JSON.stringify({ type: "success", message: "Login exitoso", coins: users[data.username].coins }));
            }
        }

        if (data.type === "play") {
            if (users[data.username]) {
                let result = Math.random() < 0.5 ? -10 : 20;
                users[data.username].coins = Math.max(0, users[data.username].coins + result);

                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: "update", username: data.username, coins: users[data.username].coins }));
                    }
                });
            }
        }
    });
});

server.listen(3000, () => console.log("Servidor en http://localhost:3000"));
