const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const { LocalStorage } = require('node-localstorage');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const localStorage = new LocalStorage('./scratch');
const ADMIN_PASSWORD = "whoamiroot";

app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (ws) => {
    console.log('Cliente conectado');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Mensaje recibido:', data);

            // Registro de usuarios mejorado
            if (data.type === 'register_user') {
                const username = data.username.trim();
                const users = JSON.parse(localStorage.getItem('users') || '{}');

                if (!username) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: '❌ El nombre no puede estar vacío'
                    }));
                    return;
                }

                if (users[username]) {
                    console.log(`Intento de registro fallido: ${username} ya existe`);
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: `❌ ${username} ya está registrado. Usa otro nombre.`
                    }));
                    return;
                }

                // Crear nuevo usuario
                users[username] = {
                    berkas: 0,
                    multiplier: 1,
                    autoClickers: 0,
                    registrationDate: new Date().toISOString(),
                    lastLogin: new Date().toISOString()
                };

                localStorage.setItem('users', JSON.stringify(users));
                console.log(`✅ Nuevo usuario: ${username}`);

                ws.send(JSON.stringify({
                    type: 'success',
                    message: `¡Bienvenido ${username}!`,
                    username: username
                }));
            }

            // Recarga administrativa
            if (data.type === 'admin_recharge') {
                if (data.password !== ADMIN_PASSWORD) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: '🔒 Contraseña incorrecta'
                    }));
                    return;
                }

                const users = JSON.parse(localStorage.getItem('users') || {});
                if (!users[data.username]) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: '❌ Usuario no encontrado'
                    }));
                    return;
                }

                const amount = parseInt(data.amount);
                users[data.username].berkas += amount;
                localStorage.setItem('users', JSON.stringify(users));

                // Notificar a todos los clientes
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'update_berkas',
                            username: data.username,
                            berkas: users[data.username].berkas
                        }));
                    }
                });

                ws.send(JSON.stringify({
                    type: 'success',
                    message: `✅ Recargados ${amount} Berk a ${data.username}`,
                    berkas: users[data.username].berkas
                }));
            }
        } catch (error) {
            console.error('Error:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: '⚠️ Error en el servidor'
            }));
        }
    });

    // Ruta para borrar todos los datos en el servidor
app.post('/clear-server-data', (req, res) => {
    try {
        localStorage.clear();  // Elimina todo el localStorage del servidor
        res.json({ success: true, message: '¡Datos del servidor eliminados!' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error al borrar los datos del servidor' });
    }
});

    ws.on('close', () => {
        console.log('Cliente desconectado');
    });
});

// Sistema de pérdida de Berk
function aplicarPerdidaAleatoria() {
    const users = JSON.parse(localStorage.getItem('users') || {});
    
    Object.entries(users).forEach(([username, user]) => {
        if (user.berkas > 0) {
            const perdida = Math.floor(Math.random() * 10) + 1;
            user.berkas = Math.max(0, user.berkas - perdida);
            console.log(`📉 ${username} perdió ${perdida} Berk`);
        }
    });
    
    localStorage.setItem('users', JSON.stringify(users));
}

setInterval(aplicarPerdidaAleatoria, 60000); // Cada 1 minutos

// Configuración del servidor
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

server.listen(3000, () => {
    console.log('🚀 Servidor activo en puerto 3000');
});
