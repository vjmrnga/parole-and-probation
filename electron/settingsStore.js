// Local, per-machine settings — never synced, never stored in MySQL.
// mode: 'head-office' | 'branch-office' | null (null = first launch, show Choose Mode)
const Store = require('electron-store');

const store = new Store({
  name: 'settings',
  defaults: {
    mode: null,
    serverPort: 4750,
    jwtSecret: null,

    // Head Office only
    mysqlConfig: { host: 'localhost', port: 3306, user: '', password: '', database: 'parole_probation' },
    backupFolder: '',
    backupSchedule: '0 2 * * *', // daily at 02:00
    backupRetentionCount: 14,
    mysqldumpPath: '',
    autoLaunchEnabled: false,

    // Branch Office only
    headOfficeUrl: '',
    pinnedCertFingerprint: '',
  },
});

function get(key) {
  return store.get(key);
}

function set(key, value) {
  store.set(key, value);
}

function getAll() {
  return store.store;
}

module.exports = { get, set, getAll, store };
