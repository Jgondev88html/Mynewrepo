const WebSocket = require('ws');
const express = require('express');

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

// Lista de jugadores conectados
let players = [];
let waitingPlayer = null;

// Manejar conexiones WebSocket
wss.on('connection', (ws) => {
  console.log('Nuevo cliente conectado');

  let player = null; // Datos del jugador conectado

  // Manejar mensajes del cliente
  ws.on('message', (message) => {
    const data = JSON.parse(message);

    // **LOGIN**
    if (data.action === 'login') {
      const username = data.username.trim();
      if (players.find((p) => p.username === username)) {
        ws.send(JSON.stringify({ action: 'login', success: false, message: 'Nombre ya en uso' }));
        return;
      }

      // Registrar al jugador
      player = {
        username,
        ws,
        monedas: 50,
        intentos: 3,
        opponent: null,
      };
      players.push(player);
      ws.send(JSON.stringify({ action: 'login', success: true, monedas: player.monedas, intentos: player.intentos }));
      console.log(`${username} se ha conectado.`);

      // Enviar lista de usuarios conectados
      broadcastPlayers();

      // Intentar emparejar al jugador
      if (waitingPlayer && waitingPlayer !== player) {
        player.opponent = waitingPlayer;
        waitingPlayer.opponent = player;
        waitingPlayer.ws.send(JSON.stringify({ action: 'matched', opponent: player.username }));
        player.ws.send(JSON.stringify({ action: 'matched', opponent: waitingPlayer.username }));
        waitingPlayer = null; // Emparejado, ya no está esperando
      } else {
        waitingPlayer = player; // Poner al jugador en espera
      }
    }

    // **APUESTA**
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

      // Resultado aleatorio
      const win = Math.random() < 0.5;
      if (win) {
        player.monedas += betAmount;
        player.opponent.monedas -= betAmount;
        ws.send(JSON.stringify({ action: 'betResult', win: true, monedas: player.monedas }));
        player.opponent.ws.send(
          JSON.stringify({ action: 'betResult', win: false, monedas: player.opponent.monedas })
        );
      } else {
        player.monedas -= betAmount;
        player.opponent.monedas += betAmount;
        ws.send(JSON.stringify({ action: 'betResult', win: false, monedas: player.monedas }));
        player.opponent.ws.send(
          JSON.stringify({ action: 'betResult', win: true, monedas: player.opponent.monedas })
        );
      }

      // Actualizar intentos
      player.intentos--;
      player.opponent.intentos--;
      if (player.intentos === 0 || player.opponent.intentos === 0) {
        player.ws.send(JSON.stringify({ action: 'gameOver', monedas: player.monedas }));
        player.opponent.ws.send(JSON.stringify({ action: 'gameOver', monedas: player.opponent.monedas }));
      }
    }
  });

  // Manejar desconexión
  ws.on('close', () => {
    console.log(player?.username + ' desconectado');
    players = players.filter((p) => p !== player);
    if (waitingPlayer === player) waitingPlayer = null; // Si estaba esperando, liberarlo
    if (player?.opponent) {
      player.opponent.ws.send(JSON.stringify({ action: 'opponentLeft' }));
      player.opponent.opponent = null;
    }
    broadcastPlayers(); // Actualizar lista de jugadores conectados
  });
});

// Enviar lista de jugadores conectados
function broadcastPlayers() {
  const usernames = players.map((p) => p.username);
  players.forEach((p) => p.ws.send(JSON.stringify({ action: 'updatePlayers', players: usernames })));
}

// Iniciar servidor en puerto especificado o 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor WebSocket corriendo en el puerto ${PORT}`);
});
