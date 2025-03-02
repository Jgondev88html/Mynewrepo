// server.js
const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000; // Usa el puerto de Render o 3000 localmente

// Sirve los archivos estáticos (HTML, CSS, JS, imágenes)
app.use(express.static(path.join(__dirname, 'public')));

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Inicia el servidor
app.listen(port, () => {
    console.log(`Servidor corriendo en http://localhost:${port}`);
});
