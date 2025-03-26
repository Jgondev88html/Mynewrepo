const express = require('express');
const { IgApiClient } = require('instagram-private-api');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración básica
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Crear servidor HTTP
const server = http.createServer(app);

// Configurar WebSocket Server
const wss = new WebSocket.Server({ server });

// Mapa para almacenar las resoluciones de promesas por cliente
const pendingRequests = new Map();

wss.on('connection', (ws) => {
    console.log('Nuevo cliente conectado via WebSocket');
    
    // Generar un ID único para esta conexión
    const connectionId = Date.now().toString();
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Mensaje recibido:', data);
            
            if (data.type === 'login') {
                // Validar que tenga los datos necesarios
                if (!data.username || !data.password) {
                    ws.send(JSON.stringify({
                        type: 'loginStatus',
                        success: false,
                        message: 'Usuario y contraseña son requeridos'
                    }));
                    return;
                }
                
                try {
                    const ig = new IgApiClient();
                    
                    // Configuración básica del cliente
                    ig.state.generateDevice(data.username);
                    
                    // Iniciar sesión con Instagram
                    await ig.account.login(data.username, data.password);
                    
                    // Obtener información del usuario
                    const user = await ig.account.currentUser();
                    
                    // Enviar respuesta de éxito
                    ws.send(JSON.stringify({
                        type: 'loginStatus',
                        success: true,
                        user: {
                            id: user.pk,
                            username: user.username,
                            fullName: user.full_name,
                            profilePic: user.profile_pic_url
                        }
                    }));
                    
                    console.log(`Usuario ${data.username} autenticado correctamente`);
                } catch (error) {
                    console.error('Error en login:', error);
                    
                    let errorMessage = 'Error al iniciar sesión';
                    if (error.message.includes('password')) {
                        errorMessage = 'Contraseña incorrecta';
                    } else if (error.message.includes('username')) {
                        errorMessage = 'Usuario no encontrado';
                    } else if (error.message.includes('challenge')) {
                        // Manejar verificación de dos pasos
                        const challengeUrl = `https://www.instagram.com/challenge/?next=/`;
                        ws.send(JSON.stringify({
                            type: 'challengeRequired',
                            url: challengeUrl,
                            message: 'Se requiere verificación adicional'
                        }));
                        return;
                    }
                    
                    ws.send(JSON.stringify({ 
                        type: 'loginStatus',
                        success: false,
                        message: errorMessage
                    }));
                }
            }
        } catch (error) {
            console.error('Error al procesar mensaje:', error);
            ws.send(JSON.stringify({
                type: 'notification',
                message: 'Error interno del servidor',
                level: 'error'
            }));
        }
    });
    
    ws.on('close', () => {
        console.log('Cliente desconectado');
        // Limpiar cualquier promesa pendiente para este cliente
        if (pendingRequests.has(connectionId)) {
            clearTimeout(pendingRequests.get(connectionId).timeout);
            pendingRequests.delete(connectionId);
        }
    });
    
    // Enviar mensaje de bienvenida
    ws.send(JSON.stringify({
        type: 'notification',
        message: 'Conectado al servidor. Puede iniciar sesión.',
        level: 'success'
    }));
});

// Ruta para el login via HTTP (opcional)
app.post('/login', async (req, res) => {
    // ... (mismo código que antes, opcional)
});

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
server.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

// Manejar cierre limpio del servidor
process.on('SIGINT', () => {
    console.log('Cerrando servidor...');
    wss.clients.forEach(client => client.close());
    wss.close();
    server.close(() => {
        process.exit(0);
    });
});
