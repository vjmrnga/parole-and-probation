// Watch-and-upload engine behind the "edit in place" feature. The renderer
// (see renderer/src/hooks/useDocEditor.js) checks a document out via the API,
// then hands its bytes here to be opened in the OS's default editor (Word for
// .docx, whatever handles PDFs/images). While the file is open we watch it on
// disk; every time the user saves, we read the new bytes back and hand them to
// the renderer, which PUTs them to the server so every office sees the change.
//
// Why watch the containing directory rather than the file itself: Word (and
// most editors) don't write in place — they save to a temp sibling, delete the
// original, and rename the temp over it. A watch bound to the original file's
// inode goes deaf after that first save. Watching the directory and filtering
// by filename survives the delete/rename dance.
const { shell } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// Editors fire a burst of filesystem events per save (temp write, delete,
// rename, metadata touch). Coalesce them so one save = at most one upload.
const DEBOUNCE_MS = 900;
// Right after a save the file can be momentarily locked/half-written; retry a
// few times before giving up on that particular change event.
const READ_RETRIES = 5;
const READ_RETRY_MS = 250;

// key -> { dir, filePath, filename, watcher, timer, lastHash, onChange, closed }
const sessions = new Map();

function sha1(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

// Filesystem-safe subdir name for an arbitrary session key (e.g. "psir:42" or
// "doc:7:court_order"). Keeps each open document isolated so a stale file from
// one never collides with another.
function keyToDir(key) {
  const safe = String(key).replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(os.tmpdir(), 'pp-doc-edit', safe);
}

function tryRead(filePath, attempt = 0) {
  try {
    return fs.readFileSync(filePath);
  } catch (err) {
    if (attempt < READ_RETRIES) {
      return new Promise((resolve) => {
        setTimeout(() => resolve(tryRead(filePath, attempt + 1)), READ_RETRY_MS);
      });
    }
    return null;
  }
}

async function handleChange(key) {
  const session = sessions.get(key);
  if (!session || session.closed) return;
  if (!fs.existsSync(session.filePath)) return; // mid-rename; the next event will catch the settled file

  const buf = await tryRead(session.filePath);
  if (!buf || buf.length === 0) return;

  const hash = sha1(buf);
  if (hash === session.lastHash) return; // fs.watch fires on metadata-only touches too
  session.lastHash = hash;
  session.onChange(buf.toString('base64'));
}

// Opens `filename` (bytes given as base64) for editing under a private temp
// dir keyed by `key`, and starts watching for saves. onChange(base64) fires
// once per distinct save. Returns { ok, filePath } or { ok:false, error }.
async function startEdit({ key, base64, filename }, onChange) {
  // Drop any previous session for this key before starting a fresh one.
  await stopEdit(key);

  const dir = keyToDir(key);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    // best-effort cleanup of a leftover dir
  }
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, filename);
  const initial = Buffer.from(base64, 'base64');
  fs.writeFileSync(filePath, initial);

  const session = {
    dir,
    filePath,
    filename,
    watcher: null,
    timer: null,
    lastHash: sha1(initial),
    onChange,
    closed: false,
  };
  sessions.set(key, session);

  try {
    session.watcher = fs.watch(dir, (_eventType, changed) => {
      // Only react to our target file (some platforms report the temp siblings).
      if (changed && changed !== filename) return;
      if (session.timer) clearTimeout(session.timer);
      session.timer = setTimeout(() => handleChange(key), DEBOUNCE_MS);
    });
  } catch (err) {
    await stopEdit(key);
    return { ok: false, error: `Could not watch the file for changes: ${err.message}` };
  }

  const openErr = await shell.openPath(filePath);
  if (openErr) {
    await stopEdit(key);
    return { ok: false, error: openErr };
  }
  return { ok: true, filePath };
}

// Stops watching and removes the temp copy. Safe to call for an unknown key.
async function stopEdit(key) {
  const session = sessions.get(key);
  if (!session) return { ok: true };
  session.closed = true;
  if (session.timer) clearTimeout(session.timer);
  if (session.watcher) {
    try { session.watcher.close(); } catch (err) { /* already closed */ }
  }
  sessions.delete(key);
  try {
    fs.rmSync(session.dir, { recursive: true, force: true });
  } catch (err) {
    // The editor may still hold the file open; leave the temp behind rather
    // than throwing — it lives under the OS temp dir and gets swept eventually.
  }
  return { ok: true };
}

// Called on app quit so no watchers or temp files linger.
async function stopAll() {
  for (const key of [...sessions.keys()]) {
    await stopEdit(key);
  }
}

module.exports = { startEdit, stopEdit, stopAll };
