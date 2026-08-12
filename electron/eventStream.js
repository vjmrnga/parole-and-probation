// Holds a single long-lived Server-Sent-Events connection to /api/events on
// whichever server this instance talks to (Head Office over loopback, or the
// paired Head Office for a Branch) and forwards each parsed event to the
// caller. This is the client half of server/events.js.
//
// It rides Node's https module rather than the renderer's EventSource for the
// same reason electron/apiProxy.js exists: Chromium can't be told to trust our
// self-signed / pinned certificate, but Node's https.Agent can (see
// electron/certPinning.js). The parsed events are handed to main.js, which
// relays them to the renderer over IPC ('server-event').
const https = require('https');
const { resolveTarget } = require('./apiProxy');

const RECONNECT_DELAY_MS = 3000;

// Opens the stream and keeps it open, reconnecting on any drop until stop() is
// called. Returns that stop function. `onEvent(payload)` fires once per parsed
// event frame.
function startEventStream({ token, settingsStore, userDataPath, onEvent }) {
  let stopped = false;
  let activeReq = null;
  let reconnectTimer = null;

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_DELAY_MS);
  }

  function connect() {
    if (stopped) return;

    let target;
    try {
      target = resolveTarget({ settingsStore, userDataPath });
    } catch (err) {
      // Not configured / not paired yet — try again shortly.
      scheduleReconnect();
      return;
    }

    const { hostname, port, agent } = target;
    activeReq = https.request(
      {
        hostname,
        port,
        path: '/api/events',
        method: 'GET',
        agent,
        headers: {
          Accept: 'text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume(); // drain so the socket can be freed
          scheduleReconnect();
          return;
        }

        res.setEncoding('utf8');
        let buffer = '';
        res.on('data', (chunk) => {
          // SSE frames are separated by a blank line. Buffer until we have a
          // whole frame, then pull out its data: lines (comments like the
          // heartbeat start with ':' and are ignored).
          buffer += chunk.replace(/\r\n/g, '\n');
          let sep;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const data = frame
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).replace(/^ /, ''))
              .join('\n');
            if (!data) continue; // heartbeat / comment-only frame
            try {
              onEvent(JSON.parse(data));
            } catch (err) {
              // ignore a malformed frame rather than tearing down the stream
            }
          }
        });
        res.on('end', scheduleReconnect);
        res.on('error', scheduleReconnect);
      }
    );

    activeReq.on('error', scheduleReconnect);
    activeReq.end();
  }

  connect();

  return function stop() {
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (activeReq) {
      activeReq.destroy();
      activeReq = null;
    }
  };
}

module.exports = { startEventStream };
