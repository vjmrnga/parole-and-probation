const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { STAGES, STATUSES } = require('../../shared/statusEnums');

function isAssignedOrAdmin(req, probationer) {
  return req.user.role === 'admin' || req.user.id === probationer.assigned_officer_id;
}

async function loadProbationer(id) {
  const [rows] = await db.getPool().query('SELECT * FROM probationers WHERE id = ?', [id]);
  return rows[0] || null;
}

async function logHistory(conn, { probationerId, changedBy, field, oldValue, newValue }) {
  await conn.query(
    'INSERT INTO status_history (probationer_id, changed_by, field_changed, old_value, new_value) VALUES (?, ?, ?, ?, ?)',
    [probationerId, changedBy, field, oldValue, newValue]
  );
}

// signaturesDir/photosDir: absolute paths (app.getPath('userData')/signatures,
// .../photos) — passed in from electron/main.js since only the main process
// knows the userData location; this module stays agnostic of Electron itself.
function buildProbationersRouter(settingsStore, signaturesDir, photosDir) {
  const router = express.Router();
  router.use(authenticate(settingsStore));

  router.get('/', async (req, res, next) => {
    try {
      const clauses = [];
      const values = [];
      if (req.query.stage) {
        clauses.push('p.stage = ?');
        values.push(req.query.stage);
      }
      if (req.query.status) {
        clauses.push('p.status = ?');
        values.push(req.query.status);
      }
      if (req.query.assignedOfficerId) {
        clauses.push('p.assigned_officer_id = ?');
        values.push(req.query.assignedOfficerId);
      }
      if (req.query.q) {
        // Unqualified column names here are ambiguous once joined against
        // users — both tables have a full_name column, and MySQL refuses to
        // resolve it (ER_NON_UNIQ_ERROR) rather than guessing which one.
        clauses.push('(p.full_name LIKE ? OR p.docket_number LIKE ?)');
        values.push(`%${req.query.q}%`, `%${req.query.q}%`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const [rows] = await db
        .getPool()
        .query(
          `SELECT p.*, u.full_name AS assigned_officer_name
           FROM probationers p JOIN users u ON u.id = p.assigned_officer_id
           ${where} ORDER BY p.created_at DESC`,
          values
        );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const probationer = await loadProbationer(req.params.id);
      if (!probationer) return res.status(404).json({ error: 'Not found' });
      res.json(probationer);
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const {
        fullName, age, address, docketNumber, offense, offenseType, courtBranch, judge, convictionDate,
        caseNumber, dateOfOrder, supervisionPeriod, supervisionStartDate, supervisionEndDate,
        alias, birthdate, sex, maritalStatus, contactNumber, remarks,
      } = req.body || {};
      if (!fullName || !docketNumber) return res.status(400).json({ error: 'fullName and docketNumber are required' });

      let assignedOfficerId = req.user.id;
      if (req.user.role === 'admin' && req.body.assignedOfficerId) {
        assignedOfficerId = req.body.assignedOfficerId;
      }

      const [result] = await db.getPool().query(
        `INSERT INTO probationers
          (full_name, age, address, docket_number, offense, offense_type, court_branch, judge, conviction_date, assigned_officer_id,
           case_number, date_of_order, supervision_period, supervision_start_date, supervision_end_date,
           alias, birthdate, sex, marital_status, contact_number, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          fullName, age || null, address || null, docketNumber, offense || null, offenseType || null, courtBranch || null, judge || null, convictionDate || null, assignedOfficerId,
          caseNumber || null, dateOfOrder || null, supervisionPeriod || null, supervisionStartDate || null, supervisionEndDate || null,
          alias || null, birthdate || null, sex || null, maritalStatus || null, contactNumber || null, remarks || null,
        ]
      );
      const probationer = await loadProbationer(result.insertId);
      res.status(201).json(probationer);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Docket number already exists' });
      next(err);
    }
  });

  router.patch('/:id', async (req, res, next) => {
    try {
      const probationer = await loadProbationer(req.params.id);
      if (!probationer) return res.status(404).json({ error: 'Not found' });
      if (!isAssignedOrAdmin(req, probationer)) return res.status(403).json({ error: 'Not assigned to you' });

      const editable = [
        'full_name', 'age', 'address', 'offense', 'offense_type', 'court_branch', 'judge', 'conviction_date',
        'case_number', 'date_of_order', 'supervision_period', 'supervision_start_date', 'supervision_end_date',
        'alias', 'birthdate', 'sex', 'marital_status', 'contact_number', 'remarks',
      ];
      const fieldMap = {
        fullName: 'full_name', age: 'age', address: 'address', offense: 'offense', offenseType: 'offense_type',
        courtBranch: 'court_branch', judge: 'judge', convictionDate: 'conviction_date',
        caseNumber: 'case_number', dateOfOrder: 'date_of_order', supervisionPeriod: 'supervision_period',
        supervisionStartDate: 'supervision_start_date', supervisionEndDate: 'supervision_end_date',
        alias: 'alias', birthdate: 'birthdate', sex: 'sex', maritalStatus: 'marital_status',
        contactNumber: 'contact_number', remarks: 'remarks',
      };
      const fields = [];
      const values = [];
      for (const [bodyKey, column] of Object.entries(fieldMap)) {
        if (req.body[bodyKey] !== undefined && editable.includes(column)) {
          fields.push(`${column} = ?`);
          values.push(req.body[bodyKey]);
        }
      }
      if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update' });

      values.push(req.params.id);
      await db.getPool().query(`UPDATE probationers SET ${fields.join(', ')} WHERE id = ?`, values);
      res.json(await loadProbationer(req.params.id));
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id/stage', async (req, res, next) => {
    try {
      const { stage } = req.body || {};
      if (!STAGES.includes(stage)) return res.status(400).json({ error: `stage must be one of: ${STAGES.join(', ')}` });

      const probationer = await loadProbationer(req.params.id);
      if (!probationer) return res.status(404).json({ error: 'Not found' });
      if (!isAssignedOrAdmin(req, probationer)) return res.status(403).json({ error: 'Not assigned to you' });

      const conn = await db.getPool().getConnection();
      try {
        await conn.beginTransaction();
        await conn.query('UPDATE probationers SET stage = ? WHERE id = ?', [stage, req.params.id]);
        await logHistory(conn, {
          probationerId: req.params.id, changedBy: req.user.id,
          field: 'stage', oldValue: probationer.stage, newValue: stage,
        });
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
      res.json(await loadProbationer(req.params.id));
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id/status', async (req, res, next) => {
    try {
      const { status } = req.body || {};
      if (!STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });

      const probationer = await loadProbationer(req.params.id);
      if (!probationer) return res.status(404).json({ error: 'Not found' });
      if (!isAssignedOrAdmin(req, probationer)) return res.status(403).json({ error: 'Not assigned to you' });

      const conn = await db.getPool().getConnection();
      try {
        await conn.beginTransaction();
        await conn.query('UPDATE probationers SET status = ? WHERE id = ?', [status, req.params.id]);
        await logHistory(conn, {
          probationerId: req.params.id, changedBy: req.user.id,
          field: 'status', oldValue: probationer.status, newValue: status,
        });
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
      res.json(await loadProbationer(req.params.id));
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id/reassign', requireRole('admin'), async (req, res, next) => {
    try {
      const { assignedOfficerId } = req.body || {};
      if (!assignedOfficerId) return res.status(400).json({ error: 'assignedOfficerId is required' });

      const probationer = await loadProbationer(req.params.id);
      if (!probationer) return res.status(404).json({ error: 'Not found' });

      const [officerRows] = await db.getPool().query('SELECT id FROM users WHERE id = ? AND is_active = 1', [assignedOfficerId]);
      if (!officerRows[0]) return res.status(400).json({ error: 'assignedOfficerId is not an active user' });

      const conn = await db.getPool().getConnection();
      try {
        await conn.beginTransaction();
        await conn.query('UPDATE probationers SET assigned_officer_id = ? WHERE id = ?', [assignedOfficerId, req.params.id]);
        await logHistory(conn, {
          probationerId: req.params.id, changedBy: req.user.id,
          field: 'assigned_officer', oldValue: String(probationer.assigned_officer_id), newValue: String(assignedOfficerId),
        });
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
      res.json(await loadProbationer(req.params.id));
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', requireRole('admin'), async (req, res, next) => {
    try {
      const probationer = await loadProbationer(req.params.id);
      if (!probationer) return res.status(404).json({ error: 'Not found' });

      await db.getPool().query('DELETE FROM probationers WHERE id = ?', [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/signature', async (req, res, next) => {
    try {
      const probationer = await loadProbationer(req.params.id);
      if (!probationer) return res.status(404).json({ error: 'Not found' });
      if (!isAssignedOrAdmin(req, probationer)) return res.status(403).json({ error: 'Not assigned to you' });

      const { pngBase64 } = req.body || {};
      if (!pngBase64) return res.status(400).json({ error: 'pngBase64 is required' });

      fs.mkdirSync(signaturesDir, { recursive: true });
      const filePath = path.join(signaturesDir, `${probationer.id}.png`);
      const data = pngBase64.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(filePath, Buffer.from(data, 'base64'));

      await db.getPool().query('UPDATE probationers SET signature_path = ? WHERE id = ?', [filePath, req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Returns base64 JSON rather than streaming raw image bytes — every API
  // response on this app goes through the IPC-proxied JSON pipeline (see
  // electron/apiProxy.js), which only parses JSON bodies.
  router.get('/:id/signature', async (req, res, next) => {
    try {
      const probationer = await loadProbationer(req.params.id);
      if (!probationer || !probationer.signature_path || !fs.existsSync(probationer.signature_path)) {
        return res.status(404).json({ error: 'No signature on file' });
      }
      const pngBase64 = fs.readFileSync(probationer.signature_path).toString('base64');
      res.json({ pngBase64 });
    } catch (err) {
      next(err);
    }
  });

  // Reference photo on file — same shape as the signature endpoints above,
  // but accepts whatever image type the officer uploads (a photo isn't
  // hand-drawn on a canvas like the signature, so it isn't always PNG) and
  // stores it under its own directory (photosDir) rather than signaturesDir.
  router.post('/:id/photo', async (req, res, next) => {
    try {
      const probationer = await loadProbationer(req.params.id);
      if (!probationer) return res.status(404).json({ error: 'Not found' });
      if (!isAssignedOrAdmin(req, probationer)) return res.status(403).json({ error: 'Not assigned to you' });

      const { dataUrl } = req.body || {};
      if (!dataUrl) return res.status(400).json({ error: 'dataUrl is required' });

      const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(dataUrl);
      if (!match) return res.status(400).json({ error: 'dataUrl must be a base64 PNG/JPEG/WEBP image' });
      const ext = match[1].replace('jpeg', 'jpg');

      fs.mkdirSync(photosDir, { recursive: true });
      const filePath = path.join(photosDir, `${probationer.id}.${ext}`);

      // Extension can change between uploads (e.g. jpg replaced by png) —
      // remove any stale file under the old name so it doesn't linger on disk.
      if (probationer.photo_path && probationer.photo_path !== filePath && fs.existsSync(probationer.photo_path)) {
        fs.unlinkSync(probationer.photo_path);
      }

      fs.writeFileSync(filePath, Buffer.from(match[2], 'base64'));
      await db.getPool().query('UPDATE probationers SET photo_path = ? WHERE id = ?', [filePath, req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/photo', async (req, res, next) => {
    try {
      const probationer = await loadProbationer(req.params.id);
      if (!probationer || !probationer.photo_path || !fs.existsSync(probationer.photo_path)) {
        return res.status(404).json({ error: 'No photo on file' });
      }
      const ext = path.extname(probationer.photo_path).slice(1) || 'jpg';
      const mime = ext === 'jpg' ? 'jpeg' : ext;
      const base64 = fs.readFileSync(probationer.photo_path).toString('base64');
      res.json({ dataUrl: `data:image/${mime};base64,${base64}` });
    } catch (err) {
      next(err);
    }
  });

  // Merges (not replaces) into probationers.psir_profile so edits made here
  // on the Case Detail screen don't clobber whatever the PSIR Generator
  // itself last wrote (media images, report-only fields, etc.) — see
  // renderer/src/components/GeneratePsirModal.jsx for the full shape.
  router.patch('/:id/psir-profile', async (req, res, next) => {
    try {
      const probationer = await loadProbationer(req.params.id);
      if (!probationer) return res.status(404).json({ error: 'Not found' });
      if (!isAssignedOrAdmin(req, probationer)) return res.status(403).json({ error: 'Not assigned to you' });

      const current = probationer.psir_profile || {};
      const patch = req.body || {};
      const merged = {
        ...current,
        fields: { ...(current.fields || {}), ...(patch.fields || {}) },
        radios: { ...(current.radios || {}), ...(patch.radios || {}) },
        offenses: { ...(current.offenses || {}), ...(patch.offenses || {}) },
        sentences: patch.sentences !== undefined ? patch.sentences : current.sentences,
      };
      await db.getPool().query('UPDATE probationers SET psir_profile = ? WHERE id = ?', [JSON.stringify(merged), req.params.id]);
      res.json(await loadProbationer(req.params.id));
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/history', async (req, res, next) => {
    try {
      const [rows] = await db.getPool().query(
        `SELECT h.*, u.full_name AS changed_by_name
         FROM status_history h JOIN users u ON u.id = h.changed_by
         WHERE h.probationer_id = ? ORDER BY h.changed_at DESC`,
        [req.params.id]
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = buildProbationersRouter;
