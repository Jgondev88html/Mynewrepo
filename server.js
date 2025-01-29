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
const users = {}; // Almacena usuarios y monedas en memoria

wss.on("connection", (ws) => {
    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === "register") {
                if (!users[data.username]) {
                    users[data.username] = { coins: 100 }; // Usuario nuevo inicia con 100 monedas
                }
                ws.send(JSON.stringify({ type: "success", coins: users[data.username].coins }));
            }

            if (data.type === "play") {
                if (users[data.username]) {
                    let result = Math.random() < 0.5 ? -10 : 20; // Ganas 20 o pierdes 10
                    users[data.username].coins = Math.max(0, users[data.username].coins + result);

                    // Enviar actualización al usuario específico
                    ws.send(JSON.stringify({
                        type: "update",
                        username: data.username,
                        coins: users[data.username].coins,
                        result
                    }));
                }
            }
        } catch (error) {
            console.error("Error procesando mensaje:", error);
        }
    });

    ws.on("close", () => console.log("Cliente desconectado"));
});

server.listen(3000, () => console.log("Servidor corriendo en http://localhost:3000"));
