// Talks to the Wacom STU-300 / STU-430 signature pads via a small C#
// companion process (bridge/) since Wacom's Signature SDK is only exposed
// as Windows COM/ActiveX objects (Florentis.SigCtl / Florentis.DynamicCapture),
// which Node.js/Electron cannot call directly. See bridge/README.md for what
// needs to be installed (the actual SDK MSI + a license key) before the
// bridge can report a real pad instead of falling back to the on-screen
// canvas (renderer/src/components/SignatureCapture.jsx handles that
// fallback — it just disables "Capture from Wacom Pad" when getPadStatus()
// reports connected: false).
//
// Ported from the OfflineSignatureManager reference project — the only
// change is where the license key comes from: that project read a
// standalone config/config.json via common/configPaths.js, this app already
// has electron/settingsStore.js (electron-store) for per-machine settings,
// so the key lives there instead (settingsStore key: wacomLicenseKey, set
// via Settings screen).
//
// Protocol: one JSON object per line over the bridge process's stdio.
//   -> {"cmd":"ping"}                                  <- {"ok":true,"sdkAvailable":bool}
//   -> {"cmd":"capture","signerName":"...","reason":"..."} <- {"ok":true,"pngBase64":"..."} | {"ok":false,"error":"..."}

const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');
const settingsStore = require('../electron/settingsStore');

const ROOT_DIR = path.join(__dirname, '..');

let mainWindowRef = null;
let status = { connected: false, model: null, mode: 'mock' };
let bridgeProcess = null;
let pendingResolve = null;

function findBridgeExe() {
  const candidates = [
    process.env.WACOM_BRIDGE_PATH,
    process.resourcesPath ? path.join(process.resourcesPath, 'bridge', 'SignatureBridge.exe') : null,
    path.join(ROOT_DIR, 'bridge', 'bin', 'Release', 'net48', 'SignatureBridge.exe'),
    path.join(ROOT_DIR, 'bridge', 'bin', 'Debug', 'net48', 'SignatureBridge.exe'),
  ].filter(Boolean);

  return candidates.find((p) => fs.existsSync(p)) || null;
}

function loadLicenseKey() {
  try {
    return settingsStore.get('wacomLicenseKey') || '';
  } catch (err) {
    console.error('Failed to read wacomLicenseKey from settings:', err);
    return '';
  }
}

function init(mainWindow) {
  mainWindowRef = mainWindow;
  status = { connected: false, model: null, mode: 'mock' };

  const exePath = findBridgeExe();
  if (!exePath) {
    broadcastStatus();
    return;
  }

  try {
    bridgeProcess = spawn(exePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, WACOM_SIGNATURE_LICENSE: loadLicenseKey() },
    });
  } catch (err) {
    console.error('Failed to spawn SignatureBridge:', err);
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
    console.error('SignatureBridge stderr:', chunk.toString());
  });

  bridgeProcess.on('error', (err) => {
    console.error('SignatureBridge process error:', err);
    bridgeProcess = null;
    status = { connected: false, model: null, mode: 'mock' };
    broadcastStatus();
  });

  bridgeProcess.on('exit', () => {
    bridgeProcess = null;
    status = { connected: false, model: null, mode: 'mock' };
    broadcastStatus();
  });

  sendCommand({ cmd: 'ping' })
    .then((res) => {
      const sdkAvailable = !!(res && res.sdkAvailable);
      status = {
        connected: sdkAvailable,
        model: sdkAvailable ? 'Wacom STU (via SignatureBridge)' : null,
        mode: 'bridge',
      };
      broadcastStatus();
    })
    .catch((err) => {
      console.error('SignatureBridge ping failed:', err);
      broadcastStatus();
    });
}

function sendCommand(obj) {
  return new Promise((resolve, reject) => {
    if (!bridgeProcess) {
      reject(new Error('Signature bridge is not running'));
      return;
    }
    pendingResolve = resolve;
    bridgeProcess.stdin.write(JSON.stringify(obj) + '\n');
  });
}

async function captureFromPad({ signerName, reason }) {
  const res = await sendCommand({ cmd: 'capture', signerName, reason });
  if (!res || !res.ok) {
    throw new Error((res && res.error) || 'Signature capture failed');
  }
  return res.pngBase64;
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

// Called after Settings saves a new license key so the next capture attempt
// (and pad-connected indicator) picks it up without requiring an app
// restart — restarts the bridge process with the new key and re-pings it.
function restart(mainWindow) {
  shutdown();
  init(mainWindow || mainWindowRef);
}

function broadcastStatus() {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('pad-status-changed', status);
  }
}

module.exports = { init, shutdown, getStatus, captureFromPad, restart };
