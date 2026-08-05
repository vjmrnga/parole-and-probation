const express = require('express');
const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { DOCUMENT_CHECKLIST_ITEMS, DOCUMENT_CHECKLIST_KEYS } = require('../../shared/documentChecklist');

async function loadProbationer(id) {
  const [rows] = await db.getPool().query('SELECT * FROM probationers WHERE id = ?', [id]);
  return rows[0] || null;
}

function isAssignedOrAdmin(req, probationer) {
  return req.user.role === 'admin' || req.user.id === probationer.assigned_officer_id;
}

// Mounted at /api/probationers/:id/documents (mergeParams) — see server/app.js.
// documentsDir is its own directory (sibling to signaturesDir/photosDir),
// passed in from electron/main.js the same way those are.
function buildDocumentsRouter(settingsStore, documentsDir) {
  const router = express.Router({ mergeParams: true });
  router.use(authenticate(settingsStore));

  // Returns one row per DOCUMENT_CHECKLIST_ITEMS entry, in that fixed order,
  // merged with whatever's actually been recorded in document_checklist —
  // a document nobody has touched yet just comes back as submitted: false,
  // hasFile: false rather than needing a row to already exist.
  router.get('/', async (req, res, next) => {
    try {
      const probationer = await loadProbationer(req.params.id);
      if (!probationer) return res.status(404).json({ error: 'Not found' });

      const [rows] = await db.getPool().query(
        'SELECT * FROM document_checklist WHERE probationer_id = ?',
        [req.params.id]
      );
      const byKey = new Map(rows.map((r) => [r.doc_key, r]));

      const result = DOCUMENT_CHECKLIST_ITEMS.map((item) => {
        const row = byKey.get(item.key);
        return {
          key: item.key,
          label: item.label,
          detainedRequired: item.detainedRequired,
          submitted: !!(row && row.submitted),
          submittedAt: row ? row.submitted_at : null,
          hasFile: !!(row && row.file_path),
          originalFilename: row ? row.original_filename : null,
          mimeType: row ? row.mime_type : null,
        };
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // Upserts the submitted flag/date for one checklist item. A row is created
  // on first touch (see the INSERT ... ON DUPLICATE KEY UPDATE below) since
  // nothing needs to exist beforehand for a probationer to start checking
  // items off.
  router.patch('/:docKey', async (req, res, next) => {
    try {
      if (!DOCUMENT_CHECKLIST_KEYS.includes(req.params.docKey)) {
        return res.status(400).json({ error: 'Unknown document key' });
      }
      const probationer = await loadProbationer(req.params.id);
      if (!probationer) return res.status(404).json({ error: 'Not found' });
      if (!isAssignedOrAdmin(req, probationer)) return res.status(403).json({ error: 'Not assigned to you' });

      const { submitted } = req.body || {};
      if (submitted === undefined) return res.status(400).json({ error: 'submitted is required' });
      const submittedAt = submitted ? dayjs().format('YYYY-MM-DD') : null;

      await db.getPool().query(
        `INSERT INTO document_checklist (probationer_id, doc_key, submitted, submitted_at, updated_by)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE submitted = VALUES(submitted), submitted_at = VALUES(submitted_at), updated_by = VALUES(updated_by)`,
        [req.params.id, req.params.docKey, submitted ? 1 : 0, submittedAt, req.user.id]
      );
      res.json({ ok: true, submitted: !!submitted, submittedAt });
    } catch (err) {
      next(err);
    }
  });

  // Attaches a scanned/photographed/uploaded copy of the document. Accepts
  // images (from the camera-capture or native-scanner paths, see
  // renderer/src/components/DocumentChecklist.jsx) or a PDF (a plain file
  // upload of something already scanned elsewhere). Marks the item submitted
  // if it wasn't already — attaching proof of a document is itself evidence
  // it was submitted, though the officer can still uncheck it later without
  // losing the file.
  router.post('/:docKey/file', async (req, res, next) => {
    try {
      if (!DOCUMENT_CHECKLIST_KEYS.includes(req.params.docKey)) {
        return res.status(400).json({ error: 'Unknown document key' });
      }
      const probationer = await loadProbationer(req.params.id);
      if (!probationer) return res.status(404).json({ error: 'Not found' });
      if (!isAssignedOrAdmin(req, probationer)) return res.status(403).json({ error: 'Not assigned to you' });

      const { dataUrl, filename } = req.body || {};
      if (!dataUrl) return res.status(400).json({ error: 'dataUrl is required' });

      const match = /^data:(image\/(?:png|jpe?g|webp)|application\/pdf);base64,(.+)$/.exec(dataUrl);
      if (!match) return res.status(400).json({ error: 'dataUrl must be a base64 PNG/JPEG/WEBP image or PDF' });
      const mimeType = match[1];
      const ext = mimeType === 'application/pdf' ? 'pdf' : mimeType.replace('image/', '').replace('jpeg', 'jpg');

      const [existingRows] = await db.getPool().query(
        'SELECT * FROM document_checklist WHERE probationer_id = ? AND doc_key = ?',
        [req.params.id, req.params.docKey]
      );
      const existing = existingRows[0];

      fs.mkdirSync(documentsDir, { recursive: true });
      const filePath = path.join(documentsDir, `${probationer.id}-${req.params.docKey}.${ext}`);

      // Extension can change between attachments (e.g. a PDF replaced by a
      // photo) — remove any stale file under the old name so it doesn't
      // linger on disk, same as the reference-photo endpoint does.
      if (existing && existing.file_path && existing.file_path !== filePath && fs.existsSync(existing.file_path)) {
        fs.unlinkSync(existing.file_path);
      }

      fs.writeFileSync(filePath, Buffer.from(match[2], 'base64'));

      const submitted = existing ? !!existing.submitted : true;
      const submittedAt = existing && existing.submitted ? existing.submitted_at : dayjs().format('YYYY-MM-DD');

      await db.getPool().query(
        `INSERT INTO document_checklist
           (probationer_id, doc_key, submitted, submitted_at, file_path, original_filename, mime_type, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           submitted = VALUES(submitted), submitted_at = VALUES(submitted_at), file_path = VALUES(file_path),
           original_filename = VALUES(original_filename), mime_type = VALUES(mime_type), updated_by = VALUES(updated_by)`,
        [req.params.id, req.params.docKey, submitted ? 1 : 0, submittedAt, filePath, filename || null, mimeType, req.user.id]
      );
      res.json({ ok: true, submitted, submittedAt });
    } catch (err) {
      next(err);
    }
  });

  // Same base64-JSON shape as the signature/photo GET endpoints in
  // server/routes/probationers.js — every API response here goes through the
  // IPC-proxied JSON pipeline (electron/apiProxy.js), which only parses JSON
  // bodies, not raw file streams.
  router.get('/:docKey/file', async (req, res, next) => {
    try {
      const [rows] = await db.getPool().query(
        'SELECT * FROM document_checklist WHERE probationer_id = ? AND doc_key = ?',
        [req.params.id, req.params.docKey]
      );
      const row = rows[0];
      if (!row || !row.file_path || !fs.existsSync(row.file_path)) {
        return res.status(404).json({ error: 'No file on file for this document' });
      }
      const base64 = fs.readFileSync(row.file_path).toString('base64');
      res.json({ dataUrl: `data:${row.mime_type};base64,${base64}`, filename: row.original_filename });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:docKey/file', async (req, res, next) => {
    try {
      const probationer = await loadProbationer(req.params.id);
      if (!probationer) return res.status(404).json({ error: 'Not found' });
      if (!isAssignedOrAdmin(req, probationer)) return res.status(403).json({ error: 'Not assigned to you' });

      const [rows] = await db.getPool().query(
        'SELECT * FROM document_checklist WHERE probationer_id = ? AND doc_key = ?',
        [req.params.id, req.params.docKey]
      );
      const row = rows[0];
      if (row && row.file_path && fs.existsSync(row.file_path)) fs.unlinkSync(row.file_path);

      await db.getPool().query(
        'UPDATE document_checklist SET file_path = NULL, original_filename = NULL, mime_type = NULL WHERE probationer_id = ? AND doc_key = ?',
        [req.params.id, req.params.docKey]
      );
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = buildDocumentsRouter;
