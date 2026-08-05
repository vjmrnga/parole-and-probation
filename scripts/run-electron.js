// Launches the Electron binary with a scrubbed environment.
//
// VS Code's integrated terminal (and some other Electron-based tools) sets
// ELECTRON_RUN_AS_NODE=1 for its own internal use, and that leaks into every
// child process spawned from that terminal. Electron treats the mere
// *presence* of that variable (even an empty string) as a signal to run as
// plain Node.js instead of launching the app/BrowserWindow runtime, which
// breaks `electron .` silently (main.js sees `app` as undefined). Deleting
// the key here, before spawning, is the only place that's early enough to
// matter — unsetting it inside main.js is too late.
const { spawn } = require('child_process');
const path = require('path');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [path.resolve(__dirname, '..'), ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error(err);
  process.exit(1);
});
