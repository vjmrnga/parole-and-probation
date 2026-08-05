// Runs before `npm run dev` (see the "predev" script in package.json) to
// force-close any instance of this app that's already running.
//
// In head-office mode the app hides to the tray instead of quitting on
// window close (see main.js's close handler), so a stale instance from a
// previous session keeps holding Electron's single-instance lock in the
// background. When that happens, the next `npm run dev` launches, loses the
// lock fight, and quits instantly without ever showing a window — so you end
// up editing code for a session that isn't the one on screen, and the
// visible window never picks up your changes. Killing both the packaged exe
// and any lingering dev `electron.exe` processes first guarantees the next
// `npm run dev` actually owns the lock and shows its own window.
const { execSync } = require('child_process');

const PRODUCT_NAME = 'Parole and Probation Case Manager';
const VITE_PORT = 5173;

function tryRun(cmd) {
  try {
    execSync(cmd, { stdio: 'ignore' });
  } catch {
    // Nothing matched — nothing to clean up.
  }
}

// A prior session that didn't shut down cleanly (e.g. this same script's
// SIGTERM racing an in-progress compile) can leave the old `vite` dev server
// bound to its port. Vite's strictPort config then refuses to fall back to
// another port, so the next `npm run dev` fails outright unless that
// listener is cleared too.
function killPortWin32(port) {
  let out;
  try {
    out = execSync('netstat -ano').toString();
  } catch {
    return;
  }
  const pids = new Set();
  for (const line of out.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'TCP' && parts[1] && parts[1].endsWith(`:${port}`)) {
      const pid = parts[parts.length - 1];
      if (/^\d+$/.test(pid)) pids.add(pid);
    }
  }
  for (const pid of pids) tryRun(`taskkill /F /PID ${pid}`);
}

if (process.platform === 'win32') {
  tryRun(`taskkill /F /IM "${PRODUCT_NAME}.exe" /T`);
  tryRun('taskkill /F /IM electron.exe /T');
  killPortWin32(VITE_PORT);
} else {
  tryRun(`pkill -f "${PRODUCT_NAME}"`);
  tryRun("pkill -f 'node_modules/.bin/electron'");
  tryRun(`fuser -k ${VITE_PORT}/tcp`);
}
