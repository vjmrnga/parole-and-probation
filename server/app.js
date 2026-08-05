const express = require('express');
const cors = require('cors');
const https = require('https');

const buildAuthRouter = require('./routes/auth');
const buildUsersRouter = require('./routes/users');
const buildProbationersRouter = require('./routes/probationers');
const { buildAttendanceRouter, buildAttendanceEntryRouter } = require('./routes/attendance');
const buildReportsRouter = require('./routes/reports');
const buildPsirRouter = require('./routes/psir');
const buildRecordsCheckRouter = require('./routes/recordsCheck');
const buildFileReportsRouter = require('./routes/fileReports');
const buildDocumentsRouter = require('./routes/documents');

// signaturesDir/photosDir/psirDir/recordsCheckDir/fileReportsDir/documentsDir:
// absolute paths where signature PNGs / reference photos / generated PSIR
// .docx / Records Check .pdf / Final Report .docx / checklist document
// scans are written on disk (see server/routes/probationers.js,
// server/routes/psir.js, server/routes/recordsCheck.js,
// server/routes/fileReports.js, server/routes/documents.js) — main.js
// resolves them via Electron's app.getPath('userData') since this module
// has no Electron dependency of its own.
function createApp(settingsStore, signaturesDir, photosDir, psirDir, recordsCheckDir, fileReportsDir, documentsDir) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '40mb' })); // signature PNGs, photos, generated PSIR/Final Report .docx, Records Check PDF batches, and scanned document attachments travel as base64 JSON

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', buildAuthRouter(settingsStore));
  app.use('/api/users', buildUsersRouter(settingsStore));
  app.use('/api/probationers', buildProbationersRouter(settingsStore, signaturesDir, photosDir));
  app.use('/api/probationers/:id/attendance', buildAttendanceRouter(settingsStore, signaturesDir));
  app.use('/api/probationers/:id/documents', buildDocumentsRouter(settingsStore, documentsDir));
  app.use('/api/attendance', buildAttendanceEntryRouter(settingsStore, signaturesDir));
  app.use('/api/reports', buildReportsRouter(settingsStore));
  app.use('/api/psir', buildPsirRouter(settingsStore, psirDir));
  app.use('/api/records-check', buildRecordsCheckRouter(settingsStore, recordsCheckDir));
  app.use('/api/file-reports', buildFileReportsRouter(settingsStore, fileReportsDir));

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

function startHttpsServer(app, { key, cert }, port) {
  const server = https.createServer({ key, cert }, app);
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}

module.exports = { createApp, startHttpsServer };
