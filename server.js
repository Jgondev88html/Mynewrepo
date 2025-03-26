require('dotenv').config();
const express = require('express');
const { IgApiClient } = require('instagram-private-api');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Configuración CORS para frontend externo
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://127.0.0.1:5500/',
  credentials: true
};

app.use(cors(corsOptions));
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
const wss = new WebSocket.Server({ 
  server,
  path: '/ws'
});

wss.on('connection', (ws) => {
  console.log('🔌 Nueva conexión WebSocket');

  ws.on('message', (message) => {
    try {
      const { type, username } = JSON.parse(message);
      if (type === 'auth' && username) {
        activeSockets[username] = ws;
        console.log(`🔑 Autenticado: ${username}`);
        sendInitialData(username);
      }
    } catch (error) {
      console.error('❌ Error WS:', error);
    }
  });

  ws.on('close', () => {
    console.log('❌ Conexión WS cerrada');
  });
});

// API Endpoints
app.post('/api/login', async (req, res) => {
  const { username, password, challengeCode } = req.body;

  try {
    ig.state.generateDevice(username);

    if (challengeCode) {
      await handleChallengeCode(username, challengeCode);
    }

    await ig.account.login(username, password);
    const user = await getUserData(username);

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

app.post('/api/start-campaign', async (req, res) => {
  try {
    // Lógica de campaña aquí
    broadcastUpdate('Campaña iniciada');
    res.json({ success: true, message: '🚀 Campaña iniciada' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Helpers
async function handleChallengeCode(username, code) {
  const session = userSessions[username];
  if (!session?.challenge) throw new Error('No active challenge');
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
  if (error.name === 'IgCheckpointError') {
    return initiateChallenge(username, res);
  }
  console.error('⚠️ Login Error:', error);
  res.status(400).json({ 
    success: false,
    message: error.message || 'Error de autenticación'
  });
}

async function initiateChallenge(username, res) {
  const challenge = await ig.challenge.auto(true);
  userSessions[username] = { challenge, challengeType: challenge.type };
  
  res.json({
    success: false,
    challengeRequired: true,
    challengeType: challenge.type,
    message: '🔒 Verificación requerida'
  });
}

function sendInitialData(username) {
  if (userSessions[username] && activeSockets[username]) {
    const ws = activeSockets[username];
    ws.send(JSON.stringify({
      type: 'init',
      data: userSessions[username]
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
