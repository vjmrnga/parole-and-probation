const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const { signToken, authenticate } = require('../middleware/auth');

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
      res.status(201).json({ user, token: signToken(user, settingsStore) });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Username already taken' });
      next(err);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) return res.status(400).json({ error: 'username and password are required' });

      const [rows] = await db.getPool().query('SELECT * FROM users WHERE username = ?', [username]);
      const user = rows[0];
      if (!user || !user.is_active) return res.status(401).json({ error: 'Invalid credentials' });

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

      const publicUser = { id: user.id, username: user.username, full_name: user.full_name, role: user.role };
      res.json({ user: publicUser, token: signToken(publicUser, settingsStore) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', authenticate(settingsStore), (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}

module.exports = buildAuthRouter;
