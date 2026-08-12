// Every renderer API call is proxied through here (via IPC — see preload.js
// / main.js's 'api-request' handler) instead of using the renderer's own
// fetch(). Two reasons: (1) Chromium's fetch/XHR stack cannot be told to
// trust a specific self-signed certificate by fingerprint — it just hard
// fails — so Branch Office's pinned-cert trust (electron/certPinning.js)
// only works from Node's https module; (2) this keeps one code path for
// both modes, the only difference is which host/agent gets used.
const https = require('https');
const fs = require('fs');
const { certPaths } = require('../server/tls/certGen');
const { buildPinnedAgent, parseHostPort } = require('./certPinning');

function requestJson({ hostname, port, path, method, headers, body, agent }) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname,
        port,
        path,
        method,
        agent,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch (err) {
            return reject(new Error('Server returned a non-JSON response'));
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Head Office trusts its own locally-generated cert directly (passing it as
// `ca` validates the chain against that exact cert, which is its own root
// since it's self-signed) — no pairing ceremony needed for local use.
function headOfficeAgent(userDataPath) {
  const { certPath } = certPaths(userDataPath);
  return new https.Agent({ ca: fs.readFileSync(certPath, 'utf8') });
}

// Where this instance's API traffic goes and how its TLS is trusted, by mode.
// Shared by apiRequest (below) and the SSE event stream (electron/eventStream.js)
// so both reach the same server with the same cert-trust rules. Throws when the
// app isn't configured for a mode yet (or a Branch isn't paired).
function resolveTarget({ settingsStore, userDataPath }) {
  const mode = settingsStore.get('mode');

  if (mode === 'head-office') {
    return {
      hostname: '127.0.0.1',
      port: settingsStore.get('serverPort'),
      agent: headOfficeAgent(userDataPath),
    };
  }

  if (mode === 'branch-office') {
    const headOfficeUrl = settingsStore.get('headOfficeUrl');
    const pinnedFingerprint = settingsStore.get('pinnedCertFingerprint');
    if (!headOfficeUrl || !pinnedFingerprint) {
      throw new Error('Branch Office is not paired with a Head Office yet — check Settings.');
    }
    const { hostname, port } = parseHostPort(headOfficeUrl);
    return { hostname, port, agent: buildPinnedAgent(pinnedFingerprint) };
  }

  throw new Error('No mode configured yet');
}

async function apiRequest({ method, path, body, token, settingsStore, userDataPath }) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const { hostname, port, agent } = resolveTarget({ settingsStore, userDataPath });
  return requestJson({ hostname, port, path: `/api${path}`, method, headers, body, agent });
}

module.exports = { apiRequest, resolveTarget };
