const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Create HTTP server
const server = http.createServer((req, res) => {
    if (req.url === '/') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading wallet interface');
                return;
            }
            res.writeHead(200, {'Content-Type': 'text/html'});
            res.end(data);
        });
    } else if (req.url === '/style.css') {
        res.writeHead(200, {'Content-Type': 'text/css'});
        res.end(fs.readFileSync(path.join(__dirname, 'style.css')));
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Data structures
const clients = new Map();
const pendingTransactions = new Map();
const transactionHistory = [];

// Function to return funds to sender
function returnFundsToSender(tx) {
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
                message: `Funds returned - recipient did not claim within 1 hour`
            }));
        }
        
        transactionHistory.push(tx);
        console.log(`Funds returned to ${tx.from} - recipient ${tx.to} did not claim within 1 hour`);
    }
}

// Load pending transactions on startup
function loadPendingTransactions() {
    try {
        if (fs.existsSync('pending_transactions.json')) {
            const data = fs.readFileSync('pending_transactions.json', 'utf8');
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
            console.log(`Loaded pending transactions from file`);
        }
    } catch (e) {
        console.error('Error loading pending transactions:', e);
    }
}

loadPendingTransactions();

wss.on('connection', (ws) => {
    console.log('New connection established');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'register') {
                if (clients.has(data.walletId)) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Wallet ID already in use'
                    }));
                    return;
                }

                clients.set(data.walletId, ws);
                console.log(`Wallet registered: ${data.walletId}`);

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

            } else if (data.type === 'transaction') {
                console.log(`Processing transaction from ${data.from} to ${data.to} for ${data.amount} FTC`);

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

                // Transaction with 1 hour expiration
                const tx = {
                    id: `tx-${Date.now()}`,
                    from: data.from,
                    to: data.to,
                    amount: amount.toFixed(6),
                    timestamp: new Date().toISOString(),
                    status: 'pending',
                    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour
                };

                const recipientWs = clients.get(data.to);
                if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
                    tx.status = 'completed';
                    tx.completedTimestamp = new Date().toISOString();
                    recipientWs.send(JSON.stringify({
                        type: 'transaction',
                        ...tx
                    }));
                } else {
                    if (!pendingTransactions.has(data.to)) {
                        pendingTransactions.set(data.to, []);
                    }
                    
                    tx.returnTimeout = setTimeout(() => {
                        returnFundsToSender(tx);
                    }, 60 * 60 * 1000); // 1 hour
                    
                    pendingTransactions.get(data.to).push(tx);
                    console.log(`Transaction queued for offline recipient: ${data.to}`);
                }

                transactionHistory.push(tx);
                ws.send(JSON.stringify({
                    type: 'transaction_success',
                    ...tx
                }));

            } else if (data.type === 'get_transactions') {
                const walletHistory = transactionHistory.filter(
                    tx => tx.from === data.walletId || tx.to === data.walletId
                );
                ws.send(JSON.stringify({
                    type: 'transaction_history',
                    transactions: walletHistory
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

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`FastTransfer Wallet Server running on http://localhost:${PORT}`);
    console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
});

// Periodic maintenance
setInterval(() => {
    if (transactionHistory.length > 0) {
        fs.appendFileSync('transaction_history.log', 
            JSON.stringify(transactionHistory.slice(-100)) + '\n');
    }

    const pendingToSave = {};
    for (const [walletId, txs] of pendingTransactions.entries()) {
        pendingToSave[walletId] = txs.map(tx => {
            const { returnTimeout, ...rest } = tx;
            return rest;
        });
    }
    fs.writeFileSync('pending_transactions.json', JSON.stringify(pendingToSave));

    if (transactionHistory.length > 1000) {
        transactionHistory.splice(0, transactionHistory.length - 1000);
    }
}, 60000); // Run every minute
