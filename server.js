import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import nodemailer from 'nodemailer';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const PAYPAL_ENV = process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox';
const PAYPAL_BASE = PAYPAL_ENV === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';
const PRICE = '7.90';
const CURRENCY = 'USD';
const PRODUCT_ID = 'first-customer-guide';
const DATA_DIR = process.env.DATA_DIR || __dirname;
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'data.sqlite');
const PRIVATE_DIR = path.join(__dirname, 'private', 'downloads');

if (!fs.existsSync(PRIVATE_DIR)) throw new Error('Private downloads directory is missing.');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paypal_order_id TEXT UNIQUE,
    email TEXT NOT NULL,
    product_id TEXT NOT NULL,
    amount TEXT NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'CREATED',
    paypal_capture_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at TEXT
  );
  CREATE TABLE IF NOT EXISTS download_tokens (
    token_hash TEXT PRIMARY KEY,
    order_id INTEGER NOT NULL,
    language TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    FOREIGN KEY(order_id) REFERENCES orders(id)
  );
`);

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false, // PayPal JS SDK requires external script; configure CSP at deployment after testing.
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '30kb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: 'draft-7', legacyHeaders: false }));

function validEmail(email) {
  return typeof email === 'string' && email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function paypalConfigured() {
  return process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET &&
    !process.env.PAYPAL_CLIENT_ID.startsWith('replace_') &&
    !process.env.PAYPAL_CLIENT_SECRET.startsWith('replace_');
}
async function paypalAccessToken() {
  if (!paypalConfigured()) throw new Error('PAYPAL_NOT_CONFIGURED');
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    console.error('PayPal token request failed:', response.status);
    throw new Error('PAYPAL_AUTH_FAILED');
  }
  return data.access_token;
}
async function paypalRequest(url, token, method, body) {
  const response = await fetch(`${PAYPAL_BASE}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': crypto.randomUUID()
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) {
    console.error('PayPal API request failed:', response.status, data?.name || 'unknown');
    throw new Error('PAYPAL_API_FAILED');
  }
  return data;
}
function mailerConfigured() {
  return process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.MAIL_FROM;
}
async function sendDownloadEmail(email, links) {
  if (!mailerConfigured()) {
    console.warn('SMTP is not configured. Order is paid, but automatic delivery email is pending configuration.');
    return false;
  }
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to: email,
    subject: 'Seu guia do Construir Juntos / Your Construir Juntos guide',
    text: `Obrigado pela compra! Baixe os arquivos pelos links temporários abaixo:\nPortuguês: ${links.pt}\nEnglish: ${links.en}\n\nLinks válidos por 48 horas e de uso único.\n\nThank you for your purchase! Use the temporary download links below:\nPortuguese: ${links.pt}\nEnglish: ${links.en}\n\nLinks expire in 48 hours and are single-use.`,
    html: `<p>Obrigado pela compra / Thank you for your purchase.</p><p><a href="${links.pt}">Baixar PDF em português / Download Portuguese PDF</a></p><p><a href="${links.en}">Download English PDF / Baixar PDF em inglês</a></p><p>Links temporários: válidos por 48 horas e de uso único / Temporary links: valid for 48 hours and single-use.</p>`
  });
  return true;
}
function makeDownloadToken(orderId, language) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + (48 * 60 * 60);
  db.prepare('INSERT INTO download_tokens(token_hash, order_id, language, expires_at) VALUES(?,?,?,?)')
    .run(tokenHash, orderId, language, expiresAt);
  return `${BASE_URL}/download/${token}`;
}
function createDownloadLinks(orderId) {
  return { pt: makeDownloadToken(orderId, 'pt'), en: makeDownloadToken(orderId, 'en') };
}
async function processCapture(orderId, paypalData) {
  const existing = db.prepare('SELECT * FROM orders WHERE paypal_order_id = ?').get(orderId);
  if (!existing) throw new Error('ORDER_NOT_FOUND');
  if (existing.status === 'PAID') return { alreadyPaid: true, email: existing.email };

  const status = paypalData?.status;
  const unit = paypalData?.purchase_units?.[0];
  const amount = unit?.payments?.captures?.[0]?.amount;
  const capture = unit?.payments?.captures?.[0];
  const captureId = capture?.id;
  if (status !== 'COMPLETED' || capture?.status !== 'COMPLETED' ||
      amount?.currency_code !== CURRENCY || amount?.value !== PRICE ||
      unit?.custom_id !== PRODUCT_ID) {
    throw new Error('PAYMENT_VALIDATION_FAILED');
  }
  const update = db.prepare(`
    UPDATE orders SET status='PAID', paypal_capture_id=?, paid_at=CURRENT_TIMESTAMP
    WHERE paypal_order_id=? AND status!='PAID'
  `).run(captureId || null, orderId);
  if (!update.changes) return { alreadyPaid: true, email: existing.email };

  const links = createDownloadLinks(existing.id);
  const emailSent = await sendDownloadEmail(existing.email, links);
  return { alreadyPaid: false, email: existing.email, emailSent };
}

app.get('/api/config', (_req, res) => {
  res.json({
    configured: Boolean(paypalConfigured()),
    clientId: paypalConfigured() ? process.env.PAYPAL_CLIENT_ID : null,
    environment: PAYPAL_ENV,
    price: PRICE,
    currency: CURRENCY
  });
});

app.post('/api/orders', async (req, res) => {
  const email = String(req.body?.email || '').trim();
  if (!validEmail(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
  if (!paypalConfigured()) return res.status(503).json({ error: 'Checkout ainda não configurado. A conta PayPal precisa ser conectada.' });
  try {
    const local = db.prepare(`INSERT INTO orders(email, product_id, amount, currency, status) VALUES(?,?,?,?, 'CREATING')`)
      .run(email, PRODUCT_ID, PRICE, CURRENCY);
    const token = await paypalAccessToken();
    const order = await paypalRequest('/v2/checkout/orders', token, 'POST', {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: PRODUCT_ID,
        custom_id: PRODUCT_ID,
        description: 'Do Zero ao Primeiro Cliente / From Zero to Your First Customer',
        amount: { currency_code: CURRENCY, value: PRICE }
      }],
      application_context: {
        brand_name: 'Construir Juntos',
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING',
        return_url: `${BASE_URL}/?payment=success`,
        cancel_url: `${BASE_URL}/?payment=cancelled`
      }
    });
    db.prepare('UPDATE orders SET paypal_order_id=?, status=? WHERE id=?').run(order.id, 'CREATED', local.lastInsertRowid);
    res.json({ id: order.id });
  } catch (err) {
    console.error('Order creation error:', err.message);
    res.status(502).json({ error: 'Não foi possível iniciar o pagamento. Tente novamente mais tarde.' });
  }
});

app.post('/api/orders/:orderId/capture', async (req, res) => {
  const orderId = String(req.params.orderId || '');
  const local = db.prepare('SELECT * FROM orders WHERE paypal_order_id=?').get(orderId);
  if (!local) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (local.status === 'PAID') return res.json({ status: 'PAID', message: 'Pagamento já confirmado. Confira seu e-mail.' });
  try {
    const token = await paypalAccessToken();
    const captured = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, token, 'POST', {});
    const result = await processCapture(orderId, captured);
    if (!result.emailSent && !result.alreadyPaid) {
      return res.status(202).json({ status: 'PAID', message: 'Pagamento confirmado. A entrega por e-mail ainda precisa ser configurada pelo administrador.' });
    }
    res.json({ status: 'PAID', message: 'Pagamento confirmado. Confira seu e-mail para baixar os arquivos.' });
  } catch (err) {
    console.error('Capture error:', err.message);
    res.status(400).json({ error: 'Não foi possível confirmar o pagamento. Não tente pagar novamente antes de verificar o status.' });
  }
});

app.get('/download/:token', (req, res) => {
  const token = String(req.params.token || '');
  if (token.length < 30 || token.length > 100) return res.status(404).send('Link inválido ou expirado.');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const row = db.prepare(`
    SELECT dt.*, o.status FROM download_tokens dt
    JOIN orders o ON o.id = dt.order_id
    WHERE dt.token_hash=?
  `).get(hash);
  const now = Math.floor(Date.now() / 1000);
  if (!row || row.status !== 'PAID' || row.used_at || row.expires_at < now) {
    return res.status(410).send('Este link é inválido, expirou ou já foi utilizado. Entre em contato com o suporte.');
  }
  const fileName = row.language === 'pt' ? 'guia-pt.pdf' : 'guide-en.pdf';
  const filePath = path.join(PRIVATE_DIR, fileName);
  db.prepare('UPDATE download_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL').run(now, hash);
  res.download(filePath, row.language === 'pt' ? 'Do-Zero-ao-Primeiro-Cliente.pdf' : 'From-Zero-to-Your-First-Customer.pdf');
});

app.get('/api/admin/orders', (req, res) => {
  const token = process.env.ADMIN_TOKEN;
  if (!token || token.startsWith('replace_') || req.get('authorization') !== `Bearer ${token}`) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }
  const orders = db.prepare(`SELECT id, paypal_order_id, email, amount, currency, status, created_at, paid_at FROM orders ORDER BY id DESC LIMIT 200`).all();
  res.json({ orders });
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('*path', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`Construir Juntos running on ${PORT}; PayPal=${PAYPAL_ENV}; configured=${Boolean(paypalConfigured())}`);
});
