const express = require("express");
const WebSocket = require("ws");
const { IgApiClient } = require("instagram-private-api");
const http = require("http");

// Configura Instagram
const ig = new IgApiClient();
const IG_USERNAME = "TU_USUARIO_DE_INSTAGRAM";
const IG_PASSWORD = "TU_CONTRASEÑA";

// Fake DB (en producción usa MongoDB/MySQL)
let users = [];
let tasks = [
    { userId: "user1", username: "usuario_popular1", reward: 10 },
    { userId: "user2", username: "usuario_popular2", reward: 10 },
    { userId: "user3", username: "usuario_popular3", reward: 15 }
];

// Inicia Express y WebSocket
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware para servir el frontend
app.use(express.static("public"));

// Conectar a Instagram
(async () => {
    ig.state.generateDevice(IG_USERNAME);
    await ig.account.login(IG_USERNAME, IG_PASSWORD);
    console.log("✅ Conectado a Instagram");
})();

// WebSocket Connection
wss.on("connection", (ws) => {
    console.log("🔌 Nuevo cliente conectado");

    ws.on("message", async (message) => {
        const data = JSON.parse(message);

        switch (data.type) {
            case "login":
                try {
                    const userInfo = await ig.user.searchExact(data.username);
                    const user = {
                        id: Date.now().toString(),
                        instagramUsername: userInfo.username,
                        profilePic: userInfo.profile_pic_url,
                        coins: 0,
                        followers: userInfo.follower_count
                    };
                    users.push(user);
                    ws.send(JSON.stringify({
                        type: "login_success",
                        user
                    }));
                    // Enviar tareas disponibles
                    ws.send(JSON.stringify({
                        type: "new_tasks",
                        tasks
                    }));
                } catch (error) {
                    ws.send(JSON.stringify({
                        type: "error",
                        message: "Usuario no encontrado"
                    }));
                }
                break;

            case "follow_user":
                try {
                    // Simular seguir al usuario (en producción usar ig.friendship.create)
                    const currentUser = users.find(u => u.id === data.currentUserId);
                    const task = tasks.find(t => t.userId === data.targetUserId);
                    
                    if (currentUser && task) {
                        currentUser.coins += task.reward;
                        ws.send(JSON.stringify({
                            type: "update_user",
                            user: currentUser
                        }));
                    }
                } catch (error) {
                    console.error("Error al seguir usuario:", error);
                }
                break;

            case "buy_followers":
                try {
                    const user = users.find(u => u.id === data.userId);
                    if (user && user.coins >= 50) {
                        user.coins -= 50;
                        user.followers += 100;
                        ws.send(JSON.stringify({
                            type: "update_user",
                            user
                        }));
                    }
                } catch (error) {
                    console.error("Error comprando seguidores:", error);
                }
                break;
        }
    });
});

// Iniciar servidor
server.listen(3000, () => {
    console.log("🚀 Servidor corriendo en http://localhost:3000");
});
