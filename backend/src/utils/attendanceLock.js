/**
 * Attendance import lock.
 *
 * Prevents overlapping attendance import cycles on the same device. Combined
 * with the per-device queue in `zkteco.service`, this eliminates duplicate
 * imports and reply-stream corruption.
 *
 * The lock is in-memory (Map keyed by deviceId). Because the API runs as a
 * single process under PM2 (see ecosystem.config.js — one instance for the
 * biometric service), that's sufficient. On process crash / restart, the
 * map disappears and the lock is automatically released — no stale state
 * ever survives a restart.
 *
 * A stale-lease timeout (LEASE_MS) protects against the pathological case
 * where a caller forgets its finally block; after that window the lock can
 * be stolen so the poller never wedges forever.
 */
const LEASE_MS = Number(process.env.ATTENDANCE_LOCK_LEASE_MS || 5 * 60_000);

const locks = new Map(); // deviceId -> { at: number }

/**
 * Try to acquire the lock for a device. Returns a release() function on
 * success, or null if the lock is already held by a fresh owner.
 * ALWAYS call the returned release() in a finally block.
 */
const acquire = (deviceId) => {
  const key = String(deviceId);
  const now = Date.now();
  const cur = locks.get(key);
  if (cur && now - cur.at < LEASE_MS) return null;
  const token = { at: now };
  locks.set(key, token);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    // Only release if we still own the lock (a stale-lease steal wouldn't).
    if (locks.get(key) === token) locks.delete(key);
  };
};

const isHeld = (deviceId) => {
  const cur = locks.get(String(deviceId));
  return !!(cur && Date.now() - cur.at < LEASE_MS);
};

module.exports = { acquire, isHeld };
