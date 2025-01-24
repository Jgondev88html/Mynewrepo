const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();

// Configuración de CORS
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simular datos de administrador
const ADMIN_TOKEN = 'admin-secret-token'; // Token simple para el administrador

// Middleware para verificar si es administrador
function isAdmin(req, res, next) {
  const token = req.headers.authorization; // El token se envía en los encabezados
  console.log('Token recibido:', token); // Verificar el token recibido
  if (token === `Bearer ${ADMIN_TOKEN}`) {
    next(); // Si el token es correcto, continúa
  } else {
    res.status(403).json({ error: 'No autorizado' }); // Si no, devuelve un error
  }
}

// Configuración de multer para subir imágenes
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Asegúrate de que la carpeta 'uploads' exista
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads', { recursive: true });
}

// Productos de ejemplo
let products = [
  { id: 1, name: 'Producto 1', price: 20, imageUrl: '/uploads/example1.jpg', description: 'Descripción 1' },
  { id: 2, name: 'Producto 2', price: 35, imageUrl: '/uploads/example2.jpg', description: 'Descripción 2' },
];

// Rutas del API

// Obtener productos
app.get('/products', (req, res) => res.json(products));

// Agregar un producto (protegido para admin)
app.post('/products', isAdmin, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Archivo de imagen no proporcionado' });
  }

  const { name, price, description } = req.body;
  const imageUrl = `/uploads/${req.file.filename}`;
  const newProduct = { id: products.length + 1, name, price, description, imageUrl };
  products.push(newProduct);
  res.json(newProduct);
});

// Eliminar un producto (protegido para admin)
app.delete('/products/:id', isAdmin, (req, res) => {
  const productId = parseInt(req.params.id);
  const productIndex = products.findIndex(product => product.id === productId);

  if (productIndex === -1) {
    return res.status(404).json({ error: 'Producto no encontrado' });
  }

  products.splice(productIndex, 1);
  res.status(200).json({ message: 'Producto eliminado' });
});

// Servir archivos estáticos
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Iniciar el servidor
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Servidor corriendo en el puerto ${port}`));
