// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const users = {};
const MAX_LIVES = 3;
const COIN_PENALTY = 50;
const WITHDRAW_THRESHOLD = 250;

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        if (data.type === 'login') {
            users[ws.id] = { ...data, lives: MAX_LIVES, coins: 0 };
            ws.id = data.username;
            ws.send(JSON.stringify({ type: 'loginSuccess', user: users[ws.id] }));
        } else if (data.type === 'gameOver') {
            const user = users[ws.id];
            user.lives -= 1;
            user.coins -= COIN_PENALTY;
            if (user.lives <= 0) {
                user.lives = 0;
            }
            ws.send(JSON.stringify({ type: 'update', user }));
        } else if (data.type === 'withdraw') {
            const user = users[ws.id];
            if (user.coins >= WITHDRAW_THRESHOLD) {
                sendWithdrawalEmail(data.email, data.phone, data.amount);
                user.coins -= data.amount;
                ws.send(JSON.stringify({ type: 'update', user }));
            }
        }
    });
});

function sendWithdrawalEmail(email, phone, amount) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: 'tuemail@gmail.com',
            pass: 'tucontraseña'
        }
    });

    const mailOptions = {
        from: 'tuemail@gmail.com',
        to: 'tuemail@gmail.com',
        subject: 'Solicitud de Retiro',
        text: `El usuario con el número de teléfono ${phone} ha solicitado un retiro de ${amount} monedas.`
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.log(error);
        } else {
            console.log('Email enviado: ' + info.response);
        }
    });
}

server.listen(3000, () => {
    console.log('Servidor escuchando en el puerto 3000');
});
