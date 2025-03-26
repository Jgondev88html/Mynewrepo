// server.js
const express = require('express');
const WebSocket = require('ws');
const { IgApiClient } = require('instagram-private-api');

// Configuración inicial
const app = express();
const PORT = process.env.PORT || 3000;

// Servir archivos estáticos
app.use(express.static('public'));

// Iniciar servidor HTTP
const server = app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});

// Configurar WebSocket
const wss = new WebSocket.Server({ server });

// Cliente de Instagram
class InstagramManager {
  constructor() {
    this.ig = new IgApiClient();
    this.ig.state.generateDevice(process.env.IG_USERNAME || 'default_user');
    this.activeSessions = new Map();
  }

  async login(username, password, ws) {
    try {
      // Simular flujo de login de Instagram
      await this.ig.simulate.preLoginFlow();
      
      // Login real
      const user = await this.ig.account.login(username, password);
      
      // Simular post-login
      await this.ig.simulate.postLoginFlow();
      
      // Guardar sesión
      this.activeSessions.set(ws, {
        ig: this.ig,
        user,
        lastActivity: Date.now()
      });

      return {
        success: true,
        user: {
          username: user.username,
          fullName: user.full_name,
          profilePic: user.profile_pic_url
        }
      };
    } catch (error) {
      console.error('Login error:', error);
      return {
        success: false,
        error: this.parseError(error)
      };
    }
  }

  async followUser(ws, targetUsername) {
    const session = this.activeSessions.get(ws);
    if (!session) {
      return { success: false, error: 'Sesión no válida' };
    }

    try {
      const userId = await session.ig.user.getIdByUsername(targetUsername);
      await session.ig.friendship.create(userId);
      return { success: true };
    } catch (error) {
      console.error('Follow error:', error);
      return { success: false, error: this.parseError(error) };
    }
  }

  parseError(error) {
    if (error.message.includes('password')) {
      return 'Contraseña incorrecta';
    } else if (error.message.includes('username')) {
      return 'Usuario no encontrado';
    } else if (error.message.includes('challenge')) {
      return 'Verificación requerida - Revisa la app de Instagram';
    } else {
      return 'Error en la operación';
    }
  }
}

const instagramManager = new InstagramManager();

// Manejo de conexiones WebSocket
wss.on('connection', (ws) => {
  console.log('Nuevo cliente conectado');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      switch (data.type) {
        case 'login':
          const loginResult = await instagramManager.login(
            data.username, 
            data.password, 
            ws
          );
          ws.send(JSON.stringify({
            type: 'login_response',
            ...loginResult
          }));
          break;

        case 'follow':
          const followResult = await instagramManager.followUser(
            ws, 
            data.targetUsername
          );
          ws.send(JSON.stringify({
            type: 'follow_response',
            ...followResult
          }));
          break;

        default:
          ws.send(JSON.stringify({
            type: 'error',
            error: 'Tipo de mensaje no válido'
          }));
      }
    } catch (error) {
      console.error('Error procesando mensaje:', error);
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Error procesando la solicitud'
      }));
    }
  });

  ws.on('close', () => {
    console.log('Cliente desconectado');
    instagramManager.activeSessions.delete(ws);
  });
});

// Endpoint básico para verificar el servidor
app.get('/status', (req, res) => {
  res.json({
    status: 'online',
    clients: wss.clients.size,
    activeSessions: instagramManager.activeSessions.size
  });
});

// Manejo de errores
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});
