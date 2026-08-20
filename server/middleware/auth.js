const jwt = require('jsonwebtoken');
const db = require('../db');
const { userNameSql } = require('../../shared/nameUtils');

function getJwtSecret(settingsStore) {
  let secret = settingsStore.get('jwtSecret');
  if (!secret) {
    secret = require('crypto').randomBytes(48).toString('hex');
    settingsStore.set('jwtSecret', secret);
  }
  return secret;
}

// sid identifies this particular login (see server/routes/auth.js) — it's
// echoed back on every request and compared against the user's row so only
// the most recent login, on one device at a time, stays valid (single-session
// enforcement).
function signToken(user, settingsStore, sessionId) {
  const secret = getJwtSecret(settingsStore);
  return jwt.sign({ sub: user.id, role: user.role, sid: sessionId }, secret, { expiresIn: '12h' });
}

// Re-checks is_active on every request (not just at login) so a deactivated
// account loses access immediately instead of waiting out the token's expiry.
// Also re-checks the token's sid against users.active_session_id so that
// once someone logs in elsewhere and replaces the session, this token stops
// working immediately instead of waiting out its own 12h expiry.
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
        .query(
          `SELECT id, username, email, first_name, middle_name, last_name, title,
                  ${userNameSql('users')} AS full_name, role, is_active, active_session_id
           FROM users WHERE id = ?`,
          [payload.sub]
        );
      const user = rows[0];
      if (!user || !user.is_active) return res.status(401).json({ error: 'Account not active' });
      if (!user.active_session_id || payload.sid !== user.active_session_id) {
        return res.status(401).json({
          error: 'This account was signed in on another device, which ended this session.',
          code: 'SESSION_REPLACED',
        });
      }
      delete user.active_session_id; // internal-only, never surface it to the client
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
