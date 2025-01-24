const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();

// Configuración de CORS
app.use(cors());  // Permitir CORS para todos los orígenes
// O, para permitir solo desde un origen específico:
// app.use(cors({
//     origin: 'http://127.0.0.1:5500' // Cambia esto a la URL de tu frontend
// }));

// Middleware para manejar datos JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
  fs.mkdirSync('uploads');
}

// Productos de ejemplo
let products = [
  {
    id: 1,
    name: "Producto 1",
    price: 20,
    imageUrl: "/uploads/1648772012327.jpg",  // Aquí puedes poner la imagen por defecto
    description: "Descripción del Producto 1"
  },
  {
    id: 2,
    name: "Producto 2",
    price: 35,
    imageUrl: "/uploads/1648772022327.jpg",  // Cambiar a la ruta de tus imágenes
    description: "Descripción del Producto 2"
  }
];

// Ruta para obtener los productos
app.get('/products', (req, res) => {
  res.json(products);
});

// Ruta para agregar un producto (solo admin)
app.post('/products', upload.single('image'), (req, res) => {
  const { name, price, description } = req.body;
  const imageUrl = `/uploads/${req.file.filename}`;  // Ruta de la imagen subida
  const newProduct = {
    id: products.length + 1,
    name,
    price,
    description,
    imageUrl
  };
  products.push(newProduct);
  res.json(newProduct);
});

// Ruta para eliminar un producto (solo admin)
app.delete('/products/:id', (req, res) => {
  const productId = parseInt(req.params.id);
  const productIndex = products.findIndex((product) => product.id === productId);

  if (productIndex === -1) {
    return res.status(404).json({ error: 'Producto no encontrado' });
  }

  products.splice(productIndex, 1);
  res.status(200).json({ message: 'Producto eliminado' });
});


// Servir archivos estáticos (como imágenes)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Iniciar el servidor
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor corriendo en el puerto ${port}`);
});
