const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const port = process.env.PORT || 3000;

// Middleware para parsear JSON
app.use(express.json());

// Servir archivos estáticos (HTML, CSS, JS)
app.use(express.static('public'));

// Ruta para recibir y guardar la foto
app.post('/upload', (req, res) => {
    const { image } = req.body;

    // Eliminar el prefijo "data:image/jpeg;base64,"
    const base64Data = image.replace(/^data:image\/jpeg;base64,/, '');

    // Crear un nombre único para la imagen
    const imageName = `photo_${Date.now()}.jpg`;
    const imagePath = path.join(__dirname, 'uploads', imageName);

    // Guardar la imagen en el servidor
    fs.writeFile(imagePath, base64Data, 'base64', (err) => {
        if (err) {
            console.error('Error al guardar la imagen:', err);
            return res.status(500).json({ success: false, message: 'Error al guardar la imagen' });
        }

        console.log('Imagen guardada:', imageName);
        res.json({ success: true, message: 'Imagen guardada correctamente', imageName });

        // Notificar a los clientes WebSocket sobre la nueva imagen
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'new_image', imageName }));
            }
        });
    });
});

// Ruta para mostrar las fotos guardadas
app.get('/fotos', (req, res) => {
    const uploadsDir = path.join(__dirname, 'uploads');

    // Leer la lista de archivos en la carpeta "uploads"
    fs.readdir(uploadsDir, (err, files) => {
        if (err) {
            console.error('Error al leer la carpeta uploads:', err);
            return res.status(500).send('Error al cargar las fotos');
        }

        // Filtrar solo archivos de imagen
        const images = files.filter(file => file.endsWith('.jpg') || file.endsWith('.png'));

        // Generar HTML para mostrar las imágenes
        const html = `
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Fotos Guardadas</title>
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        background-color: #f0f0f0;
                        padding: 20px;
                    }
                    h1 {
                        text-align: center;
                    }
                    .gallery {
                        display: flex;
                        flex-wrap: wrap;
                        gap: 10px;
                        justify-content: center;
                    }
                    .gallery img {
                        max-width: 100%;
                        height: auto;
                        border-radius: 10px;
                        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
                    }
                </style>
            </head>
            <body>
                <h1>Fotos Guardadas</h1>
                <div class="gallery">
                    ${images.map(image => `<img src="/uploads/${image}" alt="${image}">`).join('')}
                </div>
            </body>
            </html>
        `;

        res.send(html);
    });
});

// Crear la carpeta "uploads" si no existe
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Configurar WebSocket
wss.on('connection', (ws) => {
    console.log('Nuevo cliente WebSocket conectado');

    // Enviar un mensaje de bienvenida al cliente
    ws.send(JSON.stringify({ type: 'message', text: 'Estas vigilado...' }));

    // Manejar mensajes del cliente
    ws.on('message', (message) => {
        console.log('Mensaje recibido del cliente:', message.toString());
    });

    // Manejar cierre de conexión
    ws.on('close', () => {
        console.log('Cliente WebSocket desconectado');
    });
});

// Iniciar el servidor
server.listen(port, () => {
    console.log(`Servidor corriendo en http://localhost:${port}`);
});
