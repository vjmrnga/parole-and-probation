const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { probationerNameSql, userNameSql } = require('../../shared/nameUtils');
const { lockSelectSql } = require('./lockHelpers');
const { mountEditRoutes } = require('./editableDoc');

// fileReportsDir: absolute path where generated Final Report .docx files are
// written (see server/routes/psir.js's psirDir for the same convention) —
// resolved in electron/main.js since only Electron knows the userData path.
// Office letterhead/signatory defaults are shared with the PSIR Generator —
// see GET/PATCH /api/psir/settings — since the Final Report Generator's own
// field ids (brRegion, brOffice, cppoName, ...) already match psir_org_settings
// 1:1, there's no separate settings table or endpoint for this router.
function buildFileReportsRouter(settingsStore, fileReportsDir) {
  const router = express.Router();
  router.use(authenticate(settingsStore));

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
        `SELECT r.id, r.probationer_id, r.filename, r.generated_at,
                ${probationerNameSql('p')} AS probationer_name, p.docket_number,
                ${userNameSql('u')} AS generated_by_name,
                ${lockSelectSql('r', 'lu')}
         FROM file_reports r
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
      const [rows] = await db.getPool().query('SELECT * FROM file_reports WHERE id = ?', [req.params.id]);
      const report = rows[0];
      if (!report || !fs.existsSync(report.file_path)) return res.status(404).json({ error: 'Not found' });
      res.json({ base64: fs.readFileSync(report.file_path).toString('base64'), filename: report.filename });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', requireRole('admin'), async (req, res, next) => {
    try {
      const [rows] = await db.getPool().query('SELECT * FROM file_reports WHERE id = ?', [req.params.id]);
      const report = rows[0];
      if (!report) return res.status(404).json({ error: 'Not found' });
      await db.getPool().query('DELETE FROM file_reports WHERE id = ?', [req.params.id]);
      if (fs.existsSync(report.file_path)) fs.unlinkSync(report.file_path);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Body: { probationerId, filename, base64, snapshot }. The .docx itself is
  // already fully built client-side (see
  // renderer/public/final-report-generator/app-logic.js's generateDocx) —
  // this just persists the bytes + a DB record, and rolls the snapshot's
  // identifying data forward onto the probationer so the next Final Report
  // for them opens prefilled (mirrors psir.js's psir_profile rollforward).
  router.post('/', async (req, res, next) => {
    try {
      const { probationerId, filename, base64, snapshot } = req.body || {};
      if (!probationerId || !filename || !base64) {
        return res.status(400).json({ error: 'probationerId, filename and base64 are required' });
      }
      const [probRows] = await db.getPool().query('SELECT id FROM probationers WHERE id = ?', [probationerId]);
      if (!probRows[0]) return res.status(404).json({ error: 'Probationer not found' });

      fs.mkdirSync(fileReportsDir, { recursive: true });
      const safeName = `${probationerId}-${Date.now()}-${filename}`.replace(/[^A-Za-z0-9._-]/g, '_');
      const filePath = path.join(fileReportsDir, safeName);
      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));

      const [result] = await db.getPool().query(
        `INSERT INTO file_reports (probationer_id, filename, file_path, snapshot, generated_by)
         VALUES (?, ?, ?, ?, ?)`,
        [probationerId, filename, filePath, snapshot ? JSON.stringify(snapshot) : null, req.user.id]
      );

      if (snapshot) {
        await db.getPool().query('UPDATE probationers SET file_report_profile = ? WHERE id = ?', [JSON.stringify(snapshot), probationerId]);
      }

      const [rows] = await db.getPool().query('SELECT * FROM file_reports WHERE id = ?', [result.insertId]);
      res.status(201).json(rows[0]);
    } catch (err) {
      next(err);
    }
  });

  // Edit-in-place check-out: POST/DELETE /:id/lock and PUT /:id/file.
  mountEditRoutes(router, 'file_reports');

  return router;
}

module.exports = buildFileReportsRouter;
