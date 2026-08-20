const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { probationerNameSql, userNameSql } = require('../../shared/nameUtils');
const { lockSelectSql } = require('./lockHelpers');
const { mountEditRoutes } = require('./editableDoc');
// Mirrors the `id`s in renderer/public/records-check-generator/rc-render.js's
// FORMS array. Kept as a plain list rather than require()-ing that file
// directly — it lives under renderer/public, which electron-builder's
// `files` list (package.json) never bundles into the packaged app (only
// renderer/dist is), so that require crashed the packaged app on every
// launch. Update this list if a recipient is added/removed from FORMS.
const RC_FORM_IDS = new Set([
  'RTC', 'MTCC', 'CITYPROS', 'NBI', 'PNP_TAL', 'PNP_MING', 'RTC_CC', 'MTCC_CC', 'PROV_CC', 'BRGY',
]);

function safeSeg(s) {
  return String(s).replace(/[\\/:*?"<>|]+/g, '-').trim();
}

// --- Recipient header overrides (director/ATTN names that change over time) ---
const RECIPIENT_LINE_COLS = {
  to: ['to_line1', 'to_line2', 'to_line3'],
  attn: ['attn_line1', 'attn_line2', 'attn_line3'],
};
const ALL_RECIPIENT_COLS = [...RECIPIENT_LINE_COLS.to, ...RECIPIENT_LINE_COLS.attn];

function cleanLine(v) {
  const s = String(v == null ? '' : v).trim();
  return s === '' ? null : s;
}

// Row -> { to: [3]|omitted, attn: [3]|omitted }, only non-null lines kept, so
// the generator can tell "no override" (undefined) apart from "override with
// a blank line" (which cleanLine already prevents from being stored anyway).
function rowToOverride(row) {
  const out = {};
  for (const block of Object.keys(RECIPIENT_LINE_COLS)) {
    const lines = RECIPIENT_LINE_COLS[block].map((col) => row[col]);
    if (lines.some((v) => v != null)) out[block] = lines;
  }
  return out;
}

async function loadRecipientOverrides(pool) {
  const [rows] = await pool.query('SELECT * FROM records_check_recipients');
  const out = {};
  for (const row of rows) {
    const override = rowToOverride(row);
    if (Object.keys(override).length) out[row.form_id] = override;
  }
  return out;
}

// recordsCheckDir: absolute path (app.getPath('userData')/records-check-pdfs)
// — passed in from electron/main.js, same convention as psirDir/signaturesDir
// in server/routes/psir.js and probationers.js.
function buildRecordsCheckRouter(settingsStore, recordsCheckDir) {
  const router = express.Router();
  router.use(authenticate(settingsStore));

  router.get('/', async (_req, res, next) => {
    try {
      const [rows] = await db.getPool().query(
        `SELECT r.id, r.probationer_id, r.recipient, r.date_folder, r.filename, r.generated_at, r.generated_by,
                ${probationerNameSql('p')} AS probationer_name, p.docket_number,
                ${userNameSql('u')} AS generated_by_name,
                ${lockSelectSql('r', 'lu')}
         FROM records_check_files r
         JOIN probationers p ON p.id = r.probationer_id
         JOIN users u ON u.id = r.generated_by
         LEFT JOIN users lu ON lu.id = r.locked_by
         ORDER BY r.generated_at DESC`
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/download', async (req, res, next) => {
    try {
      const [rows] = await db.getPool().query('SELECT * FROM records_check_files WHERE id = ?', [req.params.id]);
      const file = rows[0];
      if (!file || !fs.existsSync(file.file_path)) return res.status(404).json({ error: 'Not found' });
      res.json({ base64: fs.readFileSync(file.file_path).toString('base64'), filename: file.filename });
    } catch (err) {
      next(err);
    }
  });

  // Admins can delete any file; other officers may delete only records-check
  // PDFs they generated themselves (checked against generated_by, not role).
  router.delete('/:id', async (req, res, next) => {
    try {
      const [rows] = await db.getPool().query('SELECT * FROM records_check_files WHERE id = ?', [req.params.id]);
      const file = rows[0];
      if (!file) return res.status(404).json({ error: 'Not found' });
      if (req.user.role !== 'admin' && file.generated_by !== req.user.id) {
        return res.status(403).json({ error: 'You can only delete files you generated' });
      }
      await db.getPool().query('DELETE FROM records_check_files WHERE id = ?', [req.params.id]);
      if (fs.existsSync(file.file_path)) fs.unlinkSync(file.file_path);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Body: { files: [{ probationerId, recipient, dateFolder, filename, base64 }] }.
  // One call per "Save PDFs" click in the generator, which can cover many
  // petitioners x many recipients at once.
  router.post('/batch', async (req, res, next) => {
    try {
      const { files } = req.body || {};
      if (!Array.isArray(files) || !files.length) return res.status(400).json({ error: 'files is required' });

      const ids = [];
      for (const file of files) {
        const { probationerId, recipient, dateFolder, filename, base64 } = file || {};
        if (!probationerId || !recipient || !dateFolder || !filename || !base64) {
          return res.status(400).json({ error: 'Each file needs probationerId, recipient, dateFolder, filename and base64' });
        }
        const dir = path.join(recordsCheckDir, safeSeg(recipient), safeSeg(dateFolder));
        fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, filename);
        fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));

        const [result] = await db.getPool().query(
          `INSERT INTO records_check_files (probationer_id, recipient, date_folder, filename, file_path, generated_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [probationerId, recipient, dateFolder, filename, filePath, req.user.id]
        );
        ids.push(result.insertId);
      }
      res.status(201).json({ ok: true, count: ids.length, ids });
    } catch (err) {
      next(err);
    }
  });

  router.get('/recipients', async (_req, res, next) => {
    try {
      res.json(await loadRecipientOverrides(db.getPool()));
    } catch (err) {
      next(err);
    }
  });

  // Body: { recipients: { [formId]: { to: [3 strings], attn: [3 strings]|null } } }.
  // Full replace, one recipient at a time: a blank/whitespace line reverts
  // that line to rc-render.js's built-in default (stored as NULL); a
  // recipient left with all 6 lines blank has its row removed entirely
  // rather than kept around empty. Any authenticated user may save — these
  // are the same freely-editable-per-run header details as the Chief/IO
  // fields already on this screen, just persisted so they don't reset.
  router.put('/recipients', async (req, res, next) => {
    try {
      const { recipients } = req.body || {};
      if (!recipients || typeof recipients !== 'object') {
        return res.status(400).json({ error: 'recipients is required' });
      }
      const pool = db.getPool();
      for (const formId of Object.keys(recipients)) {
        if (!RC_FORM_IDS.has(formId)) {
          return res.status(400).json({ error: `Unknown recipient: ${formId}` });
        }
        const entry = recipients[formId] || {};
        const values = {};
        RECIPIENT_LINE_COLS.to.forEach((col, i) => { values[col] = cleanLine(entry.to && entry.to[i]); });
        RECIPIENT_LINE_COLS.attn.forEach((col, i) => { values[col] = cleanLine(entry.attn && entry.attn[i]); });

        if (ALL_RECIPIENT_COLS.every((col) => values[col] == null)) {
          await pool.query('DELETE FROM records_check_recipients WHERE form_id = ?', [formId]);
          continue;
        }
        const cols = ['form_id', ...ALL_RECIPIENT_COLS, 'updated_by'];
        const placeholders = cols.map(() => '?').join(', ');
        const updateCols = [...ALL_RECIPIENT_COLS, 'updated_by']
          .map((col) => `${col} = VALUES(${col})`).join(', ');
        await pool.query(
          `INSERT INTO records_check_recipients (${cols.join(', ')}) VALUES (${placeholders})
           ON DUPLICATE KEY UPDATE ${updateCols}`,
          [formId, ...ALL_RECIPIENT_COLS.map((col) => values[col]), req.user.id]
        );
      }
      res.json(await loadRecipientOverrides(pool));
    } catch (err) {
      next(err);
    }
  });

  // Edit-in-place check-out: POST/DELETE /:id/lock and PUT /:id/file.
  mountEditRoutes(router, 'records_check_files');

  return router;
}

module.exports = buildRecordsCheckRouter;
