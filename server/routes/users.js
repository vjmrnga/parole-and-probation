const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { ROLES, USER_TITLES } = require('../../shared/statusEnums');
const { userNameSql } = require('../../shared/nameUtils');

function buildUsersRouter(settingsStore) {
  const router = express.Router();
  router.use(authenticate(settingsStore));

  // Officers can read the user list (limited fields) to populate "assigned
  // officer" pickers when creating/reassigning cases — everything else here
  // is admin-only. Deactivated users are excluded by default everywhere
  // they'd otherwise be pickable; only admins managing the user list can
  // opt in to see them via includeInactive.
  router.get('/', async (req, res, next) => {
    try {
      const isAdmin = req.user.role === 'admin';
      const includeInactive = isAdmin && req.query.includeInactive === '1';
      const [rows] = await db
        .getPool()
        .query(
          `SELECT id, username, first_name, middle_name, last_name, title,
                  ${userNameSql('users')} AS full_name, role, is_active
           FROM users ${includeInactive ? '' : 'WHERE is_active = 1'}
           ORDER BY last_name, first_name`
        );
      res.json(isAdmin ? rows : rows.map(({ id, full_name, role, is_active }) => ({ id, full_name, role, is_active })));
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requireRole('admin'), async (req, res, next) => {
    try {
      const { username, password, firstName, middleName, lastName, title, role } = req.body || {};
      if (!username || !password || !firstName || !lastName || !role) {
        return res.status(400).json({ error: 'username, password, firstName, lastName, and role are required' });
      }
      if (!ROLES.includes(role)) return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` });
      if (title && !USER_TITLES.includes(title)) return res.status(400).json({ error: `title must be one of: ${USER_TITLES.join(', ')}` });

      const passwordHash = await bcrypt.hash(password, 12);
      const [result] = await db
        .getPool()
        .query(
          'INSERT INTO users (username, password_hash, first_name, middle_name, last_name, title, role, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
          [username, passwordHash, firstName, middleName || null, lastName, title || null, role]
        );
      res.status(201).json({
        id: result.insertId,
        username,
        first_name: firstName,
        middle_name: middleName || null,
        last_name: lastName,
        title: title || null,
        full_name: [firstName, middleName, lastName].map((s) => (s || '').trim()).filter(Boolean).join(' '),
        role,
        is_active: 1,
      });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Username already taken' });
      next(err);
    }
  });

  router.patch('/:id', requireRole('admin'), async (req, res, next) => {
    try {
      const { username, firstName, middleName, lastName, title, role, password } = req.body || {};
      if (role && !ROLES.includes(role)) return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` });
      if (title && !USER_TITLES.includes(title)) return res.status(400).json({ error: `title must be one of: ${USER_TITLES.join(', ')}` });
      if (password && password.length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });

      const fields = [];
      const values = [];
      if (username) {
        fields.push('username = ?');
        values.push(username);
      }
      if (firstName !== undefined) {
        fields.push('first_name = ?');
        values.push(firstName);
      }
      if (middleName !== undefined) {
        fields.push('middle_name = ?');
        values.push(middleName || null);
      }
      if (lastName !== undefined) {
        fields.push('last_name = ?');
        values.push(lastName);
      }
      if (title !== undefined) {
        fields.push('title = ?');
        values.push(title || null);
      }
      if (role) {
        fields.push('role = ?');
        values.push(role);
      }
      if (password) {
        fields.push('password_hash = ?');
        values.push(await bcrypt.hash(password, 12));
      }
      if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update' });

      values.push(req.params.id);
      await db.getPool().query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
      res.json({ ok: true });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Username already taken' });
      next(err);
    }
  });

  router.post('/:id/activate', requireRole('admin'), async (req, res, next) => {
    try {
      await db.getPool().query('UPDATE users SET is_active = 1 WHERE id = ?', [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/deactivate', requireRole('admin'), async (req, res, next) => {
    try {
      if (Number(req.params.id) === req.user.id) {
        return res.status(400).json({ error: 'You cannot deactivate your own account' });
      }
      await db.getPool().query('UPDATE users SET is_active = 0 WHERE id = ?', [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/reset-password', requireRole('admin'), async (req, res, next) => {
    try {
      const { password } = req.body || {};
      if (!password || password.length < 6) {
        return res.status(400).json({ error: 'password must be at least 6 characters' });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      await db.getPool().query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = buildUsersRouter;
