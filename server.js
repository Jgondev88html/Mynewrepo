const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const ADMIN_PASSWORD = 'admin-password'; // Cambia esta contraseña por una más segura
const ADMIN_TOKEN = 'admin-secret-token'; // Token fijo para autenticar

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configuración de multer para subir imágenes
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// Productos de ejemplo
let products = [];

// Ruta del archivo de visitas
const visitCountFilePath = 'visitCount.json';

// Contador de visitas, inicializado desde el archivo
let visitCount = 0;
fs.readFile(visitCountFilePath, (err, data) => {
  if (err) {
    // Si el archivo no existe, crearlo con el contador en cero
    visitCount = 0;
    fs.writeFileSync(visitCountFilePath, JSON.stringify({ count: visitCount }));
  } else {
    // Si el archivo existe, leer el contador de visitas
    visitCount = JSON.parse(data).count;
  }
});

// Middleware que incrementa el contador de visitas
app.use((req, res, next) => {
  visitCount += 1;
  // Guardar el contador actualizado en el archivo visitCount.json
  fs.writeFileSync(visitCountFilePath, JSON.stringify({ count: visitCount }));
  next();
});

// Ruta para obtener el número de visitas
app.get('/visit-count', (req, res) => {
  res.json({ count: visitCount });
});

// Ruta de autenticación para el administrador
app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ token: ADMIN_TOKEN });
  } else {
    res.status(401).json({ error: 'Contraseña incorrecta' });
  }
});

// Middleware para verificar si el usuario es administrador
const isAdmin = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token === ADMIN_TOKEN) {
    next();
  } else {
    res.status(403).json({ error: 'No autorizado' });
  }
};

// Rutas para manejar productos
app.get('/products', (req, res) => res.json(products));

app.post('/products', isAdmin, upload.single('image'), (req, res) => {
  const { name, price, description } = req.body;
  const imageUrl = `/uploads/${req.file.filename}`;
  const newProduct = { id: products.length + 1, name, price, description, imageUrl };
  products.push(newProduct);
  res.json(newProduct);
});

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

// Iniciar servidor
const port = process.env.PORT || 5500;
app.listen(port, () => console.log(`Servidor corriendo en el puerto ${port}`));
