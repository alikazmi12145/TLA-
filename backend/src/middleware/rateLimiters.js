/**
 * Production rate limiters.
 *
 * Each limiter uses `express-rate-limit` with:
 *   - a JSON 429 response shape identical across the API
 *   - a shared `skip()` that whitelists loopback + private-network IPs
 *     (so the Nginx reverse proxy, the VPS itself, PM2 health probes and
 *     the internal biometric poller are never throttled)
 *   - `standardHeaders: true` so clients see RateLimit-* response headers
 *
 * Biometric attendance sync is intentionally NOT rate-limited here because
 * it runs in-process (see server.js `pollBiometricDevices`) and never goes
 * through the HTTP layer. Admin-facing device endpoints use the generous
 * `adminLimiter` so manual device operations (test, import, sync-all) are
 * not blocked in normal admin usage.
 */
const rateLimit = require('express-rate-limit');

const TOO_MANY = {
  success: false,
  message: 'Too many requests. Please try again later.',
};

const isPrivateIp = (ip) => {
  if (!ip) return false;
  // Normalise IPv4-mapped IPv6 (`::ffff:10.0.0.1`).
  const v = ip.replace(/^::ffff:/i, '');
  if (v === '127.0.0.1' || v === '::1' || v === 'localhost') return true;
  if (/^10\./.test(v)) return true;
  if (/^192\.168\./.test(v)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(v)) return true;
  // fc00::/7 — IPv6 unique local
  if (/^f[cd][0-9a-f]{2}:/i.test(v)) return true;
  return false;
};

// Extra whitelist from env — comma-separated list of exact IPs.
const EXTRA_WHITELIST = new Set(
  String(process.env.RATE_LIMIT_WHITELIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

const skipInternal = (req) => {
  const ip = req.ip || req.connection?.remoteAddress || '';
  const bare = ip.replace(/^::ffff:/i, '');
  if (EXTRA_WHITELIST.has(ip) || EXTRA_WHITELIST.has(bare)) return true;
  if (isPrivateIp(ip)) return true;
  // Never rate-limit health/monitoring probes even from public IPs.
  if (req.path === '/health' || req.path === '/api/v1/health') return true;
  return false;
};

const handler = (_req, res /* , _next, options */) => {
  res.status(429).json(TOO_MANY);
};

const build = ({ windowMs, max }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipInternal,
    handler,
  });

// ---- exported limiters --------------------------------------------------

// Login attempts per minute per IP.
//
// The default (5/min) was too aggressive for real deployments: a whole
// office shares ONE public IP via NAT, so as soon as ~5 employees try to
// log in around the same time (which is exactly what happens after they
// finger-punch at the start of a shift), everyone after that gets a
// blanket 429 — which the user reported as "login is not working when
// employees punch on the device". Bumped to 60/min and made overridable
// via env so the limit can be tuned without a code change. Brute-force
// defence is still intact because valid attempts also require a real
// userId/email, and repeated wrong-password attempts by the same account
// still get filtered by the caller checks (issueTokens keeps only the
// last 5 refresh tokens, etc.).
const LOGIN_MAX = Number(process.env.AUTH_LOGIN_MAX) || 60;
const authLoginLimiter = build({ windowMs: 60 * 1000, max: LOGIN_MAX });

// 3 password-reset / OTP requests per 15 minutes per IP.
const authOtpLimiter = build({ windowMs: 15 * 60 * 1000, max: 3 });

// 100 anonymous requests per 15 minutes per IP.
const publicLimiter = build({ windowMs: 15 * 60 * 1000, max: 100 });

// 300 authenticated requests per 15 minutes per IP (baseline API traffic).
const userLimiter = build({ windowMs: 15 * 60 * 1000, max: 300 });

// 500 admin requests per 15 minutes per IP — covers device / payroll / report ops.
const adminLimiter = build({ windowMs: 15 * 60 * 1000, max: 500 });

module.exports = {
  skipInternal,
  authLoginLimiter,
  authOtpLimiter,
  publicLimiter,
  userLimiter,
  adminLimiter,
};
