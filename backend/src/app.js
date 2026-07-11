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

// Health check — never rate-limited, never authenticated.
app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

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
