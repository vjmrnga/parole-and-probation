// Talks to a physical document scanner via Windows' built-in WIA (Windows
// Image Acquisition) subsystem, through a small C# companion process
// (scanner-bridge/) — same reasoning and shape as ../wacom/wacomPad.js's
// SignatureBridge, except WIA needs no separate SDK installer or license
// (it ships with Windows itself). See scanner-bridge/README.md for build
// instructions and what to check if a real scanner doesn't show up.
//
// Protocol: one JSON object per line over the bridge process's stdio.
//   -> {"cmd":"ping"}   <- {"ok":true,"wiaAvailable":bool,"deviceConnected":bool,"deviceName":string|null}
//   -> {"cmd":"scan"}   <- {"ok":true,"imageBase64":"...","mimeType":"image/jpeg"} | {"ok":false,"error":"..."}

const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.join(__dirname, '..');

let mainWindowRef = null;
let status = { connected: false, deviceName: null, mode: 'mock' };
let bridgeProcess = null;
let pendingResolve = null;

function findBridgeExe() {
  const candidates = [
    process.env.SCANNER_BRIDGE_PATH,
    process.resourcesPath ? path.join(process.resourcesPath, 'scanner-bridge', 'ScannerBridge.exe') : null,
    path.join(ROOT_DIR, 'scanner-bridge', 'bin', 'Release', 'net48', 'ScannerBridge.exe'),
    path.join(ROOT_DIR, 'scanner-bridge', 'bin', 'Debug', 'net48', 'ScannerBridge.exe'),
  ].filter(Boolean);

  return candidates.find((p) => fs.existsSync(p)) || null;
}

function init(mainWindow) {
  mainWindowRef = mainWindow;
  status = { connected: false, deviceName: null, mode: 'mock' };

  const exePath = findBridgeExe();
  if (!exePath) {
    broadcastStatus();
    return;
  }

  try {
    bridgeProcess = spawn(exePath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    console.error('Failed to spawn ScannerBridge:', err);
    broadcastStatus();
    return;
  }

  const rl = readline.createInterface({ input: bridgeProcess.stdout });
  rl.on('line', (line) => {
    if (!pendingResolve) return;
    const resolve = pendingResolve;
    pendingResolve = null;
    try {
      resolve(JSON.parse(line));
    } catch (err) {
      resolve({ ok: false, error: `bad bridge response: ${err.message}` });
    }
  });

  bridgeProcess.stderr.on('data', (chunk) => {
    console.error('ScannerBridge stderr:', chunk.toString());
  });

  bridgeProcess.on('error', (err) => {
    console.error('ScannerBridge process error:', err);
    bridgeProcess = null;
    status = { connected: false, deviceName: null, mode: 'mock' };
    broadcastStatus();
  });

  bridgeProcess.on('exit', () => {
    bridgeProcess = null;
    status = { connected: false, deviceName: null, mode: 'mock' };
    broadcastStatus();
  });

  sendCommand({ cmd: 'ping' })
    .then((res) => {
      status = {
        connected: !!(res && res.deviceConnected),
        deviceName: (res && res.deviceName) || null,
        mode: res && res.wiaAvailable ? 'bridge' : 'unavailable',
      };
      broadcastStatus();
    })
    .catch((err) => {
      console.error('ScannerBridge ping failed:', err);
      broadcastStatus();
    });
}

function sendCommand(obj) {
  return new Promise((resolve, reject) => {
    if (!bridgeProcess) {
      reject(new Error('Scanner bridge is not running'));
      return;
    }
    pendingResolve = resolve;
    bridgeProcess.stdin.write(JSON.stringify(obj) + '\n');
  });
}

async function scanDocument() {
  const res = await sendCommand({ cmd: 'scan' });
  if (!res || !res.ok) {
    throw new Error((res && res.error) || 'Scan failed');
  }
  return { imageBase64: res.imageBase64, mimeType: res.mimeType || 'image/jpeg' };
}

function shutdown() {
  if (bridgeProcess) {
    const proc = bridgeProcess;
    bridgeProcess = null;
    try {
      proc.stdin.write(JSON.stringify({ cmd: 'exit' }) + '\n');
    } catch (err) {
      // process may already be gone; fall through to kill()
    }
    proc.kill();
  }
}

function getStatus() {
  return status;
}

function broadcastStatus() {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('scanner-status-changed', status);
  }
}

module.exports = { init, shutdown, getStatus, scanDocument };
