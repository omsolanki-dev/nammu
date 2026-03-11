/* ═══════════════════════════════════════════════════════════════════════════
   NAAMU – Multi-Shop SPA Client
   ═════════════════════════════════════════════════════════════════════════ */

const API = '';

// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  // Owner session (stored in sessionStorage)
  shop: null,          // { id, name, code }

  // Ledger
  currentCustomer: null,
  allTransactions: [],
  txFilter: 'all',
  pendingTxType: 'credit',
};

// ─── Session persistence (keeps owner logged in on reload) ──────────────────
const SESSION_KEY = 'naamu_shop';
function saveSession(shop) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(shop));
  state.shop = shop;
}
function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
  state.shop = null;
}

// ─── Utils ───────────────────────────────────────────────────────────────────
const fmt = n => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtDate = s => {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
       + ' · ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
};
const todayStr = () => new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
const initials = name => (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

let toastTimer = null;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.className = '', 2800);
}
function setErr(id, msg) { const el = document.getElementById(id); if (el) el.textContent = msg; }
function clearErrs(...ids) { ids.forEach(id => setErr(id, '')); }
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

// ─── Screen Router ────────────────────────────────────────────────────────────
function goTo(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
  window.scrollTo(0, 0);
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
function init() {
  const saved = loadSession();
  if (saved) {
    state.shop = saved;
    openDashboard(saved);
  } else {
    goTo('home');
  }
}

// ═══ SHOP REGISTRATION ═══════════════════════════════════════════════════════

async function registerShop() {
  clearErrs('reg-name-err', 'reg-pin-err');
  const name = document.getElementById('reg-name').value.trim();
  const pin  = document.getElementById('reg-pin').value.trim();

  let ok = true;
  if (!name) { setErr('reg-name-err', 'Shop name is required'); ok = false; }
  if (!pin || !/^\d{4,6}$/.test(pin)) { setErr('reg-pin-err', 'PIN must be 4–6 digits'); ok = false; }
  if (!ok) return;

  const btn = document.getElementById('reg-btn');
  btn.disabled = true; btn.textContent = 'Creating…';
  try {
    const shop = await apiFetch('/api/shops/register', { method: 'POST', body: { name, pin } });
    // Show success screen
    document.getElementById('created-shop-code').textContent = shop.code;
    document.getElementById('success-shop-name-msg').textContent = `"${shop.name}" is ready to use!`;
    // Save session
    saveSession({ id: shop.id, name: shop.name, code: shop.code });
    goTo('shop-created');
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '🚀 Create My Shop';
  }
}

function proceedFromSetup() {
  openDashboard(state.shop);
}

// ═══ OWNER LOGIN ═════════════════════════════════════════════════════════════

async function ownerLogin() {
  clearErrs('login-code-err', 'login-pin-err');
  const code = document.getElementById('login-code').value.trim().toUpperCase();
  const pin  = document.getElementById('login-pin').value.trim();

  if (!code) { setErr('login-code-err', 'Enter your shop code'); return; }
  if (!pin)  { setErr('login-pin-err', 'Enter your PIN'); return; }

  const btn = document.getElementById('login-btn');
  btn.disabled = true; btn.textContent = 'Logging in…';
  try {
    const shop = await apiFetch('/api/shops/login', { method: 'POST', body: { code, pin } });
    saveSession({ id: shop.id, name: shop.name, code: shop.code });
    openDashboard(state.shop);
  } catch (e) {
    setErr('login-pin-err', e.message);
  } finally {
    btn.disabled = false; btn.textContent = '🏪 Login to Dashboard';
  }
}

function ownerLogout() {
  clearSession();
  document.getElementById('login-code').value = '';
  document.getElementById('login-pin').value  = '';
  goTo('home');
}

// ═══ OWNER DASHBOARD ═════════════════════════════════════════════════════════

function openDashboard(shop) {
  document.getElementById('dashboard-shop-name').textContent = shop.name;
  document.getElementById('dashboard-shop-code').textContent = shop.code;
  goTo('dashboard');
  loadStats();
  loadCustomers();
}

async function loadStats() {
  if (!state.shop) return;
  try {
    const s = await apiFetch(`/api/shops/${state.shop.code}/stats`);
    document.getElementById('stat-customers').textContent   = s.total_customers;
    document.getElementById('stat-udhar').textContent       = fmt(s.total_credit);
    document.getElementById('stat-outstanding').textContent = fmt(s.total_outstanding);
  } catch { /* silent */ }
}

async function loadCustomers(query = '') {
  if (!state.shop) return;
  const list = document.getElementById('customer-list');
  list.innerHTML = '<div class="spinner"></div>';
  try {
    const url = query
      ? `/api/shops/${state.shop.code}/customers/search?q=${encodeURIComponent(query)}`
      : `/api/shops/${state.shop.code}/customers`;
    const customers = await apiFetch(url);
    renderCustomerList(customers, query);
  } catch (e) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Error</div><div class="empty-desc">${escHtml(e.message)}</div></div>`;
  }
}

function renderCustomerList(customers, query = '') {
  const list  = document.getElementById('customer-list');
  const label = document.getElementById('customer-count-label');
  label.textContent = query
    ? `${customers.length} result${customers.length !== 1 ? 's' : ''} for "${query}"`
    : `All Customers (${customers.length})`;

  if (!customers.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${query ? '🔍' : '👥'}</div>
        <div class="empty-title">${query ? 'No results found' : 'No customers yet'}</div>
        <div class="empty-desc">${query ? 'Try a different name or phone.' : 'Tap ＋ to add your first customer.'}</div>
      </div>`;
    return;
  }
  list.innerHTML = customers.map(c => {
    const bal = c.balance;
    const cls = bal > 0 ? 'balance-positive' : bal < 0 ? 'balance-negative' : 'balance-zero';
    const txt = bal > 0 ? fmt(bal) : bal < 0 ? '−' + fmt(-bal) : '₹0';
    const tag = bal > 0 ? 'to pay' : bal < 0 ? 'overpaid' : 'settled';
    return `
      <div class="customer-card" onclick="openLedger(${c.id})">
        <div class="customer-avatar">${initials(c.name)}</div>
        <div class="customer-info">
          <div class="customer-name">${escHtml(c.name)}</div>
          <div class="customer-phone">📞 ${escHtml(c.phone)}</div>
        </div>
        <div class="customer-balance">
          <div class="${cls}">${txt}</div>
          <div class="balance-tag">${tag}</div>
        </div>
      </div>`;
  }).join('');
}

// Debounced search
let searchTimer;
document.getElementById('search-input').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadCustomers(e.target.value.trim()), 280);
});

// ═══ ADD CUSTOMER ════════════════════════════════════════════════════════════

function showAddCustomer() {
  document.getElementById('c-name').value  = '';
  document.getElementById('c-phone').value = '';
  clearErrs('c-name-err', 'c-phone-err');
  goTo('add-customer');
  setTimeout(() => document.getElementById('c-name').focus(), 200);
}

async function saveCustomer() {
  clearErrs('c-name-err', 'c-phone-err');
  const name  = document.getElementById('c-name').value.trim();
  const phone = document.getElementById('c-phone').value.trim();
  let ok = true;
  if (!name) { setErr('c-name-err', 'Name is required'); ok = false; }
  if (!phone) { setErr('c-phone-err', 'Phone is required'); ok = false; }
  else if (!/^\d{10}$/.test(phone)) { setErr('c-phone-err', 'Enter a valid 10-digit number'); ok = false; }
  if (!ok) return;

  const btn = document.getElementById('save-customer-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const c = await apiFetch(`/api/shops/${state.shop.code}/customers`, { method: 'POST', body: { name, phone } });
    showToast(`✅ ${c.name} added!`, 'success');
    openDashboard(state.shop);
  } catch (e) {
    if (e.message.toLowerCase().includes('phone')) setErr('c-phone-err', e.message);
    else showToast(e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '✅ Save Customer';
  }
}

// ═══ CUSTOMER LEDGER (OWNER) ════════════════════════════════════════════════

async function openLedger(customerId) {
  goTo('ledger');
  document.getElementById('tx-list').innerHTML = '<div class="spinner"></div>';
  try {
    const c = await apiFetch(`/api/customers/${customerId}`);
    state.currentCustomer = c;
    state.allTransactions  = c.transactions || [];
    state.txFilter = 'all';
    document.querySelectorAll('.filter-chip').forEach(el => el.classList.toggle('active', el.dataset.filter === 'all'));
    document.getElementById('filter-from').value = '';
    document.getElementById('filter-to').value   = '';
    renderLedgerHeader(c);
    renderTxList(state.allTransactions);
  } catch (e) {
    showToast(e.message, 'error');
    goTo('dashboard');
  }
}

function renderLedgerHeader(c) {
  document.getElementById('ledger-customer-name').textContent = c.name;
  document.getElementById('ledger-customer-phone').textContent = '📞 ' + c.phone;
  document.getElementById('ledger-balance').textContent = fmt(c.balance);
  document.getElementById('ledger-credit').textContent  = fmt(c.total_credit);
  document.getElementById('ledger-debit').textContent   = fmt(c.total_debit);
  document.getElementById('add-tx-subtitle').textContent = c.name;
}

function renderTxList(txs) {
  const list  = document.getElementById('tx-list');
  const label = document.getElementById('tx-count-label');
  label.textContent = `Transactions (${txs.length})`;
  if (!txs.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">No transactions</div><div class="empty-desc">Add the first credit or payment.</div></div>`;
    return;
  }
  list.innerHTML = txs.map(tx => buildTxCard(tx, true)).join('');
}

function buildTxCard(tx, showDelete = false) {
  const icon  = tx.type === 'credit' ? '📈' : '💰';
  const label = tx.type === 'credit' ? 'Udhar (Credit)' : 'Payment (Debit)';
  const sign  = tx.type === 'credit' ? '+' : '−';
  return `<div class="tx-card ${tx.type}" id="tx-${tx.id}">
    <div class="tx-icon">${icon}</div>
    <div class="tx-info">
      <div class="tx-type">${label}</div>
      ${tx.note ? `<div class="tx-note">📝 ${escHtml(tx.note)}</div>` : ''}
      <div class="tx-date">🕐 ${fmtDate(tx.created_at)}</div>
    </div>
    <div class="tx-amount">${sign}${fmt(tx.amount)}</div>
    ${showDelete ? `<button class="tx-delete" onclick="deleteTx(${tx.id})" title="Delete">🗑️</button>` : ''}
  </div>`;
}

function setFilter(filter, btn) {
  state.txFilter = filter;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  applyFilters();
}
function clearDateFilter() {
  document.getElementById('filter-from').value = '';
  document.getElementById('filter-to').value   = '';
  applyFilters();
}
function applyFilters() {
  let txs = state.allTransactions;
  if (state.txFilter !== 'all') txs = txs.filter(t => t.type === state.txFilter);
  const from = document.getElementById('filter-from').value;
  const to   = document.getElementById('filter-to').value;
  if (from) txs = txs.filter(t => new Date(t.created_at) >= new Date(from));
  if (to)   txs = txs.filter(t => new Date(t.created_at) <= new Date(to + 'T23:59:59'));
  renderTxList(txs);
}

// ═══ ADD TRANSACTION ════════════════════════════════════════════════════════

function showAddTransaction(type = 'credit') {
  state.pendingTxType = type;
  document.getElementById('tx-amount').value = '';
  document.getElementById('tx-note').value   = '';
  clearErrs('tx-amount-err', 'tx-global-err');
  selectType(type);
  document.getElementById('add-tx-title').textContent = type === 'credit' ? 'Add Udhar (Credit)' : 'Add Payment (Debit)';
  goTo('add-tx');
  setTimeout(() => document.getElementById('tx-amount').focus(), 200);
}

function selectType(type) {
  state.pendingTxType = type;
  document.getElementById('type-credit-btn').classList.toggle('active', type === 'credit');
  document.getElementById('type-debit-btn').classList.toggle('active', type === 'debit');
}

async function saveTransaction() {
  clearErrs('tx-amount-err', 'tx-global-err');
  const amtStr = document.getElementById('tx-amount').value.trim();
  const note   = document.getElementById('tx-note').value.trim();
  const amount = parseFloat(amtStr);
  if (!amtStr || isNaN(amount) || amount <= 0) {
    setErr('tx-amount-err', 'Enter a valid positive amount'); return;
  }
  const btn = document.getElementById('save-tx-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await apiFetch('/api/transactions', {
      method: 'POST',
      body: { customer_id: state.currentCustomer.id, amount, type: state.pendingTxType, note: note || null }
    });
    showToast(state.pendingTxType === 'credit' ? '✅ Udhar added!' : '✅ Payment recorded!', 'success');
    openLedger(state.currentCustomer.id);
  } catch (e) {
    setErr('tx-global-err', e.message);
  } finally {
    btn.disabled = false; btn.textContent = '✅ Save Transaction';
  }
}

async function deleteTx(txId) {
  if (!confirm('Delete this transaction?')) return;
  try {
    const result = await apiFetch(`/api/transactions/${txId}`, { method: 'DELETE' });
    state.currentCustomer = { ...state.currentCustomer, ...result };
    renderLedgerHeader(state.currentCustomer);
    state.allTransactions = state.allTransactions.filter(t => t.id !== txId);
    const el = document.getElementById('tx-' + txId);
    if (el) {
      el.style.transition = 'all 0.3s ease';
      el.style.opacity = '0'; el.style.transform = 'translateX(-20px)';
      setTimeout(() => { el.remove(); applyFilters(); }, 300);
    }
    showToast('Transaction deleted');
  } catch (e) { showToast(e.message, 'error'); }
}

async function deleteCustomer() {
  if (!state.currentCustomer) return;
  if (!confirm(`Delete ${state.currentCustomer.name} and all transactions? Cannot be undone.`)) return;
  try {
    await apiFetch(`/api/customers/${state.currentCustomer.id}`, { method: 'DELETE' });
    showToast('Customer deleted');
    openDashboard(state.shop);
  } catch (e) { showToast(e.message, 'error'); }
}

// ═══ CUSTOMER LOOKUP (self-serve) ═══════════════════════════════════════════

async function customerLookup() {
  clearErrs('cl-shop-err', 'cl-phone-err');
  const code  = document.getElementById('cl-shop-code').value.trim().toUpperCase();
  const phone = document.getElementById('cl-phone').value.trim();
  let ok = true;
  if (!code)  { setErr('cl-shop-err', 'Enter the shop code'); ok = false; }
  if (!phone || !/^\d{10}$/.test(phone)) { setErr('cl-phone-err', 'Enter a valid 10-digit phone number'); ok = false; }
  if (!ok) return;

  try {
    const data = await apiFetch(`/api/shops/${code}/customer-lookup/${phone}`);
    renderCustomerView(data);
    goTo('customer-view');
  } catch (e) {
    if (e.message.toLowerCase().includes('shop')) setErr('cl-shop-err', e.message);
    else setErr('cl-phone-err', e.message);
  }
}

function renderCustomerView(data) {
  document.getElementById('cv-name').textContent     = data.name;
  document.getElementById('cv-phone').textContent    = '📞 ' + data.phone;
  document.getElementById('cv-shop-name').textContent = data.shop_name || 'Shop';
  document.getElementById('cv-date').textContent     = 'As of ' + todayStr();
  document.getElementById('cv-balance').textContent  = fmt(data.balance);
  document.getElementById('cv-credit').textContent   = fmt(data.total_credit);
  document.getElementById('cv-debit').textContent    = fmt(data.total_debit);

  const list = document.getElementById('cv-tx-list');
  const txs  = data.transactions || [];
  list.innerHTML = txs.length
    ? txs.map(tx => buildTxCard(tx, false)).join('')
    : `<div class="empty-state"><div class="empty-icon">✨</div><div class="empty-title">No transactions yet</div></div>`;

  state.currentCustomer = data;
}

// ═══ PDF EXPORT ══════════════════════════════════════════════════════════════

function generatePDF(customer, txs, shopName) {
  if (!window.jspdf) { showToast('PDF loading, try again', 'error'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 15, W = 210;
  let y = 20;

  doc.setFillColor(15,118,110); doc.rect(0,0,W,35,'F');
  doc.setTextColor(255,255,255); doc.setFontSize(18); doc.setFont('helvetica','bold');
  doc.text('NAAMU – Udhar Ledger', M, 14);
  doc.setFontSize(9); doc.setFont('helvetica','normal');
  doc.text(`Shop: ${shopName}     Generated: ${new Date().toLocaleString('en-IN')}`, M, 22);
  y = 45;

  doc.setDrawColor(15,118,110); doc.setLineWidth(0.5);
  doc.rect(M, y, W-2*M, 28);
  doc.setTextColor(30,30,30); doc.setFontSize(13); doc.setFont('helvetica','bold');
  doc.text(customer.name, M+4, y+9);
  doc.setFontSize(9); doc.setFont('helvetica','normal');
  doc.text(`Phone: ${customer.phone}`, M+4, y+17);
  doc.text(`Balance: Rs ${customer.balance.toFixed(2)}  |  Total Udhar: Rs ${customer.total_credit.toFixed(2)}  |  Total Paid: Rs ${customer.total_debit.toFixed(2)}`, M+4, y+25);
  y += 36;

  doc.setFillColor(240,253,250); doc.rect(M,y,W-2*M,8,'F');
  doc.setFontSize(9); doc.setFont('helvetica','bold'); doc.setTextColor(15,118,110);
  const cx = [M+2, M+35, M+60, M+100, M+140];
  ['#','Date','Type','Note','Amount (Rs)'].forEach((h,i) => doc.text(h,cx[i],y+5.5));
  y += 10;

  doc.setFont('helvetica','normal'); doc.setTextColor(30,30,30);
  txs.forEach((tx,i) => {
    if (y > 270) { doc.addPage(); y = 20; }
    if (i%2===0) { doc.setFillColor(248,250,252); doc.rect(M,y-1,W-2*M,7.5,'F'); }
    doc.setFontSize(8);
    doc.setTextColor(30,30,30); doc.text(String(i+1), cx[0], y+4.5);
    doc.text(fmtDate(tx.created_at).replace(' · ',' '), cx[1], y+4.5);
    if (tx.type==='credit') doc.setTextColor(22,163,74); else doc.setTextColor(220,38,38);
    doc.text(tx.type==='credit'?'Udhar':'Payment', cx[2], y+4.5);
    doc.setTextColor(30,30,30); doc.text(tx.note ? tx.note.slice(0,22) : '—', cx[3], y+4.5);
    if (tx.type==='credit') doc.setTextColor(22,163,74); else doc.setTextColor(220,38,38);
    doc.text(`${tx.type==='credit'?'+':'-'}${tx.amount.toFixed(2)}`, cx[4], y+4.5);
    y += 8;
  });

  y += 5; doc.setDrawColor(200,200,200); doc.line(M,y,W-M,y);
  y += 5; doc.setTextColor(100,116,139); doc.setFontSize(8);
  doc.text('This is a computer-generated document from NAAMU Ledger.', M, y);
  doc.save(`NAAMU_${shopName}_${customer.name}.pdf`);
  showToast('📄 PDF downloaded!', 'success');
}

function exportPDF() {
  if (state.currentCustomer && state.shop)
    generatePDF(state.currentCustomer, state.allTransactions, state.shop.name);
}
function exportCustomerPDF() {
  if (state.currentCustomer)
    generatePDF(state.currentCustomer, state.currentCustomer.transactions || [], state.currentCustomer.shop_name || 'Shop');
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
init();
