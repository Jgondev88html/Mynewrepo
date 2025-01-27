const WebSocket = require('ws');
const http = require('http');
const express = require('express');

// Crear la app de Express
const app = express();
const server = http.createServer(app);

// Crear un WebSocket server
const wss = new WebSocket.Server({ server });

let users = {};  // Almacenamos los usuarios con su nombre, monedas e intentos

app.use(express.static('public'));  // Para servir los archivos estáticos

// Cuando un cliente se conecta al WebSocket
wss.on('connection', (ws) => {
  console.log('Nuevo usuario conectado');

  ws.on('message', (message) => {
    const data = JSON.parse(message);

    if (data.type === 'login') {
      // Si el usuario no está registrado, lo registramos
      if (!users[data.username]) {
        users[data.username] = { coins: 0, attempts: 3, ganados: 0, perdidos: 0 }; // Inicializamos monedas, intentos, ganancias y pérdidas
      }
      console.log(`Usuario ${data.username} conectado`);
    }

    if (data.type === 'gameAction') {
      const user = users[data.username];
      if (user && user.attempts > 0) {
        user.attempts--;
        // Decidir si ganar o perder monedas
        const resultado = Math.random() > 0.5 ? 'ganado' : 'perdido';

        if (resultado === 'ganado') {
          user.coins += 10;
          user.ganados += 10;
        } else {
          user.coins -= 5;
          user.perdidos += 5;
        }

        // Enviar el estado actualizado al cliente
        ws.send(JSON.stringify({
          type: 'updateStatus',
          coins: user.coins,
          attempts: user.attempts,
          ganados: user.ganados,
          perdidos: user.perdidos
        }));
      }
    }
  });

  ws.on('close', () => {
    console.log('Un usuario se desconectó');
  });
});

// Arrancar el servidor en el puerto 3000
server.listen(3000, () => {
  console.log('Servidor corriendo en el puerto 3000');
});
