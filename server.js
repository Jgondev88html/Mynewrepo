const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const wss = new WebSocket.Server({ port: 8080 });
const usersFilePath = path.join(__dirname, 'users.json');

// Cargar datos de usuarios desde el archivo JSON
let users = {};
if (fs.existsSync(usersFilePath)) {
    const data = fs.readFileSync(usersFilePath, 'utf8');
    users = JSON.parse(data);
}

// Función para guardar los datos de usuarios en el archivo JSON
function saveUsers() {
    fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2), 'utf8');
}

// Función para calcular el progreso
function calculateProgress(startTime) {
    const elapsed = Date.now() - startTime;
    const totalTime = 3 * 24 * 60 * 60 * 1000; // 3 días en milisegundos
    return Math.min((elapsed / totalTime) * 100, 100);
}

// Función para enviar el progreso a un cliente específico
function sendProgress(ws, username) {
    if (users[username]) {
        const progress = calculateProgress(users[username].startTime);
        users[username].progress = progress;
        users[username].lastActivity = Date.now(); // Actualizar la última actividad

        ws.send(JSON.stringify({
            action: 'updateProgress',
            username,
            progress,
        }));

        // Guardar los cambios en el archivo JSON
        saveUsers();

        // Si la minería ha terminado, eliminar del almacenamiento
        if (progress >= 100) {
            delete users[username];
            saveUsers();
        }
    }
}

// Eliminar usuarios inactivos después de 5 días
function cleanupInactiveUsers() {
    const now = Date.now();
    const fiveDaysInMs = 5 * 24 * 60 * 60 * 1000;

    for (const username in users) {
        if (now - users[username].lastActivity > fiveDaysInMs) {
            delete users[username];
        }
    }

    // Guardar los cambios en el archivo JSON
    saveUsers();
}

// Actualizar el progreso de todos los usuarios cada segundo
setInterval(() => {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            for (const username in users) {
                sendProgress(client, username);
            }
        }
    });
}, 1000);

// Limpiar usuarios inactivos cada hora
setInterval(cleanupInactiveUsers, 60 * 60 * 1000);

wss.on('connection', (ws) => {
    console.log('Cliente conectado');

    // Manejar mensajes del cliente
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.action === 'startMining' && data.username) {
                const { username } = data;

                // Iniciar la minería para el usuario si no existe
                if (!users[username]) {
                    users[username] = {
                        startTime: Date.now(),
                        progress: 0,
                        lastActivity: Date.now(),
                    };
                }

                // Enviar el progreso actual al cliente
                sendProgress(ws, username);
            } else if (data.action === 'restartMining' && data.username) {
                const { username } = data;

                // Reiniciar la minería para el usuario
                users[username] = {
                    startTime: Date.now(),
                    progress: 0,
                    lastActivity: Date.now(),
                };

                // Enviar el progreso actual al cliente
                sendProgress(ws, username);
            } else {
                console.error('Mensaje no válido recibido:', data);
            }
        } catch (error) {
            console.error('Error al procesar el mensaje:', error);
        }
    });

    // Manejar la desconexión del cliente
    ws.on('close', () => {
        console.log('Cliente desconectado');
    });
});

console.log('Servidor WebSocket iniciado en ws://localhost:8080');
