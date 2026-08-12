const fs = require('fs');
const db = require('../db');
const { acquireLock, releaseLock, requireLock } = require('./lockHelpers');

// Mounts the three edit-in-place endpoints shared by every report router whose
// rows are keyed by a numeric id and carry a file_path column
// (psir_reports, file_reports, records_check_files):
//
//   POST   /:id/lock   — check the file out for editing (see lockHelpers.js)
//   DELETE /:id/lock   — check it back in (admin can force-release another's)
//   PUT    /:id/file   — overwrite the stored bytes; holder-only
//
// The bytes are overwritten in place at the existing file_path, so open/
// download and every other consumer keep pointing at the same file — the row
// never changes, only its contents. Called from each report router after its
// own create/download/delete routes are defined. `table` is the SQL table name
// and must be a trusted constant (never user input) since it's interpolated
// into the query.
function mountEditRoutes(router, table) {
  router.post('/:id/lock', async (req, res, next) => {
    try {
      const result = await acquireLock(db.getPool(), table, 't.id = ?', [req.params.id], req.user.id);
      if (!result.ok) return res.status(result.status).json(result);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id/lock', async (req, res, next) => {
    try {
      const result = await releaseLock(
        db.getPool(), table, 't.id = ?', [req.params.id], req.user.id, req.user.role === 'admin'
      );
      if (!result.ok) return res.status(result.status).json(result);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id/file', async (req, res, next) => {
    try {
      const { base64 } = req.body || {};
      if (!base64) return res.status(400).json({ error: 'base64 is required' });

      const gate = await requireLock(db.getPool(), table, 't.id = ?', [req.params.id], req.user.id);
      if (!gate.ok) return res.status(gate.status).json(gate);

      const [rows] = await db.getPool().query(`SELECT file_path FROM ${table} WHERE id = ?`, [req.params.id]);
      const row = rows[0];
      if (!row || !row.file_path) return res.status(404).json({ error: 'Not found' });

      fs.writeFileSync(row.file_path, Buffer.from(base64, 'base64'));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { mountEditRoutes };
