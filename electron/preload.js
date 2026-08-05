const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Settings
  getEnums: () => ipcRenderer.invoke('get-enums'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', { key, value }),
  setMode: (mode) => ipcRenderer.invoke('set-mode', mode),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  getLanAddresses: () => ipcRenderer.invoke('get-lan-addresses'),

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

  // Reports
  exportReport: (rows) => ipcRenderer.invoke('export-report', rows),

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
});
