// server.js (versión simplificada)
const express = require("express");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
const server = require("http").createServer(app);
const wss = new WebSocket.Server({ server });

// Almacenamiento en memoria
let users = {};

// Configuración básica
app.use(cors());
app.use(express.json());

wss.on("connection", (ws) => {
  ws.on("message", (message) => {
    const data = JSON.parse(message);

    // Lógica del juego (ejemplo)
    if (data.type === "register") {
      users[data.username] = { coins: 0, attempts: 3 };
      ws.send(JSON.stringify({ type: "success" }));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
