const express = require('express');
const multer = require('multer');
const path = require('path');
const WebSocket = require('ws');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

const cors = require('cors');

// Permitir CORS de cualquier origen (esto es útil durante el desarrollo)
app.use(cors({
  origin: '*',  // Permite todos los orígenes (para pruebas locales)
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));


// Configuración de almacenamiento con multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, './uploads'); // Carpeta donde se almacenarán las imágenes
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname)); // Asignar un nombre único al archivo
  }
});

const upload = multer({ storage: storage });

// Usuario y contraseña del administrador
const ADMIN_USER = 'admin';  // Nombre de usuario del administrador
const ADMIN_PASSWORD = 'admin123';  // Contraseña del administrador

// Función para cargar productos desde un archivo
const loadProducts = () => {
  try {
    const data = fs.readFileSync('./products.json', 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return []; // Si no hay archivo, devolver un arreglo vacío
  }
};

// Función para guardar productos en un archivo
const saveProducts = (products) => {
  fs.writeFileSync('./products.json', JSON.stringify(products, null, 2));
};

// Obtener los productos desde el archivo
let products = loadProducts();

// Ruta para obtener los productos (pública)
app.get('/products', (req, res) => {
  res.json(products);
});

// Ruta para agregar un producto (solo para admin)
app.post('/products', upload.single('image'), (req, res) => {
  const { name, price, description, username, password } = req.body;

  // Validación de admin
  if (username !== ADMIN_USER || password !== ADMIN_PASSWORD) {
    return res.status(403).json({ success: false, message: 'Acceso denegado. Solo el administrador puede agregar productos.' });
  }

  const imageUrl = req.file ? `/uploads/${req.file.filename}` : ''; // Ruta de la imagen cargada

  const newProduct = {
    id: products.length + 1,
    name,
    price,
    imageUrl,
    description,
  };

  products.push(newProduct);
  saveProducts(products); // Guardar los productos actualizados en el archivo
  res.json(newProduct);
});

// Ruta para borrar un producto (solo para admin)
app.delete('/products/:id', (req, res) => {
  const { id } = req.params;
  const { username, password } = req.body;

  // Validación de admin
  if (username !== ADMIN_USER || password !== ADMIN_PASSWORD) {
    return res.status(403).json({ success: false, message: 'Acceso denegado. Solo el administrador puede eliminar productos.' });
  }

  const productIndex = products.findIndex(product => product.id === parseInt(id));

  if (productIndex !== -1) {
    products.splice(productIndex, 1); // Eliminar el producto
    saveProducts(products); // Guardar los productos actualizados en el archivo
    res.json({ success: true, message: 'Producto eliminado con éxito' });
  } else {
    res.status(404).json({ success: false, message: 'Producto no encontrado' });
  }
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
