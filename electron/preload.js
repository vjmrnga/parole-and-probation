const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Settings
  getEnums: () => ipcRenderer.invoke('get-enums'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', { key, value }),
  setMode: (mode) => ipcRenderer.invoke('set-mode', mode),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  getLanAddresses: () => ipcRenderer.invoke('get-lan-addresses'),
  getDeviceName: () => ipcRenderer.invoke('get-device-name'),

  // Head Office setup
  mysqlTestConnection: (config) => ipcRenderer.invoke('mysql-test-connection', config),
  mysqlRunSetup: (config) => ipcRenderer.invoke('mysql-run-setup', config),
  getCertFingerprint: () => ipcRenderer.invoke('get-cert-fingerprint'),
  runBackupNow: () => ipcRenderer.invoke('run-backup-now'),

  // Branch Office pairing
  fetchRemoteFingerprint: (headOfficeUrl) => ipcRenderer.invoke('fetch-remote-fingerprint', headOfficeUrl),
  confirmPinCert: (headOfficeUrl, fingerprint) => ipcRenderer.invoke('confirm-pin-cert', { headOfficeUrl, fingerprint }),

  // API calls (always proxied through main — see electron/apiProxy.js)
  apiRequest: (method, path, body, token) => ipcRenderer.invoke('api-request', { method, path, body, token }),

  // Real-time server push (Server-Sent Events, proxied through main — see
  // electron/eventStream.js). subscribe after login with the auth token;
  // onServerEvent registers a listener and returns an unsubscribe function.
  subscribeServerEvents: (token) => ipcRenderer.invoke('events-subscribe', { token }),
  unsubscribeServerEvents: () => ipcRenderer.invoke('events-unsubscribe'),
  onServerEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('server-event', listener);
    return () => ipcRenderer.removeListener('server-event', listener);
  },

  // Reports
  exportReport: (rows) => ipcRenderer.invoke('export-report', rows),
  attendanceOverviewExportExcel: (payload) => ipcRenderer.invoke('attendance-overview-export-excel', payload),

  // PSIR
  psirSaveFile: (base64, defaultName) => ipcRenderer.invoke('psir-save-file', { base64, defaultName }),
  psirOpenFile: (base64, filename) => ipcRenderer.invoke('psir-open-file', { base64, filename }),

  // Records Check
  recordsCheckSaveFile: (base64, defaultName) => ipcRenderer.invoke('records-check-save-file', { base64, defaultName }),
  recordsCheckOpenFile: (base64, filename) => ipcRenderer.invoke('records-check-open-file', { base64, filename }),

  // Final Report
  fileReportSaveFile: (base64, defaultName) => ipcRenderer.invoke('file-report-save-file', { base64, defaultName }),
  fileReportOpenFile: (base64, filename) => ipcRenderer.invoke('file-report-open-file', { base64, filename }),

  // Bulk case import
  importCasesPickFile: () => ipcRenderer.invoke('import-cases-pick-file'),
  importCasesDownloadTemplate: () => ipcRenderer.invoke('import-cases-download-template'),
  importActiveSupervisionPickFile: () => ipcRenderer.invoke('import-active-supervision-pick-file'),

  // Signature pad
  getPadStatus: () => ipcRenderer.invoke('pad-status'),
  captureFromPad: (payload) => ipcRenderer.invoke('pad-capture', payload),
  onPadStatusChanged: (callback) => {
    ipcRenderer.on('pad-status-changed', (_event, status) => callback(status));
  },

  // Document scanner
  getScannerStatus: () => ipcRenderer.invoke('scanner-status'),
  scanDocument: () => ipcRenderer.invoke('scanner-scan'),
  onScannerStatusChanged: (callback) => {
    ipcRenderer.on('scanner-status-changed', (_event, status) => callback(status));
  },

  // Document checklist attachments
  documentOpenFile: (base64, filename) => ipcRenderer.invoke('document-open-file', { base64, filename }),

  // Edit-in-place (watch & upload) — shared by PSIR / Final Report / Records
  // Check / checklist attachments. `key` is a stable per-document id the
  // renderer uses to correlate change events back to the right document.
  docEditOpen: (key, base64, filename) => ipcRenderer.invoke('doc-edit-open', { key, base64, filename }),
  docEditStop: (key) => ipcRenderer.invoke('doc-edit-stop', { key }),
  onDocEditChanged: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('doc-edit-changed', listener);
    // Return an unsubscribe so a React effect can clean up on unmount.
    return () => ipcRenderer.removeListener('doc-edit-changed', listener);
  },
  // Fires once when an edited document's editor is closed, so the renderer can
  // auto-release the lock (see renderer/src/hooks/useDocEditor.js).
  onDocEditClosed: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('doc-edit-closed', listener);
    return () => ipcRenderer.removeListener('doc-edit-closed', listener);
  },
});
