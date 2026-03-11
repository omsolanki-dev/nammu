const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, '..', 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);

const db = new sqlite3.Database(path.join(dbDir, 'khata.db'), err => {
  if (err) { console.error('DB error:', err); process.exit(1); }
});

// Promisify helpers
db.runAsync = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, function(err) { err ? rej(err) : res(this); }));
db.getAsync = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (err, row) => err ? rej(err) : res(row)));
db.allAsync = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (err, rows) => err ? rej(err) : res(rows)));

db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON');

  // Shops table — each shop owner registers here
  db.run(`CREATE TABLE IF NOT EXISTS shops (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    code       TEXT    NOT NULL UNIQUE,   -- e.g. NAM-4821 (shared with customers)
    pin        TEXT    NOT NULL,          -- 4–6 digit PIN for owner login
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  // Customers are scoped to a shop
  db.run(`CREATE TABLE IF NOT EXISTS customers (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id    INTEGER NOT NULL,
    name       TEXT    NOT NULL,
    phone      TEXT    NOT NULL,
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    UNIQUE(shop_id, phone),
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
  )`);

  // Transactions scoped through customer → shop
  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    amount      REAL    NOT NULL,
    type        TEXT    NOT NULL CHECK(type IN ('credit','debit')),
    note        TEXT,
    created_at  DATETIME DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
  )`);

  db.run('CREATE INDEX IF NOT EXISTS idx_cust_shop   ON customers(shop_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_cust_phone  ON customers(shop_id, phone)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tx_cust     ON transactions(customer_id)');
  console.log('✅ Multi-shop DB initialised');
});

module.exports = db;
