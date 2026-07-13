/**
 * ZKTeco device adapter.
 *
 * Uses the `node-zklib` package to talk to a ZKTeco K40 over TCP/UDP.
 * The library is required lazily so the API can still boot when the package
 * isn't installed (e.g. CI environments) or when the operator runs in
 * `BIOMETRIC_MOCK=true` mode for local development without hardware.
 *
 * Public surface:
 *   connect(device)             -> handle (cached)
 *   disconnect(device)
 *   ping(device)                -> { ok, latencyMs }
 *   getInfo(device)             -> { userCount, fingerCount, recordCount, firmware, serial }
 *   createUser(device, user)    -> void
 *   updateUser(device, user)    -> void
 *   deleteUser(device, uid)     -> void
 *   enableUser/disableUser
 *   getUsers(device)            -> [{ uid, userId, name, role, fingerCount }]
 *   getAttendance(device)       -> [{ deviceUserId, timestamp, checkType, verificationMode }]
 *   clearAttendance(device)
 *   restart(device)
 *
 * Fingerprints are NEVER read into the API surface — enrolment happens on the
 * physical K40 and we only ever read enrolment *state* back.
 */
const logger = require('../utils/logger');
const { CHECK_TYPE, VERIFICATION_MODE, DEVICE_CONN_TYPE } = require('../config/constants');
const { patchZKLibInstance } = require('./zklib-safe');

// NOTE: we deliberately do NOT bump `EventEmitter.defaultMaxListeners`
// globally — that would silently mask leaks in third-party emitters
// (mongoose, socket.io, node internals). node-zklib's short-lived
// per-request listeners are handled at the correct scope by
// `patchZKLibInstance` which calls `socket.setMaxListeners(50)` on the
// specific TCP/UDP socket it opens. Leave the process-wide default at 10.

const MOCK = String(process.env.BIOMETRIC_MOCK || '').toLowerCase() === 'true';
const DEFAULT_TIMEOUT = Number(process.env.BIOMETRIC_TIMEOUT_MS || 8000);

// ZK protocol command codes used directly (node-zklib doesn't expose setUser).
const CMD = {
  USER_WRQ: 8,
  USERTEMP_RRQ: 9,
  DELETE_USER: 18,
  REFRESHDATA: 1013,
  RESTART: 1004,
};

// Encode a JS string into a fixed-length Buffer, right-null-padded.
const encFixed = (s, len) => {
  const buf = Buffer.alloc(len);
  buf.write(String(s || ''), 0, len, 'utf8');
  return buf;
};

// Standalone-SDK CMD_USER_WRQ payload = 72 bytes. The device firmware and
// node-zklib both decode userId at offset 48 (with a 3-byte reserved/flag
// gap after timezone). Writing userId anywhere else silently corrupts the
// name field on read-back.
//   0..1   uid (uint16 LE)
//   2      privilege
//   3..10  password (8 bytes)
//   11..34 name (24 bytes)
//   35..38 cardno (uint32 LE)
//   39..42 group (uint32 LE)
//   43..44 timezone (uint16 LE)
//   45..47 reserved / flag (3 bytes)
//   48..56 userId (9 bytes ASCII, null-padded)
//   57..71 padding
const buildUserPayload = ({ uid, name, privilege = 0, password = '', userId }) => {
  const buf = Buffer.alloc(72);
  buf.writeUInt16LE(Number(uid) & 0xffff, 0);
  buf.writeUInt8(Number(privilege) & 0xff, 2);
  encFixed(password, 8).copy(buf, 3);
  encFixed(name, 24).copy(buf, 11);
  buf.writeUInt32LE(0, 35);
  buf.writeUInt32LE(0, 39);
  buf.writeUInt16LE(0, 43);
  encFixed(userId, 9).copy(buf, 48);
  return buf;
};

// ------------------------------------------------------------------
// Lazy require of node-zklib — never crash boot if the package is missing.
// ------------------------------------------------------------------
let ZKLib = null;
let zkloadError = null;
const loadZK = () => {
  if (ZKLib || zkloadError) return ZKLib;
  try {
    // eslint-disable-next-line global-require, import/no-unresolved
    ZKLib = require('node-zklib');
  } catch (err) {
    zkloadError = err;
    logger.warn(
      `[biometric] node-zklib not installed — install with "npm i node-zklib" or set BIOMETRIC_MOCK=true. (${err.message})`
    );
  }
  return ZKLib;
};

// ------------------------------------------------------------------
// Connection cache — exactly ONE live socket per device (keyed by ip:port).
//
// `state` maps `ip:port` -> {
//   zk: ZKLib | null           // the live driver instance
//   alive: boolean             // false as soon as the socket dies for any reason
//   chain: Promise             // per-device operation queue (serialises calls)
//   consecutiveFailures: number
//   backoffUntil: number       // epoch ms; ensureConnected refuses to dial before this
// }
//
// This is the single source of truth for biometric sockets. Every op goes
// through `exec()` which acquires the queue, ensures the connection is
// healthy, runs the op with a timeout, and tears the socket down on any
// error so the very next call reconnects cleanly. There is no path in this
// module that creates a socket outside of `ensureConnected`.
// ------------------------------------------------------------------
const state = new Map();
const keyOf = (device) => `${device.ip}:${device.port}`;
const stateFor = (device) => {
  const k = keyOf(device);
  let s = state.get(k);
  if (!s) {
    s = {
      zk: null,
      alive: false,
      chain: Promise.resolve(),
      consecutiveFailures: 0,
      backoffUntil: 0,
    };
    state.set(k, s);
  }
  return s;
};

// Structured op log. Format required by spec §7:
// timestamp / device IP / device name / operation / duration / status / error.
// Winston stamps the timestamp automatically, so we prepend the rest.
const perfLog = (ok, device, op, ms, errMsg) => {
  const label = device.name || 'device';
  const line = `[biometric][${device.ip}][${label}] ${op} ${ok ? 'OK' : 'FAIL'} in ${ms}ms${errMsg ? ` :: ${errMsg}` : ''}`;
  if (ok) logger.info(line);
  else logger.warn(line);
};

// -------------------------------------------------------------------
// Optional metrics hook. `server.js` wires this to `deviceMetrics.record`
// at boot. Kept as a hook (rather than a hard require) so this module
// stays free of cycles and remains usable from scripts.
// -------------------------------------------------------------------
let metricsHook = null;
const setMetricsHook = (fn) => { metricsHook = typeof fn === 'function' ? fn : null; };
const fireMetrics = (device, op, ms, ok, err) => {
  if (!metricsHook || !device || !device._id) return;
  try {
    metricsHook({ deviceId: device._id, op, latencyMs: ms, ok, error: err });
  } catch {
    // Never let a metrics-hook failure surface to the caller.
  }
};

const tearDown = (device, reason) => {
  const s = stateFor(device);
  const zk = s.zk;
  s.zk = null;
  s.alive = false;
  if (!zk || zk.mock) return;
  // Yank the underlying sockets ourselves so no dangling `data`/`close`
  // listeners survive a failed operation. node-zklib.disconnect() is best
  // effort — we don't await it because a dead socket can hang the .end()
  // callback for the full timeout window (which is exactly what created
  // the polling backpressure in the first place).
  try {
    if (zk.zklibTcp && zk.zklibTcp.socket) {
      try { zk.zklibTcp.socket.removeAllListeners(); } catch { /* ignore */ }
      try { zk.zklibTcp.socket.destroy(); } catch { /* ignore */ }
      zk.zklibTcp.socket = null;
    }
    if (zk.zklibUdp && zk.zklibUdp.socket) {
      try { zk.zklibUdp.socket.removeAllListeners(); } catch { /* ignore */ }
      try { zk.zklibUdp.socket.close(); } catch { /* ignore */ }
      zk.zklibUdp.socket = null;
    }
  } catch { /* ignore */ }
  // Drop the users cache too — a fresh connection can legitimately see a
  // different roster (device was rebooted, users edited on the panel, etc).
  try { usersCache.delete(keyOf(device)); } catch { /* ignore */ }
  if (reason) {
    logger.warn(`[biometric] tore down ${keyOf(device)}: ${reason}`);
  }
};

const isTransient = (err) => {
  const m = err && err.message ? err.message : String(err || '');
  return /DEVICE_RETURNED_INVALID_PACKET|SOCKET_NOT_CONNECTED|TIMEOUT|Timeout after|ECONNRESET|EPIPE|ETIMEDOUT|EHOSTUNREACH/i.test(m);
};

// ------------------------------------------------------------------
// Mock in-memory device (used when BIOMETRIC_MOCK=true).
// Emulates just enough of the ZKTeco surface for the UI + attendance import.
// ------------------------------------------------------------------
const mockStore = new Map(); // key -> { users: Map<uid,user>, logs: [], firmware, serial }
const getMock = (device) => {
  const k = keyOf(device);
  if (!mockStore.has(k)) {
    mockStore.set(k, {
      users: new Map(),
      logs: [],
      firmware: 'MOCK 1.0.0',
      serial: `MOCK-${device.ip.replace(/\./g, '')}`,
    });
  }
  return mockStore.get(k);
};

// ------------------------------------------------------------------
// Wrap a network op with a hard timeout so a dead device never hangs a
// request. Late rejections from the underlying promise (which happen
// often with node-zklib when a socket dies mid-parse) are swallowed so
// they never bubble up as unhandledRejection.
// ------------------------------------------------------------------
const withTimeout = (promise, ms = DEFAULT_TIMEOUT, op = 'device op') =>
  new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Timeout after ${ms}ms during ${op}`));
    }, ms);
    Promise.resolve()
      .then(() => promise)
      .then(
        (val) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(val);
        },
        (err) => {
          if (settled) {
            // Race already decided — silently drop the late failure so
            // node-zklib socket errors don't become unhandledRejection.
            return;
          }
          settled = true;
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err || `Failed during ${op}`)));
        }
      );
  });

const requireDevice = (device) => {
  if (!device) throw new Error('Device configuration is required');
  if (!device.ip) throw new Error('Device IP is not configured');
};

// ==================================================================
// Public API
// ==================================================================

/**
 * Ensure the given device has an alive ZKLib handle and return it.
 * Never called outside `exec()` — do not export.
 */
const ensureConnected = async (device) => {
  const s = stateFor(device);
  if (s.zk && s.alive) return s.zk;

  if (Date.now() < s.backoffUntil) {
    const waitMs = s.backoffUntil - Date.now();
    throw new Error(`Device ${keyOf(device)} in backoff for ${waitMs}ms after ${s.consecutiveFailures} failure(s)`);
  }

  if (MOCK) {
    const handle = { mock: true, device };
    s.zk = handle;
    s.alive = true;
    return handle;
  }

  const Lib = loadZK();
  if (!Lib) throw new Error('Biometric driver not installed (node-zklib). Set BIOMETRIC_MOCK=true or install the package.');

  const useUdp = device.connectionType === DEVICE_CONN_TYPE.UDP;
  const zk = new Lib(device.ip, device.port, DEFAULT_TIMEOUT, useUdp ? device.inport || 5200 : 4000);
  // Apply the memory-safety patch BEFORE the first createSocket, so the
  // socket comes up with `setMaxListeners(50)` and the null-reply guard
  // is in place for the very first request.
  patchZKLibInstance(zk);

  const start = Date.now();
  try {
    await withTimeout(
      zk.createSocket(
        // cbError: socket-level error — mark the handle dead so the next
        // exec() call rebuilds it. Never crash the process.
        (err) => {
          s.alive = false;
          logger.warn(`[biometric] socket error ${keyOf(device)}: ${err && err.message ? err.message : err}`);
        },
        // cbClose: mark dead on remote/local close.
        () => { s.alive = false; }
      ),
      DEFAULT_TIMEOUT,
      'createSocket'
    );
  } catch (err) {
    s.consecutiveFailures += 1;
    // Exponential backoff: 2s → 4s → 8s → 16s → 32s → cap 60s.
    const delay = Math.min(60_000, 2_000 * (2 ** Math.min(5, s.consecutiveFailures - 1)));
    s.backoffUntil = Date.now() + delay;
    tearDown(device, `createSocket failed: ${err.message}`);
    perfLog(false, device, 'connect', Date.now() - start, err.message);
    throw err;
  }
  s.zk = zk;
  s.alive = true;
  s.consecutiveFailures = 0;
  s.backoffUntil = 0;
  perfLog(true, device, 'connect', Date.now() - start);
  return zk;
};

/**
 * Serialised, self-healing biometric operation runner.
 *
 * Every public op goes through `exec()`. It guarantees:
 *   1. Only one op at a time per device (per-device promise chain), so
 *      concurrent callers can never corrupt each other's reply streams.
 *   2. A single live socket is reused across ops (huge perf win, and the
 *      root fix for MaxListenersExceededWarning — we no longer open a new
 *      socket per polling cycle).
 *   3. A hard timeout, so a dead device can never block the queue.
 *   4. On ANY error the socket is torn down and the next op reconnects
 *      cleanly. Transient errors are retried once with a fresh socket.
 *   5. Structured logging: timestamp / IP / device name / op / ms / result.
 */
const exec = async (device, opName, timeoutMs, fn, { retry = true } = {}) => {
  requireDevice(device);
  const s = stateFor(device);
  const attempt = async (isRetry) => {
    const start = Date.now();
    let handle;
    try {
      handle = await ensureConnected(device);
    } catch (err) {
      const ms = Date.now() - start;
      perfLog(false, device, `${opName}${isRetry ? ' (retry)' : ''}`, ms, err.message);
      fireMetrics(device, opName, ms, false, err);
      throw err;
    }
    try {
      const val = await withTimeout(Promise.resolve().then(() => fn(handle)), timeoutMs, opName);
      const ms = Date.now() - start;
      perfLog(true, device, `${opName}${isRetry ? ' (retry)' : ''}`, ms);
      fireMetrics(device, opName, ms, true, null);
      s.consecutiveFailures = 0;
      return val;
    } catch (err) {
      const ms = Date.now() - start;
      perfLog(false, device, `${opName}${isRetry ? ' (retry)' : ''}`, ms, err.message);
      fireMetrics(device, opName, ms, false, err);
      tearDown(device, `${opName}: ${err.message}`);
      throw err;
    }
  };

  const run = async () => {
    try {
      return await attempt(false);
    } catch (err) {
      if (retry && isTransient(err)) {
        // One retry after a clean tear-down. Enough to recover from the
        // classic `subarray of null` / short packet cases without letting
        // a truly-dead device spin.
        return attempt(true);
      }
      throw err;
    }
  };

  // Queue on the per-device chain. The chain itself must never reject or
  // subsequent ops would inherit the failure, so we swallow errors on the
  // stored promise and only propagate them to the immediate caller.
  const next = s.chain.then(run, run);
  s.chain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
};

/** Open (or reuse) a live connection to the given device. */
const connect = (device) => exec(device, 'connect', DEFAULT_TIMEOUT, async (h) => h);

/** Gracefully close the socket to a device. Always safe to call. */
const disconnect = async (device) => {
  requireDevice(device);
  const s = stateFor(device);
  // Wait for any in-flight op on this device to settle before tearing down,
  // otherwise the in-flight op could see its socket vanish mid-request.
  try { await s.chain; } catch { /* ignore prior op failures */ }
  tearDown(device, 'explicit disconnect');
};

/** Lightweight liveness probe. Returns { ok, latencyMs, error? }. */
const ping = async (device) => {
  const start = Date.now();
  try {
    await exec(device, 'ping', DEFAULT_TIMEOUT, async (h) => {
      if (h.mock) return true;
      // getInfo is the cheapest useful call on the ZK protocol.
      return h.getInfo();
    });
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err.message };
  }
};

const getInfo = async (device) => exec(device, 'getInfo', DEFAULT_TIMEOUT, async (h) => {
  if (h.mock) {
    const m = getMock(device);
    return {
      userCount: m.users.size,
      fingerCount: [...m.users.values()].reduce((s, u) => s + (u.fingerCount || 0), 0),
      recordCount: m.logs.length,
      firmware: m.firmware,
      serialNumber: m.serial,
    };
  }
  const info = await h.getInfo();
  return {
    userCount: info?.userCounts ?? info?.userCount ?? 0,
    fingerCount: info?.fingerCounts ?? info?.fingerCount ?? 0,
    recordCount: info?.recordCounts ?? info?.logCounts ?? info?.recordCount ?? 0,
    firmware: undefined,
    serialNumber: undefined,
  };
});

/**
 * Push a user to the device via CMD_USER_WRQ.
 * We ONLY send: uid, userId, name, privilege, password. Never fingerprints.
 */
const createUser = async (device, { uid, userId, name, privilege = 0, password = '' }) => {
  if (!uid) throw new Error('uid required');
  if (!userId) throw new Error('userId required');
  const safeName = String(name || '').slice(0, 24);
  const safePwd = String(password || '').slice(0, 8);

  return exec(device, 'createUser', DEFAULT_TIMEOUT, async (h) => {
    if (h.mock) {
      const m = getMock(device);
      m.users.set(String(uid), {
        uid: Number(uid),
        userId: String(userId),
        name: safeName,
        role: privilege,
        password: safePwd,
        fingerCount: 0,
        enabled: true,
      });
      return;
    }
    const payload = buildUserPayload({
      uid: Number(uid),
      userId: String(userId),
      name: safeName,
      privilege: Number(privilege) || 0,
      password: safePwd,
    });
    await h.executeCmd(CMD.USER_WRQ, payload);
    // Ask the device to refresh its data cache so the new user is visible immediately.
    try { await h.executeCmd(CMD.REFRESHDATA, ''); } catch { /* refresh is optional */ }
    // Roster changed — drop the cached user list so the next getUsers()
    // call returns fresh data instead of a stale snapshot.
    _invalidateUsersCache(device);
  });
};

/** Update = same as create on ZK devices (CMD_USER_WRQ overwrites by uid). */
const updateUser = (device, user) => createUser(device, user);

const deleteUser = async (device, uid) => exec(device, 'deleteUser', DEFAULT_TIMEOUT, async (h) => {
  if (h.mock) {
    getMock(device).users.delete(String(uid));
    _invalidateUsersCache(device);
    return;
  }
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(Number(uid) & 0xffff, 0);
  await h.executeCmd(CMD.DELETE_USER, buf);
  try { await h.executeCmd(CMD.REFRESHDATA, ''); } catch { /* optional */ }
  _invalidateUsersCache(device);
});

// ZKTeco K40 has no direct per-user enable/disable command via CMD_USER_WRQ.
// The pragmatic pattern is: enable = re-push the record, disable = delete it
// from the device (Mongo record stays). Callers can pass the full user info
// via `enableUser(device, userLike)` when they have it.
const enableUser = async (device, userLike) => {
  if (MOCK) {
    return exec(device, 'enableUser', DEFAULT_TIMEOUT, async () => {
      if (typeof userLike === 'object' && userLike?.uid) {
        const u = getMock(device).users.get(String(userLike.uid));
        if (u) u.enabled = true;
      }
    });
  }
  if (typeof userLike === 'object' && userLike?.uid && userLike?.userId) {
    return createUser(device, userLike);
  }
  logger.warn('[biometric] enableUser called without full user info — skipping (K40 has no per-user enable cmd).');
  return undefined;
};

const disableUser = async (device, uid) => {
  if (MOCK) {
    return exec(device, 'disableUser', DEFAULT_TIMEOUT, async () => {
      const u = getMock(device).users.get(String(uid));
      if (u) u.enabled = false;
    });
  }
  return deleteUser(device, uid);
};

/**
 * Read the enrolled user roster back from the device. Non-throwing: returns [] on failure.
 *
 * Cached for `USERS_CACHE_TTL_MS` per device. The biometric poller calls
 * `getUsers()` from BOTH `importAttendance` (to build the userId→uid
 * fallback map) and `refreshAllFingerprintStatuses` — without this cache
 * every poll cycle fired the roster round-trip twice. Any mutation that
 * changes the roster (`createUser` / `updateUser` / `deleteUser` /
 * `restart` / `clearAttendance`) invalidates the cache immediately via
 * `_invalidateUsersCache(device)`, so callers still see fresh data after
 * an admin syncs an employee.
 *
 * Passing `{ force: true }` bypasses the cache for the rare code paths
 * that MUST see live device state (e.g. bulk sync diff).
 */
const USERS_CACHE_TTL_MS = Number(process.env.ZKTECO_USERS_CACHE_MS || 60_000);
const usersCache = new Map(); // key -> { at, users }

const _invalidateUsersCache = (device) => {
  usersCache.delete(keyOf(device));
};

const getUsers = async (device, { force = false } = {}) => {
  const key = keyOf(device);
  if (!force) {
    const hit = usersCache.get(key);
    if (hit && Date.now() - hit.at < USERS_CACHE_TTL_MS) return hit.users;
  }
  try {
    const users = await exec(device, 'getUsers', DEFAULT_TIMEOUT * 2, async (h) => {
      if (h.mock) {
        return [...getMock(device).users.values()].map((u) => ({
          uid: u.uid,
          userId: u.userId,
          name: u.name,
          role: u.role,
          fingerCount: u.fingerCount,
        }));
      }
      const res = await h.getUsers();
      const list = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
      return list
        .filter((u) => u && (u.uid != null || u.userId != null))
        .map((u) => ({
          uid: u.uid,
          userId: String(u.userId || u.user_id || u.uid),
          name: u.name,
          role: u.role ?? u.privilege ?? 0,
          fingerCount: Number(u.fingerCount ?? u.templates ?? 0),
        }));
    });
    usersCache.set(key, { at: Date.now(), users });
    return users;
  } catch (err) {
    logger.warn(`[biometric] getUsers(${keyOf(device)}) failed: ${err.message}`);
    return [];
  }
};

/**
 * Count how many finger templates (0..9) a specific uid has enrolled on the
 * device. node-zklib doesn't return this info in getUsers(), so we probe each
 * slot via CMD_USERTEMP_RRQ. Returns a number (0..10).
 *
 * We use a short per-probe timeout because "template not present" is often
 * reported as a socket timeout by the K40 rather than an error response.
 */
const getUserFingerCount = async (device, uid) => exec(device, `getUserFingerCount(${uid})`, DEFAULT_TIMEOUT * 3, async (h) => {
  if (h.mock) {
    const u = getMock(device).users.get(String(uid));
    return u ? Number(u.fingerCount || 0) : 0;
  }
  let count = 0;
  for (let finger = 0; finger < 10; finger += 1) {
    const buf = Buffer.alloc(4);
    buf.writeUInt16LE(Number(uid) & 0xffff, 0);
    buf.writeUInt8(finger, 2);
    buf.writeUInt8(0, 3);
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await withTimeout(
        h.executeCmd(CMD.USERTEMP_RRQ, buf),
        1500,
        `USERTEMP_RRQ(uid=${uid},f=${finger})`
      );
      if (res && Buffer.isBuffer(res) && res.length > 0) count += 1;
      else if (res && !Buffer.isBuffer(res)) count += 1;
    } catch {
      // No template at this slot — keep scanning.
    }
  }
  return count;
}, { retry: false });

const CHECK_TYPE_MAP = {
  0: CHECK_TYPE.CHECK_IN,
  1: CHECK_TYPE.CHECK_OUT,
  2: CHECK_TYPE.BREAK_OUT,
  3: CHECK_TYPE.BREAK_IN,
  4: CHECK_TYPE.OVERTIME_IN,
  5: CHECK_TYPE.OVERTIME_OUT,
};
const VERIFY_MAP = {
  0: VERIFICATION_MODE.PASSWORD,
  1: VERIFICATION_MODE.FINGERPRINT,
  2: VERIFICATION_MODE.CARD,
  15: VERIFICATION_MODE.FACE,
};

/** Read attendance punches from the device. Non-throwing: returns [] on failure. */
const getAttendance = async (device) => {
  try {
    return await exec(device, 'getAttendances', DEFAULT_TIMEOUT * 3, async (h) => {
      if (h.mock) return getMock(device).logs.map((l) => ({ ...l }));
      const res = await h.getAttendances();
      const list = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
      return list
        .filter((row) => row && (row.deviceUserId ?? row.userId ?? row.user_id ?? row.uid) != null)
        .map((row) => ({
          deviceUserId: String(row.deviceUserId ?? row.userId ?? row.user_id ?? row.uid),
          timestamp: new Date(row.recordTime ?? row.timestamp ?? row.time),
          checkType: CHECK_TYPE_MAP[Number(row.type ?? row.state)] || CHECK_TYPE.CHECK_IN,
          verificationMode:
            VERIFY_MAP[Number(row.verifyMode ?? row.verified ?? 1)] || VERIFICATION_MODE.FINGERPRINT,
        }));
    });
  } catch (err) {
    logger.warn(`[biometric] getAttendances(${keyOf(device)}) failed: ${err.message}`);
    return [];
  }
};

const clearAttendance = async (device) => exec(device, 'clearAttendance', DEFAULT_TIMEOUT, async (h) => {
  if (h.mock) {
    getMock(device).logs = [];
    return;
  }
  if (typeof h.clearAttendanceLog === 'function') {
    await h.clearAttendanceLog();
  }
});

const restart = async (device) => {
  try {
    await exec(device, 'restart', DEFAULT_TIMEOUT, async (h) => {
      if (h.mock) return;
      await h.executeCmd(CMD.RESTART, '');
    }, { retry: false });
  } catch (err) {
    // A restart typically closes the socket while we're still waiting on ACK,
    // which the library surfaces as an error. Treat that as success.
    logger.warn(`[biometric] restart(${keyOf(device)}): ${err.message} (ignored)`);
  }
  // Force a fresh connection on the next op.
  tearDown({ ip: device.ip, port: device.port }, 'post-restart teardown');
};

/**
 * Prune connection-cache entries for devices no longer in the given
 * `activeKeys` set (each entry is an `ip:port` string).
 *
 * Called periodically by server.js so a device that is disabled or
 * deleted from Mongo doesn't leak its state bucket (zk handle, chain
 * closure, mock in-memory logs) for the process lifetime.
 *
 * Safe to call at any time — a state bucket that has an active `chain`
 * is torn down cleanly via the existing `disconnect()` path.
 */
const pruneStale = async (activeKeys) => {
  const keep = new Set(activeKeys || []);
  const stale = [];
  for (const k of state.keys()) {
    if (!keep.has(k)) stale.push(k);
  }
  for (const k of stale) {
    const [ip, portStr] = k.split(':');
    const port = Number(portStr);
    const device = { ip, port };
    try {
      // Drain any in-flight op on this key before evicting the bucket —
      // stops us from destroying a socket that's still being read from.
      // eslint-disable-next-line no-await-in-loop
      await disconnect(device);
    } catch { /* ignore */ }
    state.delete(k);
    // Also drop the mock in-memory store for this key so BIOMETRIC_MOCK
    // mode doesn't accumulate stale user/log arrays forever.
    mockStore.delete(k);
    usersCache.delete(k);
    logger.info(`[biometric] pruned stale connection cache for ${k}`);
  }
  return stale.length;
};

// Test helper (used by tests only): inject a punch into the mock device.
// A hard cap prevents the in-memory log array from growing without bound
// when the mock runs for hours in a dev VPS — the K40 itself only stores
// ~80 records so 500 is more than we ever need.
const MOCK_LOG_CAP = 500;
const _mockPunch = (device, payload) => {
  if (!MOCK) return;
  const m = getMock(device);
  m.logs.push({
    deviceUserId: String(payload.deviceUserId),
    timestamp: payload.timestamp || new Date(),
    checkType: payload.checkType || CHECK_TYPE.CHECK_IN,
    verificationMode: payload.verificationMode || VERIFICATION_MODE.FINGERPRINT,
  });
  if (m.logs.length > MOCK_LOG_CAP) {
    // Drop the oldest half at once — cheaper than repeated shift().
    m.logs.splice(0, m.logs.length - MOCK_LOG_CAP);
  }
};

module.exports = {
  MOCK,
  connect,
  disconnect,
  ping,
  getInfo,
  createUser,
  updateUser,
  deleteUser,
  enableUser,
  disableUser,
  getUsers,
  getUserFingerCount,
  getAttendance,
  clearAttendance,
  restart,
  setMetricsHook,
  pruneStale,
  keyOf,
  _mockPunch,
};
