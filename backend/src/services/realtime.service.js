/**
 * Realtime service — thin socket.io singleton.
 *
 * The rest of the app calls `emit(event, payload)` without caring whether
 * socket.io has been initialised. Emits become no-ops until `init(server)`
 * has been called (e.g. under unit tests). This keeps modules pure and
 * side-effect free at require time.
 *
 * Events (see spec section 5):
 *   device-online, device-offline, device-reconnected,
 *   attendance-import-started, attendance-import-finished,
 *   attendance-import-failed, attendance-created.
 */
const logger = require('../utils/logger');
// eslint-disable-next-line global-require
const jwt = require('jsonwebtoken');

let io = null;

// userId -> Set<socketId>. Lets us broadcast to a single user's tabs and
// gives us an accurate connection count for observability.
const userSockets = new Map();
// Socket-inactivity watchdog: sockets that don't emit for > IDLE_MS are
// disconnected server-side so a stale tab can never keep a socket alive
// indefinitely on the VPS.
const IDLE_MS = Number(process.env.SOCKET_IDLE_MS || 30 * 60_000); // 30 min

/**
 * Attach socket.io to the given HTTP server. Idempotent — a second call
 * with the same server is a no-op. CORS origin follows CLIENT_URL (the
 * same env variable used by Express CORS) and defaults to Vite's dev port.
 */
const init = (httpServer) => {
  if (io) return io;
  // Lazy require so the module can boot in environments where socket.io
  // isn't installed (tests, scripts).
  // eslint-disable-next-line global-require
  const { Server } = require('socket.io');
  const origins = (process.env.CLIENT_URL || 'http://localhost:5173').split(',');
  io = new Server(httpServer, {
    cors: { origin: origins, credentials: true },
    // Long-poll fallback stays enabled; websocket preferred.
    transports: ['websocket', 'polling'],
    // Match the existing HTTP keep-alive tune so infra doesn't cut early.
    pingInterval: 25_000,
    pingTimeout: 60_000,
  });

  // ----------------------------------------------------------------
  // Handshake middleware — best-effort JWT auth.
  //
  // When a token is presented (browser bridge attaches it), we verify it
  // and stash the userId on `socket.data`. Unauth'd sockets are still
  // allowed unless `SOCKET_AUTH=required` (so scripts / health probes
  // don't break). Room-based fan-out uses the stamped userId when set.
  // ----------------------------------------------------------------
  const authRequired = String(process.env.SOCKET_AUTH || '').toLowerCase() === 'required';
  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.query?.token ||
        (socket.handshake.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!token) {
        if (authRequired) return next(new Error('unauthorized'));
        return next();
      }
      const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      socket.data.userId = String(payload.id || payload.userId || payload.sub || '');
      socket.data.role = payload.role || null;
      return next();
    } catch (err) {
      if (authRequired) return next(new Error('unauthorized'));
      // Non-strict: silently downgrade to anonymous — same behaviour as
      // before the auth layer existed, so no client is broken.
      return next();
    }
  });

  io.on('connection', (socket) => {
    const uid = socket.data.userId;
    logger.info(`[realtime] client connected: ${socket.id}${uid ? ` (user=${uid})` : ' (anon)'}`);

    // Room per user — enables targeted invalidations later without
    // broadcasting user-specific data to every tab. Every socket also
    // joins the "all" broadcast room.
    if (uid) {
      socket.join(`user:${uid}`);
      let set = userSockets.get(uid);
      if (!set) { set = new Set(); userSockets.set(uid, set); }
      set.add(socket.id);
    }

    // Idle watchdog — reset on any inbound event.
    let idleTimer = setTimeout(() => {
      try { socket.disconnect(true); } catch { /* ignore */ }
    }, IDLE_MS);
    if (idleTimer.unref) idleTimer.unref();
    socket.onAny(() => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        try { socket.disconnect(true); } catch { /* ignore */ }
      }, IDLE_MS);
      if (idleTimer.unref) idleTimer.unref();
    });

    socket.on('disconnect', (reason) => {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      if (uid) {
        const set = userSockets.get(uid);
        if (set) {
          set.delete(socket.id);
          if (set.size === 0) userSockets.delete(uid);
        }
      }
      logger.info(`[realtime] client disconnected: ${socket.id} (${reason})`);
    });
  });
  logger.info('[realtime] socket.io initialised');
  return io;
};

/** Emit an event to every connected client. Safe before init(). */
const emit = (event, payload) => {
  if (!io) return false;
  try {
    io.emit(event, payload);
    return true;
  } catch (err) {
    logger.warn(`[realtime] emit(${event}) failed: ${err.message}`);
    return false;
  }
};

/** Emit an event to every socket belonging to a specific user. */
const emitToUser = (userId, event, payload) => {
  if (!io || !userId) return false;
  try {
    io.to(`user:${userId}`).emit(event, payload);
    return true;
  } catch (err) {
    logger.warn(`[realtime] emitToUser(${userId}, ${event}) failed: ${err.message}`);
    return false;
  }
};

const getIO = () => io;
const getStats = () => ({
  users: userSockets.size,
  sockets: Array.from(userSockets.values()).reduce((n, s) => n + s.size, 0),
});

module.exports = { init, emit, emitToUser, getIO, getStats };
