const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { probationerNameSql, userNameSql } = require('../../shared/nameUtils');
const { lockSelectSql } = require('./lockHelpers');
const { mountEditRoutes } = require('./editableDoc');

function safeSeg(s) {
  return String(s).replace(/[\\/:*?"<>|]+/g, '-').trim();
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
        `SELECT r.id, r.probationer_id, r.recipient, r.date_folder, r.filename, r.generated_at,
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

  router.delete('/:id', requireRole('admin'), async (req, res, next) => {
    try {
      const [rows] = await db.getPool().query('SELECT * FROM records_check_files WHERE id = ?', [req.params.id]);
      const file = rows[0];
      if (!file) return res.status(404).json({ error: 'Not found' });
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

  // Edit-in-place check-out: POST/DELETE /:id/lock and PUT /:id/file.
  mountEditRoutes(router, 'records_check_files');

  return router;
}

module.exports = buildRecordsCheckRouter;
