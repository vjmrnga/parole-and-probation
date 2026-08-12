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

// How often we probe whether the editor still has the document open, and how
// many consecutive "free" probes we require before declaring it closed. The
// confirm count guards against the brief window mid-save when Word deletes and
// re-creates the file and it momentarily looks free.
const CLOSE_POLL_MS = 2000;
const CLOSE_CONFIRM_POLLS = 2;

// key -> { dir, filePath, filename, watcher, timer, lastHash, onChange,
//          onClosed, closeTimer, everSeenOpen, freeStreak, finalizing, closed }
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

// Office apps (Word/Excel/PowerPoint) keep a hidden "~$<name>" owner file next
// to an open document, and LibreOffice a ".~lock.<name>#"; both are deleted on
// close. Because every session owns a private temp dir, any such sibling means
// our document is still open.
function hasOwnerLockFile(dir) {
  try {
    return fs.readdirSync(dir).some((n) => n.startsWith('~$') || n.startsWith('.~lock.'));
  } catch (err) {
    return false;
  }
}

// True when the document still appears open in an external editor. Two signals:
// an Office owner-lock sibling, or the file itself being unrenameable. A file a
// process holds open (Acrobat, image editors, etc.) can't be renamed, so the
// rename-and-rename-back probe fails while it's open and succeeds once free —
// and since a held file can't be renamed in the first place, the momentary
// rename-back can never collide with the editor's own save.
function isDocumentOpen(session) {
  if (hasOwnerLockFile(session.dir)) return true;
  const probe = `${session.filePath}.pp-probe`;
  try {
    fs.renameSync(session.filePath, probe);
    fs.renameSync(probe, session.filePath);
    return false; // renamed freely -> nothing holds it open
  } catch (err) {
    // Recover if we renamed away but couldn't rename back (should be rare).
    try {
      if (fs.existsSync(probe) && !fs.existsSync(session.filePath)) {
        fs.renameSync(probe, session.filePath);
      }
    } catch (recoverErr) {
      // leave it; the next probe will retry
    }
    return true; // locked, busy, or mid-save -> treat as still open
  }
}

// Periodic check behind auto-release: once we've actually observed the document
// open (so a viewer that never locks the file can't trigger a false close right
// after launch), a run of "free" probes means the user closed it. We grab any
// last-moment save, then release the session and notify via onClosed.
function checkClosed(key) {
  const session = sessions.get(key);
  if (!session || session.closed || session.finalizing) return;

  if (isDocumentOpen(session)) {
    session.everSeenOpen = true;
    session.freeStreak = 0;
    return;
  }
  if (!session.everSeenOpen) return; // never confirmed open — wait for the manual "Done"
  session.freeStreak += 1;
  if (session.freeStreak < CLOSE_CONFIRM_POLLS) return;

  session.finalizing = true;
  const onClosed = session.onClosed;
  Promise.resolve(handleChange(key))
    .catch(() => {})
    .finally(async () => {
      await stopEdit(key);
      if (onClosed) onClosed();
    });
}

// Opens `filename` (bytes given as base64) for editing under a private temp
// dir keyed by `key`, and starts watching for saves. onChange(base64) fires
// once per distinct save; onClosed() fires once when the editor is closed, so
// the caller can auto-release the document's lock without the user clicking
// "Done". Returns { ok, filePath } or { ok:false, error }.
async function startEdit({ key, base64, filename }, onChange, onClosed) {
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
    onClosed,
    closeTimer: null,
    everSeenOpen: false,
    freeStreak: 0,
    finalizing: false,
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

  // Start polling for close only after the editor has had a chance to launch
  // and take its lock, so the first probe doesn't race the open.
  session.closeTimer = setInterval(() => checkClosed(key), CLOSE_POLL_MS);
  return { ok: true, filePath };
}

// Stops watching and removes the temp copy. Safe to call for an unknown key.
async function stopEdit(key) {
  const session = sessions.get(key);
  if (!session) return { ok: true };
  session.closed = true;
  if (session.timer) clearTimeout(session.timer);
  if (session.closeTimer) clearInterval(session.closeTimer);
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
