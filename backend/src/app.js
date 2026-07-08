const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const rateLimit = require('express-rate-limit');

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
const routes = require('./routes');

const app = express();

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

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600 });
app.use('/api', limiter);

// Static for uploaded files (profile pics, payslips, etc.)
// Use the same absolute path multer writes to so uploads never 404 after save,
// regardless of the process CWD (matters under PM2 / systemd).
app.use('/uploads', express.static(uploadDir));

app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/v1', routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
