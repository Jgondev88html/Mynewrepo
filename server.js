const express = require('express');
const WebSocket = require('ws');
const { IgApiClient } = require('instagram-private-api');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de Express
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

class InstagramManager {
  constructor() {
    this.ig = new IgApiClient();
    this.activeChallenges = new Map();
    this.userSessions = new Map();
  }

  async initClient(username) {
    this.ig.state.generateDevice(username);
    this.ig.request.end$.subscribe(() => {
      this.ig.state.serialize().then(state => {
        const serialized = JSON.stringify(state);
        this.ig.state.deserialize(serialized);
      });
    });
  }

  async login(username, password, ws) {
    try {
      await this.initClient(username);
      await this.ig.simulate.preLoginFlow();

      const user = await this.ig.account.login(username, password).catch(async (error) => {
        if (error.name === 'IgCheckpointError') {
          return this.handleChallenge(username, error, ws);
        }
        throw error;
      });

      if (user && user.username) {
        await this.ig.simulate.postLoginFlow();
        this.userSessions.set(ws, { ig: this.ig, username });
        return { success: true, user };
      }
      return { success: false, error: 'Error desconocido' };

    } catch (error) {
      return { success: false, error: this.parseError(error) };
    }
  }

  async handleChallenge(username, error, ws) {
    try {
      await this.initClient(username);
      const challenge = await this.ig.challenge.resolve(error);
      this.activeChallenges.set(ws, challenge);

      ws.send(JSON.stringify({
        type: 'challenge_required',
        methods: challenge.availableValidationMethods,
        message: 'Instagram requiere verificación de seguridad'
      }));

      return new Promise((resolve) => {
        challenge.on('challenge', async (challengeData) => {
          ws.send(JSON.stringify({
            type: 'challenge_code',
            message: challengeData.message
          }));
        });
      });
    } catch (error) {
      return { success: false, error: this.parseError(error) };
    }
  }

  async submitChallengeCode(ws, code, method = '0') {
    const challenge = this.activeChallenges.get(ws);
    if (!challenge) return { success: false, error: 'No hay desafío activo' };

    try {
      // Seleccionar método de verificación (0 = SMS, 1 = Email)
      await challenge.selectVerifyMethod(method);
      
      // Validar código
      const validation = await challenge.validate(code);
      
      if (validation) {
        await challenge.auto();
        this.activeChallenges.delete(ws);
        return { success: true };
      }
      return { success: false, error: 'Código inválido' };
    } catch (error) {
      return { success: false, error: this.parseError(error) };
    }
  }

  parseError(error) {
    if (error.message.includes('password')) return 'Contraseña incorrecta';
    if (error.message.includes('username')) return 'Usuario no encontrado';
    if (error.message.includes('challenge')) return 'Verificación requerida';
    if (error.message.includes('code')) return 'Código de verificación incorrecto';
    return error.message || 'Error en la operación';
  }
}

const instagramManager = new InstagramManager();

// Configurar WebSocket
const wss = new WebSocket.Server({ server });

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

        case 'submit_challenge_code':
          const challengeResult = await instagramManager.submitChallengeCode(
            ws,
            data.code,
            data.method
          );
          ws.send(JSON.stringify({
            type: 'challenge_result',
            ...challengeResult
          }));
          break;

        case 'follow':
          const session = instagramManager.userSessions.get(ws);
          if (session) {
            const followResult = await session.ig.friendship.create(
              await session.ig.user.getIdByUsername(data.targetUsername)
            );
            ws.send(JSON.stringify({
              type: 'follow_response',
              success: true
            }));
          } else {
            ws.send(JSON.stringify({
              type: 'follow_response',
              success: false,
              error: 'Sesión no válida'
            }));
          }
          break;

        default:
          ws.send(JSON.stringify({
            type: 'error',
            error: 'Tipo de mensaje no válido'
          }));
      }
    } catch (error) {
      console.error('Error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Error procesando la solicitud'
      }));
    }
  });

  ws.on('close', () => {
    console.log('Cliente desconectado');
    instagramManager.activeChallenges.delete(ws);
    instagramManager.userSessions.delete(ws);
  });
});

// Ruta de estado
app.get('/status', (req, res) => {
  res.json({
    status: 'online',
    clients: wss.clients.size,
    activeSessions: instagramManager.userSessions.size
  });
});
