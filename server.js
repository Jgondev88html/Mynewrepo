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
const users = {}; // Almacena usuarios en memoria

wss.on("connection", (ws) => {
    ws.on("message", (message) => {
        const data = JSON.parse(message);

        if (data.type === "register") {
            if (!users[data.username]) {
                users[data.username] = { coins: 100 };
            }
            ws.send(JSON.stringify({ type: "success", coins: users[data.username].coins }));
        }

        if (data.type === "play") {
            if (users[data.username]) {
                let result = Math.random() < 0.5 ? -10 : 20;
                users[data.username].coins = Math.max(0, users[data.username].coins + result);

                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: "update", username: data.username, coins: users[data.username].coins, result }));
                    }
                });
            }
        }
    });
});

server.listen(3000, () => console.log("Servidor en http://localhost:3000"));
