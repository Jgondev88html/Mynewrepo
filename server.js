const WebSocket = require('ws');
const bcrypt = require('bcryptjs');
const fs = require('fs');

// Inicialización del servidor WebSocket
const wss = new WebSocket.Server({ port: 3000 });

// Datos de administrador (guardados de manera segura con hash)
let adminData = {
  username: 'admin',
  passwordHash: '',  // Esto se establecerá cuando se encripte la contraseña
};

// Cargar los datos del administrador desde un archivo o establecer un valor inicial
fs.readFile('admin_data.json', 'utf8', (err, data) => {
  if (err) {
    console.log('No se pudo leer el archivo de datos de admin. Creando uno nuevo...');
    bcrypt.hash('admin123', 10, (err, hash) => {
      if (err) {
        console.log('Error al generar hash de contraseña', err);
      } else {
        adminData.passwordHash = hash;
        fs.writeFile('admin_data.json', JSON.stringify(adminData), 'utf8', (err) => {
          if (err) {
            console.log('Error al guardar los datos de admin');
          } else {
            console.log('Datos de admin guardados correctamente');
          }
        });
      }
    });
  } else {
    adminData = JSON.parse(data);
  }
});

// Almacenar información de los jugadores
const users = {}; // Aquí irían los datos de los jugadores

// Función para guardar los usuarios (puedes usar una base de datos en producción)
const saveUser = (username, coins, attempts) => {
  users[username] = { coins, attempts, ganados: 0, perdidos: 0 };
};

// Ejemplo de usuario registrado
saveUser('user1', 500, 3);

wss.on('connection', (ws) => {
  console.log('Nuevo cliente conectado');
  
  ws.on('message', async (message) => {
    const data = JSON.parse(message);

    // Login del administrador
    if (data.type === 'adminLogin') {
      // Comparar la contraseña ingresada con el hash almacenado
      const passwordIsValid = await bcrypt.compare(data.password, adminData.passwordHash);
      if (passwordIsValid) {
        ws.send(JSON.stringify({ type: 'adminLoginSuccess' }));
      } else {
        ws.send(JSON.stringify({ type: 'adminLoginFailure' }));
      }
    }

    // Registro de un nuevo jugador
    if (data.type === 'register') {
      const { username } = data;
      
      // Si el usuario ya está registrado
      if (users[username]) {
        ws.send(JSON.stringify({ type: 'registerFailure', message: 'El usuario ya existe.' }));
      } else {
        // Crear el nuevo usuario
        saveUser(username, 100, 3); // Puedes modificar las monedas y los intentos iniciales
        ws.send(JSON.stringify({
          type: 'registerSuccess',
          username,
          coins: 100,
          attempts: 3,
        }));
      }
    }

    // Login de jugadores
    if (data.type === 'login') {
      const { username } = data;
      
      // Si el usuario ya está registrado
      if (users[username]) {
        // Enviar los datos del usuario al cliente
        ws.send(JSON.stringify({
          type: 'loginSuccess',
          username,
          coins: users[username].coins,
          attempts: users[username].attempts,
          ganados: users[username].ganados,
          perdidos: users[username].perdidos,
        }));
      } else {
        // El usuario no existe
        ws.send(JSON.stringify({ type: 'loginFailure' }));
      }
    }
  });
});

console.log('Servidor WebSocket corriendo en ws://localhost:3000');
