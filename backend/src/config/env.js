/**
 * Environment validation.
 *
 * Fail fast at startup with a clear message when a required variable is
 * missing, instead of crashing later at the first Mongo / JWT / mailer
 * call. Called from `server.js` before `connectDB`.
 */
const REQUIRED = ['MONGO_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

// Optional but recommended — logged as warnings, don't block boot.
const RECOMMENDED = [
  'NODE_ENV',
  'PORT',
  'CLIENT_URL',
  'BIOMETRIC_POLL_INTERVAL_MS',
];

function validateEnv(logger) {
  const missing = REQUIRED.filter((k) => !process.env[k] || String(process.env[k]).trim() === '');
  if (missing.length) {
    // eslint-disable-next-line no-console
    console.error(`[env] Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (logger) {
    for (const k of RECOMMENDED) {
      if (!process.env[k]) logger.warn(`[env] ${k} is not set — using default.`);
    }
    // JWT secret strength sanity check (production only).
    if (process.env.NODE_ENV === 'production') {
      if (String(process.env.JWT_ACCESS_SECRET).length < 32) {
        logger.warn('[env] JWT_ACCESS_SECRET is shorter than 32 chars — increase entropy for production.');
      }
      if (String(process.env.JWT_REFRESH_SECRET).length < 32) {
        logger.warn('[env] JWT_REFRESH_SECRET is shorter than 32 chars — increase entropy for production.');
      }
    }
  }
}

module.exports = { validateEnv };
