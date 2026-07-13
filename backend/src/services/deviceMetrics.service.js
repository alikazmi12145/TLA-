/**
 * Device metrics recorder.
 *
 * Every biometric op (ping, getInfo, createUser, getAttendance, …) fires a
 * `record()` call. To avoid one Mongo write per op — which would dwarf the
 * cost of the op itself on a busy device — deltas are accumulated in memory
 * and flushed every FLUSH_MS. On shutdown, `flush()` drains the buffer.
 *
 * This module never throws — a failed flush is logged and the buffer is
 * retained for the next tick.
 */
const deviceRepo = require('../repositories/device.repository');
const logger = require('../utils/logger');
// Lazy import through require cache — pulling Device once at module-load
// keeps the flush loop allocation-free (no per-tick require()).
const Device = require('../models/Device');

const FLUSH_MS = Number(process.env.DEVICE_METRICS_FLUSH_MS || 5000);
// Max flush attempts for a bucket before we drop it. Prevents an infinite
// re-merge (and unbounded growth of `pending`) when a device has been
// removed from Mongo but ops keep firing before its state bucket is pruned.
const MAX_FLUSH_ATTEMPTS = 5;

// deviceId -> pending delta bucket
const pending = new Map();

const bucketFor = (id) => {
  const k = String(id);
  let b = pending.get(k);
  if (!b) {
    b = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      failureCount: 0,
      latencySum: 0,
      latencySamples: 0,
      lastLatency: 0,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastSeen: null,
      lastError: null,
      attempts: 0,
    };
    pending.set(k, b);
  }
  return b;
};

/**
 * Buffer a metric. `ok=true` marks success (increments successfulRequests),
 * `ok=false` marks failure. Latency in ms.
 */
const record = ({ deviceId, ok, latencyMs = 0, error = null } = {}) => {
  if (!deviceId) return;
  const b = bucketFor(deviceId);
  b.totalRequests += 1;
  const now = new Date();
  if (ok) {
    b.successfulRequests += 1;
    b.latencySum += Number(latencyMs) || 0;
    b.latencySamples += 1;
    b.lastLatency = Number(latencyMs) || 0;
    b.lastSuccessAt = now;
    b.lastSeen = now;
    b.lastError = null;
  } else {
    b.failedRequests += 1;
    b.failureCount += 1;
    b.lastFailureAt = now;
    b.lastError = error && error.message ? error.message : String(error || 'unknown');
  }
};

/** Push all buffered deltas to Mongo. Safe to call at any time. */
const flush = async () => {
  if (pending.size === 0) return;
  const snapshot = Array.from(pending.entries());
  pending.clear();
  await Promise.all(
    snapshot.map(async ([id, b]) => {
      try {
        const set = {};
        if (b.lastLatency) set.lastLatency = b.lastLatency;
        if (b.lastSuccessAt) set.lastSuccessAt = b.lastSuccessAt;
        if (b.lastFailureAt) set.lastFailureAt = b.lastFailureAt;
        if (b.lastSeen) set.lastSeen = b.lastSeen;
        if (b.lastError !== null) set.lastError = b.lastError;

        // Compute new moving average using $inc + a follow-up read. We keep
        // the two-step pattern used in the repository so parallel writers
        // never lose samples.
        const t = await deviceRepo.updateTelemetry(id, set);
        // Device was removed from Mongo — abandon this bucket rather than
        // retry forever (that would grow `pending` without bound).
        if (!t) return;
        const updated = await Device.findByIdAndUpdate(
          id,
          {
            $inc: {
              totalRequests: b.totalRequests,
              successfulRequests: b.successfulRequests,
              failedRequests: b.failedRequests,
              failureCount: b.failureCount,
            },
          },
          { new: true, projection: 'successfulRequests averageLatency' }
        ).lean();
        if (updated && b.latencySamples > 0) {
          const n = Math.max(1, updated.successfulRequests || b.latencySamples);
          const prev = Number(updated.averageLatency) || 0;
          const avg = prev + (b.latencySum / b.latencySamples - prev) / n;
          await Device.updateOne({ _id: id }, { $set: { averageLatency: Math.round(avg) } });
        }
      } catch (err) {
        logger.warn(`[metrics] flush failed for device ${id}: ${err.message}`);
        // Re-merge failed bucket so we retry on the next flush — but only
        // up to MAX_FLUSH_ATTEMPTS so a permanently-broken write path
        // (e.g. deleted _id) cannot grow the pending map indefinitely.
        if ((b.attempts || 0) + 1 >= MAX_FLUSH_ATTEMPTS) {
          logger.warn(`[metrics] dropping bucket for ${id} after ${MAX_FLUSH_ATTEMPTS} failed flushes`);
          return;
        }
        const cur = bucketFor(id);
        cur.attempts = (b.attempts || 0) + 1;
        cur.totalRequests += b.totalRequests;
        cur.successfulRequests += b.successfulRequests;
        cur.failedRequests += b.failedRequests;
        cur.failureCount += b.failureCount;
        cur.latencySum += b.latencySum;
        cur.latencySamples += b.latencySamples;
      }
    })
  );
};

let _timer = null;
const start = () => {
  if (_timer) return;
  _timer = setInterval(() => { flush().catch(() => {}); }, FLUSH_MS);
  if (_timer.unref) _timer.unref();
};
const stop = () => {
  if (_timer) clearInterval(_timer);
  _timer = null;
};

module.exports = { record, flush, start, stop };
