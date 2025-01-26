const WebSocket = require('ws');
const express = require('express');

// Crear un servidor HTTP con Express
const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

// Array para almacenar los jugadores
let players = [];

// Manejar conexiones de WebSocket
wss.on('connection', (ws) => {
  console.log('Nuevo jugador conectado');

  // Inicializar al jugador
  const player = {
    id: Date.now(), // Usamos un timestamp como ID único
    monedas: 50,
    intentos: 3
  };
  players.push(player);

  // Enviar información inicial al cliente
  ws.send(JSON.stringify({ monedas: player.monedas, intentos: player.intentos }));

  // Manejar mensajes de los clientes
  ws.on('message', (message) => {
    const data = JSON.parse(message);

    if (data.action === 'bet') {
      const { betAmount } = data;

      if (betAmount <= player.monedas && player.intentos > 0) {
        player.monedas -= betAmount;
        player.intentos--;

        // Lógica de ganar o perder
        const outcome = Math.random() < 0.5 ? 'win' : 'lose';
        let response = {
          outcome,
          amount: betAmount,
          message: outcome === 'win' ? '¡Ganaste!' : 'Perdiste...',
          monedas: player.monedas,
          intentos: player.intentos
        };

        ws.send(JSON.stringify(response));

        if (player.intentos === 0) {
          ws.send(JSON.stringify({ message: '¡Se acabaron tus intentos!' }));
        }
      } else {
        ws.send(JSON.stringify({ message: 'No tienes suficientes monedas o intentos.' }));
      }
    }
  });

  // Manejar desconexión del cliente
  ws.on('close', () => {
    console.log('Jugador desconectado');
    players = players.filter(p => p.id !== player.id);
  });
});

// Iniciar el servidor en el puerto especificado por Render o en el puerto 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor WebSocket corriendo en el puerto ${PORT}`);
});
