const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuración
const CONFIG = {
    PORT: process.env.PORT || 3000,
    TRANSACTION_EXPIRATION: 60 * 60 * 1000, // 1 hora en ms
    MAX_TRANSACTION_HISTORY: 1000,
    LOG_FILE: 'transaction_history.log',
    PENDING_FILE: 'pending_transactions.json'
};

// Crear servidor HTTP
const server = http.createServer((req, res) => {
    try {
        if (req.url === '/') {
            fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
                if (err) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Error loading wallet interface');
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(data);
            });
        } else if (req.url === '/style.css') {
            res.writeHead(200, { 'Content-Type': 'text/css' });
            res.end(fs.readFileSync(path.join(__dirname, 'style.css')));
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
        }
    } catch (error) {
        console.error('HTTP server error:', error);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal server error');
    }
});

// Crear servidor WebSocket
const wss = new WebSocket.Server({ server });

// Estructuras de datos
const clients = new Map();
const pendingTransactions = new Map();
const transactionHistory = [];

// Función para generar IDs de transacción seguros
function generateTransactionId() {
    return `tx-${crypto.randomBytes(8).toString('hex')}`;
}

// Función para devolver fondos al remitente
function returnFundsToSender(tx) {
    try {
        const pendingTxs = pendingTransactions.get(tx.to) || [];
        const txIndex = pendingTxs.findIndex(t => t.id === tx.id);

        if (txIndex !== -1) {
            pendingTxs.splice(txIndex, 1);
            if (pendingTxs.length === 0) {
                pendingTransactions.delete(tx.to);
            }

            tx.status = 'returned';
            tx.returnTimestamp = new Date().toISOString();

            const senderWs = clients.get(tx.from);
            if (senderWs && senderWs.readyState === WebSocket.OPEN) {
                senderWs.send(JSON.stringify({
                    type: 'transaction_returned',
                    ...tx,
                    message: 'Funds returned - recipient did not claim within the time limit'
                }));
            }

            transactionHistory.push(tx);
            console.log(`Funds returned to ${tx.from} - recipient ${tx.to} did not claim in time`);
        }
    } catch (error) {
        console.error('Error returning funds:', error);
    }
}

// Cargar transacciones pendientes al iniciar
async function loadPendingTransactions() {
    try {
        if (fs.existsSync(CONFIG.PENDING_FILE)) {
            const data = await fs.promises.readFile(CONFIG.PENDING_FILE, 'utf8');
            const savedPending = JSON.parse(data);

            for (const [walletId, txs] of Object.entries(savedPending)) {
                pendingTransactions.set(walletId, txs.map(tx => {
                    const remainingTime = new Date(tx.expiresAt).getTime() - Date.now();
                    if (remainingTime > 0) {
                        tx.returnTimeout = setTimeout(() => {
                            returnFundsToSender(tx);
                        }, remainingTime);
                        return tx;
                    } else {
                        returnFundsToSender(tx);
                        return null;
                    }
                }).filter(tx => tx !== null));
            }
            console.log(`Loaded ${pendingTransactions.size} pending transactions`);
        }
    } catch (e) {
        console.error('Error loading pending transactions:', e);
    }
}

// Manejo de conexiones WebSocket
wss.on('connection', (ws) => {
    console.log('New WebSocket connection');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            // Validación básica del mensaje
            if (!data.type || typeof data.type !== 'string') {
                ws.send(JSON.stringify({
                    type: 'error',
                    message: 'Invalid message format'
                }));
                return;
            }

            switch (data.type) {
                case 'register':
                    handleRegister(ws, data);
                    break;

                case 'transaction':
                    handleTransaction(ws, data);
                    break;

                case 'get_transactions':
                    handleGetTransactions(ws, data);
                    break;

                default:
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Unknown message type'
                    }));
            }
        } catch (error) {
            console.error('Error processing message:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Error processing request'
            }));
        }
    });

    ws.on('close', () => {
        for (const [walletId, clientWs] of clients.entries()) {
            if (clientWs === ws) {
                clients.delete(walletId);
                console.log(`Wallet disconnected: ${walletId}`);
                break;
            }
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Manejador de registro
function handleRegister(ws, data) {
    if (!data.walletId || typeof data.walletId !== 'string') {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Invalid wallet ID'
        }));
        return;
    }

    if (clients.has(data.walletId)) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Wallet ID already in use'
        }));
        return;
    }

    clients.set(data.walletId, ws);
    console.log(`Wallet registered: ${data.walletId}`);

    // Entregar transacciones pendientes si las hay
    if (pendingTransactions.has(data.walletId)) {
        const pending = pendingTransactions.get(data.walletId);
        pending.forEach(tx => {
            if (tx.returnTimeout) {
                clearTimeout(tx.returnTimeout);
            }

            tx.status = 'completed';
            tx.completedTimestamp = new Date().toISOString();
            ws.send(JSON.stringify({
                type: 'transaction',
                ...tx
            }));
        });
        pendingTransactions.delete(data.walletId);
        console.log(`Delivered ${pending.length} pending transactions to ${data.walletId}`);
    }

    ws.send(JSON.stringify({
        type: 'registered',
        walletId: data.walletId,
        message: 'Wallet registered successfully'
    }));
}

// Manejador de transacciones
function handleTransaction(ws, data) {
    if (!data.from || !data.to || !data.amount) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Incomplete transaction data'
        }));
        return;
    }

    if (data.from === data.to) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Cannot send funds to yourself'
        }));
        return;
    }

    const amount = parseFloat(data.amount);
    if (isNaN(amount) || amount <= 0) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Invalid amount'
        }));
        return;
    }

    // Crear transacción con expiración
    const tx = {
        id: generateTransactionId(),
        from: data.from,
        to: data.to,
        amount: amount.toFixed(6),
        timestamp: new Date().toISOString(),
        status: 'pending',
        expiresAt: new Date(Date.now() + CONFIG.TRANSACTION_EXPIRATION).toISOString()
    };

    // Verificar si el destinatario está conectado
    const recipientWs = clients.get(data.to);
    if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
        tx.status = 'completed';
        tx.completedTimestamp = new Date().toISOString();
        recipientWs.send(JSON.stringify({
            type: 'transaction',
            ...tx
        }));
    } else {
        // Almacenar transacción pendiente
        if (!pendingTransactions.has(data.to)) {
            pendingTransactions.set(data.to, []);
        }

        tx.returnTimeout = setTimeout(() => {
            returnFundsToSender(tx);
        }, CONFIG.TRANSACTION_EXPIRATION);

        pendingTransactions.get(data.to).push(tx);
        console.log(`Transaction queued for offline recipient: ${data.to}`);
    }

    transactionHistory.push(tx);
    ws.send(JSON.stringify({
        type: 'transaction_success',
        ...tx
    }));
}

// Manejador de solicitud de historial
function handleGetTransactions(ws, data) {
    if (!data.walletId) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Wallet ID required'
        }));
        return;
    }

    const walletHistory = transactionHistory.filter(
        tx => tx.from === data.walletId || tx.to === data.walletId
    );

    ws.send(JSON.stringify({
        type: 'transaction_history',
        transactions: walletHistory
    }));
}

// Mantenimiento periódico
async function performMaintenance() {
    try {
        // Guardar historial de transacciones
        if (transactionHistory.length > 0) {
            await fs.promises.appendFile(CONFIG.LOG_FILE,
                JSON.stringify(transactionHistory.slice(-100)) + '\n');
        }

        // Guardar transacciones pendientes
        const pendingToSave = {};
        for (const [walletId, txs] of pendingTransactions.entries()) {
            pendingToSave[walletId] = txs.map(tx => {
                const { returnTimeout, ...rest } = tx;
                return rest;
            });
        }
        await fs.promises.writeFile(CONFIG.PENDING_FILE, JSON.stringify(pendingToSave));

        // Limitar tamaño del historial
        if (transactionHistory.length > CONFIG.MAX_TRANSACTION_HISTORY) {
            transactionHistory.splice(0, transactionHistory.length - CONFIG.MAX_TRANSACTION_HISTORY);
        }
    } catch (error) {
        console.error('Maintenance error:', error);
    }
}

// Iniciar servidor
async function startServer() {
    await loadPendingTransactions();

    setInterval(performMaintenance, 60000); // Ejecutar cada minuto

    server.listen(CONFIG.PORT, () => {
        console.log(`FastTransfer Wallet Server running on http://localhost:${CONFIG.PORT}`);
        console.log(`WebSocket endpoint: ws://localhost:${CONFIG.PORT}`);
    });
}

startServer().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});

// Manejo de cierre limpio
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    performMaintenance().finally(() => {
        server.close(() => {
            console.log('Server closed');
            process.exit(0);
        });
    });
});
