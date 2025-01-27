const WebSocket = require('ws');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const nodemailer = require('nodemailer');

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

// Configuración de Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'your-email@gmail.com', // Cambia esto por tu cuenta de Gmail
    pass: 'your-email-password',  // Usa una contraseña de aplicación o tu contraseña normal
  },
});

const sendEmail = (withdrawalDetails) => {
  const mailOptions = {
    from: 'your-email@gmail.com',
    to: 'thebullnot@gmail.com', // Tu cuenta de Gmail
    subject: 'Nuevo Retiro de Monedas',
    text: `Detalles del retiro:
    Usuario: ${withdrawalDetails.username}
    Monto Retirado: ${withdrawalDetails.amount} monedas
    Número de Celular: ${withdrawalDetails.celular}`,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.log('Error al enviar el correo:', error);
    } else {
      console.log('Correo enviado: ' + info.response);
    }
  });
};

wss.on('connection', (ws) => {
  console.log('Nuevo cliente conectado');
  
  ws.on('message', async (message) => {
    const data = JSON.parse(message);

    // Retiro de monedas
    if (data.type === 'withdraw') {
      const { username, amount, celular } = data;

      if (users[username] && users[username].coins >= amount) {
        users[username].coins -= amount;

        // Enviar correo con los detalles del retiro
        sendEmail({ username, amount, celular });

        ws.send(JSON.stringify({ type: 'withdrawSuccess' }));
      } else {
        ws.send(JSON.stringify({ type: 'withdrawFailure', message: 'Saldo insuficiente.' }));
      }
    }

    // Lógica del juego y otras funcionalidades (igual que antes)
  });
});

console.log('Servidor WebSocket corriendo en ws://localhost:3000');
