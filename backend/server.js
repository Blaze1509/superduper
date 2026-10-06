const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const { jsPDF } = require('jspdf');
require('jspdf-autotable');
require('dotenv').config();
const CryptoJS = require('crypto-js');

// ** CRITICAL SECURITY SECRET **
// Must match exactly with mobile config.js
const SHARED_SECRET = 'HACKER_PROOF_ENCRYPTION_KEY_2026';

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
app.set('trust proxy', 1);
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
    const url = 'https://gwfh.mranftl.com/api/fonts/noto-sans-gujarati?download=zip&subsets=gujarati,latin&variants=600';
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          try {
            const { execSync } = require('child_process');
            const extractDir = path.join(FONTS_DIR, 'gwfh_extract');
            execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force"`);
            const extractedTtf = path.join(extractDir, 'noto-sans-gujarati-v27-gujarati_latin-600.ttf');
            if (fs.existsSync(extractedTtf)) {
              fs.copyFileSync(extractedTtf, GUJARATI_FONT_PATH);
              console.log('Full Gujarati TTF font unpacked successfully.');
            }
          } catch (e) {
            console.error('Failed to extract Gujarati font package:', e.message);
          }
          resolve(GUJARATI_FONT_PATH);
        });
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
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false, frameguard: false }));

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

// Phase 4: Payload Decryption Middleware
app.use((req, res, next) => {
  if (req.body && req.body.encryptedPayload) {
    try {
      const bytes = CryptoJS.AES.decrypt(req.body.encryptedPayload, SHARED_SECRET);
      const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
      if (decryptedStr) {
        req.body = JSON.parse(decryptedStr);
      } else {
        throw new Error('Empty decrypted string');
      }
    } catch (e) {
      console.error('Payload decryption failed:', e.message);
      return res.status(400).json({ success: false, error: 'Invalid encrypted payload' });
    }
  }

  // Intercept res.json to encrypt outgoing responses
  const originalJson = res.json;
  res.json = function (data) {
    try {
      if (data && typeof data === 'object' && !data.encryptedPayload) {
        const jsonStr = JSON.stringify(data);
        const encrypted = CryptoJS.AES.encrypt(jsonStr, SHARED_SECRET).toString();
        return originalJson.call(this, { encryptedPayload: encrypted });
      }
    } catch (e) {
      console.error('Response encryption failed:', e.message);
    }
    return originalJson.call(this, data);
  };
  
  next();
});

app.use('/exports', express.static(EXPORT_PATH));

// Rate Limiters for Security
const isDev = process.env.NODE_ENV === 'development';

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 10000 : 300,
  skip: () => isDev,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDev ? 10000 : 300,
  skip: () => isDev,
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

app.post('/api/admin/panic/reset', requireAdmin, async (req, res) => {
  try {
    const { token_id } = req.body;
    if (!token_id) return res.status(400).json({ success: false, error: 'Token ID required' });
    await pool.query('UPDATE activation_tokens SET is_panic = FALSE WHERE id = $1', [token_id]);
    res.json({ success: true });
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
      'SELECT *, (expires_at < NOW()) as is_expired FROM activation_tokens WHERE token=$1',
      [token.trim().toUpperCase()]
    );

    if (result.rows.length === 0)
      return res.status(400).json({ success: false, error: 'Invalid token' });

    const t = result.rows[0];
    if (t.is_used)
      return res.status(400).json({ success: false, error: 'Token already used' });
    if (t.is_expired)
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
      `SELECT *, (expires_at < NOW()) as is_expired FROM activation_tokens 
       WHERE UPPER(token) = $1 AND (device_id = $2 OR device_id IS NULL) AND is_used = TRUE`,
      [cleanToken, cleanDeviceId]
    );

    if (result.rows.length === 0) return res.json({ valid: false });

    const t = result.rows[0];
    if (t.is_expired) return res.json({ valid: false });

    // Ensure device_id is bound if it was NULL
    if (!t.device_id) {
      await pool.query('UPDATE activation_tokens SET device_id=$1 WHERE id=$2', [cleanDeviceId, t.id]);
    }

    res.json({ valid: true, firm_id: t.firm_id, username: t.username || '', expires_at: t.expires_at, is_panic: t.is_panic });
  } catch (err) {
    res.status(500).json({ valid: false });
  }
});

app.post('/api/panic/trigger', async (req, res) => {
  try {
    const { token, device_id } = req.body;
    if (!token || !device_id) return res.json({ success: false });

    const cleanToken = String(token).trim().toUpperCase();
    const cleanDeviceId = String(device_id).trim();

    await pool.query(
      'UPDATE activation_tokens SET is_panic = TRUE WHERE UPPER(token) = $1 AND device_id = $2',
      [cleanToken, cleanDeviceId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ── Socket.IO ──────────────────────────────────────────────
io.on('connection', (socket) => {
  const firmId = socket.handshake.query.firmId;
  if (firmId) {
    socket.join(`firm_${firmId}`);
    console.log(`Client ${socket.id} joined firm_${firmId}`);
  } else {
    console.log('Client connected without firmId:', socket.id);
  }
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
    io.to(`firm_${firmId}`).emit('newEntry', newEntry);
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

    io.to(`firm_${firmId}`).emit('entryUpdated', result.rows[0]);
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

    io.to(`firm_${firmId}`).emit('entriesDeleted', entryIds);
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

    io.to(`firm_${firmId}`).emit('entriesMarked', { entryIds, marked });
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
    io.to(`firm_${firmId}`).emit('entriesPaid', { entryIds, paid });
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
    const result = await pool.query(
      'INSERT INTO create_lists (firm_id, section, value) VALUES ($1, $2, $3) ON CONFLICT (firm_id, section, value) DO NOTHING',
      [firmId, section, value]
    );
    
    if (result.rowCount === 0) {
      return res.status(409).json({ success: false, error: 'Already exists' });
    }
    
    io.to(`firm_${firmId}`).emit('listAdded', { section, value });
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
    
    io.to(`firm_${firmId}`).emit('listDeleted', { section, value });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PDF EXPORTS ────────────────────────────────────────────
const puppeteer = require('puppeteer');

// Helper: Generate PDF from HTML using Puppeteer
async function generatePdfFromHtml(htmlContent, filename) {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    headless: 'new'
  });
  const page = await browser.newPage();
  await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
  const pdfBuffer = await page.pdf({
    format: 'A4',
    landscape: true,
    margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    printBackground: true,
  });
  await browser.close();

  const filepath = path.join(EXPORT_PATH, filename);
  fs.writeFileSync(filepath, pdfBuffer);
  return filepath;
}
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

    const isGu = lang === 'gu';
    const title = isGu ? 'પેમેન્ટ લિસ્ટ' : 'Payment List';

    const headers = isGu
      ? ['તારીખ', 'ક્વોલિટી', 'માલ ની જાત', 'પાર્ટી નું નામ', 'બિલ નં', 'બોરી', 'ભરતી', 'વજન', 'ભાવ', 'લેસ ભાવ', 'માલ ની રકમ', 'કમિશન', 'અન્ય', 'રકમ', 'કુલ રકમ', 'માર્કેટ ફી']
      : ['DATE', 'QUALITY', 'ITEM', 'PARTY<br>NAME', 'BILL<br>NO', 'BAGS', 'BHARTI', 'WEIGHT', 'RATE', 'LESS<br>RATE', 'AMOUNT', 'COMMISSION', 'OTHER', 'TOTAL', 'ALL<br>AMOUNT', 'MARKET<br>FEE'];

    let totBags = 0, totWeight = 0, totAmt = 0, totTotal = 0, totMF = 0;

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Gujarati:wght@400;600;700&display=swap');
          body { font-family: 'Noto Sans Gujarati', sans-serif; font-size: 10px; margin: 0; padding: 10px; }
          h1 { font-size: 18px; margin-bottom: 10px; }
          table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
          tr { page-break-inside: avoid; page-break-after: auto; }
          th, td { border: 1px solid #000; padding: 4px; text-align: center; }
          .head { background-color: #2e7d32; color: #fff; font-weight: bold; text-align: center; }
          .body { background-color: #e8f5e9; color: #000; }
          .allamt { background-color: #a5d6a7; font-weight: bold; }
          .amt { text-align: right; }
          .foot { background-color: #a5d6a7; font-weight: bold; }
        </style>
      </head>
      <body>
        <h1>${title}</h1>
        <table>
          <thead>
            <tr>${headers.map(h => `<th class="head">${h}</th>`).join('')}</tr>
          </thead>
          <tbody>
    `;

    entries.forEach(entry => {
      const pairs = typeof entry.bharti_pairs === 'string' ? JSON.parse(entry.bharti_pairs) : (entry.bharti_pairs || []);
      const bhartiDisplay = pairs.map(p => `(${p.a}×${p.b})`).join('<br>');
      const allAmount = calcAllAmount(entry, entries);
      const d = new Date(entry.entry_date);
      const dateStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;

      totBags += parseFloat(entry.bags) || 0;
      totWeight += parseFloat(entry.weight) || 0;
      totTotal += parseFloat(entry.total) || 0;
      totMF += parseFloat(entry.market_fee) || 0;
      totAmt += parseFloat(entry.amount) || 0;

      html += `
        <tr class="body">
          <td>${dateStr}</td>
          <td>${entry.quality || ''}</td>
          <td>${entry.item || ''}</td>
          <td>${entry.name || ''}</td>
          <td>${entry.bill_number || ''}</td>
          <td>${entry.bags || 0}</td>
          <td>${bhartiDisplay}</td>
          <td class="amt">${entry.weight || 0}</td>
          <td class="amt">${entry.rate || 0}</td>
          <td class="amt">${entry.lessrate || 0}</td>
          <td class="amt">${entry.amount || 0}</td>
          <td class="amt">${entry.commission || 0}</td>
          <td class="amt">${pdfInteger(entry.other_amount)}</td>
          <td class="amt">${entry.total || 0}</td>
          <td class="allamt amt">${allAmount.toFixed(2)}</td>
          <td class="amt">${pdfInteger(entry.market_fee)}</td>
        </tr>
      `;
    });

    let allAmtTotal = 0;
    const seen = new Set();
    entries.forEach(e => {
      const key = `${e.name}_${new Date(e.entry_date).toDateString()}`;
      if (!seen.has(key)) {
        seen.add(key);
        allAmtTotal += entries.filter(x => x.name === e.name && new Date(x.entry_date).toDateString() === new Date(e.entry_date).toDateString())
          .reduce((s, x) => s + (parseFloat(x.total) || 0), 0);
      }
    });

    html += `
          </tbody>
          <tfoot>
            <tr class="foot">
              <td colspan="5"></td>
              <td>${totBags}</td>
              <td></td>
              <td class="amt">${totWeight.toFixed(2)}</td>
              <td colspan="2"></td>
              <td class="amt">${totAmt.toFixed(2)}</td>
              <td colspan="2"></td>
              <td class="amt">${totTotal.toFixed(2)}</td>
              <td class="amt">${allAmtTotal.toFixed(2)}</td>
              <td class="amt">${pdfInteger(totMF)}</td>
            </tr>
          </tfoot>
        </table>
      </body>
      </html>
    `;

    const filename = `entries_${Date.now()}.pdf`;
    const filepath = await generatePdfFromHtml(html, filename);
    res.json({ success: true, filePath: filepath, filename });
  } catch (err) {
    console.error(err);
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

    const isGu = lang === 'gu';
    const title = isGu ? 'પડતર લિસ્ટ રિપોર્ટ' : 'Qualitywise Report';

    const headers = isGu
      ? ['માલ ની રકમ', 'વજન', 'ભાવ', 'બોરી', 'માલ ની જાત', 'પાર્ટી નું નામ', 'ક્વોલિટી', 'ફેકટરી (ગોડાઉન)', 'તારીખ']
      : ['AMOUNT', 'WEIGHT', 'RATE', 'BAGS', 'ITEM', 'NAME', 'QUALITYL', 'FACTORY(GODOWN)', 'DATE'];

    let totAmount = 0, totWeight = 0, totBags = 0;

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Gujarati:wght@400;600;700&display=swap');
          body { font-family: 'Noto Sans Gujarati', sans-serif; font-size: 10px; margin: 0; padding: 10px; }
          h1 { font-size: 18px; margin-bottom: 10px; }
          table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
          tr { page-break-inside: avoid; page-break-after: auto; }
          th, td { border: 1px solid #000; padding: 4px; text-align: center; }
          .head { background-color: #2e7d32; color: #fff; font-weight: bold; text-align: center; }
          .body { background-color: #e8f5e9; color: #000; }
          .amt { text-align: right; }
          .foot { background-color: #a5d6a7; font-weight: bold; }
        </style>
      </head>
      <body>
        <h1>${title}</h1>
        <table>
          <thead>
            <tr>${headers.map(h => `<th class="head">${h}</th>`).join('')}</tr>
          </thead>
          <tbody>
    `;

    entries.forEach(entry => {
      const rate = parseFloat(entry.rate) || 0;
      const weight = parseFloat(entry.weight) || 0;
      const amount = (rate * weight) / 20;
      const bags = parseInt(entry.bags) || 0;

      totAmount += amount;
      totWeight += weight;
      totBags += bags;

      html += `
        <tr class="body">
          <td class="amt">${amount.toFixed(2)}</td>
          <td class="amt">${weight.toFixed(2)}</td>
          <td class="amt">${rate.toFixed(2)}</td>
          <td>${bags}</td>
          <td>${entry.item || ''}</td>
          <td>${entry.name || ''}</td>
          <td>${entry.quality || ''}</td>
          <td>${entry.godown || ''}</td>
          <td>${new Date(entry.entry_date).toLocaleDateString('en-GB')}</td>
        </tr>
      `;
    });

    const avgRate = totWeight > 0 ? (totAmount * 20) / totWeight : 0;

    html += `
          </tbody>
          <tfoot>
            <tr class="foot">
              <td class="amt">${totAmount.toFixed(2)}</td>
              <td class="amt">${totWeight.toFixed(2)}</td>
              <td class="amt">${avgRate.toFixed(2)}</td>
              <td>${totBags}</td>
              <td colspan="5"></td>
            </tr>
          </tfoot>
        </table>
      </body>
      </html>
    `;

    const filename = `qualitywise_${Date.now()}.pdf`;
    const filepath = await generatePdfFromHtml(html, filename);
    res.json({ success: true, filePath: filepath, filename });
  } catch (err) {
    console.error(err);
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

    const isGu = lang === 'gu';
    const title = isGu ? 'બિલ રિપોર્ટ' : 'Bill Report';

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
      ? ['પાર્ટી નું નામ', 'તારીખ', 'માલ ની જાત', 'બોરી', 'લેસ ભાવ', 'વજન', 'માલ ની રકમ', 'કમિશન', 'માર્કેટ ફી', 'રકમ', 'SGST', 'CGST', 'સબટોટલ']
      : ['NAME', 'DATE', 'ITEM', 'BAGS', 'LESS RATE', 'WEIGHTS', 'AMOUNT', 'COMMISSION', 'MARKET FEE', 'TOTAL', 'SGST', 'CGST', 'SubTotal'];

    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Gujarati:wght@400;600;700&display=swap');
          body { font-family: 'Noto Sans Gujarati', sans-serif; font-size: 10px; margin: 0; padding: 10px; }
          h1 { font-size: 18px; margin-bottom: 10px; }
          table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
          tr { page-break-inside: avoid; page-break-after: auto; }
          th, td { border: 1px solid #000; padding: 4px; text-align: center; vertical-align: middle; }
          .head { background-color: #2e7d32; color: #fff; font-weight: bold; text-align: center; }
          .body { background-color: #e8f5e9; color: #000; }
          .foot { background-color: #a5d6a7; font-weight: bold; }
          .sub { color: #000000ff; font-weight: bold; }
          .bold { font-weight: bold; }
          .amt { text-align: right; }
          .text-right { text-align: right; padding-right: 10px; }
        </style>
      </head>
      <body>
        <h1>${title}</h1>
        <table>
          <thead>
            <tr>${headers.map(h => `<th class="head">${h}</th>`).join('')}</tr>
          </thead>
          <tbody>
    `;

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

        html += `<tr class="body">`;

        if (index === 0) {
          const billLabel = group.billNumber ? `<br>(Bill: ${group.billNumber})` : '';
          html += `<td rowspan="${N}" class="bold">${group.name || ''}${billLabel}</td>`;
          html += `<td rowspan="${N}">${group.displayDate || ''}</td>`;
        }

        html += `
          <td>${item.item || ''}</td>
          <td>${item.bags || 0}</td>
          <td class="amt">${item.lRate.toFixed(2)}</td>
          <td class="amt">${item.weight.toFixed(2)}</td>
          <td class="amt">${item.baseAmt.toFixed(2)}</td>
        `;

        if (index === 0) {
          html += `<td rowspan="${N}" class="amt">${comm.toFixed(2)}</td>`;
          html += `<td rowspan="${N}" class="amt">${pdfInteger(marketfee)}</td>`;
          html += `<td rowspan="${N}" class="bold amt">${total.toFixed(2)}</td>`;
          html += `<td rowspan="${N}" class="amt">${sgst.toFixed(2)}</td>`;
          html += `<td rowspan="${N}" class="amt">${cgst.toFixed(2)}</td>`;
          html += `<td rowspan="${N}" class="sub amt">${subtotal.toFixed(2)}</td>`;
        }

        html += `</tr>`;
      });
    });

    const footLabel = isGu ? 'કુલ સરવાળો' : 'GRAND TOTAL';
    html += `
          </tbody>
          <tfoot>
            <tr class="foot">
              <td colspan="3" class="text-right">${footLabel}</td>
              <td>${grandBags}</td>
              <td></td>
              <td class="amt">${grandWt.toFixed(2)}</td>
              <td class="amt">${grandAmt.toFixed(2)}</td>
              <td class="amt">${grandComm.toFixed(2)}</td>
              <td class="amt">${pdfInteger(grandMarketFee)}</td>
              <td class="amt">${grandTotal.toFixed(2)}</td>
              <td class="amt">${grandSgst.toFixed(2)}</td>
              <td class="amt">${grandCgst.toFixed(2)}</td>
              <td class="amt">${grandSubtotal.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </body>
      </html>
    `;

    const filename = `bill_${Date.now()}.pdf`;
    const filepath = await generatePdfFromHtml(html, filename);
    res.json({ success: true, filePath: filepath, filename });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

let PORT = process.env.PORT || 3001;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} is busy, retrying binding in 1 second...`);
    setTimeout(() => {
      try { server.close(); } catch (e) { }
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
    setInterval(() => emitTokens(io).catch(() => { }), 60 * 1000);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err.message);
  process.exit(1);
});

