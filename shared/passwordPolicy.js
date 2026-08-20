// Single source of truth for the account password policy, enforced by every
// route that sets or changes a password: server/routes/auth.js's /signup
// and server/routes/users.js's create/PATCH/reset-password. The renderer
// mirrors this same rule in its own form validation (LoginScreen.jsx,
// ManageUsersView.jsx) so a bad password is rejected before it's ever
// submitted — renderer code can't require() this file directly (it isn't
// bundled into the browser build, see shared/statusEnums.js's getEnums()
// IPC pattern for why), so keep both copies in sync if this changes.
const PASSWORD_MIN_LENGTH = 8;

const PASSWORD_POLICY_DESCRIPTION = `At least ${PASSWORD_MIN_LENGTH} characters, including at least one letter and one number.`;

function isPasswordValid(password) {
  return (
    typeof password === 'string' &&
    password.length >= PASSWORD_MIN_LENGTH &&
    /[A-Za-z]/.test(password) &&
    /[0-9]/.test(password)
  );
}

module.exports = { PASSWORD_MIN_LENGTH, PASSWORD_POLICY_DESCRIPTION, isPasswordValid };
