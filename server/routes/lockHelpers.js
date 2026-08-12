// Shared check-out lock logic for every table that stores a file users can
// open, edit and save back in place (psir_reports, file_reports,
// records_check_files, document_checklist — all carry the locked_by/locked_at
// columns added in server/migrations/schema.js's NEW_LOCK_COLUMNS).
//
// The model is deliberately simple: one editor at a time. Acquiring a lock
// stamps locked_by = the current user and locked_at = now. A second user who
// tries to edit the same file is refused (409) with the holder's name, unless
// the existing lock is STALE — older than STALE_LOCK_MS, which happens when an
// editor's app crashed or was killed without releasing — in which case it's
// treated as free and taken over. The renderer releases the lock explicitly
// when the user clicks "Done", and the update endpoint refuses writes from
// anyone who isn't the current holder (see requireLock), so a stale-lock
// takeover can never let two people's edits silently clobber each other.
const { userNameSql } = require('../../shared/nameUtils');

// A lock older than this is considered abandoned and may be taken over. Long
// enough to cover a genuinely long editing session in Word, short enough that
// a crashed session doesn't strand a file for the rest of the day.
const STALE_LOCK_MS = 60 * 60 * 1000; // 1 hour

function isStale(lockedAt) {
  if (!lockedAt) return true;
  return Date.now() - new Date(lockedAt).getTime() > STALE_LOCK_MS;
}

// Loads the lock row for a record identified by an arbitrary WHERE clause
// (numeric id for the report tables, probationer_id + doc_key for the
// checklist), joined to the holder's name for friendly 409 messages.
async function loadLock(pool, table, whereSql, whereValues) {
  const [rows] = await pool.query(
    `SELECT t.locked_by, t.locked_at, ${userNameSql('u')} AS locked_by_name
       FROM ${table} t
       LEFT JOIN users u ON u.id = t.locked_by
      WHERE ${whereSql}`,
    whereValues
  );
  return rows[0] || null;
}

// Attempts to take the lock. Returns { ok: true } on success, or
// { ok: false, status, error } describing why not (404 missing row, 409 held
// by someone else with a live lock).
async function acquireLock(pool, table, whereSql, whereValues, userId) {
  const current = await loadLock(pool, table, whereSql, whereValues);
  if (!current) return { ok: false, status: 404, error: 'Not found' };

  const heldByOther = current.locked_by && current.locked_by !== userId;
  if (heldByOther && !isStale(current.locked_at)) {
    return {
      ok: false,
      status: 409,
      error: `This document is being edited by ${current.locked_by_name || 'another user'}.`,
      lockedByName: current.locked_by_name,
      lockedAt: current.locked_at,
    };
  }

  await pool.query(
    `UPDATE ${table} t SET t.locked_by = ?, t.locked_at = CURRENT_TIMESTAMP WHERE ${whereSql}`,
    [userId, ...whereValues]
  );
  return { ok: true };
}

// Releases the lock. A normal officer can only release their own lock; an
// admin can clear anyone's (used to break a stuck lock from the UI). Silently
// succeeds if the row is already free — releasing is idempotent.
async function releaseLock(pool, table, whereSql, whereValues, userId, isAdmin) {
  const current = await loadLock(pool, table, whereSql, whereValues);
  if (!current) return { ok: false, status: 404, error: 'Not found' };

  if (current.locked_by && current.locked_by !== userId && !isAdmin) {
    return {
      ok: false,
      status: 403,
      error: `Only ${current.locked_by_name || 'the current editor'} (or an admin) can release this lock.`,
    };
  }

  await pool.query(
    `UPDATE ${table} t SET t.locked_by = NULL, t.locked_at = NULL WHERE ${whereSql}`,
    whereValues
  );
  return { ok: true };
}

// Gate for the save-back endpoints: only the user currently holding a live
// lock may overwrite the file. Returns { ok: true } or a { status, error }
// describing the refusal — 409 if someone else holds it, or if the caller's
// own lock went stale (their session was gone long enough that the file may
// have been taken over, so they must re-open to edit again).
async function requireLock(pool, table, whereSql, whereValues, userId) {
  const current = await loadLock(pool, table, whereSql, whereValues);
  if (!current) return { ok: false, status: 404, error: 'Not found' };

  if (!current.locked_by || current.locked_by !== userId) {
    return {
      ok: false,
      status: 409,
      error: current.locked_by
        ? `This document is now being edited by ${current.locked_by_name || 'another user'}. Your changes were not saved.`
        : 'Your editing session has ended — re-open the document to make changes.',
    };
  }
  if (isStale(current.locked_at)) {
    return {
      ok: false,
      status: 409,
      error: 'Your editing session timed out — re-open the document to make changes.',
    };
  }
  return { ok: true };
}

// SELECT fragment the list endpoints append so the UI can render "In use by X"
// badges. Aliased off table alias `t` and joined against users alias `lu`.
function lockSelectSql(tableAlias = 'r', userAlias = 'lu') {
  return `${tableAlias}.locked_by, ${tableAlias}.locked_at, ${userNameSql(userAlias)} AS locked_by_name`;
}

module.exports = {
  STALE_LOCK_MS,
  isStale,
  acquireLock,
  releaseLock,
  requireLock,
  lockSelectSql,
};
