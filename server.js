const express = require("express");
const session = require("express-session");
const WebSocket = require("ws");
const cors = require("cors");
const RedisStore = require('connect-redis')(session);
const redis = require('redis');

const app = express();
const server = require("http").createServer(app);
const wss = new WebSocket.Server({ server });

const redisClient = redis.createClient({
  host: 'localhost',  // O la URL de tu servidor Redis (en Render usa el host proporcionado por Render)
  port: 6379          // Puerto predeterminado de Redis
});

app.use(express.json());
app.use(cors());
app.use(
  session({
    store: new RedisStore({ client: redisClient }),
    secret: "clave_secreta",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 30 * 60 * 1000 }, // 30 minutos
  })
);

let users = {}; // Almacenamiento en memoria de usuarios y sus intentos

// Verificar login del administrador
app.post("/admin/login", (req, res) => {
  const { password } = req.body;
  if (password === "admin123") {
    req.session.admin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: "Contraseña incorrecta" });
  }
});

// Verificar si la sesión del administrador está activa
app.get("/admin/session", (req, res) => {
  res.json({ isAdmin: req.session.admin || false });
});

// Cerrar sesión del administrador
app.post("/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// Recargar intentos de un usuario
app.post("/admin/recharge", (req, res) => {
  if (!req.session.admin) {
    return res.status(403).json({ message: "Acceso denegado" });
  }
  const { username } = req.body;
  if (users[username]) {
    users[username].attempts = 3;
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, message: "Usuario no encontrado" });
  }
});

// Manejo de WebSockets
wss.on("connection", (ws) => {
  ws.on("message", (message) => {
    const data = JSON.parse(message);

    if (data.type === "register") {
      if (users[data.username]) {
        ws.send(JSON.stringify({ type: "error", message: "Nombre de usuario ya en uso" }));
      } else {
        users[data.username] = { coins: 0, attempts: 3 };
        ws.send(JSON.stringify({ type: "success", message: "Registro exitoso" }));
      }
    }

    if (data.type === "play") {
      const user = users[data.username];
      if (user && user.attempts > 0) {
        const result = Math.random() > 0.5 ? 10 : -5; // Ganar o perder monedas
        user.coins += result;
        user.attempts -= 1;

        ws.send(JSON.stringify({ type: "update", coins: user.coins, result }));
      } else {
        ws.send(JSON.stringify({ type: "error", message: "No tienes más intentos disponibles" }));
      }
    }
  });
});

server.listen(3000, () => console.log("Servidor corriendo en el puerto 3000"));
