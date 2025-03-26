const express = require('express');
const WebSocket = require('ws');
const { Client } = require('instagrapi');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 3000;

// Almacén temporal de credenciales (solo para desarrollo)
const tempCredentials = new Map();

// Configuración de Instagram Client
const ig = new Client();

// WebSocket Connection
wss.on('connection', (ws) => {
  console.log('Nuevo cliente WebSocket conectado');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      // Proceso de login
      if (data.action === 'login') {
        const { username, password, requestId } = data;

        if (!username || !password) {
          return ws.send(JSON.stringify({
            requestId,
            status: 'error',
            message: 'Usuario y contraseña son requeridos'
          }));
        }

        // Almacenar temporalmente (solo para desarrollo)
        tempCredentials.set(requestId, { username, password });

        ws.send(JSON.stringify({
          requestId,
          status: 'processing',
          message: 'Validando credenciales...'
        }));

        try {
          await ig.login(username, password);
          const user = await ig.account.currentUser();

          ws.send(JSON.stringify({
            requestId,
            status: 'success',
            user: {
              username: user.username,
              full_name: user.full_name,
              profile_pic_url: user.profile_pic_url
            }
          }));

        } catch (error) {
          console.error('Error de login:', error);

          if (error.name === 'IgChallengeError') {
            return ws.send(JSON.stringify({
              requestId,
              status: 'challenge_required',
              message: 'Se requiere verificación adicional',
              methods: error.challenge.methods
            }));
          }

          ws.send(JSON.stringify({
            requestId,
            status: 'error',
            message: error.message || 'Credenciales inválidas'
          }));
        } finally {
          tempCredentials.delete(requestId);
        }
      }

      // Proceso de verificación 2FA
      if (data.action === 'verify_2fa') {
        const { code, requestId } = data;
        const credentials = tempCredentials.get(requestId);

        if (!credentials) {
          return ws.send(JSON.stringify({
            requestId,
            status: 'error',
            message: 'Solicitud expirada'
          }));
        }

        ws.send(JSON.stringify({
          requestId,
          status: 'processing',
          message: 'Verificando código...'
        }));

        try {
          await ig.challenge.resolve({
            username: credentials.username,
            code
          });

          const user = await ig.account.currentUser();

          ws.send(JSON.stringify({
            requestId,
            status: 'success',
            user: {
              username: user.username,
              full_name: user.full_name,
              profile_pic_url: user.profile_pic_url
            }
          }));

        } catch (error) {
          console.error('Error de verificación:', error);
          ws.send(JSON.stringify({
            requestId,
            status: 'error',
            message: error.message || 'Código de verificación incorrecto'
          }));
        }
      }

    } catch (error) {
      console.error('Error procesando mensaje:', error);
      ws.send(JSON.stringify({
        status: 'error',
        message: 'Error interno del servidor'
      }));
    }
  });

  ws.on('close', () => {
    console.log('Cliente WebSocket desconectado');
  });
});

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Servidor de validación de Instagram activo');
});

server.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
