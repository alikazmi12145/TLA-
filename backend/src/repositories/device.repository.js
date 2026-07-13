/**
 * Device repository — thin data-access layer around the Device model.
 * All Mongo access for devices lives here so services stay database-agnostic.
 *
 * Read helpers accept an optional `projection` and support `{ lean: true }`
 * for read-only, high-frequency callers (health monitor, metrics flush).
 * Existing method names are preserved — extra args are optional.
 */
const Device = require('../models/Device');

const create = (payload) => Device.create(payload);

const findById = (id, projection = null, { lean = false } = {}) => {
  const q = Device.findById(id, projection);
  return lean ? q.lean() : q;
};

const findByIp = (ip, port, projection = null, { lean = false } = {}) => {
  const q = Device.findOne({ ip, port }, projection);
  return lean ? q.lean() : q;
};

const findEnabled = (projection = null, { lean = false } = {}) => {
  const q = Device.find({ enabled: true }, projection).sort({ isPrimary: -1, name: 1 });
  return lean ? q.lean() : q;
};

const findPrimary = (projection = null, { lean = false } = {}) => {
  const q = Device.findOne({ enabled: true, isPrimary: true }, projection);
  return lean ? q.lean() : q;
};

const list = (filter = {}, projection = null, { lean = false } = {}) => {
  const q = Device.find(filter, projection).sort({ isPrimary: -1, name: 1 });
  return lean ? q.lean() : q;
};

const update = (id, patch) =>
  Device.findByIdAndUpdate(id, patch, { new: true, runValidators: true });

const remove = (id) => Device.findByIdAndDelete(id);

/**
 * Update device telemetry. Automatically stamps `lastSeen` so callers do not
 * need to remember it. Callers may still pass an explicit `lastSeen`
 * (e.g. a historical value) — that wins.
 */
const updateTelemetry = (id, patch = {}) => {
  const merged = { lastSeen: new Date(), ...patch };
  return Device.findByIdAndUpdate(id, { $set: merged }, { new: true });
};

/**
 * Atomically record a successful biometric op. Uses $inc / $set so parallel
 * writes never lose counters. `averageLatency` is a running moving mean.
 */
const recordSuccess = async (id, latencyMs) => {
  const now = new Date();
  // Two-step: first $inc, then read counters back to compute the new mean.
  // Keeps arithmetic correct under concurrency without needing aggregation
  // pipeline updates.
  const doc = await Device.findByIdAndUpdate(
    id,
    {
      $inc: { totalRequests: 1, successfulRequests: 1 },
      $set: {
        online: true,
        status: 'ONLINE',
        lastSeen: now,
        lastSuccessAt: now,
        lastLatency: Number(latencyMs) || 0,
        lastError: null,
      },
    },
    { new: true, projection: 'successfulRequests averageLatency' }
  );
  if (!doc) return null;
  const n = Math.max(1, doc.successfulRequests || 1);
  const prevAvg = Number(doc.averageLatency) || 0;
  // Incremental mean: avg_n = avg_{n-1} + (x - avg_{n-1}) / n
  const nextAvg = prevAvg + ((Number(latencyMs) || 0) - prevAvg) / n;
  return Device.findByIdAndUpdate(
    id,
    { $set: { averageLatency: Math.round(nextAvg) } },
    { new: true }
  );
};

/** Atomically record a failed biometric op. Never resets success counters. */
const recordFailure = (id, error) => {
  const now = new Date();
  return Device.findByIdAndUpdate(
    id,
    {
      $inc: { totalRequests: 1, failedRequests: 1, failureCount: 1 },
      $set: {
        lastFailureAt: now,
        lastError: typeof error === 'string' ? error : (error && error.message) || 'unknown error',
      },
    },
    { new: true }
  );
};

module.exports = {
  create,
  findById,
  findByIp,
  findEnabled,
  findPrimary,
  list,
  update,
  remove,
  updateTelemetry,
  recordSuccess,
  recordFailure,
};
