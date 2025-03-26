require('dotenv').config();
const WebSocket = require('ws');
const { IgApiClient, IgCheckpointError } = require('instagram-private-api');

const wss = new WebSocket.Server({ port: 3000 });
const ig = new IgApiClient();

// Configurar dispositivo (necesario para la API)
ig.state.generateDevice(process.env.IG_USERNAME);

wss.on('connection', (ws) => {
    console.log('✅ Cliente conectado');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('📩 Mensaje recibido:', data.type);

            switch (data.type) {
                case 'login':
                    await handleLogin(ws, data);
                    break;

                case 'submit_verification_code':
                    await handleVerification(ws, data);
                    break;

                case 'follow_user':
                    await handleFollow(ws, data);
                    break;

                default:
                    ws.send(JSON.stringify({ error: 'Acción no válida' }));
            }
        } catch (error) {
            console.error('❌ Error:', error);
            ws.send(JSON.stringify({ error: error.message }));
        }
    });
});

// 🔐 Manejar inicio de sesión
async function handleLogin(ws, data) {
    try {
        await ig.account.login(data.username, data.password);

        // Si el login es exitoso
        const user = await ig.account.currentUser();
        ws.send(JSON.stringify({
            type: 'login_success',
            user: {
                username: user.username,
                fullName: user.full_name,
                profilePic: user.profile_pic_url,
                followers: user.follower_count,
            }
        }));

    } catch (error) {
        if (error instanceof IgCheckpointError) {
            // Instagram pide verificación (2FA o email/SMS)
            ws.send(JSON.stringify({
                type: 'verification_required',
                message: 'Instagram requiere verificación',
                checkpointUrl: error.checkpoint_url,
            }));
        } else {
            ws.send(JSON.stringify({ error: error.message }));
        }
    }
}

// 🔑 Manejar código de verificación (2FA/Checkpoint)
async function handleVerification(ws, data) {
    try {
        // Enviar el código de verificación a Instagram
        await ig.challenge.sendSecurityCode(data.code);

        // Si la verificación es exitosa
        ws.send(JSON.stringify({
            type: 'verification_success',
            message: '¡Cuenta verificada!',
        }));

    } catch (error) {
        ws.send(JSON.stringify({ error: 'Código incorrecto' }));
    }
}

// ➕ Seguir a un usuario
async function handleFollow(ws, data) {
    try {
        const userId = await ig.user.getIdByUsername(data.targetUsername);
        await ig.friendship.create(userId);  // ¡Seguir al usuario!

        ws.send(JSON.stringify({
            type: 'follow_success',
            targetUsername: data.targetUsername,
        }));

    } catch (error) {
        ws.send(JSON.stringify({ error: 'No se pudo seguir al usuario' }));
    }
}

console.log('🚀 Servidor WebSocket en ws://localhost:3000');
