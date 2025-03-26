const express = require('express');
const { IgApiClient } = require('instagram-private-api');
const bodyParser = require('body-parser');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración básica
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Crear servidor HTTP
const server = app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

// Configurar WebSocket
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('Nuevo cliente conectado via WebSocket');
    
    ws.on('message', (message) => {
        console.log('Mensaje recibido:', message);
    });
    
    ws.on('close', () => {
        console.log('Cliente desconectado');
    });
});

// Ruta para el login
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ message: 'Usuario y contraseña son requeridos' });
    }
    
    try {
        const ig = new IgApiClient();
        
        // Configuración básica del cliente
        ig.state.generateDevice(username);
        
        // Opcional: Configurar proxy si es necesario
        // ig.request.defaults.proxy = 'http://proxy-url:port';
        
        // Iniciar sesión con Instagram
        await ig.account.login(username, password);
        
        // Notificar a los clientes WebSocket sobre el login exitoso
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'login',
                    username,
                    timestamp: new Date().toISOString()
                }));
            }
        });
        
        // Obtener información del usuario
        const user = await ig.account.currentUser();
        
        res.json({
            success: true,
            user: {
                id: user.pk,
                username: user.username,
                fullName: user.full_name,
                profilePic: user.profile_pic_url
            }
        });
    } catch (error) {
        console.error('Error en login:', error);
        
        let errorMessage = 'Error al iniciar sesión';
        if (error.message.includes('password')) {
            errorMessage = 'Contraseña incorrecta';
        } else if (error.message.includes('username')) {
            errorMessage = 'Usuario no encontrado';
        } else if (error.message.includes('challenge')) {
            errorMessage = 'Se requiere verificación adicional. Por favor, revisa la app de Instagram.';
        }
        
        res.status(401).json({ 
            success: false,
            message: errorMessage
        });
    }
});

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
