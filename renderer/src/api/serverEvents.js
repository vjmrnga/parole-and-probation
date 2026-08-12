// Renderer-side fan-out for real-time server push events. The single SSE
// connection lives in the main process (electron/eventStream.js); here we
// just (dis)connect it with the auth token and let any number of screens
// subscribe to the parsed events that arrive over IPC ('server-event').
//
// connect()/disconnect() are driven by auth state in App.jsx; subscribe() is
// used by screens (via the useServerEvents hook) to refetch when relevant
// data changes elsewhere.
const listeners = new Set();
let ipcUnsubscribe = null;

// Wire the single IPC listener the first time anyone needs events, then
// re-broadcast each event to every screen-level subscriber.
function ensureIpcWired() {
  if (ipcUnsubscribe) return;
  ipcUnsubscribe = window.api.onServerEvent((event) => {
    for (const fn of listeners) {
      try {
        fn(event);
      } catch (err) {
        // one misbehaving listener shouldn't stop the others
      }
    }
  });
}

export const serverEvents = {
  connect(token) {
    ensureIpcWired();
    window.api.subscribeServerEvents(token);
  },
  disconnect() {
    window.api.unsubscribeServerEvents();
  },
  subscribe(fn) {
    ensureIpcWired();
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
