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
    PENDING_FILE: 'pending_transactions.json',
    WALLET_ID_MIN_LENGTH: 8,
    WALLET_ID_MAX_LENGTH: 64
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

// Función para validar IDs de billetera
function isValidWalletId(walletId) {
    return typeof walletId === 'string' && 
           walletId.length >= CONFIG.WALLET_ID_MIN_LENGTH && 
           walletId.length <= CONFIG.WALLET_ID_MAX_LENGTH &&
           /^[a-zA-Z0-9_-]+$/.test(walletId);
}

// Función para generar IDs de transacción seguros
function generateTransactionId() {
    return `tx-${crypto.randomBytes(8).toString('hex')}`;
}

// Función para validar IDs de transacción
function isValidTransactionId(txId) {
    return typeof txId === 'string' && 
           txId.startsWith('tx-') && 
           txId.length === 20 && 
           /^tx-[a-f0-9]+$/.test(txId);
}

// Función para devolver fondos al remitente
async function returnFundsToSender(tx) {
    try {
        // Verificar si la transacción ya fue procesada
        if (tx.status !== 'pending') return;

        // Buscar en transacciones pendientes
        const pendingTxs = pendingTransactions.get(tx.to) || [];
        const txIndex = pendingTxs.findIndex(t => t.id === tx.id);

        if (txIndex !== -1) {
            pendingTxs.splice(txIndex, 1);
            if (pendingTxs.length === 0) {
                pendingTransactions.delete(tx.to);
            }
        }

        // Actualizar estado
        tx.status = 'returned';
        tx.returnTimestamp = new Date().toISOString();
        
        // Notificar al remitente si está conectado
        const senderWs = clients.get(tx.from);
        if (senderWs && senderWs.readyState === WebSocket.OPEN) {
            senderWs.send(JSON.stringify({
                type: 'transaction_returned',
                ...tx,
                message: 'Funds returned - recipient did not claim within the time limit'
            }));
        }

        // Registrar en el historial
        transactionHistory.push(tx);
        console.log(`Funds returned to ${tx.from} - transaction ${tx.id} expired`);

        // Guardar cambios
        await performMaintenance();

    } catch (error) {
        console.error('Error in returnFundsToSender:', error);
        // Reintentar después de un tiempo si falla
        setTimeout(() => returnFundsToSender(tx), 5000);
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
                    await handleTransaction(ws, data);
                    break;

                case 'get_transactions':
                    handleGetTransactions(ws, data);
                    break;

                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong' }));
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
    try {
        if (!data.walletId || !isValidWalletId(data.walletId)) {
            throw new Error(`Invalid wallet ID format (${CONFIG.WALLET_ID_MIN_LENGTH}-${CONFIG.WALLET_ID_MAX_LENGTH} alphanumeric chars)`);
        }

        if (clients.has(data.walletId)) {
            // Verificar si la conexión anterior sigue activa
            const existingWs = clients.get(data.walletId);
            if (existingWs.readyState === WebSocket.OPEN) {
                throw new Error('Wallet ID already in use');
            } else {
                // Eliminar conexión muerta
                clients.delete(data.walletId);
            }
        }

        clients.set(data.walletId, ws);
        console.log(`Wallet registered: ${data.walletId}`);

        // Entregar transacciones pendientes si las hay
        if (pendingTransactions.has(data.walletId)) {
            const pending = pendingTransactions.get(data.walletId);
            const delivered = [];
            const failed = [];

            pending.forEach(tx => {
                try {
                    if (tx.returnTimeout) {
                        clearTimeout(tx.returnTimeout);
                    }

                    tx.status = 'completed';
                    tx.completedTimestamp = new Date().toISOString();
                    ws.send(JSON.stringify({
                        type: 'transaction',
                        ...tx
                    }));
                    delivered.push(tx);
                } catch (sendError) {
                    console.error(`Error delivering pending tx ${tx.id}:`, sendError);
                    failed.push(tx);
                }
            });

            if (failed.length > 0) {
                pendingTransactions.set(data.walletId, failed);
            } else {
                pendingTransactions.delete(data.walletId);
            }

            console.log(`Delivered ${delivered.length} pending transactions to ${data.walletId}`);
        }

        ws.send(JSON.stringify({
            type: 'registered',
            walletId: data.walletId,
            message: 'Wallet registered successfully'
        }));

    } catch (error) {
        console.error('Registration error:', error.message);
        ws.send(JSON.stringify({
            type: 'registration_error',
            message: error.message
        }));
    }
}

// Manejador de transacciones
async function handleTransaction(ws, data) {
    let tx;
    try {
        // Validación básica
        if (!data.from || !data.to || !data.amount) {
            throw new Error('Incomplete transaction data');
        }

        // Validación de IDs
        if (!isValidWalletId(data.from) || !isValidWalletId(data.to)) {
            throw new Error('Invalid wallet ID format');
        }

        if (data.from === data.to) {
            throw new Error('Cannot send funds to yourself');
        }

        const amount = parseFloat(data.amount);
        if (isNaN(amount)) {
            throw new Error('Amount must be a number');
        }
        
        if (amount <= 0) {
            throw new Error('Amount must be positive');
        }

        // Verificar que el remitente esté registrado
        if (!clients.has(data.from)) {
            throw new Error('Sender wallet not registered');
        }

        // Crear transacción con expiración
        tx = {
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
            try {
                // Notificar al destinatario
                recipientWs.send(JSON.stringify({
                    type: 'transaction',
                    ...tx
                }));
                
                tx.status = 'completed';
                tx.completedTimestamp = new Date().toISOString();
            } catch (sendError) {
                console.error(`Error sending to recipient ${data.to}:`, sendError);
                throw new Error('Failed to deliver transaction to recipient');
            }
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

        // Registrar transacción
        transactionHistory.push(tx);
        
        // Notificar éxito al remitente
        ws.send(JSON.stringify({
            type: 'transaction_success',
            ...tx
        }));

    } catch (error) {
        console.error('Transaction error:', error.message);
        ws.send(JSON.stringify({
            type: 'transaction_error',
            message: error.message,
            transaction: data
        }));
        
        // Si hubo un error después de crear la transacción pero antes de completarla
        if (tx && tx.status === 'pending') {
            await returnFundsToSender(tx);
        }
    }
}

// Manejador de solicitud de historial
function handleGetTransactions(ws, data) {
    try {
        if (!data.walletId || !isValidWalletId(data.walletId)) {
            throw new Error('Valid wallet ID required');
        }

        const walletHistory = transactionHistory.filter(
            tx => tx.from === data.walletId || tx.to === data.walletId
        );

        ws.send(JSON.stringify({
            type: 'transaction_history',
            transactions: walletHistory
        }));
    } catch (error) {
        console.error('Error getting transactions:', error.message);
        ws.send(JSON.stringify({
            type: 'error',
            message: error.message
        }));
    }
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
    try {
        await loadPendingTransactions();

        // Mantenimiento cada minuto
        setInterval(performMaintenance, 60000);

        // Heartbeat para conexiones WebSocket
        setInterval(() => {
            wss.clients.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.ping();
                }
            });
        }, 30000);

        server.listen(CONFIG.PORT, () => {
            console.log(`FastTransfer Wallet Server running on http://localhost:${CONFIG.PORT}`);
            console.log(`WebSocket endpoint: ws://localhost:${CONFIG.PORT}`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

startServer();

// Manejo de cierre limpio
process.on('SIGINT', async () => {
    console.log('Shutting down server...');
    try {
        await performMaintenance();
        server.close(() => {
            console.log('Server closed');
            process.exit(0);
        });
    } catch (err) {
        console.error('Error during shutdown:', err);
        process.exit(1);
    }
});
