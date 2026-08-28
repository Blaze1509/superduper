const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const { jsPDF } = require('jspdf');
require('jspdf-autotable');
require('dotenv').config();

const { pool, initDB } = require('./db');

const pdfInteger = value => {
  const number = parseFloat(value);
  return Number.isFinite(number) ? String(Math.round(number)) : '0';
};
const pdfOptionalAmount = value => {
  const number = parseFloat(value);
  return Number.isFinite(number) && number !== 0 ? String(value) : '';
};

const EXPORT_PATH = process.env.EXPORT_PATH || path.join(__dirname, 'exports');
if (!fs.existsSync(EXPORT_PATH)) fs.mkdirSync(EXPORT_PATH, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const FONTS_DIR = path.join(__dirname, 'fonts');
if (!fs.existsSync(FONTS_DIR)) fs.mkdirSync(FONTS_DIR, { recursive: true });
const GUJARATI_FONT_PATH = path.join(FONTS_DIR, 'NotoSansGujarati-Regular.ttf');

function ensureGujaratiFont() {
  return new Promise((resolve) => {
    if (fs.existsSync(GUJARATI_FONT_PATH) && fs.statSync(GUJARATI_FONT_PATH).size > 50000) {
      return resolve(GUJARATI_FONT_PATH);
    }
    console.log('Downloading NotoSansGujarati full font for PDF generation...');
    const https = require('https');
    const zipPath = path.join(FONTS_DIR, 'noto.zip');
    const file = fs.createWriteStream(zipPath);
    const url = 'https://gwfh.mranftl.com/api/fonts/noto-sans-gujarati?download=zip&subsets=gujarati,latin&variants=regular';
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        try {
          const { execSync } = require('child_process');
          const extractDir = path.join(FONTS_DIR, 'gwfh_extract');
          execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`);
          const extractedTtf = path.join(extractDir, 'noto-sans-gujarati-v27-gujarati_latin-regular.ttf');
          if (fs.existsSync(extractedTtf)) {
            fs.copyFileSync(extractedTtf, GUJARATI_FONT_PATH);
            console.log('Full Gujarati TTF font unpacked successfully.');
          }
        } catch (e) {
          console.error('Failed to extract Gujarati font package:', e.message);
        }
        resolve(GUJARATI_FONT_PATH);
      });
    }).on('error', (err) => {
      console.error('Error downloading Gujarati font:', err.message);
      resolve(null);
    });
  });
}
ensureGujaratiFont();

function applyPdfFont(doc) {
  if (fs.existsSync(GUJARATI_FONT_PATH) && fs.statSync(GUJARATI_FONT_PATH).size > 50000) {
    try {
      const fontBase64 = fs.readFileSync(GUJARATI_FONT_PATH).toString('base64');
      doc.addFileToVFS('NotoSansGujarati-Regular.ttf', fontBase64);
      doc.addFont('NotoSansGujarati-Regular.ttf', 'NotoSansGujarati', 'normal');
      doc.addFont('NotoSansGujarati-Regular.ttf', 'NotoSansGujarati', 'bold');
      doc.setFont('NotoSansGujarati');
      return 'NotoSansGujarati';
    } catch (e) {
      console.error('Failed to attach Gujarati font to PDF:', e.message);
    }
  }
  return 'helvetica';
}
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Security HTTP headers
app.use(helmet({ crossOriginResourcePolicy: false }));

// Environment-driven CORS configuration
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-firm-id']
}));

app.use(express.json());
app.use('/exports', express.static(EXPORT_PATH));

// Rate Limiters for Security
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many security/activation attempts. Please try again later.' }
});

app.use('/api/', globalLimiter);
app.use('/api/activate', authLimiter);
app.use('/api/check-activation', authLimiter);
app.use('/api/activation/', authLimiter);
app.use('/api/admin/', authLimiter);

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'blaze';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Blaze@1509';

function requireAdmin(req, res, next) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Basic ')) return res.status(401).json({ success: false, error: 'Unauthorized' });
  const decoded = Buffer.from(auth.slice(6), 'base64').toString();
  const colon = decoded.indexOf(':');
  const user = decoded.slice(0, colon);
  const pass = decoded.slice(colon + 1);
  if (user !== ADMIN_USERNAME || pass !== ADMIN_PASSWORD)
    return res.status(401).json({ success: false, error: 'Invalid credentials' });
  next();
}

function getFirmId(req) {
  return req.headers['x-firm-id'] ? parseInt(req.headers['x-firm-id']) : null;
}

// ── ADMIN: Firms ───────────────────────────────────────────
app.get('/api/admin/firms', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM firms ORDER BY name ASC');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/firms', requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Name required' });
    const result = await pool.query(
      'INSERT INTO firms (name) VALUES ($1) RETURNING *',
      [name.trim()]
    );
    await emitFirms(io);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ success: false, error: 'Firm already exists' });
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/admin/firms/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM firms WHERE id=$1', [req.params.id]);
    await emitFirms(io);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// helper: compute token status
function tokenStatus(t) {
  const now = new Date();
  if (t.device_id === 'REVOKED') return 'deactivated';
  if (new Date(t.expires_at) < now) return 'expired';
  if (t.is_used && t.device_id) return 'in_use';
  return 'active';
}

async function emitTokens(io) {
  const result = await pool.query(`
    SELECT t.*, f.name as firm_name FROM activation_tokens t
    JOIN firms f ON f.id = t.firm_id ORDER BY t.created_at DESC
  `);
  const rows = result.rows.map(t => ({ ...t, status: tokenStatus(t) }));
  io.emit('tokens_update', rows);
}

async function emitFirms(io) {
  const result = await pool.query('SELECT * FROM firms ORDER BY name ASC');
  io.emit('firms_update', result.rows);
}

function computeDurationMs(body) {
  const { duration_hours, years, months, days, hours, minutes, seconds } = body || {};
  if (years || months || days || hours || minutes || seconds) {
    const y = parseInt(years || 0, 10);
    const mo = parseInt(months || 0, 10);
    const d = parseInt(days || 0, 10);
    const h = parseInt(hours || 0, 10);
    const m = parseInt(minutes || 0, 10);
    const s = parseInt(seconds || 0, 10);
    const totalSecs = (y * 365 * 86400) + (mo * 30 * 86400) + (d * 86400) + (h * 3600) + (m * 60) + s;
    return totalSecs * 1000;
  }
  const floatHours = parseFloat(duration_hours || 24);
  return floatHours * 3600 * 1000;
}

// ── ADMIN: Tokens ──────────────────────────────────────────
app.post('/api/admin/generate-token', requireAdmin, async (req, res) => {
  try {
    const { firm_id, username } = req.body;
    if (!firm_id)
      return res.status(400).json({ success: false, error: 'firm_id required' });
    if (!username || !username.trim())
      return res.status(400).json({ success: false, error: 'Username / identity label is required' });

    const ms = computeDurationMs(req.body);
    if (!ms || ms <= 0) {
      return res.status(400).json({ success: false, error: 'Valid duration required' });
    }

    const crypto = require('crypto');
    const token = crypto.randomBytes(16).toString('hex').toUpperCase();
    const expires_at = new Date(Date.now() + ms);

    const result = await pool.query(
      'INSERT INTO activation_tokens (token, firm_id, expires_at, username) VALUES ($1, $2, $3, $4) RETURNING *',
      [token, firm_id, expires_at, username || '']
    );
    await emitTokens(io);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/tokens', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.*, f.name as firm_name FROM activation_tokens t
      JOIN firms f ON f.id = t.firm_id ORDER BY t.created_at DESC
    `);
    const rows = result.rows.map(t => ({ ...t, status: tokenStatus(t) }));
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/deactivate/:firm_id', requireAdmin, async (req, res) => {
  try {
    await pool.query(
      `UPDATE activation_tokens
       SET expires_at = NOW(), is_used = TRUE, device_id = 'REVOKED',
           revoke_count = revoke_count + 1
       WHERE firm_id = $1 AND expires_at > NOW()`,
      [req.params.firm_id]
    );
    await emitTokens(io);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Revoke single token
app.post('/api/admin/revoke-token/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query(
      `UPDATE activation_tokens
       SET expires_at = NOW(), is_used = TRUE, device_id = 'REVOKED',
           revoke_count = revoke_count + 1
       WHERE id = $1`,
      [req.params.id]
    );
    await emitTokens(io);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Revert/Reactivate single token for one-time use
app.post('/api/admin/revert-token/:id', requireAdmin, async (req, res) => {
  try {
    const ms = computeDurationMs(req.body);
    const expires_at = new Date(Date.now() + ms);
    await pool.query(
      `UPDATE activation_tokens
       SET expires_at = $1, is_used = FALSE, device_id = NULL
       WHERE id = $2`,
      [expires_at, req.params.id]
    );
    await emitTokens(io);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete single token
app.delete('/api/admin/tokens/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM activation_tokens WHERE id=$1', [req.params.id]);
    await emitTokens(io);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reset or Clear App Lock PIN for a specific token
app.post('/api/admin/reset-token-pin/:id', requireAdmin, async (req, res) => {
  try {
    const { new_pin, clear_pin } = req.body;
    const crypto = require('crypto');

    if (clear_pin) {
      await pool.query(
        `UPDATE activation_tokens
         SET pin_hash = NULL, pin_salt = NULL, pin_reset_required = TRUE
         WHERE id = $1`,
        [req.params.id]
      );
    } else if (new_pin) {
      if (!/^\d{4}$/.test(new_pin)) {
        return res.status(400).json({ success: false, error: 'PIN must be a 4-digit number' });
      }
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()';
      let salt = '';
      for (let i = 0; i < 16; i++) {
        salt += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      const saltedPin = `BLAZE_SALT_${salt}_${new_pin}_SECURE_PIN`;
      const hash = crypto.createHash('sha256').update(saltedPin).digest('hex');

      await pool.query(
        `UPDATE activation_tokens
         SET pin_hash = $1, pin_salt = $2, pin_reset_required = FALSE
         WHERE id = $3`,
        [hash, salt, req.params.id]
      );
    } else {
      return res.status(400).json({ success: false, error: 'Provide new_pin or clear_pin' });
    }

    await emitTokens(io);
    res.json({ success: true, message: 'Token PIN reset successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Mobile App PIN status check/sync
app.post('/api/activation/check-pin-status', async (req, res) => {
  try {
    const { token, device_id } = req.body;
    if (!token) return res.status(400).json({ success: false, error: 'token required' });

    const result = await pool.query(
      `SELECT pin_hash, pin_salt, pin_reset_required
       FROM activation_tokens
       WHERE token = $1 AND (device_id = $2 OR device_id IS NULL)`,
      [token, device_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Token not found' });
    }

    const row = result.rows[0];
    res.json({
      success: true,
      pin_hash: row.pin_hash,
      pin_salt: row.pin_salt,
      pin_reset_required: row.pin_reset_required || false
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Mobile App PIN update/sync from mobile device
app.post('/api/activation/update-pin', async (req, res) => {
  try {
    const { token, device_id, pin_hash, pin_salt, clear_pin } = req.body;
    if (!token) return res.status(400).json({ success: false, error: 'token required' });

    if (clear_pin) {
      await pool.query(
        `UPDATE activation_tokens
         SET pin_hash = NULL, pin_salt = NULL, pin_reset_required = FALSE
         WHERE token = $1`,
        [token]
      );
    } else if (pin_hash && pin_salt) {
      await pool.query(
        `UPDATE activation_tokens
         SET pin_hash = $1, pin_salt = $2, pin_reset_required = FALSE
         WHERE token = $3`,
        [pin_hash, pin_salt, token]
      );
    }

    await emitTokens(io);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── ACTIVATION ─────────────────────────────────────────────
app.post('/api/activate', async (req, res) => {
  try {
    const { token, device_id } = req.body;
    if (!token || !device_id)
      return res.status(400).json({ success: false, error: 'token and device_id required' });

    const result = await pool.query(
      'SELECT * FROM activation_tokens WHERE token=$1',
      [token.trim().toUpperCase()]
    );

    if (result.rows.length === 0)
      return res.status(400).json({ success: false, error: 'Invalid token' });

    const t = result.rows[0];
    if (t.is_used)
      return res.status(400).json({ success: false, error: 'Token already used' });
    if (new Date(t.expires_at) < new Date())
      return res.status(400).json({ success: false, error: 'Token expired' });

    // Mark token as used, bind to device
    await pool.query(
      'UPDATE activation_tokens SET is_used=TRUE, device_id=$1, used_at=NOW() WHERE id=$2',
      [device_id, t.id]
    );

    const firm = await pool.query('SELECT * FROM firms WHERE id=$1', [t.firm_id]);
    await emitTokens(io);
    res.json({
      success: true,
      firm_id: t.firm_id,
      firm_name: firm.rows[0].name,
      username: t.username || '',
      expires_at: t.expires_at,
      token: t.token
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/check-activation', async (req, res) => {
  try {
    const { token, device_id } = req.body;
    if (!token || !device_id)
      return res.json({ valid: false });

    const cleanToken = String(token).trim().toUpperCase();
    const cleanDeviceId = String(device_id).trim();

    const result = await pool.query(
      `SELECT * FROM activation_tokens 
       WHERE UPPER(token) = $1 AND (device_id = $2 OR device_id IS NULL) AND is_used = TRUE`,
      [cleanToken, cleanDeviceId]
    );

    if (result.rows.length === 0) return res.json({ valid: false });

    const t = result.rows[0];
    if (new Date(t.expires_at) < new Date()) return res.json({ valid: false });

    // Ensure device_id is bound if it was NULL
    if (!t.device_id) {
      await pool.query('UPDATE activation_tokens SET device_id=$1 WHERE id=$2', [cleanDeviceId, t.id]);
    }

    res.json({ valid: true, firm_id: t.firm_id, username: t.username || '', expires_at: t.expires_at });
  } catch (err) {
    res.status(500).json({ valid: false });
  }
});

// ── Socket.IO ──────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// ── ENTRIES ────────────────────────────────────────────────

// GET all entries
app.get('/api/entries', async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ success: false, error: 'No firm context' });
    const result = await pool.query(
      'SELECT * FROM entries WHERE firm_id=$1 ORDER BY entry_date DESC, name ASC, created_at ASC',
      [firmId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST add entry
app.post('/api/entries', async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ success: false, error: 'No firm context' });
    const {
      entry_date, name, bags, bharti_pairs, weight, rate,
      amount, commission, other_amount, total, quality,
      item, market_fee, lessrate, bill_number, godown
    } = req.body;

    const result = await pool.query(
      `INSERT INTO entries
        (firm_id, entry_date, name, bags, bharti_pairs, weight, rate, amount,
         commission, other_amount, total, quality, item, market_fee, lessrate, bill_number, godown)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        firmId, entry_date, name, bags,
        JSON.stringify(bharti_pairs),
        weight, rate, amount, commission,
        other_amount || 0, total, quality,
        item, market_fee, lessrate || 0,
        bill_number || '',
        godown || ''
      ]
    );

    const newEntry = result.rows[0];
    io.emit('newEntry', newEntry);
    res.json({ success: true, data: newEntry });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update entry
app.put('/api/entries/:id', async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ success: false, error: 'No firm context' });
    const {
      entry_date, name, bags, bharti_pairs, weight, rate,
      amount, commission, other_amount, total, quality,
      item, market_fee, lessrate, bill_number, godown
    } = req.body;

    const result = await pool.query(
      `UPDATE entries SET
        entry_date=$1, name=$2, bags=$3, bharti_pairs=$4, weight=$5,
        rate=$6, amount=$7, commission=$8, other_amount=$9, total=$10,
        quality=$11, item=$12, market_fee=$13, lessrate=$14, bill_number=$15,
        godown=$16 WHERE id=$17 AND firm_id=$18 RETURNING *`,
      [
        entry_date, name, bags,
        JSON.stringify(bharti_pairs),
        weight, rate, amount, commission,
        other_amount || 0, total, quality,
        item, market_fee, lessrate || 0,
        bill_number || '',
        godown || '',
        req.params.id, firmId
      ]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ success: false, error: 'Entry not found' });

    io.emit('entryUpdated', result.rows[0]);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE entries
app.delete('/api/entries', async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ success: false, error: 'No firm context' });
    const { entryIds } = req.body;
    if (!entryIds || entryIds.length === 0)
      return res.status(400).json({ success: false, error: 'No entries selected' });

    await pool.query(
      'DELETE FROM entries WHERE id = ANY($1) AND firm_id=$2',
      [entryIds.map(id => parseInt(id)), firmId]
    );

    io.emit('entriesDeleted', entryIds);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST mark/unmark entries
app.post('/api/mark-entries', async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ success: false, error: 'No firm context' });
    const { entryIds, marked } = req.body;
    if (!entryIds || entryIds.length === 0)
      return res.status(400).json({ error: 'No entries provided' });

    await pool.query(
      'UPDATE entries SET is_marked=$1 WHERE id = ANY($2) AND firm_id=$3',
      [marked, entryIds.map(id => parseInt(id)), firmId]
    );

    io.emit('entriesMarked', { entryIds, marked });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET autocomplete names & items
app.get('/api/autocomplete', async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ success: false, error: 'No firm context' });
    const [names, items] = await Promise.all([
      pool.query('SELECT DISTINCT name FROM entries WHERE name IS NOT NULL AND firm_id=$1 ORDER BY name', [firmId]),
      pool.query('SELECT DISTINCT item FROM entries WHERE item IS NOT NULL AND firm_id=$1 ORDER BY item', [firmId])
    ]);
    res.json({
      success: true,
      names: names.rows.map(r => r.name),
      items: items.rows.map(r => r.item)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST pay/unpay entries
app.post('/api/pay-entries', async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ success: false, error: 'No firm context' });
    const { entryIds, paid } = req.body;
    if (!entryIds || entryIds.length === 0)
      return res.status(400).json({ error: 'No entries provided' });
    await pool.query(
      'UPDATE entries SET is_paid=$1 WHERE id = ANY($2) AND firm_id=$3',
      [paid, entryIds.map(id => parseInt(id)), firmId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET create lists
app.get('/api/lists', async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ success: false, error: 'No firm context' });
    const result = await pool.query('SELECT section, value FROM create_lists WHERE firm_id=$1 ORDER BY id ASC', [firmId]);
    const lists = { Name: [], Item: [], Godown: [], Quality: [] };
    result.rows.forEach(r => { if (lists[r.section]) lists[r.section].push(r.value); });
    res.json({ success: true, data: lists });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST add to list
app.post('/api/lists', async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ success: false, error: 'No firm context' });
    const { section, value } = req.body;
    await pool.query(
      'INSERT INTO create_lists (firm_id, section, value) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [firmId, section, value]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE from list
app.delete('/api/lists', async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ success: false, error: 'No firm context' });
    const { section, value } = req.body;
    await pool.query('DELETE FROM create_lists WHERE section=$1 AND value=$2 AND firm_id=$3', [section, value, firmId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PDF EXPORTS ────────────────────────────────────────────

// Helper: calculate allAmount for a set of entries
function calcAllAmount(entry, entries) {
  const same = entries.filter(e =>
    e.name === entry.name &&
    new Date(e.entry_date).toDateString() === new Date(entry.entry_date).toDateString()
  );
  if (same.length === 1) return parseFloat(entry.total) || 0;
  const first = same.sort((a, b) => a.id - b.id)[0];
  if (entry.id === first.id)
    return same.reduce((s, e) => s + (parseFloat(e.total) || 0), 0);
  return 0;
}

// POST export main page PDF
app.post('/api/export/pdf', async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ success: false, error: 'No firm context' });
    const { selectedEntries, lang } = req.body;
    if (!selectedEntries || selectedEntries.length === 0)
      return res.status(400).json({ error: 'No entries selected' });

    const result = await pool.query(
      'SELECT * FROM entries WHERE id = ANY($1) AND firm_id=$2 ORDER BY entry_date DESC, name ASC, created_at ASC',
      [selectedEntries.map(id => parseInt(id)), firmId]
    );
    const entries = result.rows;
    if (entries.length === 0)
      return res.status(400).json({ error: 'No matching entries found' });

    const doc = new jsPDF('landscape', 'mm', 'a4');
    const pdfFont = applyPdfFont(doc);
    const isGu = lang === 'gu';

    doc.setFontSize(14);
    doc.text(isGu ? 'એન્ટ્રીઝ રિપોર્ટ' : 'Entries Report', 15, 15);

    const headers = isGu
      ? ['તારીખ','ક્વોલિટી','માલ ની જાત','પાર્ટી નું નામ','બિલ નં','બોરી','ભરતી','વજન','ભાવ','લેસ ભાવ','માલ ની રકમ','કમિશન','અન્ય','રકમ','કુલ રકમ','માર્કેટ ફી']
      : ['DATE','QL','ITEM','NAME','BILL NO','BAGS','BHARTI','WT','RATE','L RATE','AMT','COM','OT','TOTAL','A AMT','MF'];

    const data = entries.map(entry => {
      const pairs = typeof entry.bharti_pairs === 'string' ? JSON.parse(entry.bharti_pairs) : (entry.bharti_pairs || []);
      const bhartiDisplay = pairs.map(p => `(${p.a}×${p.b})`).join('\n');
      const allAmount = calcAllAmount(entry, entries);
      const d = new Date(entry.entry_date);
      const dateStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(-2)}`;
      return [dateStr, entry.quality, entry.item, entry.name, entry.bill_number||'', entry.bags, bhartiDisplay,
        entry.weight, entry.rate, entry.lessrate||0, entry.amount,
        entry.commission, pdfInteger(entry.other_amount), entry.total,
        allAmount.toFixed(2), pdfInteger(entry.market_fee)];
    });

    doc.autoTable({
      head: [headers], body: data, startY: 22,
      styles: { font: pdfFont, fontSize: 7.5, cellPadding: 1.5, halign: 'center', lineWidth: 0.5, lineColor: [0,0,0] },
      headStyles: { font: pdfFont, fontStyle: 'bold', fillColor: [200,200,200], textColor: [0,0,0], lineWidth: 0.5, lineColor: [0,0,0] },
      bodyStyles: { font: pdfFont, textColor: [0,0,0] },
      tableWidth: 'auto', margin: { left: 6, right: 6 }, theme: 'grid'
    });

    const colWidths = doc.lastAutoTable.columns.map(c => c.width);
    const totBags = entries.reduce((s,e) => s+(parseFloat(e.bags)||0), 0);
    const totWeight = entries.reduce((s,e) => s+(parseFloat(e.weight)||0), 0);
    const totTotal = entries.reduce((s,e) => s+(parseFloat(e.total)||0), 0);
    const totMF = entries.reduce((s,e) => s+(parseFloat(e.market_fee)||0), 0);
    const totAmt = entries.reduce((s,e) => s+(parseFloat(e.amount)||0), 0);

    let allAmtTotal = 0;
    const seen = new Set();
    entries.forEach(e => {
      const key = `${e.name}_${new Date(e.entry_date).toDateString()}`;
      if (!seen.has(key)) {
        seen.add(key);
        allAmtTotal += entries.filter(x => x.name===e.name && new Date(x.entry_date).toDateString()===new Date(e.entry_date).toDateString())
          .reduce((s,x) => s+(parseFloat(x.total)||0), 0);
      }
    });

    doc.autoTable({
      body: [['','','','','',totBags,'',totWeight.toFixed(2),'','',totAmt.toFixed(2),'','',totTotal.toFixed(2),allAmtTotal.toFixed(2),pdfInteger(totMF)]],
      startY: doc.lastAutoTable.finalY,
      styles: { font: pdfFont, fontSize: 7.5, fontStyle: 'bold', fillColor: [240,240,240], cellPadding: 1.5, halign: 'center', lineWidth: 0.5, lineColor: [0,0,0], textColor: [0,0,0] },
      theme: 'grid', tableWidth: 'auto', margin: { left: 6, right: 6 },
      columnStyles: colWidths.reduce((acc, w, i) => { acc[i] = { cellWidth: w }; return acc; }, {})
    });

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
    const filename = `entries_${Date.now()}.pdf`;
    const filepath = path.join(EXPORT_PATH, filename);
    fs.writeFileSync(filepath, pdfBuffer);
    res.json({ success: true, filePath: filepath, filename });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST export qualitywise PDF
app.post('/api/export/qualitywise-pdf', async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ success: false, error: 'No firm context' });
    const { selectedEntries, lang } = req.body;
    if (!selectedEntries || selectedEntries.length === 0)
      return res.status(400).json({ error: 'No entries selected' });

    const result = await pool.query(
      'SELECT * FROM entries WHERE id = ANY($1) AND firm_id=$2 ORDER BY entry_date DESC, name ASC, created_at ASC',
      [selectedEntries.map(id => parseInt(id)), firmId]
    );
    const entries = result.rows;
    if (entries.length === 0)
      return res.status(400).json({ error: 'No matching entries found' });

    const doc = new jsPDF('landscape', 'mm', 'a4');
    const pdfFont = applyPdfFont(doc);
    const isGu = lang === 'gu';

    doc.setFontSize(14);
    doc.text(isGu ? 'પડતર લિસ્ટ રિપોર્ટ' : 'Qualitywise Report', 15, 15);

    const headers = isGu
      ? ['માલ ની રકમ','વજન','ભાવ','બોરી','માલ ની જાત','પાર્ટી નું નામ','ક્વોલિટી','ગોડાઉન','તારીખ']
      : ['AMOUNT','WEIGHT','RATE','BAGS','ITEM','NAME','QL','GODOWN','DATE'];

    const data = entries.map(entry => {
      const rate = parseFloat(entry.rate) || 0;
      const weight = parseFloat(entry.weight) || 0;
      return [
        ((rate * weight) / 20).toFixed(2),
        weight.toFixed(2), rate.toFixed(2),
        String(parseInt(entry.bags) || 0),
        entry.item || '', entry.name || '',
        entry.quality || '',
        entry.godown || '',
        new Date(entry.entry_date).toLocaleDateString('en-GB')
      ];
    });

    const totAmount = entries.reduce((s,e) => s+((parseFloat(e.rate)*parseFloat(e.weight))/20), 0);
    const totWeight = entries.reduce((s,e) => s+(parseFloat(e.weight)||0), 0);
    const totBags = entries.reduce((s,e) => s+(parseInt(e.bags)||0), 0);
    const avgRate = totWeight > 0 ? (totAmount * 20) / totWeight : 0;

    doc.autoTable({
      head: [headers], body: data, startY: 22,
      styles: { font: pdfFont, fontSize: 8, cellPadding: 2, halign: 'center', lineWidth: 0.5, lineColor: [0,0,0] },
      headStyles: { font: pdfFont, fontStyle: 'bold', fillColor: [200,200,200], textColor: [0,0,0], lineWidth: 0.5, lineColor: [0,0,0] },
      bodyStyles: { font: pdfFont, textColor: [0,0,0] },
      tableWidth: 'auto', margin: { left: 8, right: 8 }, theme: 'grid'
    });

    const colWidths = doc.lastAutoTable.columns.map(c => c.width);
    doc.autoTable({
      body: [[totAmount.toFixed(2), totWeight.toFixed(2), avgRate.toFixed(2), totBags, '', '', '', '', '']],
      startY: doc.lastAutoTable.finalY,
      styles: { font: pdfFont, fontSize: 8, fontStyle: 'bold', fillColor: [240,240,240], cellPadding: 2, halign: 'center', textColor: [0,0,0], lineWidth: 0.5, lineColor: [0,0,0] },
      theme: 'grid', tableWidth: 'auto', margin: { left: 8, right: 8 },
      columnStyles: colWidths.reduce((acc, w, i) => { acc[i] = { cellWidth: w }; return acc; }, {})
    });

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
    const filename = `qualitywise_${Date.now()}.pdf`;
    const filepath = path.join(EXPORT_PATH, filename);
    fs.writeFileSync(filepath, pdfBuffer);
    res.json({ success: true, filePath: filepath, filename });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST export bill PDF
app.post('/api/export/bill-pdf', async (req, res) => {
  try {
    const firmId = getFirmId(req);
    if (!firmId) return res.status(401).json({ success: false, error: 'No firm context' });
    const { selectedEntries, lang } = req.body;
    if (!selectedEntries || selectedEntries.length === 0)
      return res.status(400).json({ error: 'No entries selected' });

    const result = await pool.query(
      'SELECT * FROM entries WHERE id = ANY($1) AND firm_id=$2 ORDER BY entry_date DESC, name ASC, created_at ASC',
      [selectedEntries.map(id => parseInt(id)), firmId]
    );
    const entries = result.rows;
    if (entries.length === 0)
      return res.status(400).json({ error: 'No matching entries found' });

    const doc = new jsPDF('landscape', 'mm', 'a4');
    const pdfFont = applyPdfFont(doc);
    const isGu = lang === 'gu';

    doc.setFontSize(14);
    doc.text(isGu ? 'બિલ રિપોર્ટ' : 'Bill Report', 15, 15);
    
    // Group exactly as frontend
    const groups = {};
    entries.forEach(entry => {
      if (!entry.name) return;
      const dStr = new Date(entry.entry_date).toDateString();
      const bNum = entry.bill_number || '';
      const key = `${entry.name}_${dStr}_${bNum}`;
      if (!groups[key]) {
        groups[key] = {
          name: entry.name,
          dateObj: new Date(entry.entry_date),
          displayDate: new Date(entry.entry_date).toLocaleDateString('en-GB'),
          billNumber: bNum,
          maxId: entry.id || 0,
          items: []
        };
      } else {
        if ((entry.id || 0) > groups[key].maxId) {
          groups[key].maxId = entry.id || 0;
        }
      }
      
      const lRate = parseFloat(entry.lessrate || 0);
      const weight = parseFloat(entry.weight || 0);
      const baseAmt = (lRate * weight * 5) / 100;
      
      groups[key].items.push({
        ...entry, lRate, weight, baseAmt
      });
    });

    const partyGroups = Object.values(groups).sort((a, b) => {
      const timeDiff = b.dateObj.getTime() - a.dateObj.getTime();
      if (timeDiff !== 0) return timeDiff;
      return (b.maxId || 0) - (a.maxId || 0);
    });

    const headers = isGu
      ? ['પાર્ટી નું નામ', 'તારીખ', 'માલ ની જાત', 'બોરી', 'લેસ ભાવ', 'વજન', 'માલ ની રકમ', 'કુલ આધાર રકમ', 'કમિશન', 'માર્કેટ ફી', 'રકમ', 'SGST', 'CGST', 'સબટોટલ']
      : ['NAME', 'DATE', 'ITEM', 'BAGS', 'L.RATE', 'WT', 'AMT', 'T_AMT', 'COMM', 'M.FEE', 'TOTAL', 'SGST', 'CGST', 'SUBTOT'];

    const tableData = [];

    let grandBags = 0;
    let grandWt = 0;
    let grandAmt = 0;
    let grandTBase = 0;
    let grandComm = 0;
    let grandMarketFee = 0;
    let grandTotal = 0;
    let grandSgst = 0;
    let grandCgst = 0;
    let grandSubtotal = 0;

    partyGroups.forEach(group => {
      const N = group.items.length;
      if (N === 0) return;

      const totalBaseAmount = group.items.reduce((sum, item) => sum + item.baseAmt, 0);
      const comm = (1.5 * totalBaseAmount) / 100;
      const marketfee = (0.5 * totalBaseAmount) / 100;
      const total = totalBaseAmount + comm + marketfee;
      const sgst = (2.5 * total) / 100;
      const cgst = (2.5 * total) / 100;
      const subtotal = total + sgst + cgst;

      grandTBase += totalBaseAmount;
      grandComm += comm;
      grandMarketFee += marketfee;
      grandTotal += total;
      grandSgst += sgst;
      grandCgst += cgst;
      grandSubtotal += subtotal;

      group.items.forEach((item, index) => {
        grandBags += parseFloat(item.bags || 0);
        grandWt += parseFloat(item.weight || 0);
        grandAmt += item.baseAmt;
        
        const row = [];
        
        if (index === 0) {
          const billLabel = group.billNumber ? `\n(Bill: ${group.billNumber})` : '';
          row.push({ content: (group.name || '') + billLabel, rowSpan: N, styles: { valign: 'middle', fontStyle: 'bold' } });
          row.push({ content: group.displayDate || '', rowSpan: N, styles: { valign: 'middle' } });
        }
        
        row.push(item.item || '');
        row.push(String(item.bags || 0));
        row.push(item.lRate.toFixed(2));
        row.push(item.weight.toFixed(2));
        row.push(item.baseAmt.toFixed(2));

        if (index === 0) {
          row.push({ content: totalBaseAmount.toFixed(2), rowSpan: N, styles: { valign: 'middle' } });
          row.push({ content: comm.toFixed(2), rowSpan: N, styles: { valign: 'middle' } });
          row.push({ content: pdfInteger(marketfee), rowSpan: N, styles: { valign: 'middle' } });
          row.push({ content: total.toFixed(2), rowSpan: N, styles: { valign: 'middle', fontStyle: 'bold' } });
          row.push({ content: sgst.toFixed(2), rowSpan: N, styles: { valign: 'middle' } });
          row.push({ content: cgst.toFixed(2), rowSpan: N, styles: { valign: 'middle' } });
          row.push({ content: subtotal.toFixed(2), rowSpan: N, styles: { valign: 'middle', fontStyle: 'bold', textColor: [0, 150, 0] } });
        }
        
        tableData.push(row);
      });
    });

    const footData = [
      [
        { content: isGu ? 'કુલ સરવાળો' : 'GRAND TOTAL', colSpan: 3, styles: { halign: 'right', fontStyle: 'bold' } },
        grandBags.toString(),
        '', // L.RATE
        grandWt.toFixed(2),
        grandAmt.toFixed(2), // AMT
        grandTBase.toFixed(2), // T_AMT
        grandComm.toFixed(2),
        pdfInteger(grandMarketFee),
        grandTotal.toFixed(2),
        grandSgst.toFixed(2),
        grandCgst.toFixed(2),
        grandSubtotal.toFixed(2)
      ]
    ];

    doc.autoTable({
      head: [headers],
      body: tableData,
      foot: footData,
      startY: 22,
      styles: { font: pdfFont, fontSize: 8, cellPadding: 2, halign: 'center', lineWidth: 0.5, lineColor: [0,0,0] },
      headStyles: { font: pdfFont, fontStyle: 'bold', fillColor: [200,200,200], textColor: [0,0,0] },
      footStyles: { font: pdfFont, fontStyle: 'bold', fillColor: [220,220,220], textColor: [0,0,0] },
      bodyStyles: { font: pdfFont, textColor: [0,0,0] },
      tableWidth: 'auto', margin: { left: 6, right: 6 }, theme: 'grid'
    });

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
    const filename = `bill_${Date.now()}.pdf`;
    const filepath = path.join(EXPORT_PATH, filename);
    fs.writeFileSync(filepath, pdfBuffer);
    res.json({ success: true, filePath: filepath, filename });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

let PORT = process.env.PORT || 3001;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} is busy, retrying binding in 1 second...`);
    setTimeout(() => {
      try { server.close(); } catch (e) {}
      server.listen(PORT);
    }, 1000);
  } else {
    console.error('Server error:', err);
  }
});

initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    // Every 60s push updated token statuses so expired tokens flip in real-time
    setInterval(() => emitTokens(io).catch(() => {}), 60 * 1000);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err.message);
  process.exit(1);
});
