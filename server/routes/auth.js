const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../db');
const { signToken, authenticate } = require('../middleware/auth');

// Matches the JWT's own expiresIn (see signToken) — a session recorded on
// users.active_session_id older than this is already dead as far as the
// token is concerned, so a login from elsewhere shouldn't warn about it.
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

function hasLiveConflictingSession(user, deviceName) {
  if (!user.active_session_id) return false;
  if (user.active_session_device && deviceName && user.active_session_device === deviceName) return false;
  if (!user.active_session_started_at) return true;
  const age = Date.now() - new Date(user.active_session_started_at).getTime();
  return age < SESSION_MAX_AGE_MS;
}

// Starts a fresh session for this user (new sid, device label, timestamp),
// stamping over whatever was there before — the caller is responsible for
// deciding whether that's OK (see the login route's force flag).
async function startSession(user, deviceName) {
  const sessionId = crypto.randomUUID();
  await db
    .getPool()
    .query('UPDATE users SET active_session_id = ?, active_session_device = ?, active_session_started_at = NOW() WHERE id = ?', [
      sessionId,
      deviceName || null,
      user.id,
    ]);
  return sessionId;
}

function buildAuthRouter(settingsStore) {
  const router = express.Router();

  router.get('/bootstrap-status', async (_req, res, next) => {
    try {
      const [rows] = await db.getPool().query("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
      res.json({ needsAdmin: rows[0].n === 0 });
    } catch (err) {
      next(err);
    }
  });

  // Only creates a user if there is currently no admin at all — this route
  // can't be used to smuggle in a second admin once one exists.
  router.post('/bootstrap-admin', async (req, res, next) => {
    try {
      const [rows] = await db.getPool().query("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
      if (rows[0].n > 0) return res.status(409).json({ error: 'An admin account already exists' });

      const { username, password, fullName } = req.body || {};
      if (!username || !password || !fullName) {
        return res.status(400).json({ error: 'username, password, and fullName are required' });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const [result] = await db
        .getPool()
        .query('INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES (?, ?, ?, ?, 1)', [
          username,
          passwordHash,
          fullName,
          'admin',
        ]);

      const user = { id: result.insertId, username, full_name: fullName, role: 'admin' };
      const sessionId = await startSession(user, (req.body || {}).deviceName);
      res.status(201).json({ user, token: signToken(user, settingsStore, sessionId) });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Username already taken' });
      next(err);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const { username, password, deviceName, force } = req.body || {};
      if (!username || !password) return res.status(400).json({ error: 'username and password are required' });

      const [rows] = await db.getPool().query('SELECT * FROM users WHERE username = ?', [username]);
      const user = rows[0];
      if (!user || !user.is_active) return res.status(401).json({ error: 'Invalid credentials' });

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

      // Single-session enforcement: someone is (or recently was) signed in
      // as this user on a different device. Refuse the plain login and let
      // the client decide whether to force it — see LoginScreen.jsx's
      // "sign out the other session?" confirmation modal.
      if (!force && hasLiveConflictingSession(user, deviceName)) {
        return res.status(409).json({
          error: `This account is already signed in on "${user.active_session_device || 'another device'}". Signing in here will sign that session out.`,
          code: 'ALREADY_LOGGED_IN',
          device: user.active_session_device,
          since: user.active_session_started_at,
        });
      }

      const sessionId = await startSession(user, deviceName);
      const publicUser = { id: user.id, username: user.username, full_name: user.full_name, role: user.role };
      res.json({ user: publicUser, token: signToken(publicUser, settingsStore, sessionId) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', authenticate(settingsStore), (req, res) => {
    res.json({ user: req.user });
  });

  // Best-effort: clears this session so a future login from elsewhere (or
  // even this same device) doesn't warn about a session the user
  // deliberately ended. authenticate() already guarantees the caller *is*
  // the current active session, so this can only ever clear its own.
  router.post('/logout', authenticate(settingsStore), async (req, res, next) => {
    try {
      await db
        .getPool()
        .query('UPDATE users SET active_session_id = NULL, active_session_device = NULL, active_session_started_at = NULL WHERE id = ?', [
          req.user.id,
        ]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = buildAuthRouter;
