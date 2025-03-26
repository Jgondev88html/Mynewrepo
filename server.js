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

// Clientes Instagram por conexión WS
const igClients = new Map();

wss.on('connection', (ws) => {
    console.log('Nuevo cliente conectado via WebSocket');
    const connectionId = Date.now().toString();
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'login') {
                await handleLogin(ws, connectionId, data);
            } 
            else if (data.type === 'getChallengeOptions') {
                ws.send(JSON.stringify({
                    type: 'challengeOptions',
                    options: ['email', 'sms'] // Instagram suele ofrecer estas opciones
                }));
            } 
            else if (data.type === 'selectChallengeMethod') {
                await handleChallengeMethod(ws, connectionId, data);
            } 
            else if (data.type === 'submitChallengeCode') {
                await handleChallengeCode(ws, connectionId, data);
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
        // Limpiar cliente Instagram asociado
        if (igClients.has(connectionId)) {
            igClients.delete(connectionId);
        }
    });
    
    // Mensaje de bienvenida
    ws.send(JSON.stringify({
        type: 'notification',
        message: 'Conectado al servidor',
        level: 'success'
    }));
});

async function handleLogin(ws, connectionId, data) {
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
        ig.state.generateDevice(data.username);
        
        // Guardar instancia de ig para esta conexión
        igClients.set(connectionId, ig);
        
        // Intentar login
        await ig.account.login(data.username, data.password);
        
        // Si llega aquí, el login fue exitoso
        const user = await ig.account.currentUser();
        
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
    } catch (error) {
        console.error('Error en login:', error);
        
        if (error.message.includes('challenge_required')) {
            // Manejar challenge
            const challengeError = JSON.parse(error.json.challenge?.json || '{}');
            ws.send(JSON.stringify({
                type: 'challengeRequired',
                challengeData: challengeError,
                message: 'Se requiere verificación adicional'
            }));
        } else {
            let errorMessage = 'Error al iniciar sesión';
            if (error.message.includes('password')) errorMessage = 'Contraseña incorrecta';
            if (error.message.includes('username')) errorMessage = 'Usuario no encontrado';
            
            ws.send(JSON.stringify({ 
                type: 'loginStatus',
                success: false,
                message: errorMessage
            }));
        }
    }
}

async function handleChallengeMethod(ws, connectionId, data) {
    try {
        const ig = igClients.get(connectionId);
        if (!ig) throw new Error('No hay cliente Instagram asociado');
        
        // Seleccionar método de challenge
        await ig.challenge.selectVerifyMethod(data.method);
        
        ws.send(JSON.stringify({
            type: 'challengeCodeSent',
            method: data.method,
            message: `Código enviado por ${data.method}`
        }));
    } catch (error) {
        console.error('Error al seleccionar método:', error);
        ws.send(JSON.stringify({
            type: 'loginStatus',
            success: false,
            message: 'Error al solicitar código de verificación'
        }));
    }
}

async function handleChallengeCode(ws, connectionId, data) {
    try {
        const ig = igClients.get(connectionId);
        if (!ig) throw new Error('No hay cliente Instagram asociado');
        
        // Enviar código de verificación
        await ig.challenge.sendSecurityCode(data.code);
        
        // Si llega aquí, el código fue aceptado
        const user = await ig.account.currentUser();
        
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
    } catch (error) {
        console.error('Error al verificar código:', error);
        ws.send(JSON.stringify({
            type: 'loginStatus',
            success: false,
            message: error.message.includes('invalid') 
                ? 'Código inválido. Intenta nuevamente.' 
                : 'Error al verificar código'
        }));
    }
}

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
server.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

// Manejar cierre limpio
process.on('SIGINT', () => {
    console.log('Cerrando servidor...');
    wss.clients.forEach(client => client.close());
    wss.close();
    server.close(() => {
        process.exit(0);
    });
});
