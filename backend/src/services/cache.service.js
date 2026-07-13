/**
 * Cache service — Redis-ready layer with an in-memory fallback.
 *
 * Goal: give the app a single, injection-free `cache.get / set / del /
 * getOrSet(key, ttl, loader)` surface without forcing Redis to be
 * installed. When `REDIS_URL` is set AND the `ioredis` package is
 * available, we connect and use Redis. Otherwise every call falls back
 * to an in-process LRU-ish Map with per-key TTL. The application
 * behaviour is identical either way — Redis just improves cross-process
 * cache-hit rates (only relevant if you later scale beyond `instances: 1`).
 *
 * Nothing in the app *requires* this module; controllers can wrap hot
 * reads with `cache.getOrSet(...)` opportunistically. Because we never
 * throw on cache failures, adding it as an optimisation cannot break a
 * business flow.
 */
const logger = require('../utils/logger');

const REDIS_URL = process.env.REDIS_URL || '';
const MAX_LOCAL_KEYS = Number(process.env.CACHE_MAX_LOCAL_KEYS || 5000);

let redis = null;
let usingRedis = false;

const tryConnectRedis = () => {
  if (!REDIS_URL) return;
  try {
    // eslint-disable-next-line global-require, import/no-unresolved
    const Redis = require('ioredis');
    redis = new Redis(REDIS_URL, {
      lazyConnect: false,
      // Silent, capped reconnects. Never throw at boot.
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
    });
    redis.on('error', (err) => {
      // First error also flips us back to in-memory mode; subsequent
      // errors are logged once at debug level to avoid log spam.
      if (usingRedis) {
        logger.warn(`[cache] redis error, falling back to in-memory: ${err.message}`);
        usingRedis = false;
      }
    });
    redis.on('connect', () => {
      usingRedis = true;
      logger.info(`[cache] connected to Redis (${REDIS_URL.replace(/:[^:@/]+@/, ':***@')})`);
    });
  } catch (err) {
    logger.info(`[cache] Redis not installed — using in-memory cache (${err.message})`);
    redis = null;
    usingRedis = false;
  }
};
tryConnectRedis();

// --------------------------------------------------------------------
// In-memory tier — insertion-order Map with per-key expiry. Bounded by
// MAX_LOCAL_KEYS so it can never grow unbounded even under a bad key
// pattern.
// --------------------------------------------------------------------
const mem = new Map(); // key -> { v, exp }

const memGet = (key) => {
  const e = mem.get(key);
  if (!e) return undefined;
  if (e.exp && e.exp < Date.now()) { mem.delete(key); return undefined; }
  return e.v;
};
const memSet = (key, value, ttlMs) => {
  if (mem.size >= MAX_LOCAL_KEYS) {
    // Drop the oldest N entries at once — Map preserves insertion order.
    const drop = Math.max(1, Math.floor(MAX_LOCAL_KEYS * 0.1));
    let i = 0;
    for (const k of mem.keys()) {
      if (i++ >= drop) break;
      mem.delete(k);
    }
  }
  mem.set(key, { v: value, exp: ttlMs > 0 ? Date.now() + ttlMs : 0 });
};

// --------------------------------------------------------------------
// Public API — always non-throwing.
// --------------------------------------------------------------------

const get = async (key) => {
  try {
    if (usingRedis && redis) {
      const raw = await redis.get(key);
      return raw == null ? undefined : JSON.parse(raw);
    }
  } catch { /* fall through to memory */ }
  return memGet(key);
};

const set = async (key, value, ttlSec = 60) => {
  const ttlMs = Number(ttlSec) * 1000;
  try {
    if (usingRedis && redis) {
      await redis.set(key, JSON.stringify(value), 'PX', ttlMs);
      return;
    }
  } catch { /* fall through to memory */ }
  memSet(key, value, ttlMs);
};

const del = async (key) => {
  try {
    if (usingRedis && redis) await redis.del(key);
  } catch { /* ignore */ }
  mem.delete(key);
};

/**
 * getOrSet — the workhorse. Returns cached value if present, otherwise
 * calls `loader()`, caches the result, and returns it. The loader is
 * only invoked on a cache miss, and loader errors bypass the cache
 * (they still surface to the caller).
 */
const getOrSet = async (key, ttlSec, loader) => {
  const hit = await get(key);
  if (hit !== undefined) return hit;
  const value = await loader();
  if (value !== undefined) await set(key, value, ttlSec);
  return value;
};

const isReady = () => usingRedis;

const disconnect = async () => {
  try { if (redis) await redis.quit(); } catch { /* ignore */ }
  redis = null;
  usingRedis = false;
  mem.clear();
};

module.exports = { get, set, del, getOrSet, isReady, disconnect };
