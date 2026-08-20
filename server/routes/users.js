const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { ROLES, USER_TITLES } = require('../../shared/statusEnums');
const { PASSWORD_POLICY_DESCRIPTION, isPasswordValid } = require('../../shared/passwordPolicy');
const { userNameSql } = require('../../shared/nameUtils');
const { duplicateFieldMessage } = require('../utils/dbErrors');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function buildUsersRouter(settingsStore) {
  const router = express.Router();
  router.use(authenticate(settingsStore));

  // Officers can read the user list (limited fields) to populate "assigned
  // officer" pickers when creating/reassigning cases — everything else here
  // is admin-only. Deactivated users are excluded by default everywhere
  // they'd otherwise be pickable; only admins managing the user list can
  // opt in to see them via includeInactive. Pending sign-ups are always
  // surfaced to admins (even without includeInactive) so a new request in
  // Manage Users can't be missed — they're not "deactivated", they've never
  // been approved yet.
  router.get('/', async (req, res, next) => {
    try {
      const isAdmin = req.user.role === 'admin';
      const includeInactive = isAdmin && req.query.includeInactive === '1';
      let where = 'WHERE is_active = 1';
      if (isAdmin) where = includeInactive ? '' : "WHERE (is_active = 1 OR approval_status = 'pending')";
      const [rows] = await db
        .getPool()
        .query(
          `SELECT id, username, email, first_name, middle_name, last_name, title,
                  ${userNameSql('users')} AS full_name, role, is_active, approval_status, created_at
           FROM users ${where}
           ORDER BY (approval_status = 'pending') DESC, last_name, first_name`
        );
      res.json(isAdmin ? rows : rows.map(({ id, full_name, role, is_active }) => ({ id, full_name, role, is_active })));
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requireRole('admin'), async (req, res, next) => {
    try {
      const { username, email, password, firstName, middleName, lastName, title, role } = req.body || {};
      if (!username || !password || !firstName || !lastName || !role) {
        return res.status(400).json({ error: 'username, password, firstName, lastName, and role are required' });
      }
      if (!ROLES.includes(role)) return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` });
      if (title && !USER_TITLES.includes(title)) return res.status(400).json({ error: `title must be one of: ${USER_TITLES.join(', ')}` });
      if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
      if (!isPasswordValid(password)) return res.status(400).json({ error: PASSWORD_POLICY_DESCRIPTION });

      const passwordHash = await bcrypt.hash(password, 12);
      const [result] = await db
        .getPool()
        .query(
          'INSERT INTO users (username, email, password_hash, first_name, middle_name, last_name, title, role, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
          [username, email || null, passwordHash, firstName, middleName || null, lastName, title || null, role]
        );
      res.status(201).json({
        id: result.insertId,
        username,
        email: email || null,
        first_name: firstName,
        middle_name: middleName || null,
        last_name: lastName,
        title: title || null,
        full_name: [firstName, middleName, lastName].map((s) => (s || '').trim()).filter(Boolean).join(' '),
        role,
        is_active: 1,
      });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: duplicateFieldMessage(err) });
      next(err);
    }
  });

  router.patch('/:id', requireRole('admin'), async (req, res, next) => {
    try {
      const { username, email, firstName, middleName, lastName, title, role, password } = req.body || {};
      if (role && !ROLES.includes(role)) return res.status(400).json({ error: `role must be one of: ${ROLES.join(', ')}` });
      if (title && !USER_TITLES.includes(title)) return res.status(400).json({ error: `title must be one of: ${USER_TITLES.join(', ')}` });
      if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
      if (password && !isPasswordValid(password)) return res.status(400).json({ error: PASSWORD_POLICY_DESCRIPTION });

      const fields = [];
      const values = [];
      if (username) {
        fields.push('username = ?');
        values.push(username);
      }
      if (email !== undefined) {
        fields.push('email = ?');
        values.push(email || null);
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
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: duplicateFieldMessage(err) });
      next(err);
    }
  });

  // Approves a self-registered account (see POST /auth/signup): flips it to
  // 'approved' and turns it on, so it can sign in right away. Role/title
  // default to 'officer'/whatever the requester picked at signup — an admin
  // can still adjust either via PATCH /users/:id, before or after approving.
  router.post('/:id/approve', requireRole('admin'), async (req, res, next) => {
    try {
      await db.getPool().query("UPDATE users SET approval_status = 'approved', is_active = 1 WHERE id = ?", [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Declines a self-registered account. Left in place (not deleted) so the
  // username stays reserved and the admin has a record of the request;
  // it stays signed-out and shows as "Rejected" in Manage Users.
  router.post('/:id/reject', requireRole('admin'), async (req, res, next) => {
    try {
      await db.getPool().query("UPDATE users SET approval_status = 'rejected', is_active = 0 WHERE id = ?", [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
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
      if (!isPasswordValid(password)) {
        return res.status(400).json({ error: PASSWORD_POLICY_DESCRIPTION });
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
