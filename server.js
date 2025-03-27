const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// Configuración
const PORT = 3000;
const WALLET_FILE = path.join(__dirname, 'wallets.json');
const INITIAL_BALANCE = 100;

// Helpers
const getWeekNumber = (date) => {
    const firstDay = new Date(date.getFullYear(), 0, 1);
    return Math.ceil((((date - firstDay) / 86400000) + firstDay.getDay() + 1) / 7);
};

const generateWalletId = (clientId) => {
    const now = new Date();
    return `VC-${now.getFullYear()}-W${getWeekNumber(now)}-${clientId.slice(-8).toUpperCase()}`;
};

// Manejo de archivos
const readWallets = () => {
    try {
        if (!fs.existsSync(WALLET_FILE)) {
            fs.writeFileSync(WALLET_FILE, JSON.stringify([]));
        }
        return JSON.parse(fs.readFileSync(WALLET_FILE));
    } catch (error) {
        console.error("Error reading wallets:", error);
        return [];
    }
};

const saveWallets = (wallets) => {
    try {
        fs.writeFileSync(WALLET_FILE, JSON.stringify(wallets, null, 2));
        return true;
    } catch (error) {
        console.error("Error saving wallets:", error);
        return false;
    }
};

// Servidor WebSocket
const wss = new WebSocket.Server({ port: PORT });

wss.on('connection', (ws) => {
    console.log('Nueva conexión');
    let clientId = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // Inicialización
            if (data.action === 'init') {
                clientId = data.clientId;
                const wallets = readWallets();
                let wallet = wallets.find(w => w.clientId === clientId);

                if (!wallet) {
                    wallet = {
                        walletId: generateWalletId(clientId),
                        clientId,
                        balance: INITIAL_BALANCE,
                        createdAt: new Date().toISOString(),
                        week: getWeekNumber(new Date()),
                        year: new Date().getFullYear()
                    };
                    wallets.push(wallet);
                    saveWallets(wallets);
                }

                ws.send(JSON.stringify({
                    action: 'wallet-info',
                    walletId: wallet.walletId,
                    balance: wallet.balance,
                    week: wallet.week,
                    year: wallet.year
                }));
            }

            // Transferencias
            if (data.action === 'transfer' && clientId) {
                const wallets = readWallets();
                const sender = wallets.find(w => w.clientId === clientId);
                const receiver = wallets.find(w => w.walletId === data.receiverId);

                if (!sender || !receiver) throw new Error("Billetera no encontrada");
                if (sender.balance < data.amount) throw new Error("Saldo insuficiente");
                if (data.receiverId === sender.walletId) throw new Error("No puedes enviarte a ti mismo");

                sender.balance -= data.amount;
                receiver.balance += data.amount;

                if (saveWallets(wallets)) {
                    ws.send(JSON.stringify({
                        action: 'transfer-success',
                        newBalance: sender.balance,
                        amount: data.amount
                    }));

                    // Notificar al receptor
                    wss.clients.forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                action: 'transfer-received',
                                amount: data.amount,
                                newBalance: receiver.balance,
                                senderId: sender.walletId
                            }));
                        }
                    });
                }
            }

        } catch (error) {
            console.error("Error:", error.message);
            ws.send(JSON.stringify({
                action: 'error',
                message: error.message
            }));
        }
    });

    ws.on('close', () => {
        console.log('Conexión cerrada:', clientId);
    });
});

console.log(`🚀 Servidor iniciado en ws://localhost:${PORT}`);
