const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// Configuración optimizada
const PORT = process.env.PORT || 3000; // Usa el puerto de Render si existe
const WALLET_FILE = path.join(__dirname, 'wallets.json');
const INITIAL_BALANCE = 100;

// Helpers (sin cambios)
const getWeekNumber = (date) => {
    const firstDay = new Date(date.getFullYear(), 0, 1);
    return Math.ceil((((date - firstDay) / 86400000) + firstDay.getDay() + 1) / 7);
};

const generateWalletId = (clientId) => {
    const now = new Date();
    return `VC-${now.getFullYear()}-W${getWeekNumber(now)}-${clientId.slice(-8).toUpperCase()}`;
};

// Manejo de archivos MEJORADO
const readWallets = () => {
    try {
        if (!fs.existsSync(WALLET_FILE)) {
            fs.writeFileSync(WALLET_FILE, '[]', 'utf-8'); // Crea el archivo vacío
            return [];
        }
        const data = fs.readFileSync(WALLET_FILE, 'utf-8');
        return JSON.parse(data || '[]'); // Evita errores si el archivo está corrupto
    } catch (error) {
        console.error("Error leyendo wallets:", error);
        return []; // Retorna array vacío para evitar caídas
    }
};

const saveWallets = (wallets) => {
    try {
        fs.writeFileSync(WALLET_FILE, JSON.stringify(wallets, null, 2), 'utf-8');
        console.log("✅ Wallets guardados correctamente"); // Log para debug
        return true;
    } catch (error) {
        console.error("🚨 Error GUARDANDO wallets:", error);
        return false;
    }
};

// Servidor WebSocket (optimizado)
const wss = new WebSocket.Server({ port: PORT });

wss.on('connection', (ws) => {
    console.log('🔌 Nueva conexión');
    let clientId = null;

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            // Inicialización (con guardado automático)
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
                    if (!saveWallets(wallets)) throw new Error("Error al crear wallet");
                }

                ws.send(JSON.stringify({
                    action: 'wallet-info',
                    walletId: wallet.walletId,
                    balance: wallet.balance,
                    week: wallet.week,
                    year: wallet.year
                }));
            }

            // Transferencias (con doble validación)
            if (data.action === 'transfer' && clientId) {
                const wallets = readWallets();
                const sender = wallets.find(w => w.clientId === clientId);
                const receiver = wallets.find(w => w.walletId === data.receiverId);

                if (!sender || !receiver) throw new Error("Billetera no encontrada");
                if (sender.balance < data.amount) throw new Error("Saldo insuficiente");
                if (data.receiverId === sender.walletId) throw new Error("No puedes enviarte a ti mismo");

                sender.balance -= data.amount;
                receiver.balance += data.amount;

                if (!saveWallets(wallets)) throw new Error("Error al guardar la transacción");

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

        } catch (error) {
            console.error("⛔ Error en mensaje:", error.message);
            ws.send(JSON.stringify({
                action: 'error',
                message: error.message
            }));
        }
    });

    ws.on('close', () => {
        console.log('❌ Conexión cerrada:', clientId);
    });
});

console.log(`🚀 Servidor WebSocket en ws://localhost:${PORT}`);
