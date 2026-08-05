// Branch Office cert trust-on-first-use helpers. These run in the main
// process using Node's `tls`/`https` modules deliberately — Chromium's
// fetch()/XHR stack has no hook for trusting a specific self-signed cert by
// fingerprint, it just hard-fails with ERR_CERT_AUTHORITY_INVALID. Node's
// `https.Agent` does support a custom checkServerIdentity, so all Branch
// Office API traffic is proxied through here (see electron/apiProxy.js)
// rather than issued directly from the renderer.
const tls = require('tls');
const https = require('https');
const { URL } = require('url');

function formatFingerprint(fingerprint256) {
  return fingerprint256.toUpperCase();
}

// One-time, deliberately-insecure connection made ONLY to read the
// presented cert's fingerprint so the user can visually confirm it against
// what's shown on the Head Office Settings screen (trust-on-first-use, same
// model as SSH host keys). Nothing sent over this connection is trusted.
function fetchRemoteFingerprint(hostname, port) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: hostname, port, rejectUnauthorized: false, timeout: 8000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert || !cert.fingerprint256) return reject(new Error('No certificate presented'));
      resolve(formatFingerprint(cert.fingerprint256));
    });
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Connection timed out'));
    });
    socket.on('error', reject);
  });
}

// Real pinned trust: TLS verification is off (self-signed, no public CA),
// but checkServerIdentity throws unless the live cert's fingerprint matches
// the one the user confirmed during pairing.
function buildPinnedAgent(pinnedFingerprint) {
  return new https.Agent({
    rejectUnauthorized: false,
    checkServerIdentity: (_hostname, cert) => {
      const live = formatFingerprint(cert.fingerprint256);
      if (live !== pinnedFingerprint) {
        return new Error(`Certificate fingerprint mismatch — expected ${pinnedFingerprint}, got ${live}`);
      }
      return undefined;
    },
  });
}

function parseHostPort(headOfficeUrl) {
  const url = new URL(headOfficeUrl);
  return { hostname: url.hostname, port: Number(url.port) || 443 };
}

module.exports = { fetchRemoteFingerprint, buildPinnedAgent, parseHostPort };
