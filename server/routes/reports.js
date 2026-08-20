const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { userNameSql } = require('../../shared/nameUtils');

// Mirrors composeOffense() in psir-generator/app-logic.js: joins the
// "Charged With" list's citation texts the same way the PSIR does —
// identical entries merged into "(n Cts.) …", multiple distinct entries
// numbered "(1) …; and (2) …".
function composeCharged(charged) {
  const parts = (charged || [])
    .map((o) => (o && o.text ? o.text.trim() : ''))
    .filter(Boolean)
    .map((t) => `Viol. of ${t}`);
  if (!parts.length) return '';
  const uniq = [];
  parts.forEach((p) => {
    const found = uniq.find((u) => u.text === p);
    if (found) found.n += 1; else uniq.push({ text: p, n: 1 });
  });
  const grouped = uniq.map((u) => (u.n > 1 ? `${u.text} (${u.n} Cts.)` : u.text));
  if (grouped.length === 1) return grouped[0];
  const items = grouped.map((p, i) => `(${i + 1}) ${p}`);
  return `${items.slice(0, -1).join('; ')}; and ${items[items.length - 1]}`;
}

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
      // conviction_date is no longer collected as its own field — it now
      // comes from the "Convicted Of" offense list's date (psir_profile.
      // offenses.convicted), same source the PSIR Generator prints (see
      // composeOffenseDates() in psir-generator/app-logic.js). Falls back to
      // whatever's still in the legacy column for older cases that have a
      // conviction_date but never had that offense list filled in.
      //
      // offense is likewise no longer collected as its own field — it now
      // comes from the "Charged With" list (psir_profile.offenses.charged),
      // falling back to the legacy column the same way.
      res.json(rows.map((row) => {
        const offenses = (row.psir_profile && row.psir_profile.offenses) || {};
        const convicted = offenses.convicted || [];
        const offenseDate = convicted.find((o) => o && o.date)?.date;
        return {
          ...row,
          conviction_date: offenseDate || row.conviction_date,
          offense: composeCharged(offenses.charged) || row.offense,
        };
      }));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = buildReportsRouter;
