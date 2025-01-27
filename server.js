const fs = require('fs');
const WebSocket = require('ws');
const express = require('express');

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

let players = []; // Lista de jugadores en memoria
let playerData = {}; // Almacenar datos persistentes

// Cargar datos desde un archivo al iniciar el servidor
if (fs.existsSync('playerData.json')) {
  playerData = JSON.parse(fs.readFileSync('playerData.json'));
}

// Guardar datos al archivo
function savePlayerData() {
  fs.writeFileSync('playerData.json', JSON.stringify(playerData, null, 2));
}

wss.on('connection', (ws) => {
  console.log('Nuevo cliente conectado');

  let player = null;

  ws.on('message', (message) => {
    const data = JSON.parse(message);

    if (data.action === 'login') {
      const username = data.username.trim();

      // Verificar si el nombre ya está en uso
      if (players.find((p) => p.username === username)) {
        ws.send(JSON.stringify({ action: 'login', success: false, message: 'Nombre ya en uso' }));
        return;
      }

      // Cargar o inicializar datos del jugador
      if (!playerData[username]) {
        playerData[username] = { monedas: 50, intentos: 3 };
        savePlayerData();
      }

      player = {
        username,
        ws,
        monedas: playerData[username].monedas,
        intentos: playerData[username].intentos,
        opponent: null,
      };

      players.push(player);
      ws.send(JSON.stringify({ action: 'login', success: true, monedas: player.monedas, intentos: player.intentos }));
      console.log(`${username} se ha conectado.`);

      broadcastPlayers();
    }

    if (data.action === 'bet') {
      if (!player || !player.opponent) {
        ws.send(JSON.stringify({ action: 'error', message: 'No tienes un oponente aún.' }));
        return;
      }

      const betAmount = data.betAmount;
      if (betAmount <= 0 || betAmount > player.monedas) {
        ws.send(JSON.stringify({ action: 'error', message: 'Apuesta inválida.' }));
        return;
      }

      const win = Math.random() < 0.5;
      if (win) {
        player.monedas += betAmount;
        player.opponent.monedas -= betAmount;
      } else {
        player.monedas -= betAmount;
        player.opponent.monedas += betAmount;
      }

      // Actualizar datos del jugador
      playerData[player.username].monedas = player.monedas;
      playerData[player.opponent.username].monedas = player.opponent.monedas;
      savePlayerData();

      ws.send(JSON.stringify({ action: 'betResult', win, monedas: player.monedas }));
      player.opponent.ws.send(
        JSON.stringify({ action: 'betResult', win: !win, monedas: player.opponent.monedas })
      );

      player.intentos--;
      player.opponent.intentos--;
      playerData[player.username].intentos = player.intentos;
      playerData[player.opponent.username].intentos = player.opponent.intentos;

      savePlayerData();

      if (player.intentos <= 0 || player.opponent.intentos <= 0) {
        ws.send(JSON.stringify({ action: 'gameOver', monedas: player.monedas }));
        player.opponent.ws.send(JSON.stringify({ action: 'gameOver', monedas: player.opponent.monedas }));
        return;
      }

      ws.send(JSON.stringify({ action: 'updateAttempts', intentos: player.intentos }));
      player.opponent.ws.send(JSON.stringify({ action: 'updateAttempts', intentos: player.opponent.intentos }));
    }
  });

  ws.on('close', () => {
    if (player) {
      players = players.filter((p) => p !== player);
      broadcastPlayers();
    }
  });
});

function broadcastPlayers() {
  const usernames = players.map((p) => p.username);
  players.forEach((p) => p.ws.send(JSON.stringify({ action: 'updatePlayers', players: usernames })));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor WebSocket corriendo en el puerto ${PORT}`);
});
