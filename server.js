const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();

// Iniciamos el servidor WebSocket
const wss = new WebSocket.Server({ port: 3000 }, () => {
  console.log('Servidor WebSocket iniciado en el puerto 3000');
});

// Conexión a la base de datos SQLite
const db = new sqlite3.Database('./wallets.db', (err) => {
  if (err) {
    console.error('Error al conectar a la base de datos:', err.message);
  } else {
    console.log('Conectado a la base de datos SQLite');
    
    // Crear tablas si no existen
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS wallets (
          id TEXT PRIMARY KEY,
          balance REAL NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      
      db.run(`
        CREATE TABLE IF NOT EXISTS transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sender_id TEXT NOT NULL,
          receiver_id TEXT NOT NULL,
          amount REAL NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (sender_id) REFERENCES wallets (id),
          FOREIGN KEY (receiver_id) REFERENCES wallets (id)
        )
      `);
    });
  }
});

// Función para generar un ID único de billetera
function generateWalletId() {
  return 'WALLET-' + Math.random().toString(36).substr(2, 9).toUpperCase();
}

// Almacenar billeteras activas (solo para sesión actual)
const activeWallets = new Map();

// Manejador de conexiones
wss.on('connection', (ws) => {
  console.log('Nuevo cliente conectado');

  // Asociar una billetera a esta conexión
  let currentWalletId = null;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      const action = data.action;

      switch (action) {
        // Crear una nueva billetera
        case 'create-wallet': {
          if (currentWalletId) {
            ws.send(JSON.stringify({
              action: 'error',
              message: 'Ya tienes una billetera asociada'
            }));
            return;
          }

          const walletId = generateWalletId();
          const initialBalance = 100;
          
          db.run(
            'INSERT INTO wallets (id, balance) VALUES (?, ?)',
            [walletId, initialBalance],
            function(err) {
              if (err) {
                ws.send(JSON.stringify({
                  action: 'error',
                  message: 'Error al crear billetera'
                }));
                console.error('Error al crear billetera:', err);
                return;
              }
              
              currentWalletId = walletId;
              activeWallets.set(ws, walletId);
              
              ws.send(JSON.stringify({
                action: 'wallet-created',
                walletId,
                balance: initialBalance
              }));
              console.log(`Billetera creada: ${walletId}`);
            }
          );
          break;
        }

        // Conectar con una billetera existente
        case 'connect-wallet': {
          const walletId = data.walletId;
          
          if (!walletId) {
            ws.send(JSON.stringify({
              action: 'error',
              message: 'Debes proporcionar un ID de billetera'
            }));
            return;
          }
          
          // Verificar si la billetera existe
          db.get(
            'SELECT balance FROM wallets WHERE id = ?',
            [walletId],
            function(err, row) {
              if (err) {
                ws.send(JSON.stringify({
                  action: 'error',
                  message: 'Error al verificar billetera'
                }));
                console.error('Error al verificar billetera:', err);
                return;
              }
              
              if (!row) {
                ws.send(JSON.stringify({
                  action: 'error',
                  message: 'Billetera no encontrada'
                }));
                return;
              }
              
              // Asociar esta billetera al cliente
              currentWalletId = walletId;
              activeWallets.set(ws, walletId);
              
              ws.send(JSON.stringify({
                action: 'wallet-connected',
                walletId,
                balance: row.balance
              }));
              console.log(`Billetera conectada: ${walletId}`);
            }
          );
          break;
        }

        // Obtener historial de transacciones
        case 'get-transaction-history': {
          if (!currentWalletId) {
            ws.send(JSON.stringify({
              action: 'error',
              message: 'No tienes una billetera conectada'
            }));
            return;
          }
          
          db.all(
            `SELECT * FROM transactions 
             WHERE sender_id = ? OR receiver_id = ? 
             ORDER BY created_at DESC`,
            [currentWalletId, currentWalletId],
            function(err, rows) {
              if (err) {
                ws.send(JSON.stringify({
                  action: 'error',
                  message: 'Error al obtener historial'
                }));
                console.error('Error al obtener historial:', err);
                return;
              }
              
              ws.send(JSON.stringify({
                action: 'transaction-history',
                transactions: rows
              }));
              console.log(`Historial solicitado para: ${currentWalletId}`);
            }
          );
          break;
        }

        // Enviar transacción
        case 'send-transaction': {
          if (!currentWalletId) {
            ws.send(JSON.stringify({
              action: 'error',
              message: 'No tienes una billetera conectada'
            }));
            return;
          }
          
          const { receiverId, amount } = data;
          
          // Validaciones básicas
          if (!receiverId || !amount || amount <= 0) {
            ws.send(JSON.stringify({
              action: 'error',
              message: 'Datos de transacción inválidos'
            }));
            return;
          }
          
          if (currentWalletId === receiverId) {
            ws.send(JSON.stringify({
              action: 'error',
              message: 'No puedes enviar fondos a ti mismo'
            }));
            return;
          }
          
          // Usamos una transacción para asegurar la consistencia
          db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            
            // Verificar saldo del remitente
            db.get(
              'SELECT balance FROM wallets WHERE id = ?',
              [currentWalletId],
              function(err, sender) {
                if (err) {
                  db.run('ROLLBACK');
                  ws.send(JSON.stringify({
                    action: 'error',
                    message: 'Error al verificar saldo'
                  }));
                  console.error('Error al verificar saldo:', err);
                  return;
                }
                
                if (sender.balance < amount) {
                  db.run('ROLLBACK');
                  ws.send(JSON.stringify({
                    action: 'error',
                    message: 'Saldo insuficiente'
                  }));
                  return;
                }
                
                // Verificar existencia del destinatario
                db.get(
                  'SELECT id FROM wallets WHERE id = ?',
                  [receiverId],
                  function(err, receiver) {
                    if (err) {
                      db.run('ROLLBACK');
                      ws.send(JSON.stringify({
                        action: 'error',
                        message: 'Error al verificar destinatario'
                      }));
                      console.error('Error al verificar destinatario:', err);
                      return;
                    }
                    
                    if (!receiver) {
                      db.run('ROLLBACK');
                      ws.send(JSON.stringify({
                        action: 'error',
                        message: 'Billetera del destinatario no encontrada'
                      }));
                      return;
                    }
                    
                    // Actualizar saldos
                    db.run(
                      'UPDATE wallets SET balance = balance - ? WHERE id = ?',
                      [amount, currentWalletId],
                      function(err) {
                        if (err) {
                          db.run('ROLLBACK');
                          ws.send(JSON.stringify({
                            action: 'error',
                            message: 'Error al actualizar saldo del remitente'
                          }));
                          console.error('Error al actualizar saldo remitente:', err);
                          return;
                        }
                        
                        db.run(
                          'UPDATE wallets SET balance = balance + ? WHERE id = ?',
                          [amount, receiverId],
                          function(err) {
                            if (err) {
                              db.run('ROLLBACK');
                              ws.send(JSON.stringify({
                                action: 'error',
                                message: 'Error al actualizar saldo del destinatario'
                              }));
                              console.error('Error al actualizar saldo destinatario:', err);
                              return;
                            }
                            
                            // Registrar transacción
                            db.run(
                              `INSERT INTO transactions 
                               (sender_id, receiver_id, amount) 
                               VALUES (?, ?, ?)`,
                              [currentWalletId, receiverId, amount],
                              function(err) {
                                if (err) {
                                  db.run('ROLLBACK');
                                  ws.send(JSON.stringify({
                                    action: 'error',
                                    message: 'Error al registrar transacción'
                                  }));
                                  console.error('Error al registrar transacción:', err);
                                  return;
                                }
                                
                                db.run('COMMIT');
                                
                                // Obtener nuevo saldo para enviar al cliente
                                db.get(
                                  'SELECT balance FROM wallets WHERE id = ?',
                                  [currentWalletId],
                                  function(err, updatedWallet) {
                                    if (err) {
                                      console.error('Error al obtener saldo actualizado:', err);
                                      return;
                                    }
                                    
                                    ws.send(JSON.stringify({
                                      action: 'transaction-completed',
                                      newBalance: updatedWallet.balance
                                    }));
                                    console.log(`Transacción completada: ${currentWalletId} -> ${receiverId} por ${amount} NV`);
                                  }
                                );
                              }
                            );
                          }
                        );
                      }
                    );
                  }
                );
              }
            );
          });
          break;
        }

        // Verificar saldo
        case 'get-balance': {
          if (!currentWalletId) {
            ws.send(JSON.stringify({
              action: 'error',
              message: 'No tienes una billetera conectada'
            }));
            return;
          }
          
          db.get(
            'SELECT balance FROM wallets WHERE id = ?',
            [currentWalletId],
            function(err, row) {
              if (err) {
                ws.send(JSON.stringify({
                  action: 'error',
                  message: 'Error al obtener saldo'
                }));
                console.error('Error al obtener saldo:', err);
                return;
              }
              
              ws.send(JSON.stringify({
                action: 'balance',
                walletId: currentWalletId,
                balance: row.balance
              }));
            }
          );
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
    if (currentWalletId) {
      activeWallets.delete(ws);
    }
  });
});

// Manejo de cierre del servidor
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error('Error al cerrar la base de datos:', err.message);
    } else {
      console.log('Conexión a la base de datos cerrada');
    }
    process.exit(0);
  });
});
