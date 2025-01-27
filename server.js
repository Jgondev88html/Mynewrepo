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

    if (data.type === 'login') {
      // Verificamos si el usuario ya está logueado
      if (users[data.username]) {
        ws.send(JSON.stringify({ type: 'error', message: 'El usuario ya está registrado. Elija otro nombre.' }));
      } else {
        // Si el usuario no está registrado, lo registramos
        users[data.username] = { coins: 0, attempts: 3, ganados: 0, perdidos: 0 };
        console.log(`Usuario ${data.username} conectado`);
        ws.send(JSON.stringify({ type: 'loginSuccess', username: data.username }));
      }
    }

    if (data.type === 'gameAction') {
      const user = users[data.username];
      if (user && user.attempts > 0) {
        user.attempts--;

        // Generar una cantidad aleatoria de monedas entre 0 y 70
        const coinsWon = Math.floor(Math.random() * 71);  // Genera un número entre 0 y 70

        // Aumentamos las probabilidades de ganar (60% de ganar, 40% de perder)
        const resultado = Math.random() > 0.4 ? 'ganado' : 'perdido';  // 60% de ganar, 40% de perder

        if (resultado === 'ganado') {
          user.coins += coinsWon;
          user.ganados += coinsWon;
        } else {
          user.coins -= 1;  // Perdida mínima de 1 moneda en lugar de 5
          user.perdidos += 1;
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

    if (data.type === 'adminLogin') {
      // Verificamos la contraseña del administrador
      if (data.password === adminPassword) {
        ws.send(JSON.stringify({ type: 'adminLoginSuccess' }));
      } else {
        ws.send(JSON.stringify({ type: 'adminLoginFailure', message: 'Contraseña incorrecta' }));
      }
    }

    if (data.type === 'adminUpdate') {
      // Verificamos si el usuario existe
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
