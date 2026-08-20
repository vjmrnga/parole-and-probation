const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const cron = require('node-cron');

let scheduledTask = null;

function findMysqldump(settingsStore) {
  const override = settingsStore.get('mysqldumpPath');
  if (override && fs.existsSync(override)) return override;

  const guesses = [
    'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe',
    'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysqldump.exe',
    'C:\\xampp\\mysql\\bin\\mysqldump.exe',
  ];
  return guesses.find((p) => fs.existsSync(p)) || 'mysqldump'; // fall back to PATH
}

function findMysqlClient(settingsStore) {
  const override = settingsStore.get('mysqlPath');
  if (override && fs.existsSync(override)) return override;

  const guesses = [
    'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe',
    'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysql.exe',
    'C:\\xampp\\mysql\\bin\\mysql.exe',
  ];
  return guesses.find((p) => fs.existsSync(p)) || 'mysql'; // fall back to PATH
}

function pruneOldBackups(backupFolder, retentionCount) {
  const files = fs
    .readdirSync(backupFolder)
    .filter((f) => f.startsWith('parole_backup_') && f.endsWith('.sql'))
    .map((f) => ({ f, mtime: fs.statSync(path.join(backupFolder, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  files.slice(retentionCount).forEach(({ f }) => fs.unlinkSync(path.join(backupFolder, f)));
}

// Dumps the configured database to `outFile` via mysqldump. Shared by the
// scheduled backup below and the manual "Export Database" action in Settings.
function dumpToFile(settingsStore, outFile) {
  return new Promise((resolve, reject) => {
    const mysqlConfig = settingsStore.get('mysqlConfig');
    if (!mysqlConfig || !mysqlConfig.database) return reject(new Error('MySQL is not configured yet — finish Head Office setup first'));
    const mysqldumpPath = findMysqldump(settingsStore);

    const args = [
      `--host=${mysqlConfig.host}`,
      `--port=${mysqlConfig.port}`,
      `--user=${mysqlConfig.user}`,
      `--password=${mysqlConfig.password}`,
      '--single-transaction',
      '--routines',
      mysqlConfig.database,
    ];

    execFile(mysqldumpPath, args, { maxBuffer: 1024 * 1024 * 200 }, (err, stdout) => {
      if (err) return reject(err);
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, stdout);
      resolve(outFile);
    });
  });
}

// Restores `inFile` (a .sql dump, e.g. one produced by dumpToFile/runBackup)
// into the configured database via the mysql client. This runs the file's
// statements against the live database — it does not first drop existing
// tables unless the dump itself contains DROP/CREATE statements, so imported
// data is layered on top of whatever is already there. The caller (renderer)
// is responsible for warning the user before invoking this.
function restoreFromFile(settingsStore, inFile) {
  return new Promise((resolve, reject) => {
    const mysqlConfig = settingsStore.get('mysqlConfig');
    if (!mysqlConfig || !mysqlConfig.database) return reject(new Error('MySQL is not configured yet — finish Head Office setup first'));
    if (!fs.existsSync(inFile)) return reject(new Error(`File not found: ${inFile}`));
    const mysqlPath = findMysqlClient(settingsStore);

    const args = [
      `--host=${mysqlConfig.host}`,
      `--port=${mysqlConfig.port}`,
      `--user=${mysqlConfig.user}`,
      `--password=${mysqlConfig.password}`,
      mysqlConfig.database,
    ];

    const child = spawn(mysqlPath, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject); // e.g. mysql client not found on PATH
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `mysql exited with code ${code}`));
    });

    const readStream = fs.createReadStream(inFile);
    readStream.on('error', (err) => child.stdin.destroy(err));
    readStream.pipe(child.stdin);
  });
}

function runBackup(settingsStore) {
  const backupFolder = settingsStore.get('backupFolder');
  if (!backupFolder) return Promise.reject(new Error('No backup folder configured in Settings'));
  fs.mkdirSync(backupFolder, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(backupFolder, `parole_backup_${timestamp}.sql`);

  return dumpToFile(settingsStore, outFile).then((filePath) => {
    pruneOldBackups(backupFolder, settingsStore.get('backupRetentionCount') || 14);
    return filePath;
  });
}

function start(settingsStore) {
  stop();
  const schedule = settingsStore.get('backupSchedule') || '0 2 * * *';
  scheduledTask = cron.schedule(schedule, () => {
    runBackup(settingsStore).catch((err) => console.error('Scheduled backup failed:', err));
  });
}

function stop() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
}

module.exports = { start, stop, runBackup, dumpToFile, restoreFromFile };
