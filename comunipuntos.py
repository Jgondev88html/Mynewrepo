from flask import Flask, request, jsonify
from flask_cors import CORS                       import sqlite3
import time                                       
app = Flask(__name__)                             CORS(app)  # Permite solicitudes cross-origin
                                                  DB = 'comunipuntos.db'

# Inicializar la base de datos                    def init_db():
    with sqlite3.connect(DB) as con:                      cur = con.cursor()
        cur.execute('''
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                balance REAL DEFAULT 0
            )                                             ''')
        cur.execute('''                                       CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT,                                    action TEXT,
                amount REAL,                                      timestamp TEXT
            )                                             ''')
        con.commit()
                                                  init_db()
                                                  @app.route('/register', methods=['POST'])
def register():
    username = request.json.get('username')
    if not username:
        return jsonify({'error': 'Falta el nombre de usuario'}), 400                                    with sqlite3.connect(DB) as con:
        cur = con.cursor()                                try:
            cur.execute("INSERT INTO users (username, balance) VALUES (?, ?)", (username, 0))
            con.commit()                                      return jsonify({'message': f'Usuario {username} registrado'}), 201                              except sqlite3.IntegrityError:
            return jsonify({'error': 'Usuario ya existe'}), 409                                     
@app.route('/wallet/<username>', methods=['GET']) def wallet(username):
    with sqlite3.connect(DB) as con:
        cur = con.cursor()
        cur.execute("SELECT balance FROM users WHERE username=?", (username,))
        row = cur.fetchone()
        if row:
            return jsonify({'username': username, 'balance': row[0]}), 200
        else:                                                 return jsonify({'error': 'Usuario no encontrado'}), 404                                 
@app.route('/earn', methods=['POST'])             def earn():
    data = request.json                               username = data.get('username')
    amount = data.get('amount')                                                                         if not username or amount is None:
        return jsonify({'error': 'Faltan datos'}), 400

    with sqlite3.connect(DB) as con:
        cur = con.cursor()                                cur.execute("UPDATE users SET balance = balance + ? WHERE username = ?", (amount, username))
        if cur.rowcount == 0:                                 return jsonify({'error': 'Usuario no encontrado'}), 404                                         cur.execute("INSERT INTO history (username, action, amount, timestamp) VALUES (?, 'earn', ?, ?)",                                                                 (username, amount, time.ctime()))
        con.commit()
    return jsonify({'message': f'{amount} puntos ganados'}), 200
                                                  @app.route('/spend', methods=['POST'])            def spend():                                          data = request.json                               username = data.get('username')                   amount = data.get('amount')
                                                      if not username or amount is None:                    return jsonify({'error': 'Faltan datos'}), 400                                                                                                    with sqlite3.connect(DB) as con:                      cur = con.cursor()
        cur.execute("SELECT balance FROM users WHERE username = ?", (username,))                            row = cur.fetchone()
        if not row:
            return jsonify({'error': 'Usuario no encontrado'}), 404
        if row[0] < amount:
            return jsonify({'error': 'Fondos insuficientes'}), 400
        cur.execute("UPDATE users SET balance = balance - ? WHERE username = ?", (amount, username))
        cur.execute("INSERT INTO history (username, action, amount, timestamp) VALUES (?, 'spend', ?, ?)",
                    (username, amount, time.ctime()))                                                       con.commit()                                  return jsonify({'message': f'{amount} puntos gastados'}), 200                                                                                     @app.route('/history/<username>', methods=['GET'])
def history(username):                                with sqlite3.connect(DB) as con:                      cur = con.cursor()                                cur.execute("SELECT action, amount, timestamp FROM history WHERE username = ?", (username,))        rows = cur.fetchall()                             return jsonify({'history': rows}), 200                                                      if __name__ == '__main__':                            app.run(host='0.0.0.0', port=5000)
