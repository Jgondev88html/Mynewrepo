const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const { LocalStorage } = require('node-localstorage');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const localStorage = new LocalStorage('./scratch');  // Simulamos el localStorage en el servidor

const ADMIN_PASSWORD = "123";  // Contraseña del administrador para recargar Berk

// Servir archivos estáticos (frontend)
app.use(express.static(path.join(__dirname, 'public')));

// WebSocket: Manejo de la comunicación
wss.on('connection', (ws) => {
    console.log('Cliente conectado');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Mensaje recibido:', data);

            // Verificar tipo de mensaje
            if (data.type === 'register_user') {
                const users = JSON.parse(localStorage.getItem('users') || '{}');
                console.log('Usuarios almacenados en localStorage:', users);  // Depuración
                if (!users[data.username]) {
                    users[data.username] = {
                        berkas: 0,
                        multiplier: 1,
                        autoClickers: 0
                    };
                    localStorage.setItem('users', JSON.stringify(users));
                    ws.send(JSON.stringify({
                        type: 'success',
                        message: 'Usuario registrado correctamente'
                    }));
                } else {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'El usuario ya existe'
                    }));
                }
            }

            // Recarga de Berk por parte del administrador
            if (data.type === 'admin_recharge') {
                // Verificar contraseña del administrador
                if (data.password !== ADMIN_PASSWORD) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Contraseña de administrador incorrecta'
                    }));
                    return;
                }

                // Buscar usuario y recargar Berk
                const users = JSON.parse(localStorage.getItem('users') || '{}');
                console.log('Usuarios en el servidor:', users);  // Depuración
                if (!users[data.username]) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Usuario no encontrado'
                    }));
                    return;
                }

                // Recargar Berk
                users[data.username].berkas += parseInt(data.amount);
                localStorage.setItem('users', JSON.stringify(users));

                console.log(`Recarga exitosa: ${data.amount} Berk a ${data.username}`);

                // Enviar la actualización de Berk a todos los clientes conectados
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({
                            type: 'update_berkas',
                            username: data.username,
                            berkas: users[data.username].berkas
                        }));
                    }
                });

                // Responder al administrador que la recarga fue exitosa
                ws.send(JSON.stringify({
                    type: 'success',
                    message: `Recarga exitosa: ${data.amount} Berk a ${data.username}`,
                    berkas: users[data.username].berkas,
                    username: data.username
                }));
            }
        } catch (error) {
            console.error('Error procesando mensaje:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Error en el servidor'
            }));
        }
    });

    ws.on('close', () => {
        console.log('Cliente desconectado');
    });
});

// Servir el contenido del juego
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Iniciar el servidor
server.listen(3000, () => {
    console.log('Servidor escuchando en http://localhost:3000');
});
