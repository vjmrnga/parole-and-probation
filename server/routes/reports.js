const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { userNameSql } = require('../../shared/nameUtils');

function buildReportsRouter(settingsStore) {
  const router = express.Router();
  router.use(authenticate(settingsStore));

  router.get('/probationers-full', async (_req, res, next) => {
    try {
      const [rows] = await db.getPool().query(
        `SELECT p.*, ${userNameSql('u')} AS assigned_officer_name,
                (SELECT COUNT(*) FROM attendance_log a WHERE a.probationer_id = p.id) AS attendance_count
         FROM probationers p JOIN users u ON u.id = p.assigned_officer_id
         ORDER BY p.last_name, p.first_name`
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = buildReportsRouter;
