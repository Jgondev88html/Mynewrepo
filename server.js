<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Juego de Apuestas</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            text-align: center;
            margin: 20px;
        }
        .game-container {
            max-width: 400px;
            margin: 0 auto;
            padding: 20px;
            border: 1px solid #ddd;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        input[type="text"],
        input[type="number"] {
            width: 80%;
            margin-bottom: 10px;
        }
        .message {
            margin: 10px 0;
            padding: 10px;
            background-color: #f9f9f9;
            border: 1px solid #ddd;
            border-radius: 5px;
        }
        .users-list {
            text-align: left;
            margin-top: 20px;
        }
        .users-list ul {
            padding: 0;
            list-style: none;
        }
    </style>
</head>
<body>
    <div class="game-container">
        <h1>Juego de Apuestas</h1>
        <div id="login-section">
            <input type="text" id="username" placeholder="Ingrese su nombre de usuario">
            <button id="login-btn">Iniciar sesión</button>
        </div>
        <div id="game-section" style="display: none;">
            <p>Monedas: <span id="coins">0</span></p>
            <p>Intentos restantes: <span id="attempts">0</span></p>
            <input type="number" id="bet" min="1" max="5" placeholder="1-5">
            <button id="guess-btn">Adivinar</button>
            <div id="messages"></div>
        </div>
        <div class="users-list">
            <h3>Usuarios activos</h3>
            <ul id="active-users"></ul>
        </div>
    </div>

    <script>
        const socket = new WebSocket('wss://mynewrepo-udix.onrender.com');
        let username = localStorage.getItem('username'); // Recuperamos el usuario de localStorage

        // Esperamos a que se abra el WebSocket para enviar cualquier mensaje
        socket.addEventListener('open', () => {
            if (username) {
                // Enviar login solo si username existe en localStorage
                socket.send(JSON.stringify({ type: 'login', username }));
            } else {
                document.getElementById('login-section').style.display = 'block';
                document.getElementById('game-section').style.display = 'none';
            }
        });

        // Login
        document.getElementById('login-btn').addEventListener('click', () => {
            const input = document.getElementById('username');
            username = input.value.trim();
            if (username) {
                localStorage.setItem('username', username); // Guardamos el nombre de usuario en localStorage
                socket.send(JSON.stringify({ type: 'login', username }));
            } else {
                alert('Por favor, ingresa un nombre de usuario.');
            }
        });

        // Manejar mensajes del servidor
        socket.addEventListener('message', (event) => {
            const data = JSON.parse(event.data);

            if (data.type === 'loginSuccess') {
                // Escondemos la sección de login y mostramos el juego
                document.getElementById('login-section').style.display = 'none';
                document.getElementById('game-section').style.display = 'block';
                document.getElementById('coins').textContent = data.coins;
                document.getElementById('attempts').textContent = data.attempts;
            }

            if (data.type === 'loginError') {
                alert(data.message);
            }

            if (data.type === 'result') {
                addMessage(data.win ? `¡Ganaste! Número: ${data.number}` : `Perdiste. Número: ${data.number}`);
                document.getElementById('coins').textContent = data.newCoins;
                document.getElementById('attempts').textContent = data.remainingAttempts;
                if (data.remainingAttempts === 0) {
                    addMessage('¡Te quedaste sin intentos!');
                }
            }

            if (data.type === 'activeUsers') {
                updateActiveUsers(data.users);
            }
        });

        // Adivinar
        document.getElementById('guess-btn').addEventListener('click', () => {
            const bet = parseInt(document.getElementById('bet').value);
            if (bet >= 1 && bet <= 5) {
                socket.send(JSON.stringify({ type: 'guess', bet }));
                document.getElementById('bet').value = ''; // Limpiar input después de adivinar
            } else {
                alert('Por favor, ingresa un número entre 1 y 5.');
            }
        });

        function addMessage(message) {
            const messagesDiv = document.getElementById('messages');
            const messageDiv = document.createElement('div');
            messageDiv.textContent = message;
            messageDiv.className = 'message';
            messagesDiv.appendChild(messageDiv);
        }

        function updateActiveUsers(users) {
            const usersList = document.getElementById('active-users');
            usersList.innerHTML = users.map(user => `<li>${user}</li>`).join('');
        }
    </script>
</body>
</html>
