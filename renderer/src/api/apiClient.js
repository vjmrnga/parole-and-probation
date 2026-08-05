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

function isLoggedIn() {
  return !!token;
}

async function request(method, path, body) {
  const result = await window.api.apiRequest(method, path, body, token);
  if (result.status === 0) {
    throw new Error((result.body && result.body.error) || 'Could not reach the server');
  }
  if (result.status === 401) {
    clearSession();
    throw new Error((result.body && result.body.error) || 'Session expired — please log in again');
  }
  if (result.status >= 400) {
    throw new Error((result.body && result.body.error) || `Request failed (${result.status})`);
  }
  return result.body;
}

async function login(username, password) {
  const data = await request('POST', '/auth/login', { username, password });
  setSession(data.token, data.user);
  return data.user;
}

async function bootstrapAdmin(username, password, fullName) {
  const data = await request('POST', '/auth/bootstrap-admin', { username, password, fullName });
  setSession(data.token, data.user);
  return data.user;
}

export const ApiClient = {
  request,
  login,
  bootstrapAdmin,
  logout: clearSession,
  getUser,
  isLoggedIn,
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path) => request('DELETE', path),
};
