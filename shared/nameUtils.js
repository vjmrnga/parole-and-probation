// Name helpers shared across the server (CommonJS). The renderer keeps its own
// ESM copy of composeName (renderer/src/utils/composeName.js) since Vite/CJS
// interop is messy — keep the two composeName implementations in sync.

// "Last, First Middle" or "First Middle Last" — best-effort split used only to
// backfill/import legacy single-string names into the first/middle/last
// columns; every consumer surfaces these as editable fields afterward, so a
// wrong guess here never silently sticks.
function splitName(fullName) {
  const empty = { lastName: '', firstName: '', middleName: '' };
  if (!fullName) return empty;
  if (fullName.includes(',')) {
    const [last, rest] = fullName.split(',').map((s) => s.trim());
    const [first, ...mid] = (rest || '').split(/\s+/).filter(Boolean);
    return { lastName: last || '', firstName: first || '', middleName: mid.join(' ') };
  }
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { lastName: parts[0], firstName: '', middleName: '' };
  return { lastName: parts[parts.length - 1], firstName: parts[0], middleName: parts.slice(1, -1).join(' ') };
}

// SQL expression composing the stored name parts as "Last, First Middle" for
// list/attendance queries that still surface one name string. NULLIF drops the
// trailing comma when first+middle are both empty; the inner CONCAT_WS drops a
// blank middle name. `alias` is the probationers table alias in the query.
function probationerNameSql(alias = 'p') {
  return `CONCAT_WS(', ', ${alias}.last_name, NULLIF(TRIM(CONCAT_WS(' ', ${alias}.first_name, ${alias}.middle_name)), ''))`;
}

// SQL expression composing a user's stored name parts as "First Middle Last"
// (natural order) — used by every query that still surfaces one officer-name
// string (assigned_officer_name, generated_by_name, changed_by_name). Kept in
// natural order rather than "Last, First" so it matches how the old free-text
// full_name column read, and so officer pickers/imports keep matching. `alias`
// is the users table alias in the query.
function userNameSql(alias = 'u') {
  return `TRIM(CONCAT_WS(' ', ${alias}.first_name, ${alias}.middle_name, ${alias}.last_name))`;
}

// JS equivalent of userNameSql() for composing a user's name from its parts
// (used when building login/bootstrap response payloads). Mirror the ordering.
function composeUserName(u) {
  if (!u) return '';
  return [u.first_name, u.middle_name, u.last_name].map((s) => (s || '').trim()).filter(Boolean).join(' ');
}

module.exports = { splitName, probationerNameSql, userNameSql, composeUserName };
