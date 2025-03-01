const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const wss = new WebSocket.Server({ port: 8080 });
const usersFilePath = path.join(__dirname, 'users.json');

// Cargar datos de usuarios desde el archivo JSON
let users = {};

// Función para cargar usuarios desde el archivo JSON
function loadUsers() {
    try {
        if (fs.existsSync(usersFilePath)) {
            const data = fs.readFileSync(usersFilePath, 'utf8');
            if (data.trim() === '') {
                // Si el archivo está vacío, inicializarlo con un objeto vacío
                users = {};
                fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2), 'utf8');
            } else {
                users = JSON.parse(data);
            }
        } else {
            // Si el archivo no existe, crearlo con un objeto vacío
            users = {};
            fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2), 'utf8');
        }
    } catch (error) {
        console.error('Error al cargar usuarios:', error);
        users = {};
    }
}

// Cargar usuarios al iniciar el servidor
loadUsers();

// Función para guardar los datos de usuarios en el archivo JSON
function saveUsers() {
    try {
        fs.writeFileSync(usersFilePath, JSON.stringify(users, null, 2), 'utf8');
    } catch (error) {
        console.error('Error al guardar usuarios:', error);
    }
}

// Resto del código del servidor (igual que antes)...
