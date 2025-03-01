const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

// Almacenamiento de progreso de minería por usuario (en memoria)
const miningProgress = {};

// Función para calcular el progreso
function calculateProgress(startTime) {
    const elapsed = Date.now() - startTime;
    const totalTime = 3 * 24 * 60 * 60 * 1000; // 3 días en milisegundos
    return Math.min((elapsed / totalTime) * 100, 100);
}

// Actualizar el progreso de todos los usuarios cada segundo
setInterval(() => {
    for (const username in miningProgress) {
        const { startTime } = miningProgress[username];
        const progress = calculateProgress(startTime);

        miningProgress[username].progress = progress;

        // Si la minería ha terminado, eliminar del almacenamiento
        if (progress >= 100) {
            delete miningProgress[username];
        }
    }
}, 1000);

wss.on('connection', (ws) => {
    console.log('Cliente conectado');

    // Manejar mensajes del cliente
    ws.on('message', (message) => {
        const data = JSON.parse(message);

        if (data.action === 'startMining') {
            const { username } = data;

            // Iniciar la minería para el usuario si no existe
            if (!miningProgress[username]) {
                miningProgress[username] = {
                    startTime: Date.now(),
                    progress: 0,
                };
            }

            // Enviar el progreso actual al cliente
            ws.send(JSON.stringify({
                action: 'updateProgress',
                username,
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
                username,
                progress: 0,
            }));
        }
    });

    // Manejar la desconexión del cliente
    ws.on('close', () => {
        console.log('Cliente desconectado');
    });
});

console.log('Servidor WebSocket iniciado en ws://localhost:8080');
