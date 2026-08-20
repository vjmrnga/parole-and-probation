// Thin wrapper around window.api.apiRequest (IPC → main process → Node
// http/https — see electron/apiProxy.js for why this can't be a plain
// fetch()). Every screen goes through ApiClient.request() so token
// attachment and error handling live in one place.
//
// The token is mirrored into sessionStorage so an accidental page reload
// doesn't silently log the user out — sessionStorage survives a reload but
// is cleared when the window/app actually closes. App.jsx re-validates the
// restored token against /auth/me before trusting it (see boot()).
const STORAGE_KEY = 'pp_session';

let token = null;
let currentUser = null;
// True when the user authenticated against the locally-cached credential
// because Head Office was unreachable (see loginOffline). In this state there
// is no server token, so only the offline attendance flow is usable.
let offlineMode = false;

try {
  const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
  if (saved && saved.token) {
    token = saved.token;
    currentUser = saved.user;
  }
} catch (err) {
  // corrupt/absent — just start logged out
}

function setSession(nextToken, user) {
  token = nextToken;
  currentUser = user;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token: nextToken, user }));
}

function clearSession() {
  token = null;
  currentUser = null;
  offlineMode = false;
  sessionStorage.removeItem(STORAGE_KEY);
}

function isOffline() {
  return offlineMode;
}

function getUser() {
  return currentUser;
}

// Exposed so App.jsx can hand the token to the real-time event stream
// (see renderer/src/api/serverEvents.js) once the user is authenticated.
function getToken() {
  return token;
}

function isLoggedIn() {
  return !!token;
}

// Fires when a 401 comes back tagged SESSION_REPLACED — i.e. this token was
// invalidated because the account signed in somewhere else (see
// server/middleware/auth.js). App.jsx registers a handler that bounces the
// user back to the login screen with an explanation, instead of the generic
// "please log in again" every other 401 gets.
let sessionReplacedListener = null;
function onSessionReplaced(fn) {
  sessionReplacedListener = fn;
}

// Fires when an authenticated (online) request can't reach Head Office at all
// (status 0) — i.e. the connection dropped mid-session. App.jsx uses this to
// show a "you're offline" notice and bounce back to the login screen, where the
// user can continue in offline attendance mode. Not fired during login itself
// (no token yet — LoginScreen handles that case) or while already offline.
let connectionLostListener = null;
function onConnectionLost(fn) {
  connectionLostListener = fn;
}

async function request(method, path, body) {
  const result = await window.api.apiRequest(method, path, body, token);
  if (result.status === 0) {
    const err = new Error((result.body && result.body.error) || 'Could not reach the server');
    err.status = 0;
    err.offline = true; // lets callers (e.g. LoginScreen) fall back to offline mode
    // An authenticated request that can't reach the server = mid-session
    // connection loss. Notify App so it can return the user to login.
    if (token && !offlineMode && connectionLostListener) {
      connectionLostListener();
    }
    throw err;
  }
  if (result.status === 401) {
    clearSession();
    const message = (result.body && result.body.error) || 'Session expired — please log in again';
    if (result.body && result.body.code === 'SESSION_REPLACED' && sessionReplacedListener) {
      sessionReplacedListener(message);
    }
    throw new Error(message);
  }
  if (result.status >= 400) {
    const err = new Error((result.body && result.body.error) || `Request failed (${result.status})`);
    err.status = result.status; // lets sync tell "already recorded" (409) apart from a real failure
    if (result.body) {
      err.code = result.body.code;
      err.device = result.body.device;
      err.since = result.body.since;
    }
    throw err;
  }
  return result.body;
}

// deviceName lets the server tell "signing in again on this same laptop"
// apart from "signing in on a different one" (see hasLiveConflictingSession
// in server/routes/auth.js). force:true skips the conflict check entirely —
// used when the user has confirmed the "sign out the other session?" modal.
async function login(username, password, { force = false } = {}) {
  const deviceName = await window.api.getDeviceName();
  const data = await request('POST', '/auth/login', { username, password, deviceName, force });
  setSession(data.token, data.user);
  offlineMode = false;
  // Cache this (now-verified) credential so the same officer can log in on this
  // PC while Head Office is unreachable — best-effort, never blocks login.
  window.api.cacheOfflineCredential({ user: data.user, password }).catch(() => {});
  return data.user;
}

// Fallback login used only when Head Office is unreachable: verifies the typed
// password against the bcrypt hash cached at the last successful online login
// (see electron/offlineStore.js). Grants a token-less, attendance-only session.
async function loginOffline(username, password) {
  const user = await window.api.verifyOfflineCredential({ username, password });
  if (!user) {
    const err = new Error(
      'No offline access is saved for this account on this PC. Connect to Head Office and sign in once to enable offline login.'
    );
    err.code = 'NO_OFFLINE_CREDENTIAL';
    throw err;
  }
  token = null;
  currentUser = user;
  offlineMode = true;
  return user;
}

// Public (no token) self-registration — see server/routes/auth.js's /signup.
// Never signs the requester in: the account sits 'pending' until an admin
// approves it in Manage Users, so there's no session to establish here.
async function signup({ username, email, password, confirmPassword, firstName, middleName, lastName, title }) {
  return request('POST', '/auth/signup', { username, email, password, confirmPassword, firstName, middleName, lastName, title });
}

async function bootstrapAdmin(username, password, { firstName, middleName, lastName }) {
  const deviceName = await window.api.getDeviceName();
  const data = await request('POST', '/auth/bootstrap-admin', {
    username,
    password,
    firstName,
    middleName,
    lastName,
    deviceName,
  });
  setSession(data.token, data.user);
  return data.user;
}

// Tells the server to end this session (so it stops warning about a
// conflict the next time someone logs in) before clearing local state.
// Best-effort — an unreachable server shouldn't block logging out locally.
async function logout() {
  try {
    if (token) await request('POST', '/auth/logout');
  } catch (err) {
    // already logged out locally regardless
  } finally {
    clearSession();
  }
}

export const ApiClient = {
  request,
  login,
  loginOffline,
  signup,
  bootstrapAdmin,
  logout,
  clearLocalSession: clearSession,
  onSessionReplaced,
  onConnectionLost,
  getUser,
  getToken,
  isLoggedIn,
  isOffline,
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path) => request('DELETE', path),
};
