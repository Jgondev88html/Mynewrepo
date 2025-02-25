const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs'); // Para manipular el sistema de archivos
const { LocalStorage } = require('node-localstorage');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const localStorage = new LocalStorage('./scratch'); // La carpeta 'scratch'
const ADMIN_PASSWORD = "whoamiroot";

// Función para eliminar y volver a crear la carpeta 'scratch' al iniciar el servidor
function resetScratchFolder() {
    const folderPath = path.join(__dirname, 'scratch');
    
    // Si la carpeta existe, la eliminamos
    if (fs.existsSync(folderPath)) {
        fs.rmdirSync(folderPath, { recursive: true });  // Elimina la carpeta y todo su contenido
        console.log("Carpeta 'scratch' eliminada.");
    }

    // Creamos la nueva carpeta 'scratch'
    fs.mkdirSync(folderPath);
    console.log("Carpeta 'scratch' creada.");
}

// Llamamos a la función cuando se inicia el servidor
resetScratchFolder();

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
            console.log("Borrando datos del servidor...");
            localStorage.clear();  // Elimina todo el localStorage del servidor
            res.json({ success: true, message: '¡Datos del servidor eliminados!' });
        } catch (err) {
            console.error("Error al borrar datos del servidor:", err);
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
            // Pérdida aleatoria con decimales entre 0.001 y 0.01
            const perdida = (Math.random() * (0.01 - 0.001) + 0.001).toFixed(3);  // Redondeado a 3 decimales
            user.berkas = Math.max(0, user.berkas - parseFloat(perdida));  // Asegurarse de que los valores no sean negativos
            console.log(`📉 ${username} perdió ${perdida} Berk`);
        }
    });
    
    localStorage.setItem('users', JSON.stringify(users));
}

setInterval(aplicarPerdidaAleatoria, 60000); // Cada 1 minuto

// Configuración del servidor
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

server.listen(3000, () => {
    console.log('🚀 Servidor activo en puerto 3000');
});
