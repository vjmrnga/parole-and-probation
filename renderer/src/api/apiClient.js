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
  sessionStorage.removeItem(STORAGE_KEY);
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

async function request(method, path, body) {
  const result = await window.api.apiRequest(method, path, body, token);
  if (result.status === 0) {
    throw new Error((result.body && result.body.error) || 'Could not reach the server');
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
  return data.user;
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
  bootstrapAdmin,
  logout,
  onSessionReplaced,
  getUser,
  getToken,
  isLoggedIn,
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path) => request('DELETE', path),
};
