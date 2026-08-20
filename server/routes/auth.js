const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../db');
const { signToken, authenticate } = require('../middleware/auth');
const { composeUserName } = require('../../shared/nameUtils');
const { USER_TITLES } = require('../../shared/statusEnums');
const { PASSWORD_POLICY_DESCRIPTION, isPasswordValid } = require('../../shared/passwordPolicy');
const { duplicateFieldMessage } = require('../utils/dbErrors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

      const { username, password, firstName, middleName, lastName } = req.body || {};
      if (!username || !password || !firstName || !lastName) {
        return res.status(400).json({ error: 'username, password, firstName, and lastName are required' });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const [result] = await db
        .getPool()
        .query(
          'INSERT INTO users (username, password_hash, first_name, middle_name, last_name, role, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)',
          [username, passwordHash, firstName, middleName || null, lastName, 'admin']
        );

      const user = {
        id: result.insertId,
        username,
        first_name: firstName,
        middle_name: middleName || null,
        last_name: lastName,
        title: null,
        full_name: composeUserName({ first_name: firstName, middle_name: middleName, last_name: lastName }),
        role: 'admin',
      };
      const sessionId = await startSession(user, (req.body || {}).deviceName);
      res.status(201).json({ user, token: signToken(user, settingsStore, sessionId) });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Username already taken' });
      next(err);
    }
  });

  // Self-service registration: anyone can request an account, but it can't
  // sign in until an admin approves it in Manage Users (see users.js's
  // /:id/approve and /:id/reject). Always defaults to the lowest-privilege
  // role — the requester can't grant themselves 'admin' or 'staff'; an admin
  // assigns the real role at approval time (or later via PATCH /users/:id).
  router.post('/signup', async (req, res, next) => {
    try {
      const { username, email, password, confirmPassword, firstName, middleName, lastName, title } = req.body || {};
      if (!username || !email || !password || !firstName || !lastName) {
        return res.status(400).json({ error: 'username, email, password, firstName, and lastName are required' });
      }
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
      if (!isPasswordValid(password)) return res.status(400).json({ error: PASSWORD_POLICY_DESCRIPTION });
      // confirmPassword is optional here (the client already blocks submit on
      // a mismatch) but re-checked in case something calls this API directly.
      if (confirmPassword !== undefined && confirmPassword !== password) {
        return res.status(400).json({ error: 'Passwords do not match' });
      }
      if (title && !USER_TITLES.includes(title)) return res.status(400).json({ error: `title must be one of: ${USER_TITLES.join(', ')}` });

      const passwordHash = await bcrypt.hash(password, 12);
      await db
        .getPool()
        .query(
          `INSERT INTO users (username, email, password_hash, first_name, middle_name, last_name, title, role, approval_status, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'officer', 'pending', 0)`,
          [username, email, passwordHash, firstName, middleName || null, lastName, title || null]
        );
      res.status(201).json({ ok: true, message: 'Account request submitted. An administrator needs to approve it before you can sign in.' });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: duplicateFieldMessage(err) });
      next(err);
    }
  });

  // Live "is this username taken?" check for the sign-up form (checked
  // on blur, not on every keystroke — see LoginScreen.jsx) so a clash
  // surfaces before the user fills out the rest of the form, rather than
  // only after submitting. Not authoritative by itself — the /signup
  // insert above is still guarded by the UNIQUE column, since a name could
  // be claimed in the gap between this check and that submit.
  router.get('/check-username', async (req, res, next) => {
    try {
      const username = (req.query.username || '').trim();
      if (!username) return res.json({ available: false });
      const [rows] = await db.getPool().query('SELECT id FROM users WHERE username = ?', [username]);
      res.json({ available: rows.length === 0 });
    } catch (err) {
      next(err);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const { username, password, deviceName, force } = req.body || {};
      if (!username || !password) return res.status(400).json({ error: 'username and password are required' });

      const [rows] = await db.getPool().query('SELECT * FROM users WHERE username = ?', [username]);
      const user = rows[0];
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

      // Checked after the password so a wrong password always looks like
      // "Invalid credentials" regardless of approval state — no signal to a
      // guesser about whether an account is pending/rejected.
      if (user.approval_status === 'pending') {
        return res.status(403).json({ error: 'Your account is awaiting administrator approval.', code: 'PENDING_APPROVAL' });
      }
      if (user.approval_status === 'rejected') {
        return res.status(403).json({ error: 'Your account request was declined. Contact an administrator.', code: 'REGISTRATION_REJECTED' });
      }
      if (!user.is_active) return res.status(401).json({ error: 'Invalid credentials' });

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
      const publicUser = {
        id: user.id,
        username: user.username,
        email: user.email,
        first_name: user.first_name,
        middle_name: user.middle_name,
        last_name: user.last_name,
        title: user.title,
        full_name: composeUserName(user),
        role: user.role,
      };
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
