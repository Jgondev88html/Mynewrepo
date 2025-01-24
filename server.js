const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Mock de usuario admin
const users = [
  { username: 'admin', password: 'admin123', role: 'admin' },
  { username: 'user1', password: 'user123', role: 'user' },
];

// Mock de productos
let products = [
  { id: 1, name: 'Producto 1', price: 100 },
  { id: 2, name: 'Producto 2', price: 150 },
];

// Ruta para el login
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  const user = users.find(u => u.username === username && u.password === password);
  if (user) {
    res.json({ success: true, role: user.role });
  } else {
    res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos' });
  }
});

// Ruta para obtener los productos
app.get('/products', (req, res) => {
  res.json(products);
});

// Ruta para agregar un producto (solo para admin)
app.post('/products', (req, res) => {
  const { name, price } = req.body;
  const newProduct = { id: products.length + 1, name, price };
  products.push(newProduct);
  res.json(newProduct);
});

// Crear servidor WebSocket
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', ws => {
  ws.on('message', message => {
    console.log('Mensaje recibido:', message);
    ws.send('Mensaje recibido: ' + message);
  });
});

app.server = app.listen(port, () => {
  console.log(`Servidor escuchando en el puerto ${port}`);
});

// Actualizar el servidor Express para manejar WebSocket
app.server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, ws => {
    wss.emit('connection', ws, request);
  });
});
