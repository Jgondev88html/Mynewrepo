const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
const session = require('express-session');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

let users = {}; // Almacenamiento temporal de usuarios

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: 'pixelrunner_secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 30 * 60 * 1000 } // 30 minutos
}));

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        const data = JSON.parse(message);

        if (data.type === 'login') {
            const { username } = data;
            if (!username) {
                return ws.send(JSON.stringify({ type: 'error', message: 'Nombre de usuario requerido' }));
            }
            if (!users[username]) {
                users[username] = { coins: 0, lives: 5 };
            }
            ws.username = username;
            ws.send(JSON.stringify({ type: 'login-success', user: users[username] }));
        }

        if (data.type === 'admin-login') {
            const { password } = data;
            if (password === 'admin123') {
                ws.isAdmin = true;
                ws.send(JSON.stringify({ type: 'admin-success', message: 'Autenticado como admin' }));
            } else {
                ws.send(JSON.stringify({ type: 'error', message: 'Contraseña incorrecta' }));
            }
        }

        if (data.type === 'add-lives' && ws.isAdmin) {
            const { username } = data;
            if (users[username]) {
                users[username].lives = 5;
                ws.send(JSON.stringify({ type: 'update-success', message: `Vidas recargadas para ${username}` }));
            } else {
                ws.send(JSON.stringify({ type: 'error', message: 'Usuario no encontrado' }));
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
