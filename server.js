const express = require('express');
const { IgApiClient } = require('instagram-private-api');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

// Configuración CORS (acepta cualquier origen)
app.use(cors());
app.use(express.json());

// Cliente Instagram
const ig = new IgApiClient();
const userSessions = {};
const activeSockets = {};

// Servidor HTTP
const server = app.listen(PORT, () => {
  console.log(`✅ Servidor API en puerto ${PORT}`);
});

// WebSocket Server
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws) => {
  console.log('🔌 Nueva conexión WebSocket');

  ws.on('message', (message) => {
    try {
      const { type, username } = JSON.parse(message);
      if (type === 'auth' && username) {
        activeSockets[username] = ws;
        console.log(`🔑 Usuario autenticado en WS: ${username}`);
        sendInitialData(username);
      }
    } catch (error) {
      console.error('❌ Error en WebSocket:', error);
    }
  });

  ws.on('close', () => {
    console.log('❌ Conexión WS cerrada');
  });
});

// Endpoint de Login
app.post('/api/login', async (req, res) => {
  const { username, password, challengeCode } = req.body;

  // Validación básica
  if (!username || !password) {
    return res.status(400).json({ 
      success: false, 
      message: 'Usuario y contraseña son requeridos.' 
    });
  }

  try {
    ig.state.generateDevice(username);

    // Manejo de código de verificación (2FA)
    if (challengeCode) {
      await handleChallengeCode(username, challengeCode);
    }

    // Login en Instagram
    await ig.account.login(username, password);
    const user = await getUserData(username);

    // Respuesta exitosa
    res.json({
      success: true,
      user: {
        username: user.username,
        followersCount: user.followersCount,
        profilePic: user.profile_pic_url
      }
    });

  } catch (error) {
    handleLoginError(error, username, res);
  }
});

// Endpoint para iniciar campaña
app.post('/api/start-campaign', async (req, res) => {
  try {
    // Simulación de campaña (aquí iría tu lógica real)
    broadcastUpdate('¡Campaña iniciada! Nuevos seguidores en camino...');
    
    res.json({ 
      success: true, 
      message: '🚀 Campaña de crecimiento iniciada con éxito.' 
    });

  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Error al iniciar la campaña.' 
    });
  }
});

// --- Funciones de apoyo ---

async function handleChallengeCode(username, code) {
  const session = userSessions[username];
  if (!session?.challenge) throw new Error('No hay un desafío activo.');
  await ig.challenge.sendSecurityCode(code);
  delete userSessions[username].challenge;
}

async function getUserData(username) {
  const user = await ig.account.currentUser();
  const followers = await ig.feed.accountFollowers(user.pk).items();
  return {
    ...user,
    followersCount: followers.length
  };
}

function handleLoginError(error, username, res) {
  console.error('⚠️ Error en login:', error);

  // Error de verificación (2FA)
  if (error.name === 'IgCheckpointError') {
    return initiateChallenge(username, res);
  }

  // Errores conocidos de Instagram
  const errorMessages = {
    'The password you entered is incorrect.': 'Contraseña incorrecta.',
    'The username you entered doesn\'t belong to an account.': 'Usuario no encontrado.',
    'Challenge required.': 'Instagram requiere verificación adicional.'
  };

  const message = errorMessages[error.message] || 
                  error.message || 
                  'Error al conectar con Instagram. Intenta nuevamente.';

  res.status(400).json({ 
    success: false,
    message 
  });
}

async function initiateChallenge(username, res) {
  try {
    const challenge = await ig.challenge.auto(true);
    userSessions[username] = { challenge, challengeType: challenge.type };
    
    res.json({
      success: false,
      challengeRequired: true,
      challengeType: challenge.type,
      message: '🔒 Instagram requiere verificación. Revisa tu email/teléfono.'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'No se pudo iniciar el desafío de seguridad.'
    });
  }
}

function sendInitialData(username) {
  if (userSessions[username] && activeSockets[username]) {
    const ws = activeSockets[username];
    ws.send(JSON.stringify({
      type: 'init',
      data: {
        message: `Bienvenido, ${username}!`,
        followers: userSessions[username].followersCount || 0
      }
    }));
  }
}

function broadcastUpdate(message) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'notification',
        message
      }));
    }
  });
}
