const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const dotenv = require('dotenv');
dotenv.config(); // Cargar variables del archivo .env

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let users = {};  // Para almacenar el estado de los usuarios (berkas, etc.)
let adminLoggedIn = false;  // Variable para verificar si el admin ha iniciado sesión

// Middleware para servir las páginas estáticas
app.use(express.static('public'));

// Ruta para el juego
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// Ruta para la administración (con protección de login)
app.get('/admin', (req, res) => {
    if (adminLoggedIn) {
        res.sendFile(__dirname + '/public/admin.html');
    } else {
        res.send('Acceso denegado. Inicia sesión como administrador.');
    }
});

// Conexión WebSocket para gestionar el juego y la administración
wss.on('connection', (ws) => {
    console.log('Nuevo cliente conectado');

    // Recibir mensajes desde el frontend
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'register') {
                // Registrar un nuevo usuario
                if (users[data.username]) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Nombre de usuario ya existe.' }));
                } else {
                    users[data.username] = { berkas: 0, multiplier: 1, autoClickers: 0 };
                    ws.send(JSON.stringify({ type: 'success', message: 'Usuario registrado exitosamente.' }));
                }
            } else if (data.type === 'click') {
                // Procesar un click del usuario
                if (users[data.username]) {
                    users[data.username].berkas += users[data.username].multiplier;
                    ws.send(JSON.stringify({ type: 'update', berkas: users[data.username].berkas }));
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Usuario no encontrado.' }));
                }
            } else if (data.type === 'accredit' && adminLoggedIn) {
                // Acreditar Berkas a un usuario
                if (users[data.username]) {
                    users[data.username].berkas += data.amount;
                    // Enviar confirmación al administrador
                    ws.send(JSON.stringify({ type: 'accredit', username: data.username, amount: data.amount }));
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Usuario no encontrado.' }));
                }
            }
        } catch (error) {
            console.error(error);
            ws.send(JSON.stringify({ type: 'error', message: 'Error procesando mensaje.' }));
        }
    });

    ws.on('close', () => {
        console.log('Cliente desconectado');
    });
});

// Ruta para iniciar sesión como administrador
app.post('/admin-login', express.json(), (req, res) => {
    const { password } = req.body;
    if (password === process.env.ADMIN_PASSWORD) {
        adminLoggedIn = true;
        res.send({ message: 'Administrador autenticado' });
    } else {
        res.status(401).send({ message: 'Contraseña incorrecta' });
    }
});

// Usar el puerto proporcionado por Render o el puerto 3000 para desarrollo local
const PORT = process.env.PORT || 3000;

// Iniciar el servidor en el puerto
server.listen(PORT, () => {
    console.log(`Servidor iniciado en el puerto ${PORT}`);
});
