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

let visitCount = 0;

// Ruta para leer el número de visitas desde el archivo `visitCount.json`
fs.readFile('visitCount.json', (err, data) => {
  if (err) {
    // Si el archivo no existe, crear uno con el contador en cero
    visitCount = 0;
    fs.writeFileSync('visitCount.json', JSON.stringify({ count: visitCount }));
  } else {
    // Si el archivo existe, leer el número de visitas
    visitCount = JSON.parse(data).count;
  }
});

// Middleware que se ejecuta en cada solicitud para incrementar el contador de visitas
app.use((req, res, next) => {
  visitCount += 1;
  // Guardar el contador actualizado en el archivo `visitCount.json`
  fs.writeFileSync('visitCount.json', JSON.stringify({ count: visitCount }));
  next(); // Continúa con la ejecución de las demás rutas
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
let visitCount = 0; // Contador de visitas

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
