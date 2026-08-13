// Branch-Office offline support. When the Head Office server is unreachable,
// the Signature & Attendance screen keeps working against these three local,
// per-machine JSON files in Electron's userData dir; the outbox is replayed to
// Head Office once it's reachable again (see renderer/src/api/offlineAttendance.js).
//
//   offline-credentials.json  bcrypt hashes so officers can log in offline
//   offline-attendance-cache.json  last-known probationer list + per-case detail
//   offline-attendance-outbox.json  attendance captured offline, awaiting sync
//
// This is deliberately scoped to attendance only — everything else in the app
// genuinely needs Head Office and stays unavailable offline.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const ExcelJS = require('exceljs');

const CRED_FILE = 'offline-credentials.json';
const CACHE_FILE = 'offline-attendance-cache.json';
const OUTBOX_FILE = 'offline-attendance-outbox.json';

let baseDir = null;

function init(userDataPath) {
  baseDir = userDataPath;
}

function filePath(name) {
  if (!baseDir) throw new Error('offlineStore not initialized — call init(userDataPath) first');
  return path.join(baseDir, name);
}

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath(name), 'utf8'));
  } catch (err) {
    return fallback; // absent or corrupt — start fresh
  }
}

function writeJson(name, data) {
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2));
}

// ---- Cached credentials (offline login) ----
// Stores a bcrypt hash of the password that just succeeded online, keyed by
// username, so the same password can be verified locally while offline. Only
// ever written right after a successful online login, so a hash landing here
// always corresponds to a real, valid account.
async function cacheCredential({ user, password }) {
  if (!user || !user.username || !password) return { ok: false };
  const creds = readJson(CRED_FILE, {});
  creds[user.username.toLowerCase()] = {
    userId: user.id,
    username: user.username,
    fullName: user.full_name,
    role: user.role,
    passwordHash: await bcrypt.hash(password, 12),
    cachedAt: new Date().toISOString(),
  };
  writeJson(CRED_FILE, creds);
  return { ok: true };
}

async function verifyCredential({ username, password }) {
  const creds = readJson(CRED_FILE, {});
  const rec = creds[(username || '').toLowerCase()];
  if (!rec) return null;
  const ok = await bcrypt.compare(password || '', rec.passwordHash);
  if (!ok) return null;
  return { id: rec.userId, username: rec.username, full_name: rec.fullName, role: rec.role };
}

// ---- Read cache (probationer list + per-case detail for offline rendering) ----
function getCache() {
  return readJson(CACHE_FILE, { probationers: [], byId: {}, cachedAt: null });
}

function setProbationerList(probationers) {
  const cache = getCache();
  cache.probationers = probationers || [];
  cache.cachedAt = new Date().toISOString();
  writeJson(CACHE_FILE, cache);
  return { ok: true };
}

// detail may include { probationer, attendance, referenceSignature, referencePhoto }.
// Merged (not replaced) so a partial refresh doesn't wipe fields it didn't fetch.
function setProbationerDetail(id, detail) {
  const cache = getCache();
  cache.byId[id] = { ...(cache.byId[id] || {}), ...detail };
  writeJson(CACHE_FILE, cache);
  return { ok: true };
}

// ---- Outbox (attendance captured offline, awaiting sync) ----
function getOutbox() {
  return readJson(OUTBOX_FILE, { entries: [] });
}

// An entry's `kind` is 'attendance' (append-only, one per probationer per day)
// or 'referenceSignature' / 'referencePhoto' (overwrite — one on file per
// probationer). For the overwrite kinds we collapse any earlier un-synced
// capture of the same kind for the same probationer so we never push a stale
// version. Missing kind is treated as 'attendance' for back-compat.
function enqueue(entry) {
  const outbox = getOutbox();
  const kind = entry.kind || 'attendance';
  if (kind !== 'attendance') {
    outbox.entries = outbox.entries.filter(
      (e) => !((e.kind || 'attendance') === kind && e.probationerId === entry.probationerId)
    );
  }
  const record = {
    ...entry,
    kind,
    clientId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  outbox.entries.push(record);
  writeJson(OUTBOX_FILE, outbox);
  return record;
}

function removeEntry(clientId) {
  const outbox = getOutbox();
  outbox.entries = outbox.entries.filter((e) => e.clientId !== clientId);
  writeJson(OUTBOX_FILE, outbox);
  return { ok: true };
}

// ---- Excel export (human-readable backup of what's queued) ----
// Signatures aren't embedded — they ride along with the actual sync; this
// sheet is a paper-trail backup of the queued entries, not the sync channel.
async function buildOutboxWorkbook() {
  // Only attendance is a meaningful spreadsheet row; reference signature/photo
  // captures sync silently and have no date/notes to tabulate.
  const entries = getOutbox().entries.filter((e) => (e.kind || 'attendance') === 'attendance');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Pending Attendance');
  sheet.columns = [
    { header: 'Probationer', key: 'probationerName', width: 30 },
    { header: 'Log Date', key: 'logDate', width: 14 },
    { header: 'GAD Topic', key: 'gadTopic', width: 24 },
    { header: 'Notes', key: 'notes', width: 40 },
    { header: 'Recorded By', key: 'recordedByName', width: 24 },
    { header: 'Captured At', key: 'createdAt', width: 22 },
    { header: 'Status', key: 'status', width: 12 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const e of entries) {
    sheet.addRow({
      probationerName: e.probationerName || '',
      logDate: e.logDate || '',
      gadTopic: e.gadTopic || '',
      notes: e.notes || '',
      recordedByName: e.recordedByName || '',
      createdAt: e.createdAt || '',
      status: e.status || 'pending',
    });
  }
  return workbook;
}

module.exports = {
  init,
  cacheCredential,
  verifyCredential,
  getCache,
  setProbationerList,
  setProbationerDetail,
  getOutbox,
  enqueue,
  removeEntry,
  buildOutboxWorkbook,
};
