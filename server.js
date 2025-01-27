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
let adminSession = null;  // Variable para almacenar la sesión del administrador

app.use(express.static('public'));  // Para servir los archivos estáticos

// Cuando un cliente se conecta al WebSocket
wss.on('connection', (ws) => {
  console.log('Nuevo usuario conectado');

  ws.on('message', (message) => {
    const data = JSON.parse(message);

    // Manejo de login de usuario
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

    // Manejo de la acción del juego
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
      } else {
        ws.send(JSON.stringify({ type: 'error', message: 'No tienes intentos disponibles.' }));
      }
    }

    // Manejo del login del administrador
    if (data.type === 'adminLogin') {
      // Verificamos la contraseña del administrador
      if (data.password === adminPassword) {
        adminSession = ws;  // Almacenar la sesión del administrador
        ws.send(JSON.stringify({ type: 'adminLoginSuccess' }));
      } else {
        ws.send(JSON.stringify({ type: 'adminLoginFailure', message: 'Contraseña incorrecta' }));
      }
    }

    // Manejo de la actualización de usuarios por parte del administrador
    if (data.type === 'adminUpdate') {
      if (adminSession !== ws) {
        // Si el que está enviando el mensaje no es el administrador, no permitimos la acción
        ws.send(JSON.stringify({ type: 'error', message: 'Acceso denegado. Debes iniciar sesión como administrador.' }));
        return;
      }

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
