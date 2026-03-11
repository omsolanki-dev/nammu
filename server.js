const express = require('express');
const cors    = require('cors');
const path    = require('path');
const crypto  = require('crypto');
const db      = require('./db/init');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers ──────────────────────────────────────────────────────────────────
function genCode() {
  // e.g. NAM-4821
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const prefix  = Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  const num     = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${num}`;
}

async function uniqueCode() {
  let code, exists;
  do {
    code   = genCode();
    exists = await db.getAsync('SELECT id FROM shops WHERE code = ?', [code]);
  } while (exists);
  return code;
}

async function getBalance(customerId) {
  const row = await db.getAsync(`
    SELECT
      COALESCE(SUM(CASE WHEN type='credit' THEN amount ELSE 0 END),0) AS total_credit,
      COALESCE(SUM(CASE WHEN type='debit'  THEN amount ELSE 0 END),0) AS total_debit
    FROM transactions WHERE customer_id = ?
  `, [customerId]);
  return { total_credit: row.total_credit, total_debit: row.total_debit, balance: row.total_credit - row.total_debit };
}

// ═══ SHOPS ═══════════════════════════════════════════════════════════════════

// POST register a new shop
app.post('/api/shops/register', async (req, res) => {
  try {
    const { name, pin } = req.body;
    if (!name || !pin)              return res.status(400).json({ error: 'Shop name and PIN are required' });
    if (!/^\d{4,6}$/.test(pin))    return res.status(400).json({ error: 'PIN must be 4–6 digits' });

    const code   = await uniqueCode();
    const result = await db.runAsync('INSERT INTO shops (name, code, pin) VALUES (?,?,?)', [name.trim(), code, pin]);
    const shop   = await db.getAsync('SELECT id, name, code, created_at FROM shops WHERE id = ?', [result.lastID]);
    res.status(201).json(shop);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST owner login  { code, pin }
app.post('/api/shops/login', async (req, res) => {
  try {
    const { code, pin } = req.body;
    if (!code || !pin) return res.status(400).json({ error: 'Shop code and PIN are required' });

    const shop = await db.getAsync(
      'SELECT id, name, code, created_at FROM shops WHERE code = ? AND pin = ?',
      [code.trim().toUpperCase(), pin]);
    if (!shop) return res.status(401).json({ error: 'Invalid shop code or PIN. Please check and try again.' });
    res.json(shop);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET shop info by code (public – no PIN, used by customer lookup)
app.get('/api/shops/:code', async (req, res) => {
  try {
    const shop = await db.getAsync(
      'SELECT id, name, code FROM shops WHERE code = ?',
      [req.params.code.trim().toUpperCase()]);
    if (!shop) return res.status(404).json({ error: 'Shop not found. Check the shop code.' });
    res.json(shop);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET owner dashboard stats for a shop
app.get('/api/shops/:code/stats', async (req, res) => {
  try {
    const shop = await db.getAsync('SELECT id FROM shops WHERE code = ?', [req.params.code.toUpperCase()]);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });
    const stats = await db.getAsync(`
      SELECT
        COUNT(DISTINCT c.id) AS total_customers,
        COALESCE(SUM(CASE WHEN t.type='credit' THEN t.amount ELSE 0 END),0) AS total_credit,
        COALESCE(SUM(CASE WHEN t.type='debit'  THEN t.amount ELSE 0 END),0) AS total_debit
      FROM customers c
      LEFT JOIN transactions t ON c.id = t.customer_id
      WHERE c.shop_id = ?
    `, [shop.id]);
    res.json({ ...stats, total_outstanding: stats.total_credit - stats.total_debit });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══ CUSTOMERS (scoped to shop) ══════════════════════════════════════════════

// GET all customers for a shop
app.get('/api/shops/:code/customers', async (req, res) => {
  try {
    const shop = await db.getAsync('SELECT id FROM shops WHERE code = ?', [req.params.code.toUpperCase()]);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });
    const customers = await db.allAsync('SELECT * FROM customers WHERE shop_id = ? ORDER BY name ASC', [shop.id]);
    const result    = await Promise.all(customers.map(async c => ({ ...c, ...(await getBalance(c.id)) })));
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET search customers within a shop
app.get('/api/shops/:code/customers/search', async (req, res) => {
  try {
    const shop = await db.getAsync('SELECT id FROM shops WHERE code = ?', [req.params.code.toUpperCase()]);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });
    const q  = `%${req.query.q || ''}%`;
    const cs = await db.allAsync(
      'SELECT * FROM customers WHERE shop_id = ? AND (name LIKE ? OR phone LIKE ?) ORDER BY name ASC',
      [shop.id, q, q]);
    const result = await Promise.all(cs.map(async c => ({ ...c, ...(await getBalance(c.id)) })));
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single customer by id (owner view)
app.get('/api/customers/:id', async (req, res) => {
  try {
    const customer = await db.getAsync('SELECT * FROM customers WHERE id = ?', [req.params.id]);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    const [bal, transactions] = await Promise.all([
      getBalance(customer.id),
      db.allAsync('SELECT * FROM transactions WHERE customer_id = ? ORDER BY created_at DESC', [customer.id]),
    ]);
    res.json({ ...customer, ...bal, transactions });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET customer by shop-code + phone (CUSTOMER self-lookup)
app.get('/api/shops/:code/customer-lookup/:phone', async (req, res) => {
  try {
    const shop = await db.getAsync('SELECT id, name FROM shops WHERE code = ?', [req.params.code.toUpperCase()]);
    if (!shop) return res.status(404).json({ error: 'Shop not found. Check the shop code.' });

    const customer = await db.getAsync(
      'SELECT * FROM customers WHERE shop_id = ? AND phone = ?',
      [shop.id, req.params.phone]);
    if (!customer) return res.status(404).json({ error: 'No account found for this phone number at this shop.' });

    const [bal, transactions] = await Promise.all([
      getBalance(customer.id),
      db.allAsync('SELECT * FROM transactions WHERE customer_id = ? ORDER BY created_at DESC', [customer.id]),
    ]);
    res.json({ ...customer, ...bal, transactions, shop_name: shop.name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST create customer in a shop
app.post('/api/shops/:code/customers', async (req, res) => {
  try {
    const shop = await db.getAsync('SELECT id FROM shops WHERE code = ?', [req.params.code.toUpperCase()]);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });
    const { name, phone } = req.body;
    if (!name || !phone)           return res.status(400).json({ error: 'Name and phone are required' });
    if (!/^\d{10}$/.test(phone))   return res.status(400).json({ error: 'Phone must be a 10-digit number' });

    const existing = await db.getAsync('SELECT id FROM customers WHERE shop_id = ? AND phone = ?', [shop.id, phone]);
    if (existing) return res.status(409).json({ error: 'A customer with this phone number already exists in your shop' });

    const result  = await db.runAsync('INSERT INTO customers (shop_id, name, phone) VALUES (?,?,?)', [shop.id, name.trim(), phone]);
    const newCust = await db.getAsync('SELECT * FROM customers WHERE id = ?', [result.lastID]);
    res.status(201).json({ ...newCust, total_credit: 0, total_debit: 0, balance: 0 });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) return res.status(409).json({ error: 'A customer with this phone already exists' });
    res.status(500).json({ error: err.message });
  }
});

// DELETE customer
app.delete('/api/customers/:id', async (req, res) => {
  try {
    await db.runAsync('PRAGMA foreign_keys = ON');
    const r = await db.runAsync('DELETE FROM customers WHERE id = ?', [req.params.id]);
    if (r.changes === 0) return res.status(404).json({ error: 'Customer not found' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══ TRANSACTIONS ════════════════════════════════════════════════════════════

app.post('/api/transactions', async (req, res) => {
  try {
    const { customer_id, amount, type, note } = req.body;
    if (!customer_id || !amount || !type) return res.status(400).json({ error: 'customer_id, amount, type required' });
    if (!['credit','debit'].includes(type)) return res.status(400).json({ error: 'Type must be credit or debit' });
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'Amount must be a positive number' });

    const cust = await db.getAsync('SELECT id FROM customers WHERE id = ?', [customer_id]);
    if (!cust) return res.status(404).json({ error: 'Customer not found' });

    const result = await db.runAsync('INSERT INTO transactions (customer_id, amount, type, note) VALUES (?,?,?,?)',
      [customer_id, amt, type, note ? note.trim() : null]);
    const tx  = await db.getAsync('SELECT * FROM transactions WHERE id = ?', [result.lastID]);
    const bal = await getBalance(customer_id);
    res.status(201).json({ ...tx, ...bal });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/transactions/:id', async (req, res) => {
  try {
    const tx = await db.getAsync('SELECT customer_id FROM transactions WHERE id = ?', [req.params.id]);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    await db.runAsync('DELETE FROM transactions WHERE id = ?', [req.params.id]);
    res.json({ success: true, ...(await getBalance(tx.customer_id)) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── SPA Catch-all ────────────────────────────────────────────────────────────
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`✅ NAAMU (multi-shop) → http://localhost:${PORT}`));
