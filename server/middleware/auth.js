const jwt = require('jsonwebtoken');
const db = require('../db');

function getJwtSecret(settingsStore) {
  let secret = settingsStore.get('jwtSecret');
  if (!secret) {
    secret = require('crypto').randomBytes(48).toString('hex');
    settingsStore.set('jwtSecret', secret);
  }
  return secret;
}

function signToken(user, settingsStore) {
  const secret = getJwtSecret(settingsStore);
  return jwt.sign({ sub: user.id, role: user.role }, secret, { expiresIn: '12h' });
}

// Re-checks is_active on every request (not just at login) so a deactivated
// account loses access immediately instead of waiting out the token's expiry.
function authenticate(settingsStore) {
  return async (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing bearer token' });

    let payload;
    try {
      payload = jwt.verify(token, getJwtSecret(settingsStore));
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
      const [rows] = await db
        .getPool()
        .query('SELECT id, username, full_name, role, is_active FROM users WHERE id = ?', [payload.sub]);
      const user = rows[0];
      if (!user || !user.is_active) return res.status(401).json({ error: 'Account not active' });
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { signToken, authenticate, requireRole };
