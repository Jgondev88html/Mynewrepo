const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

// Almacenamiento de progreso de minería por usuario (en memoria)
const miningProgress = {};

wss.on('connection', (ws) => {
    console.log('Cliente conectado');

    // Manejar mensajes del cliente
    ws.on('message', (message) => {
        const data = JSON.parse(message);

        if (data.action === 'startMining') {
            const { username } = data;

            // Iniciar la minería para el usuario
            if (!miningProgress[username]) {
                miningProgress[username] = {
                    startTime: Date.now(),
                    progress: 0,
                };
            }

            // Enviar el progreso actual al cliente
            ws.send(JSON.stringify({
                action: 'updateProgress',
                progress: miningProgress[username].progress,
            }));
        } else if (data.action === 'restartMining') {
            const { username } = data;

            // Reiniciar la minería para el usuario
            miningProgress[username] = {
                startTime: Date.now(),
                progress: 0,
            };

            // Enviar el progreso actual al cliente
            ws.send(JSON.stringify({
                action: 'updateProgress',
                progress: 0,
            }));
        }
    });

    // Enviar actualizaciones de progreso cada segundo
    const interval = setInterval(() => {
        for (const username in miningProgress) {
            const startTime = miningProgress[username].startTime;
            const elapsed = Date.now() - startTime;
            const totalTime = 3 * 24 * 60 * 60 * 1000; // 3 días en milisegundos
            const progress = Math.min((elapsed / totalTime) * 100, 100);

            miningProgress[username].progress = progress;

            // Notificar a todos los clientes conectados
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        action: 'updateProgress',
                        username,
                        progress,
                    }));
                }
            });

            // Si la minería ha terminado, eliminar del almacenamiento
            if (progress >= 100) {
                delete miningProgress[username];
            }
        }
    }, 1000);

    // Limpiar el intervalo cuando el cliente se desconecta
    ws.on('close', () => {
        clearInterval(interval);
        console.log('Cliente desconectado');
    });
});

console.log('Servidor WebSocket iniciado en ws://localhost:8080');
