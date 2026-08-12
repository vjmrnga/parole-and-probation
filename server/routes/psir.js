const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { probationerNameSql, userNameSql } = require('../../shared/nameUtils');
const { lockSelectSql } = require('./lockHelpers');
const { mountEditRoutes } = require('./editableDoc');

const ORG_SETTINGS_FIELDS = [
  'br_region', 'br_region2', 'br_office', 'br_addr', 'br_tel', 'br_email', 'br_web',
  'office_name', 'office_address', 'cppo_name', 'cppo_title',
  'officer_rank', 'officer_name', 'officer_title', 'sign_place',
];

// Reverse of GeneratePsirModal.jsx's `seeded` map: turns a PSIR snapshot's
// flat field map (keyed by the generator's own input ids — see
// renderer/public/psir-generator/collectSnapshot) back into probationers-table
// columns, so details the officer types straight into the PSIR form become the
// case's stored data. This matters because officers commonly hit "Generate
// PSIR" on a barely-created case and fill the identifying details there rather
// than on the Case Detail screen.
//
// Only non-empty snapshot values are returned, so a blank PSIR field never
// wipes an existing case value — it just isn't touched. docket_number is
// deliberately excluded: it's the case's unique identity key (prefilled from
// the case, UNIQUE + NOT NULL), and letting a PSIR edit rewrite it risks a
// duplicate-key failure on an otherwise-fine save. Offense/court are also left
// out — the generator stores those as structured charged/convicted/sentence
// builders, not the single free-text columns the case uses.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function probationerColumnsFromSnapshot(snapshot) {
  const f = (snapshot && snapshot.fields) || {};
  const out = {};
  const setStr = (col, val) => {
    if (val != null && String(val).trim() !== '') out[col] = String(val).trim();
  };
  const setDate = (col, val) => {
    const d = val ? String(val).slice(0, 10) : '';
    if (DATE_RE.test(d)) out[col] = d;
  };

  setStr('last_name', f.lastName);
  setStr('first_name', f.firstName);
  setStr('middle_name', f.middleName);
  setStr('case_number', f.criminalCaseNo);
  setStr('judge', f.judgeName);
  setStr('address', f.presentAddress);
  setStr('alias', f.alias);
  setDate('date_of_order', f.orderDate);
  setDate('date_order_received', f.receivedDate);
  setDate('birthdate', f.birthday);

  if (f.age != null && String(f.age).trim() !== '') {
    const n = parseInt(f.age, 10);
    if (Number.isFinite(n)) out.age = n;
  }
  // sex / civil status <select>s carry "__other" with the real text in a
  // companion field (see GeneratePsirModal.jsx's applySelectOther).
  setStr('sex', f.sex === '__other' ? f.sexOther : f.sex);
  setStr('marital_status', f.civilStatus === '__other' ? f.civilOther : f.civilStatus);

  return out;
}

async function loadOrgSettings(pool) {
  const [rows] = await pool.query('SELECT * FROM psir_org_settings WHERE id = 1');
  if (rows[0]) return rows[0];
  await pool.query('INSERT INTO psir_org_settings (id) VALUES (1)');
  const [created] = await pool.query('SELECT * FROM psir_org_settings WHERE id = 1');
  return created[0];
}

// psirDir: absolute path where generated .docx files are written (see
// server/routes/probationers.js's signaturesDir for the same convention) —
// resolved in electron/main.js since only Electron knows the userData path.
function buildPsirRouter(settingsStore, psirDir) {
  const router = express.Router();
  router.use(authenticate(settingsStore));

  router.get('/meta', (_req, res) => {
    res.json({
      recommendationTypes: [
        { value: 'GRANTED', label: 'GRANTED — recommend probation' },
        { value: 'DENIED', label: 'DENIED — unfavorable evaluation' },
        { value: 'LEGAL_DQ', label: 'DENIED — Legal Disqualification (Sec. 9, P.D. 968)' },
        { value: 'WITHDRAWN', label: 'WITHDRAWN — petitioner withdrew the application' },
        { value: 'MOOT', label: 'MOOT and ACADEMIC — e.g., sentence fully served' },
      ],
    });
  });

  router.get('/settings', async (_req, res, next) => {
    try {
      res.json(await loadOrgSettings(db.getPool()));
    } catch (err) {
      next(err);
    }
  });

  router.patch('/settings', requireRole('admin'), async (req, res, next) => {
    try {
      const fields = [];
      const values = [];
      for (const col of ORG_SETTINGS_FIELDS) {
        if (req.body[col] !== undefined) {
          fields.push(`${col} = ?`);
          values.push(req.body[col]);
        }
      }
      await loadOrgSettings(db.getPool()); // ensure the singleton row exists
      if (fields.length) {
        await db.getPool().query(`UPDATE psir_org_settings SET ${fields.join(', ')} WHERE id = 1`, values);
      }
      res.json(await loadOrgSettings(db.getPool()));
    } catch (err) {
      next(err);
    }
  });

  router.get('/', async (req, res, next) => {
    try {
      const clauses = [];
      const values = [];
      if (req.query.probationerId) {
        clauses.push('r.probationer_id = ?');
        values.push(req.query.probationerId);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const [rows] = await db.getPool().query(
        `SELECT r.id, r.probationer_id, r.recommendation_type, r.filename, r.generated_at,
                ${probationerNameSql('p')} AS probationer_name, p.docket_number,
                ${userNameSql('u')} AS generated_by_name,
                ${lockSelectSql('r', 'lu')}
         FROM psir_reports r
         JOIN probationers p ON p.id = r.probationer_id
         JOIN users u ON u.id = r.generated_by
         LEFT JOIN users lu ON lu.id = r.locked_by
         ${where} ORDER BY r.generated_at DESC`,
        values
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/download', async (req, res, next) => {
    try {
      const [rows] = await db.getPool().query('SELECT * FROM psir_reports WHERE id = ?', [req.params.id]);
      const report = rows[0];
      if (!report || !fs.existsSync(report.file_path)) return res.status(404).json({ error: 'Not found' });
      res.json({ base64: fs.readFileSync(report.file_path).toString('base64'), filename: report.filename });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', requireRole('admin'), async (req, res, next) => {
    try {
      const [rows] = await db.getPool().query('SELECT * FROM psir_reports WHERE id = ?', [req.params.id]);
      const report = rows[0];
      if (!report) return res.status(404).json({ error: 'Not found' });
      await db.getPool().query('DELETE FROM psir_reports WHERE id = ?', [req.params.id]);
      if (fs.existsSync(report.file_path)) fs.unlinkSync(report.file_path);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Body: { probationerId, filename, base64, recommendationType, snapshot }.
  // The .docx itself is already fully built client-side (see
  // renderer/public/psir-generator/app-logic.js's generateDocx) — this just
  // persists the bytes + a DB record, and rolls the snapshot's identifying
  // data forward onto the probationer so the next PSIR for them opens
  // prefilled.
  router.post('/', async (req, res, next) => {
    try {
      const { probationerId, filename, base64, recommendationType, snapshot } = req.body || {};
      if (!probationerId || !filename || !base64 || !recommendationType) {
        return res.status(400).json({ error: 'probationerId, filename, base64 and recommendationType are required' });
      }
      const [probRows] = await db.getPool().query('SELECT id FROM probationers WHERE id = ?', [probationerId]);
      if (!probRows[0]) return res.status(404).json({ error: 'Probationer not found' });

      fs.mkdirSync(psirDir, { recursive: true });
      const safeName = `${probationerId}-${Date.now()}-${filename}`.replace(/[^A-Za-z0-9._-]/g, '_');
      const filePath = path.join(psirDir, safeName);
      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));

      const [result] = await db.getPool().query(
        `INSERT INTO psir_reports (probationer_id, recommendation_type, filename, file_path, snapshot, generated_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [probationerId, recommendationType, filename, filePath, snapshot ? JSON.stringify(snapshot) : null, req.user.id]
      );

      if (snapshot) {
        // Roll the snapshot forward for prefill AND back-fill the structured
        // case columns from what the officer typed (see
        // probationerColumnsFromSnapshot) — one UPDATE for both.
        const cols = probationerColumnsFromSnapshot(snapshot);
        cols.psir_profile = JSON.stringify(snapshot);
        const setSql = Object.keys(cols).map((c) => `${c} = ?`).join(', ');
        await db.getPool().query(
          `UPDATE probationers SET ${setSql} WHERE id = ?`,
          [...Object.values(cols), probationerId]
        );
      }

      const [rows] = await db.getPool().query('SELECT * FROM psir_reports WHERE id = ?', [result.insertId]);
      res.status(201).json(rows[0]);
    } catch (err) {
      next(err);
    }
  });

  // Edit-in-place check-out: POST/DELETE /:id/lock and PUT /:id/file.
  mountEditRoutes(router, 'psir_reports');

  return router;
}

module.exports = buildPsirRouter;
