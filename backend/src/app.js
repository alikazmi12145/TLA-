const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');

// Node >= 22 makes req.query a read-only getter, which breaks middleware that
// reassigns it (express-mongo-sanitize, xss-clean). Sanitize body/params in place.
const sanitizeRequest = (req, _res, next) => {
  if (req.body) mongoSanitize.sanitize(req.body, { replaceWith: '_' });
  if (req.params) mongoSanitize.sanitize(req.params, { replaceWith: '_' });
  next();
};

const errorHandler = require('./middleware/errorHandler');
const notFound = require('./middleware/notFound');
const { uploadDir } = require('./middleware/upload');
const {
  publicLimiter,
  userLimiter,
  adminLimiter,
} = require('./middleware/rateLimiters');
const routes = require('./routes');

const app = express();

// Trust the first proxy hop (Nginx / load balancer) so `req.ip` reflects the
// real client IP for rate limiting. `1` is safe when there is exactly ONE
// reverse proxy in front of Node; increase if the deployment stacks more.
app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(
  cors({
    origin: (process.env.CLIENT_URL || 'http://localhost:5173').split(','),
    credentials: true,
  })
);
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(cookieParser());
app.use(compression());
app.use(sanitizeRequest);
app.use(hpp());
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// Static for uploaded files (profile pics, payslips, etc.)
// Use the same absolute path multer writes to so uploads never 404 after save,
// regardless of the process CWD (matters under PM2 / systemd).
app.use('/uploads', express.static(uploadDir));

// -----------------------------------------------------------------
// Missing-upload fallback.
//
// When a User / Setting document references an upload path that was
// deleted from disk (manual cleanup, restore-from-backup drift, file
// system corruption, orphan payslip PDFs, etc.) the browser fires a
// `GET /uploads/profiles/xyz.png` that produces a red 404 in dev-tools
// on every page load — even though MUI's <Avatar> already falls back to
// the initials children on `onError`. The 404 itself is real HTTP; the
// only way to silence it is to return a valid response.
//
// We return a 1×1 transparent PNG with a short cache header so the
// browser doesn't hammer us on every re-render, and log a warn so ops
// can spot orphaned references and clean them up when convenient.
// This ONLY runs when express.static above did NOT find the file
// (fallthrough default), so it doesn't hide real assets.
// -----------------------------------------------------------------
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);
const _loggedMissingUploads = new Set();
app.use('/uploads', (req, res) => {
  // De-dupe log spam — one warn per unique missing path per process boot.
  if (!_loggedMissingUploads.has(req.path)) {
    _loggedMissingUploads.add(req.path);
    // Cap the memoization set so a runaway drift can't leak memory.
    if (_loggedMissingUploads.size > 500) _loggedMissingUploads.clear();
    // eslint-disable-next-line no-console
    console.warn(`[uploads] missing file served as placeholder: ${req.path}`);
  }
  res.set('Cache-Control', 'public, max-age=300');
  res.type('image/png').send(TRANSPARENT_PNG);
});

// -----------------------------------------------------------------
// Health check — never rate-limited, never authenticated.
//
// Two flavours:
//   GET /health           → liveness probe (200 as long as the process
//                           is up). Cheap enough for k8s / PM2 to hit
//                           every second without touching Mongo.
//   GET /health/status    → readiness probe. Reports Mongo connection
//                           state, socket.io connected clients, and
//                           per-device biometric health. Also returns
//                           process uptime + rss memory for dashboards.
// Both never log any request-scoped user data and never rate-limit.
// -----------------------------------------------------------------
const mongoose = require('mongoose');
app.get('/health', (_req, res) => {
  const ok = mongoose.connection.readyState === 1; // 1 = connected
  res
    .status(ok ? 200 : 503)
    .json({ status: ok ? 'ok' : 'degraded', time: new Date().toISOString() });
});

app.get('/health/status', async (_req, res) => {
  // Lazy-require so cyclic loads never break liveness.
  // eslint-disable-next-line global-require
  const Device = require('./models/Device');
  // eslint-disable-next-line global-require
  const realtime = require('./services/realtime.service');

  const mongoState = ['disconnected', 'connected', 'connecting', 'disconnecting'][
    mongoose.connection.readyState
  ] || 'unknown';
  const mongoOk = mongoose.connection.readyState === 1;

  let devices = [];
  try {
    devices = await Device.find({ enabled: true })
      .select('name ip online status lastSeen lastLatency averageLatency failureCount')
      .lean();
  } catch { /* mongo down → empty list */ }

  const mem = process.memoryUsage();
  const overallOk = mongoOk && devices.every((d) => d.online !== false);

  res.status(overallOk ? 200 : 503).json({
    status: overallOk ? 'ok' : 'degraded',
    time: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    mongo: { state: mongoState, ok: mongoOk },
    realtime: realtime.getStats ? realtime.getStats() : { users: 0, sockets: 0 },
    memory: {
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
    },
    devices: devices.map((d) => ({
      name: d.name,
      ip: d.ip,
      online: d.online === true,
      status: d.status || 'UNKNOWN',
      lastSeen: d.lastSeen,
      lastLatency: d.lastLatency || 0,
      averageLatency: d.averageLatency || 0,
      failureCount: d.failureCount || 0,
    })),
  });
});

// -------- Rate limiting ---------------------------------------------------
// Public-tier baseline for every /api/v1 hit. Auth routes layer their own
// tighter limits on top (login: 5/min, OTP: 3/15m — see auth.routes.js).
// Admin-heavy prefixes get the generous `adminLimiter` so bulk operations
// (device sync, payroll runs, reports) don't get blocked in normal use.
// The `skip()` inside each limiter whitelists 127.0.0.1 + private-network
// IPs so the reverse proxy and internal services are never throttled.
app.use('/api', publicLimiter);
app.use('/api/v1/devices', adminLimiter);
app.use('/api/v1/payroll', adminLimiter);
app.use('/api/v1/reports', adminLimiter);
app.use('/api/v1/employees', userLimiter);
app.use('/api/v1/attendance', userLimiter);
app.use('/api/v1/leaves', userLimiter);
app.use('/api/v1/notifications', userLimiter);
app.use('/api/v1/dashboard', userLimiter);

app.use('/api/v1', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
