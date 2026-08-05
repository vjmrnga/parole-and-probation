const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
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

function pruneOldBackups(backupFolder, retentionCount) {
  const files = fs
    .readdirSync(backupFolder)
    .filter((f) => f.startsWith('parole_backup_') && f.endsWith('.sql'))
    .map((f) => ({ f, mtime: fs.statSync(path.join(backupFolder, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  files.slice(retentionCount).forEach(({ f }) => fs.unlinkSync(path.join(backupFolder, f)));
}

function runBackup(settingsStore) {
  return new Promise((resolve, reject) => {
    const backupFolder = settingsStore.get('backupFolder');
    if (!backupFolder) return reject(new Error('No backup folder configured in Settings'));
    fs.mkdirSync(backupFolder, { recursive: true });

    const mysqlConfig = settingsStore.get('mysqlConfig');
    const mysqldumpPath = findMysqldump(settingsStore);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outFile = path.join(backupFolder, `parole_backup_${timestamp}.sql`);

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
      fs.writeFileSync(outFile, stdout);
      pruneOldBackups(backupFolder, settingsStore.get('backupRetentionCount') || 14);
      resolve(outFile);
    });
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

module.exports = { start, stop, runBackup };
