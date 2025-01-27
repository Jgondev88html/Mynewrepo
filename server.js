const WebSocket = require('ws');
const http = require('http');
const express = require('express');

// Crear la app de Express
const app = express();
const server = http.createServer(app);

// Crear un WebSocket server
const wss = new WebSocket.Server({ server });

let users = {};  // Almacenamos los usuarios con su nombre, monedas e intentos
const adminPassword = 'admin123';  // Contraseña para acceder al modo administrador

app.use(express.static('public'));  // Para servir los archivos estáticos

// Cuando un cliente se conecta al WebSocket
wss.on('connection', (ws) => {
  console.log('Nuevo usuario conectado');

  ws.on('message', (message) => {
    const data = JSON.parse(message);

    // Acción de login de usuario
    if (data.type === 'login') {
      if (users[data.username]) {
        ws.send(JSON.stringify({ type: 'error', message: 'El usuario ya está registrado. Elija otro nombre.' }));
      } else {
        users[data.username] = { coins: 0, attempts: 3, ganados: 0, perdidos: 0 };
        console.log(`Usuario ${data.username} conectado`);
        ws.send(JSON.stringify({ type: 'loginSuccess', username: data.username, coins: 0, attempts: 3, ganados: 0, perdidos: 0 }));
      }
    }

    // Acción de juego
    if (data.type === 'gameAction') {
      const user = users[data.username];
      if (user && user.attempts > 0) {
        user.attempts--;
        const resultado = Math.random() > 0.5 ? 'ganado' : 'perdido';
        if (resultado === 'ganado') {
          user.coins += 10;
          user.ganados += 10;
        } else {
          user.coins -= 5;
          user.perdidos += 5;
        }

        ws.send(JSON.stringify({
          type: 'updateStatus',
          coins: user.coins,
          attempts: user.attempts,
          ganados: user.ganados,
          perdidos: user.perdidos
        }));
      }
    }

    // Acción de login de administrador
    if (data.type === 'adminLogin') {
      if (data.password === adminPassword) {
        ws.send(JSON.stringify({ type: 'adminLoginSuccess' }));
      } else {
        ws.send(JSON.stringify({ type: 'adminLoginFailure', message: 'Contraseña incorrecta' }));
      }
    }

    // Acción de actualización de usuario por el administrador
    if (data.type === 'adminUpdate') {
      const user = users[data.username];
      if (user) {
        user.coins += data.coins;
        user.attempts += data.attempts;
        ws.send(JSON.stringify({
          type: 'adminUpdateSuccess',
          username: data.username,
          coins: user.coins,
          attempts: user.attempts
        }));
      } else {
        ws.send(JSON.stringify({
          type: 'adminUpdateFailure',
          message: 'Usuario no encontrado'
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
