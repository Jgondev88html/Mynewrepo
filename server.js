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
const clients = new Map();          // Active connections: {walletId: ws}
const pendingTransactions = new Map(); // Pending transactions: {walletId: [transactions]}
const transactionHistory = [];      // Complete transaction log

wss.on('connection', (ws) => {
    console.log('New connection established');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'register') {
                // Handle wallet registration
                if (clients.has(data.walletId)) {
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Wallet ID already in use'
                    }));
                    return;
                }

                clients.set(data.walletId, ws);
                console.log(`Wallet registered: ${data.walletId}`);

                // Process any pending transactions for this wallet
                if (pendingTransactions.has(data.walletId)) {
                    const pending = pendingTransactions.get(data.walletId);
                    pending.forEach(tx => {
                        tx.status = 'completed';
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

                // Validate transaction
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

                // Create transaction record
                const tx = {
                    id: `tx-${Date.now()}`,
                    from: data.from,
                    to: data.to,
                    amount: amount.toFixed(6),
                    timestamp: new Date().toISOString(),
                    status: 'pending'
                };

                // Try to deliver to recipient
                const recipientWs = clients.get(data.to);
                if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
                    tx.status = 'completed';
                    recipientWs.send(JSON.stringify({
                        type: 'transaction',
                        ...tx
                    }));
                } else {
                    // Store for later delivery
                    if (!pendingTransactions.has(data.to)) {
                        pendingTransactions.set(data.to, []);
                    }
                    pendingTransactions.get(data.to).push(tx);
                    console.log(`Transaction queued for offline recipient: ${data.to}`);
                }

                // Add to history and confirm to sender
                transactionHistory.push(tx);
                ws.send(JSON.stringify({
                    type: 'transaction_success',
                    ...tx
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
        // Clean up disconnected clients
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
    // Save transaction history to disk
    if (transactionHistory.length > 0) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            transactionCount: transactionHistory.length,
            pendingTransactions: Array.from(pendingTransactions.entries()).reduce((acc, [walletId, txs]) => {
                acc[walletId] = txs.length;
                return acc;
            }, {})
        };

        fs.appendFile('transactions.log', JSON.stringify(logEntry) + '\n', (err) => {
            if (err) console.error('Error writing transaction log:', err);
        });
    }

    // Clean up old transactions
    if (transactionHistory.length > 1000) {
        transactionHistory.splice(0, transactionHistory.length - 1000);
    }
}, 60000); // Run every minute
