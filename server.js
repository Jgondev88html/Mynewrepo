const express = require("express");
const session = require("express-session");
const WebSocket = require("ws");
const cors = require("cors");
const RedisStore = require("connect-redis").default;
const redis = require("redis");

// Configuración inicial
const app = express();
const server = require("http").createServer(app);
const wss = new WebSocket.Server({ server });

// Configuración de Redis (para producción en Render)
const redisClient = redis.createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
  legacyMode: true // Necesario para versiones recientes de Redis
});

// Manejo de eventos de Redis
redisClient.on("connect", () => console.log("✅ Conectado a Redis"))
          .on("error", (err) => console.error("❌ Error de Redis:", err));

// Configuración de almacenamiento de sesiones
const redisStore = new RedisStore({
  client: redisClient,
  prefix: "session:",
  ttl: 1800 // 30 minutos
});

// Middlewares
app.use(cors({
  origin: "*", // Permite cualquier origen (ajusta en producción)
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    store: redisStore,
    secret: process.env.SESSION_SECRET || "clave_secreta_dev",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 30 * 60 * 1000 // 30 minutos
    }
  })
);

// Almacenamiento en memoria para el juego
const gameState = {
  users: new Map(), // <username, { coins: number, attempts: number }>
  leaderboard: new Map()
};

// ================== RUTAS DE API ================== //
app.get("/health", (req, res) => res.sendStatus(200));

// Administración
app.post("/admin/login", (req, res) => {
  if (req.body.password === (process.env.ADMIN_PASSWORD || "admin123")) {
    req.session.admin = true;
    return res.json({ success: true });
  }
  res.status(401).json({ success: false });
});

app.post("/admin/recharge", (req, res) => {
  if (!req.session.admin) return res.sendStatus(403);
  
  const user = gameState.users.get(req.body.username);
  if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
  
  user.attempts = 3;
  res.json({ success: true });
});

// ================== WEBSOCKETS ================== //
wss.on("connection", (ws) => {
  console.log("🔌 Nueva conexión WebSocket");

  ws.on("message", async (rawData) => {
    try {
      const data = JSON.parse(rawData);
      const user = gameState.users.get(data.username);

      switch (data.type) {
        case "register":
          if (gameState.users.has(data.username)) {
            return ws.send(JSON.stringify({ 
              type: "error", 
              message: "Nombre ya en uso" 
            }));
          }
          
          gameState.users.set(data.username, { 
            coins: 0, 
            attempts: 3 
          });
          
          ws.send(JSON.stringify({
            type: "session",
            coins: 0,
            attempts: 3
          }));
          break;

        case "play":
          if (!user || user.attempts <= 0) {
            return ws.send(JSON.stringify({
              type: "error",
              message: "Sin intentos disponibles"
            }));
          }

          const result = Math.random() > 0.5 ? 10 : -5;
          user.coins += result;
          user.attempts--;
          
          ws.send(JSON.stringify({
            type: "update",
            coins: user.coins,
            attempts: user.attempts,
            result
          }));
          break;

        case "withdraw":
          if (user.coins < 250) {
            return ws.send(JSON.stringify({
              type: "error",
              message: "Mínimo 250 monedas"
            }));
          }
          
          user.coins -= 250;
          ws.send(JSON.stringify({
            type: "update",
            coins: user.coins
          }));
          break;
      }
    } catch (error) {
      console.error("Error en WebSocket:", error);
      ws.send(JSON.stringify({
        type: "error",
        message: "Error interno del servidor"
      }));
    }
  });

  ws.on("close", () => console.log("🔌 Conexión WebSocket cerrada"));
});

// ================== INICIO DEL SERVIDOR ================== //
const PORT = process.env.PORT || 3000;

(async () => {
  await redisClient.connect();
  server.listen(PORT, () => {
    console.log(`
    🚀 Servidor listo en puerto ${PORT}
    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    Modo: ${process.env.NODE_ENV || "development"}
    Redis: ${redisClient.isReady ? "conectado" : "desconectado"}
    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    `);
  });
})();
