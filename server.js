const express = require('express');
const { IgApiClient } = require('instagram-private-api');
const { sample } = require('lodash');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configuración del cliente de Instagram
const ig = new IgApiClient();

// Seguimiento de sesiones de usuario
const userSessions = {};
const activeSockets = {};

// Servidor WebSocket
const server = app.listen(PORT, () => {
    console.log(`Servidor ejecutándose en el puerto ${PORT}`);
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    console.log('Nueva conexión WebSocket');
    
    let username = '';
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'auth' && data.username) {
                username = data.username;
                activeSockets[username] = ws;
                console.log(`Usuario autenticado via WS: ${username}`);
                
                // Enviar datos iniciales
                sendInitialData(ws, username);
            }
        } catch (error) {
            console.error('Error procesando mensaje WS:', error);
        }
    });
    
    // Enviar actualizaciones periódicas
    const interval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN && username) {
            sendFollowerUpdate(ws, username);
        }
    }, 5000);
    
    ws.on('close', () => {
        clearInterval(interval);
        if (username && activeSockets[username] === ws) {
            delete activeSockets[username];
        }
        console.log('Conexión WebSocket cerrada');
    });
    
    ws.on('error', (error) => {
        console.error('Error en WebSocket:', error);
    });
});

function sendInitialData(ws, username) {
    if (userSessions[username]) {
        const session = userSessions[username];
        const data = {
            type: 'followerUpdate',
            data: {
                currentFollowers: session.followersCount,
                newFollowers: 0,
                growthRate: 0,
                recentFollowers: []
            }
        };
        ws.send(JSON.stringify(data));
    }
}

function sendFollowerUpdate(ws, username) {
    if (userSessions[username]) {
        const session = userSessions[username];
        const newFollowers = Math.floor(Math.random() * 10);
        const growthRate = (Math.random() * 2).toFixed(2);
        
        const recentFollowers = Array.from({ length: 5 }, (_, i) => ({
            username: `usuario_${Math.floor(Math.random() * 10000)}`,
            avatar: `https://i.pravatar.cc/150?img=${Math.floor(Math.random() * 70)}`,
            date: new Date(),
            status: sample(['active', 'pending', 'inactive'])
        }));
        
        const data = {
            type: 'followerUpdate',
            data: {
                currentFollowers: session.followersCount + newFollowers,
                newFollowers,
                growthRate,
                recentFollowers
            }
        };
        
        ws.send(JSON.stringify(data));
        
        // Actualizar contador en sesión
        userSessions[username].followersCount += newFollowers;
    }
}

// Endpoint de inicio de sesión
app.post('/api/login', async (req, res) => {
    const { username, password, challengeCode } = req.body;
    
    try {
        ig.state.generateDevice(username);
        
        // Si hay código de verificación, intentar completar el desafío
        if (challengeCode) {
            const session = userSessions[username];
            if (!session || !session.challenge) {
                return res.status(400).json({ 
                    success: false,
                    message: 'No hay un desafío activo para este usuario' 
                });
            }
            
            await ig.challenge.sendSecurityCode(challengeCode);
            delete userSessions[username].challenge;
        }
        
        // Iniciar sesión en Instagram
        await ig.account.login(username, password);
        
        // Obtener información del usuario
        const user = await ig.account.currentUser();
        const followersFeed = ig.feed.accountFollowers(user.pk);
        const followers = await followersFeed.items();
        
        // Almacenar sesión
        userSessions[username] = {
            igClient: ig,
            followersCount: followers.length,
            lastLogin: new Date()
        };
        
        res.json({
            success: true,
            user: {
                username: user.username,
                fullName: user.full_name,
                followersCount: followers.length,
                profilePic: user.profile_pic_url,
                targetFollowers: 1000
            }
        });
        
    } catch (error) {
        if (error.name === 'IgCheckpointError') {
            // Se requiere verificación
            const challenge = await ig.challenge.auto(true);
            
            userSessions[username] = {
                challenge,
                challengeType: challenge.type
            };
            
            return res.json({
                success: false,
                challengeRequired: true,
                challengeType: challenge.type,
                message: 'Se requiere verificación de seguridad'
            });
        }
        
        console.error('Error al iniciar sesión en Instagram:', error);
        res.status(400).json({ 
            success: false,
            message: error.message || 'Error al iniciar sesión en Instagram' 
        });
    }
});

// Endpoint para iniciar campaña
app.post('/api/startCampaign', async (req, res) => {
    try {
        // Simular inicio de campaña
        res.json({ 
            success: true,
            message: 'Campaña de seguidores iniciada con éxito'
        });
        
        // Notificar a todos los clientes via WebSocket
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'notification',
                    message: 'Campaña de seguidores iniciada'
                }));
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error al iniciar la campaña'
        });
    }
});

// Servir el frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
