const WebSocket = require('ws');

// Iniciamos el servidor WebSocket en el puerto 8080
const wss = new WebSocket.Server({ port: 3000 }, () => {
  console.log('Servidor WebSocket iniciado en el puerto 8080');
});

// Almacenamiento en memoria para billeteras y transacciones
const wallets = {};
const transactions = [];

// Función para generar un ID único de billetera
function generateWalletId() {
  return 'WALLET-' + Math.random().toString(36).substr(2, 9).toUpperCase();
}

// Manejador de conexiones
wss.on('connection', (ws) => {
  console.log('Nuevo cliente conectado');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const action = data.action;

      switch (action) {

        // Crear una nueva billetera
        case 'create-wallet': {
          const walletId = generateWalletId();
          const initialBalance = 100; // saldo inicial
          wallets[walletId] = { balance: initialBalance, transactions: [] };

          ws.send(JSON.stringify({
            action: 'wallet-created',
            walletId,
            balance: initialBalance
          }));
          console.log(`Billetera creada: ${walletId}`);
          break;
        }

        // Registrar billetera existente o crear una nueva si no existe
        case 'register-wallet': {
          const walletId = data.walletId;
          if (!walletId || !wallets[walletId]) {
            // Si no existe, se crea una nueva billetera
            const newWalletId = generateWalletId();
            const initialBalance = 100;
            wallets[newWalletId] = { balance: initialBalance, transactions: [] };

            ws.send(JSON.stringify({
              action: 'wallet-created',
              walletId: newWalletId,
              balance: initialBalance
            }));
            console.log(`Billetera no encontrada. Se creó una nueva: ${newWalletId}`);
          } else {
            // Se devuelve la información de la billetera existente
            const balance = wallets[walletId].balance;
            ws.send(JSON.stringify({
              action: 'wallet-registered',
              walletId,
              balance
            }));
            console.log(`Billetera registrada: ${walletId}`);
          }
          break;
        }

        // Devolver el historial de transacciones de la billetera
        case 'get-transaction-history': {
          const walletId = data.walletId;
          const userTransactions = transactions.filter(tx => tx.senderId === walletId || tx.receiverId === walletId);
          ws.send(JSON.stringify({
            action: 'transaction-history',
            transactions: userTransactions
          }));
          console.log(`Historial solicitado para: ${walletId}`);
          break;
        }

        // Procesar una transacción
        case 'send-transaction': {
          const { senderId, receiverId, amount } = data;

          // Validaciones
          if (!wallets[senderId]) {
            ws.send(JSON.stringify({
              action: 'error',
              message: 'Billetera del remitente no encontrada'
            }));
            return;
          }
          if (!wallets[receiverId]) {
            ws.send(JSON.stringify({
              action: 'error',
              message: 'Billetera del destinatario no encontrada'
            }));
            return;
          }
          if (wallets[senderId].balance < amount) {
            ws.send(JSON.stringify({
              action: 'error',
              message: 'Saldo insuficiente'
            }));
            return;
          }

          // Procesar transacción
          wallets[senderId].balance -= amount;
          wallets[receiverId].balance += amount;

          // Crear objeto transacción
          const transaction = {
            senderId,
            receiverId,
            amount,
            date: new Date().toISOString()
          };
          transactions.push(transaction);
          wallets[senderId].transactions.push(transaction);
          wallets[receiverId].transactions.push(transaction);

          // Notificar al cliente
          ws.send(JSON.stringify({
            action: 'transaction-completed',
            newBalance: wallets[senderId].balance
          }));
          console.log(`Transacción completada: ${senderId} -> ${receiverId} por ${amount} NV`);
          break;
        }

        default: {
          ws.send(JSON.stringify({
            action: 'error',
            message: 'Acción no reconocida'
          }));
          console.log(`Acción no reconocida: ${action}`);
        }
      }
    } catch (error) {
      console.error('Error procesando mensaje:', error);
      ws.send(JSON.stringify({
        action: 'error',
        message: 'Error procesando mensaje'
      }));
    }
  });

  ws.on('close', () => {
    console.log('Cliente desconectado');
  });
});
