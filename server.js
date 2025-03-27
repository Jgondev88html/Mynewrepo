const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// Configuración optimizada para Render
const PORT = process.env.PORT || 3000;
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

// Manejo de archivos mejorado (con retry)
const readWallets = () => {
    try {
        if (!fs.existsSync(WALLET_FILE)) {
            fs.writeFileSync(WALLET_FILE, '[]', 'utf-8');
            return [];
        }
        const data = fs.readFileSync(WALLET_FILE, 'utf-8');
        return JSON.parse(data || '[]');
    } catch (error) {
        console.error("Error leyendo wallets, recreando archivo...", error);
        fs.writeFileSync(WALLET_FILE, '[]', 'utf-8');
        return [];
    }
};

const saveWallets = (wallets) => {
    try {
        fs.writeFileSync(WALLET_FILE, JSON.stringify(wallets, null, 2), 'utf-8');
        return true;
    } catch (error) {
        console.error("Error guardando wallets (reintentando)...", error);
        // Intento de recuperación
        try {
            fs.writeFileSync(WALLET_FILE + '.bak', JSON.stringify(wallets));
            return true;
        } catch (e) {
            console.error("Error crítico al guardar backup", e);
            return false;
        }
    }
};

// Servidor WebSocket con manejo de errores
const wss = new WebSocket.Server({ port: PORT });

// Heartbeat para conexiones estables
setInterval(() => {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.ping('HB', false, (err) => {
                if (err) console.error("Error en ping:", err.message);
            });
        }
    });
}, 30000); // Cada 30 segundos

// Manejo de errores globales
wss.on('error', (error) => {
    console.error('⚠️ Error del servidor:', error.message);
});

wss.on('connection', (ws) => {
    console.log('🔌 Nueva conexión');
    let clientId = null;

    // Manejo de errores por conexión
    ws.on('error', (error) => {
        console.error(`⛔ Error en ${clientId || 'cliente no identificado'}:`, error.message);
    });

    ws.on('message', async (message) => {
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
                    if (!saveWallets(wallets)) throw new Error("Error persistente al crear wallet");
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

                if (!saveWallets(wallets)) throw new Error("Error al guardar transacción");

                ws.send(JSON.stringify({
                    action: 'transfer-success',
                    newBalance: sender.balance,
                    amount: data.amount
                }));

                // Notificar al receptor
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN && client !== ws) {
                        client.send(JSON.stringify({
                            action: 'transfer-received',
                            amount: data.amount,
                            newBalance: receiver.balance,
                            senderId: sender.walletId
                        }));
                    }
                });
            }

        } catch (error) {
            console.error("Error procesando mensaje:", error.message);
            ws.send(JSON.stringify({
                action: 'error',
                message: error.message
            }));
        }
    });

    ws.on('close', () => {
        console.log(`❌ Conexión cerrada: ${clientId || 'cliente desconocido'}`);
    });
});

console.log(`🚀 Servidor WebSocket escuchando en puerto ${PORT}`);
