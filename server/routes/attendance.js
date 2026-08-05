const express = require('express');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { firstWeekGraceEnd } = require('../../shared/attendanceGracePeriod');

async function loadProbationer(id) {
  const [rows] = await db.getPool().query('SELECT * FROM probationers WHERE id = ?', [id]);
  return rows[0] || null;
}

function isAssignedOrAdmin(req, probationer) {
  return req.user.role === 'admin' || req.user.id === probationer.assigned_officer_id;
}

// Mounted twice from server/app.js: under /probationers/:id/attendance (list/create)
// and under /attendance (edit single entry by id) — see app.js for the mount points.
//
// signaturesDir is shared with the probationer reference-signature endpoints
// (server/routes/probationers.js) — per-visit signatures are told apart from
// the one on-file reference signature by filename (attendance-<entryId>.png
// vs <probationerId>.png), so there's no need for a separate directory.
function buildAttendanceRouter(settingsStore, signaturesDir) {
  const router = express.Router({ mergeParams: true });
  router.use(authenticate(settingsStore));

  router.get('/', async (req, res, next) => {
    try {
      const [rows] = await db
        .getPool()
        .query('SELECT * FROM attendance_log WHERE probationer_id = ? ORDER BY log_date DESC', [req.params.id]);
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const probationer = await loadProbationer(req.params.id);
      if (!probationer) return res.status(404).json({ error: 'Not found' });
      if (!isAssignedOrAdmin(req, probationer)) return res.status(403).json({ error: 'Not assigned to you' });

      const { logDate, notes, pngBase64, gadTopic } = req.body || {};
      if (!logDate) return res.status(400).json({ error: 'logDate is required' });
      // Every attendance entry needs its own signature captured at the visit
      // — separate from probationers.signature_path, the one-time reference
      // signature the officer compares it against (see SignatureAttendanceView.jsx).
      if (!pngBase64) return res.status(400).json({ error: 'pngBase64 (signature for this visit) is required' });

      const [result] = await db
        .getPool()
        .query('INSERT INTO attendance_log (probationer_id, log_date, notes, gad_topic, recorded_by) VALUES (?, ?, ?, ?, ?)', [
          req.params.id,
          logDate,
          notes || null,
          (gadTopic && gadTopic.trim()) || null,
          req.user.id,
        ]);

      fs.mkdirSync(signaturesDir, { recursive: true });
      const filePath = path.join(signaturesDir, `attendance-${result.insertId}.png`);
      const data = pngBase64.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
      await db.getPool().query('UPDATE attendance_log SET signature_path = ? WHERE id = ?', [filePath, result.insertId]);

      res.status(201).json({
        id: result.insertId,
        probationer_id: req.params.id,
        log_date: logDate,
        notes: notes || null,
        gad_topic: (gadTopic && gadTopic.trim()) || null,
        signature_path: filePath,
      });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An entry already exists for that date' });
      next(err);
    }
  });

  return router;
}

function buildAttendanceEntryRouter(settingsStore, signaturesDir) {
  const router = express.Router();
  router.use(authenticate(settingsStore));

  // Each probationer reports once a month, not on a fixed per-person
  // schedule — everyone gets the same grace period through the end of the
  // month's first Monday-Friday work week (see
  // shared/attendanceGracePeriod.js) before being flagged absent. For the
  // requested month we check attendance_log for that month only:
  //   present — has an attendance_log entry in the month
  //   pending — no entry yet, but still within the grace period
  //   absent  — grace period has passed with no entry
  router.get('/overview', async (req, res, next) => {
    try {
      const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : dayjs().format('YYYY-MM');
      const monthStart = `${month}-01`;
      const monthEnd = dayjs(monthStart).endOf('month').format('YYYY-MM-DD');
      const graceEnd = firstWeekGraceEnd(month);

      const [rows] = await db.getPool().query(
        `SELECT p.id AS probationer_id, p.full_name, p.docket_number,
                p.assigned_officer_id, u.full_name AS assigned_officer_name,
                a.id AS log_id, a.log_date
         FROM probationers p
         JOIN users u ON u.id = p.assigned_officer_id
         LEFT JOIN attendance_log a
           ON a.probationer_id = p.id AND a.log_date BETWEEN ? AND ?
         ORDER BY p.full_name, a.log_date`,
        [monthStart, monthEnd]
      );

      const byProbationer = new Map();
      for (const row of rows) {
        if (!byProbationer.has(row.probationer_id)) {
          byProbationer.set(row.probationer_id, {
            probationerId: row.probationer_id,
            fullName: row.full_name,
            docketNumber: row.docket_number,
            assignedOfficerId: row.assigned_officer_id,
            assignedOfficerName: row.assigned_officer_name,
            reportedDates: [],
            // Reporting is once a month, so there's normally at most one entry
            // here — but if a re-report ever happens, the latest one (query is
            // ordered by log_date) is what "the signature that was logged" means.
            latestAttendanceEntryId: null,
          });
        }
        if (row.log_date) {
          const entry = byProbationer.get(row.probationer_id);
          entry.reportedDates.push(dayjs(row.log_date).format('YYYY-MM-DD'));
          entry.latestAttendanceEntryId = row.log_id;
        }
      }

      const today = dayjs().format('YYYY-MM-DD');
      const probationers = [...byProbationer.values()].map((p) => {
        let status;
        if (p.reportedDates.length) status = 'present';
        else if (today <= graceEnd) status = 'pending';
        else status = 'absent';
        const { latestAttendanceEntryId, ...rest } = p;
        return { ...rest, status, attendanceEntryId: latestAttendanceEntryId };
      });

      res.json({ month, graceEnd, probationers });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:entryId/signature', async (req, res, next) => {
    try {
      const [entryRows] = await db.getPool().query('SELECT * FROM attendance_log WHERE id = ?', [req.params.entryId]);
      const entry = entryRows[0];
      if (!entry) return res.status(404).json({ error: 'Not found' });

      const probationer = await loadProbationer(entry.probationer_id);
      if (!isAssignedOrAdmin(req, probationer)) return res.status(403).json({ error: 'Not assigned to you' });

      if (!entry.signature_path || !fs.existsSync(entry.signature_path)) {
        return res.status(404).json({ error: 'No signature on file for this entry' });
      }
      const pngBase64 = fs.readFileSync(entry.signature_path).toString('base64');
      res.json({ pngBase64 });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:entryId', async (req, res, next) => {
    try {
      const [entryRows] = await db.getPool().query('SELECT * FROM attendance_log WHERE id = ?', [req.params.entryId]);
      const entry = entryRows[0];
      if (!entry) return res.status(404).json({ error: 'Not found' });

      const probationer = await loadProbationer(entry.probationer_id);
      if (!isAssignedOrAdmin(req, probationer)) return res.status(403).json({ error: 'Not assigned to you' });

      const { notes, gadTopic } = req.body || {};
      if (notes === undefined && gadTopic === undefined) {
        return res.status(400).json({ error: 'notes or gadTopic is required' });
      }

      if (notes !== undefined) {
        await db.getPool().query('UPDATE attendance_log SET notes = ? WHERE id = ?', [notes, req.params.entryId]);
      }
      if (gadTopic !== undefined) {
        await db.getPool().query('UPDATE attendance_log SET gad_topic = ? WHERE id = ?', [
          (gadTopic && gadTopic.trim()) || null,
          req.params.entryId,
        ]);
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { buildAttendanceRouter, buildAttendanceEntryRouter };
