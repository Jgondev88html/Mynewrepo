const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');

// Cargar los certificados SSL (reemplaza con tus propios certificados)
const server = https.createServer({
  key: fs.readFileSync('private.key'),  // Clave privada
  cert: fs.readFileSync('server.crt')   // Certificado público
});

// Crear servidor WebSocket (WSS)
const wss = new WebSocket.Server({ server });

let players = [];  // Array para almacenar jugadores y su información

// Lógica cuando un jugador se conecta
wss.on('connection', (ws) => {
  console.log('Nuevo jugador conectado');
  
  // Inicializar al jugador con 50 monedas y 3 intentos
  const player = {
    id: ws._socket.remoteAddress,
    monedas: 50,
    intentos: 3
  };
  players.push(player);

  // Enviar información inicial de monedas e intentos al cliente
  ws.send(JSON.stringify({ monedas: player.monedas, intentos: player.intentos }));

  // Escuchar mensajes de los clientes
  ws.on('message', (message) => {
    const data = JSON.parse(message);

    // Si el mensaje es una apuesta, procesamos la lógica
    if (data.action === 'bet') {
      const { betAmount } = data;
      if (betAmount <= player.monedas && player.intentos > 0) {
        player.monedas -= betAmount;  // Restamos la apuesta de las monedas
        player.intentos--;            // Restamos un intento

        // Lógica simple de ganar o perder
        const outcome = Math.random() < 0.5 ? 'win' : 'lose';
        let response = {
          outcome,
          amount: betAmount,
          message: outcome === 'win' ? '¡Ganaste!' : 'Perdiste...',
          monedas: player.monedas,
          intentos: player.intentos
        };
        ws.send(JSON.stringify(response));  // Enviar la respuesta al cliente

        // Si se acabaron los intentos, enviar mensaje de fin de juego
        if (player.intentos === 0) {
          ws.send(JSON.stringify({ message: '¡Se acabaron tus intentos!' }));
        }
      } else {
        // Si no tiene suficientes monedas o intentos
        ws.send(JSON.stringify({ message: 'No tienes suficientes monedas o intentos.' }));
      }
    }
  });

  // Evento cuando un jugador se desconecta
  ws.on('close', () => {
    console.log('Jugador desconectado');
    players = players.filter(p => p.id !== player.id);  // Eliminar jugador de la lista
  });
});

// Iniciar el servidor HTTPS
server.listen(3000, () => {
  console.log('Servidor HTTPS con WSS corriendo en https://localhost:3000');
});
