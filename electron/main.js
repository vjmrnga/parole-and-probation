const { app, BrowserWindow, ipcMain, dialog, session, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const settingsStore = require('./settingsStore');
const tray = require('./tray');
const { apiRequest } = require('./apiProxy');
const { fetchRemoteFingerprint, parseHostPort } = require('./certPinning');
const certGen = require('../server/tls/certGen');
const db = require('../server/db');
const { runMigration } = require('../server/migrations/schema');
const { createApp, startHttpsServer } = require('../server/app');
const backupScheduler = require('../server/backup/scheduler');
const { buildProbationersWorkbook } = require('../shared/reportBuilder');
const statusEnums = require('../shared/statusEnums');
const { parseProbationerImport, buildImportTemplate } = require('./importParser');
const { parseActiveSupervisionImport } = require('./activeSupervisionImportParser');

// wacom/ + bridge/ are copied in separately (see plan). Commented out until
// that's done — uncomment once wacom/wacomPad.js exists; everything below
// that touches wacomPad is already guarded with `if (wacomPad)` so it's
// safe to leave this as `null` in the meantime.
let wacomPad = null;
// try {
//   wacomPad = require('../wacom/wacomPad');
// } catch (err) {
//   console.warn('wacom/wacomPad.js not found yet — signature pad support disabled:', err.message);
// }

const isHiddenLaunch = process.argv.includes('--hidden');
// Set by `npm run dev` (see package.json) to point at Vite's dev server for
// hot reload; unset for a plain `npm start`/packaged build, which loads the
// built renderer/dist/index.html instead.
const devServerUrl = process.env.ELECTRON_START_URL;

let mainWindow = null;
let httpsServer = null;

function signaturesDir() {
  return path.join(app.getPath('userData'), 'signatures');
}

function psirDir() {
  return path.join(app.getPath('userData'), 'psir-reports');
}

function recordsCheckDir() {
  return path.join(app.getPath('userData'), 'records-check-pdfs');
}

function fileReportsDir() {
  return path.join(app.getPath('userData'), 'file-reports');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: !isHiddenLaunch,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'dist', 'index.html'));
  }

  mainWindow.on('close', (event) => {
    if (settingsStore.get('mode') === 'head-office' && !app.isQuittingForReal) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

async function startHeadOfficeServer() {
  const mysqlConfig = settingsStore.get('mysqlConfig');
  if (!mysqlConfig || !mysqlConfig.user) return; // setup wizard hasn't run yet

  stopHeadOfficeServer(); // close any previously-running listener before rebinding (e.g. Settings re-save)
  db.init(mysqlConfig);
  await runMigration(db.getPool()); // idempotent — picks up schema changes (e.g. new columns) on every launch, not just initial setup
  const { key, cert } = certGen.ensureCert(app.getPath('userData'));
  const expressApp = createApp(settingsStore, signaturesDir(), psirDir(), recordsCheckDir(), fileReportsDir());
  httpsServer = await startHttpsServer(expressApp, { key, cert }, settingsStore.get('serverPort'));

  if (settingsStore.get('backupFolder')) {
    backupScheduler.start(settingsStore);
  }
}

function stopHeadOfficeServer() {
  backupScheduler.stop();
  if (httpsServer) {
    httpsServer.close();
    httpsServer = null;
  }
}

async function initForCurrentMode() {
  const mode = settingsStore.get('mode');
  if (mode === 'head-office') {
    try {
      await startHeadOfficeServer();
    } catch (err) {
      console.error('Failed to start Head Office server:', err);
    }
    tray.create(mainWindow, {
      onQuit: () => {
        app.isQuittingForReal = true;
        app.quit();
      },
    });
    applyAutoLaunchSetting();
  } else {
    tray.destroy();
    stopHeadOfficeServer();
  }
}

function applyAutoLaunchSetting() {
  if (process.platform !== 'win32') return;
  const enabled = settingsStore.get('autoLaunchEnabled');
  app.setLoginItemSettings({ openAtLogin: enabled, args: enabled ? ['--hidden'] : [] });
}

function lanAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const ifaceList of Object.values(nets)) {
    for (const iface of ifaceList || []) {
      if (iface.family === 'IPv4' && !iface.internal) addresses.push(iface.address);
    }
  }
  return addresses;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // CSP is enforced via response headers rather than a <meta> tag in the
    // HTML — Vite's dev server injects its own module/HMR scripts that a
    // static CSP would fight, so this only applies to the production
    // file:// load. Dev mode relies on Vite's own dev-server protections.
    if (!devServerUrl) {
      session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            // frame-src/object-src allow blob: — the Records Check generator
            // (renderer/public/records-check-generator) previews and prints
            // its jsPDF output via blob: URLs loaded into iframes.
            'Content-Security-Policy': [
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self' blob:; object-src 'self' blob:;",
            ],
          },
        });
      });
    }

    createWindow();
    await initForCurrentMode();

    if (wacomPad) wacomPad.init(mainWindow);

    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === 'media');
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (wacomPad) wacomPad.shutdown();
    if (process.platform !== 'darwin' && settingsStore.get('mode') !== 'head-office') app.quit();
  });

  app.on('before-quit', () => {
    app.isQuittingForReal = true;
    stopHeadOfficeServer();
  });

  // ---- IPC: settings ----
  ipcMain.handle('get-enums', () => statusEnums);
  ipcMain.handle('get-settings', () => settingsStore.getAll());
  ipcMain.handle('set-setting', (_e, { key, value }) => {
    settingsStore.set(key, value);
    return settingsStore.getAll();
  });

  // Mode changes require the server to start/stop and auto-launch to be
  // re-registered, so route it through a dedicated handler rather than the
  // generic setter above.
  ipcMain.handle('set-mode', async (_e, mode) => {
    settingsStore.set('mode', mode);
    await initForCurrentMode();
    return settingsStore.getAll();
  });

  ipcMain.handle('choose-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // ---- IPC: Head Office setup wizard ----
  ipcMain.handle('mysql-test-connection', async (_e, mysqlConfig) => {
    try {
      await db.testConnection(mysqlConfig);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('mysql-run-setup', async (_e, mysqlConfig) => {
    try {
      settingsStore.set('mysqlConfig', mysqlConfig);
      db.init(mysqlConfig);
      await runMigration(db.getPool());
      await initForCurrentMode(); // (re)start the HTTPS server now that the DB is ready
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('get-cert-fingerprint', () => {
    try {
      return certGen.getFingerprint(app.getPath('userData'));
    } catch (err) {
      return null;
    }
  });

  ipcMain.handle('get-lan-addresses', () => lanAddresses());

  // ---- IPC: Branch Office pairing (trust-on-first-use) ----
  ipcMain.handle('fetch-remote-fingerprint', async (_e, headOfficeUrl) => {
    try {
      const { hostname, port } = parseHostPort(headOfficeUrl);
      const fingerprint = await fetchRemoteFingerprint(hostname, port);
      return { ok: true, fingerprint };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('confirm-pin-cert', (_e, { headOfficeUrl, fingerprint }) => {
    settingsStore.set('headOfficeUrl', headOfficeUrl);
    settingsStore.set('pinnedCertFingerprint', fingerprint);
    return { ok: true };
  });

  // ---- IPC: proxied API calls (see electron/apiProxy.js for why) ----
  ipcMain.handle('api-request', async (_e, { method, path: reqPath, body, token }) => {
    try {
      return await apiRequest({
        method,
        path: reqPath,
        body,
        token,
        settingsStore,
        userDataPath: app.getPath('userData'),
      });
    } catch (err) {
      return { status: 0, body: { error: err.message } };
    }
  });

  // ---- IPC: reports ----
  ipcMain.handle('export-report', async (_e, rows) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save probationer report',
      defaultPath: `Probationer Report ${new Date().toISOString().slice(0, 10)}.xlsx`,
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };
    const workbook = await buildProbationersWorkbook(rows);
    await workbook.xlsx.writeFile(result.filePath);
    return { ok: true, filePath: result.filePath };
  });

  // ---- IPC: PSIR ----
  ipcMain.handle('psir-save-file', async (_e, { base64, defaultName }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save PSIR',
      defaultPath: defaultName,
      filters: [{ name: 'Word Document', extensions: ['docx'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };
    fs.writeFileSync(result.filePath, Buffer.from(base64, 'base64'));
    return { ok: true, filePath: result.filePath };
  });

  ipcMain.handle('psir-open-file', async (_e, { base64, filename }) => {
    const tmpDir = path.join(app.getPath('temp'), 'psir-preview');
    fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, filename);
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    const err = await shell.openPath(filePath);
    return err ? { ok: false, error: err } : { ok: true };
  });

  // ---- IPC: Records Check ----
  // Generated PDFs are saved via POST /api/records-check/batch (see
  // server/routes/recordsCheck.js) so every machine — Head or Branch — sees
  // the same shared list and can pull any file's bytes down; these two
  // handlers just mirror psir-open-file/-save-file for viewing/exporting
  // those bytes once fetched.
  ipcMain.handle('records-check-open-file', async (_e, { base64, filename }) => {
    const tmpDir = path.join(app.getPath('temp'), 'records-check-preview');
    fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, filename);
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    const err = await shell.openPath(filePath);
    return err ? { ok: false, error: err } : { ok: true };
  });

  ipcMain.handle('records-check-save-file', async (_e, { base64, defaultName }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Records Check PDF',
      defaultPath: defaultName,
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };
    fs.writeFileSync(result.filePath, Buffer.from(base64, 'base64'));
    return { ok: true, filePath: result.filePath };
  });

  // ---- IPC: Final Report ----
  ipcMain.handle('file-report-save-file', async (_e, { base64, defaultName }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save Final Report',
      defaultPath: defaultName,
      filters: [{ name: 'Word Document', extensions: ['docx'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };
    fs.writeFileSync(result.filePath, Buffer.from(base64, 'base64'));
    return { ok: true, filePath: result.filePath };
  });

  ipcMain.handle('file-report-open-file', async (_e, { base64, filename }) => {
    const tmpDir = path.join(app.getPath('temp'), 'file-report-preview');
    fs.mkdirSync(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, filename);
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    const err = await shell.openPath(filePath);
    return err ? { ok: false, error: err } : { ok: true };
  });

  // ---- IPC: bulk case import ----
  ipcMain.handle('import-cases-pick-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose Excel file to import',
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false };
    try {
      const rows = await parseProbationerImport(result.filePaths[0]);
      return { ok: true, filePath: result.filePaths[0], rows };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('import-active-supervision-pick-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose Active Supervision Excel file to import',
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false };
    try {
      const rows = await parseActiveSupervisionImport(result.filePaths[0]);
      return { ok: true, filePath: result.filePaths[0], rows };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('import-cases-download-template', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save import template',
      defaultPath: 'Probationer Import Template.xlsx',
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };
    await buildImportTemplate(result.filePath);
    return { ok: true, filePath: result.filePath };
  });

  ipcMain.handle('run-backup-now', async () => {
    try {
      const filePath = await backupScheduler.runBackup(settingsStore);
      return { ok: true, filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ---- IPC: signature pad ----
  ipcMain.handle('pad-status', () => (wacomPad ? wacomPad.getStatus() : { connected: false, model: null, mode: 'unavailable' }));
  ipcMain.handle('pad-capture', async (_e, payload) => {
    if (!wacomPad) return { ok: false, error: 'Signature pad module not installed' };
    try {
      const pngBase64 = await wacomPad.captureFromPad(payload);
      return { ok: true, pngBase64 };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}
