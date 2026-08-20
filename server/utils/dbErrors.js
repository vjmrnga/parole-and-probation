// Shared by every route that inserts/updates a users row with a UNIQUE
// column (server/routes/auth.js's /signup, server/routes/users.js's create
// and PATCH). MySQL's duplicate-key error names the column ("Duplicate
// entry '...' for key 'users.username'" / '...email'), which is the only
// way to tell a clashing username apart from a clashing email — both are
// UNIQUE and both raise the same ER_DUP_ENTRY code.
function duplicateFieldMessage(err) {
  const msg = err.sqlMessage || err.message || '';
  if (/email/i.test(msg)) return 'An account with that email already exists';
  if (/username/i.test(msg)) return 'Username already taken';
  return 'That username or email is already in use';
}

module.exports = { duplicateFieldMessage };
