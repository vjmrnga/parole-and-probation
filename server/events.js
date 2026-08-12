// Real-time push (Server-Sent Events). The Head Office HTTPS server is the
// single process every client connects to — local Head Office and every
// Branch Office alike — so this one in-process registry of open connections
// is the whole fan-out. A write route calls broadcast(...) and every screen
// currently listening (see electron/eventStream.js → renderer/src/api/
// serverEvents.js) hears about it and refetches, no manual refresh needed.
//
// This lives on the server as a plain streaming HTTP response rather than any
// WebSocket library: it's one-way (server → client), rides the existing
// HTTPS server / JWT auth / self-signed cert with no new port or dependency,
// and the client half is Node's https module (Chromium's EventSource can't
// trust our cert — same reason electron/apiProxy.js exists).

// The open Express `res` objects, one per connected client.
const clients = new Set();

// Express handler for GET /api/events. Authenticated like any other route
// (see the mount in server/app.js), but instead of returning JSON once it
// holds the connection open and streams events until the client disconnects.
function sseHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    // Tell any reverse proxy in front not to buffer the stream (harmless when
    // there isn't one, which is the usual LAN deployment here).
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n'); // client's reconnect delay hint (ms)
  res.write(': connected\n\n'); // a comment frame — ignored by the parser, just opens the stream

  // Node closes idle sockets by default; this connection is meant to stay
  // open indefinitely, so clear the timeout and send data as soon as written.
  req.socket.setTimeout(0);
  if (res.socket) res.socket.setNoDelay(true);

  clients.add(res);

  // Heartbeat comment every 25s so an idle connection isn't dropped by any
  // intermediary (or Node itself) as apparently dead.
  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
}

// Fan a change event out to every connected client. Fire-and-forget: a write
// to a dead socket just throws here and is swallowed — that socket's own
// 'close' handler removes it from the set.
function broadcast(payload) {
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try {
      res.write(frame);
    } catch (err) {
      // ignore — the 'close' handler cleans it up
    }
  }
}

module.exports = { sseHandler, broadcast };
