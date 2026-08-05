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

// signaturesDir/psirDir/recordsCheckDir/fileReportsDir: absolute paths where
// signature PNGs / generated PSIR .docx / Records Check .pdf / Final Report
// .docx files are written on disk (see server/routes/probationers.js,
// server/routes/psir.js, server/routes/recordsCheck.js,
// server/routes/fileReports.js) — main.js resolves them via Electron's
// app.getPath('userData') since this module has no Electron dependency of
// its own.
function createApp(settingsStore, signaturesDir, psirDir, recordsCheckDir, fileReportsDir) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '40mb' })); // signature PNGs, generated PSIR/Final Report .docx and Records Check PDF batches travel as base64 JSON

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', buildAuthRouter(settingsStore));
  app.use('/api/users', buildUsersRouter(settingsStore));
  app.use('/api/probationers', buildProbationersRouter(settingsStore, signaturesDir));
  app.use('/api/probationers/:id/attendance', buildAttendanceRouter(settingsStore));
  app.use('/api/attendance', buildAttendanceEntryRouter(settingsStore));
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
