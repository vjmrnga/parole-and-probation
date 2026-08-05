// Generates (once) and loads the self-signed cert Head Office's HTTPS server
// uses. Branch Office instances pin its fingerprint on first pairing instead
// of trusting a public CA — see server/tls/README in the plan for the flow.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const selfsigned = require('selfsigned');

function certDir(userDataPath) {
  return path.join(userDataPath, 'certs');
}

function certPaths(userDataPath) {
  const dir = certDir(userDataPath);
  return { dir, keyPath: path.join(dir, 'key.pem'), certPath: path.join(dir, 'cert.pem') };
}

function lanHostnameAttrs() {
  return [{ name: 'commonName', value: os.hostname() }];
}

// Self-signed certs need every hostname/IP a client might connect through
// listed as a Subject Alternative Name, or Node's TLS client will refuse the
// handshake even with the fingerprint pinned correctly.
function subjectAltNames() {
  const altNames = [{ type: 2, value: os.hostname() }, { type: 2, value: 'localhost' }];
  const nets = os.networkInterfaces();
  for (const ifaceList of Object.values(nets)) {
    for (const iface of ifaceList || []) {
      if (iface.family === 'IPv4') altNames.push({ type: 7, ip: iface.address });
    }
  }
  altNames.push({ type: 7, ip: '127.0.0.1' });
  return altNames;
}

function ensureCert(userDataPath) {
  const { dir, keyPath, certPath } = certPaths(userDataPath);
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return { key: fs.readFileSync(keyPath, 'utf8'), cert: fs.readFileSync(certPath, 'utf8') };
  }

  fs.mkdirSync(dir, { recursive: true });
  const pems = selfsigned.generate(lanHostnameAttrs(), {
    days: 3650,
    keySize: 2048,
    extensions: [{ name: 'subjectAltName', altNames: subjectAltNames() }],
  });

  fs.writeFileSync(keyPath, pems.private, { mode: 0o600 });
  fs.writeFileSync(certPath, pems.cert, { mode: 0o600 });
  return { key: pems.private, cert: pems.cert };
}

function getFingerprint(userDataPath) {
  const { certPath } = certPaths(userDataPath);
  const certPem = fs.readFileSync(certPath, 'utf8');
  const der = Buffer.from(
    certPem.replace(/-----BEGIN CERTIFICATE-----/, '').replace(/-----END CERTIFICATE-----/, '').replace(/\s/g, ''),
    'base64'
  );
  const hash = crypto.createHash('sha256').update(der).digest('hex').toUpperCase();
  return hash.match(/.{2}/g).join(':');
}

module.exports = { ensureCert, getFingerprint, certPaths };
