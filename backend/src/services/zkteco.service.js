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

const MOCK = String(process.env.BIOMETRIC_MOCK || '').toLowerCase() === 'true';
const DEFAULT_TIMEOUT = Number(process.env.BIOMETRIC_TIMEOUT_MS || 5000);

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
// Connection cache — one live handle per device (keyed by ip:port).
// ------------------------------------------------------------------
const handles = new Map();
const keyOf = (device) => `${device.ip}:${device.port}`;

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

/** Open (or reuse) a live connection to the given device. */
const connect = async (device) => {
  requireDevice(device);
  const key = keyOf(device);
  if (handles.has(key)) return handles.get(key);

  if (MOCK) {
    const handle = { mock: true, device };
    handles.set(key, handle);
    return handle;
  }

  const Lib = loadZK();
  if (!Lib) throw new Error('Biometric driver not installed (node-zklib). Set BIOMETRIC_MOCK=true or install the package.');

  const useUdp = device.connectionType === DEVICE_CONN_TYPE.UDP;
  const zk = new Lib(device.ip, device.port, DEFAULT_TIMEOUT, useUdp ? device.inport || 5200 : 4000);
  await withTimeout(zk.createSocket(), DEFAULT_TIMEOUT, 'connect');
  handles.set(key, zk);
  return zk;
};

/** Gracefully close the socket to a device. */
const disconnect = async (device) => {
  requireDevice(device);
  const key = keyOf(device);
  const handle = handles.get(key);
  handles.delete(key);
  if (!handle || handle.mock) return;
  try {
    await handle.disconnect();
  } catch (err) {
    logger.warn(`[biometric] disconnect(${key}) failed: ${err.message}`);
  }
};

/** Lightweight liveness probe. Returns { ok, latencyMs, error? }. */
const ping = async (device) => {
  const start = Date.now();
  try {
    const handle = await connect(device);
    if (handle.mock) return { ok: true, latencyMs: Date.now() - start };
    // getInfo is the cheapest useful call on the ZK protocol.
    await withTimeout(handle.getInfo(), DEFAULT_TIMEOUT, 'ping');
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err.message };
  }
};

const getInfo = async (device) => {
  const handle = await connect(device);
  if (handle.mock) {
    const m = getMock(device);
    return {
      userCount: m.users.size,
      fingerCount: [...m.users.values()].reduce((s, u) => s + (u.fingerCount || 0), 0),
      recordCount: m.logs.length,
      firmware: m.firmware,
      serialNumber: m.serial,
    };
  }
  const info = await withTimeout(handle.getInfo(), DEFAULT_TIMEOUT, 'getInfo');
  return {
    userCount: info?.userCounts ?? info?.userCount ?? 0,
    fingerCount: info?.fingerCounts ?? info?.fingerCount ?? 0,
    recordCount: info?.recordCounts ?? info?.logCounts ?? info?.recordCount ?? 0,
    firmware: undefined,
    serialNumber: undefined,
  };
};

/**
 * Push a user to the device via CMD_USER_WRQ.
 * We ONLY send: uid, userId, name, privilege, password. Never fingerprints.
 */
const createUser = async (device, { uid, userId, name, privilege = 0, password = '' }) => {
  if (!uid) throw new Error('uid required');
  if (!userId) throw new Error('userId required');
  const handle = await connect(device);
  const safeName = String(name || '').slice(0, 24);
  const safePwd = String(password || '').slice(0, 8);

  if (handle.mock) {
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
  await withTimeout(handle.executeCmd(CMD.USER_WRQ, payload), DEFAULT_TIMEOUT, 'CMD_USER_WRQ');
  // Ask the device to refresh its data cache so the new user is visible immediately.
  try {
    await withTimeout(handle.executeCmd(CMD.REFRESHDATA, ''), DEFAULT_TIMEOUT, 'CMD_REFRESHDATA');
  } catch { /* refresh is optional */ }
};

/** Update = same as create on ZK devices (CMD_USER_WRQ overwrites by uid). */
const updateUser = (device, user) => createUser(device, user);

const deleteUser = async (device, uid) => {
  const handle = await connect(device);
  if (handle.mock) {
    getMock(device).users.delete(String(uid));
    return;
  }
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(Number(uid) & 0xffff, 0);
  await withTimeout(handle.executeCmd(CMD.DELETE_USER, buf), DEFAULT_TIMEOUT, 'CMD_DELETE_USER');
  try {
    await withTimeout(handle.executeCmd(CMD.REFRESHDATA, ''), DEFAULT_TIMEOUT, 'CMD_REFRESHDATA');
  } catch { /* optional */ }
};

// ZKTeco K40 has no direct per-user enable/disable command via CMD_USER_WRQ.
// The pragmatic pattern is: enable = re-push the record, disable = delete it
// from the device (Mongo record stays). Callers can pass the full user info
// via `enableUser(device, userLike)` when they have it.
const enableUser = async (device, userLike) => {
  const handle = await connect(device);
  if (handle.mock) {
    if (typeof userLike === 'object' && userLike?.uid) {
      const u = getMock(device).users.get(String(userLike.uid));
      if (u) u.enabled = true;
    }
    return;
  }
  if (typeof userLike === 'object' && userLike?.uid && userLike?.userId) {
    return createUser(device, userLike);
  }
  logger.warn('[biometric] enableUser called without full user info — skipping (K40 has no per-user enable cmd).');
};

const disableUser = async (device, uid) => {
  const handle = await connect(device);
  if (handle.mock) {
    const u = getMock(device).users.get(String(uid));
    if (u) u.enabled = false;
    return;
  }
  return deleteUser(device, uid);
};

/** Read the enrolled user roster back from the device. */
const getUsers = async (device) => {
  const handle = await connect(device);
  if (handle.mock) {
    return [...getMock(device).users.values()].map((u) => ({
      uid: u.uid,
      userId: u.userId,
      name: u.name,
      role: u.role,
      fingerCount: u.fingerCount,
    }));
  }
  let res;
  try {
    res = await withTimeout(handle.getUsers(), DEFAULT_TIMEOUT * 2, 'getUsers');
  } catch (err) {
    logger.warn(`[biometric] getUsers(${keyOf(device)}) failed: ${err.message}`);
    return [];
  }
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
};

/**
 * Count how many finger templates (0..9) a specific uid has enrolled on the
 * device. node-zklib doesn't return this info in getUsers(), so we probe each
 * slot via CMD_USERTEMP_RRQ. Returns a number (0..10).
 *
 * We use a short per-probe timeout because "template not present" is often
 * reported as a socket timeout by the K40 rather than an error response.
 */
const getUserFingerCount = async (device, uid) => {
  const handle = await connect(device);
  if (handle.mock) {
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
      const res = await withTimeout(
        handle.executeCmd(CMD.USERTEMP_RRQ, buf),
        Math.min(DEFAULT_TIMEOUT, 1500),
        `USERTEMP_RRQ(uid=${uid},f=${finger})`
      );
      // Any non-empty template payload means this finger slot is enrolled.
      if (res && Buffer.isBuffer(res) && res.length > 0) count += 1;
      else if (res && !Buffer.isBuffer(res)) count += 1; // some libs return true/object
    } catch {
      // No template at this slot — keep scanning.
    }
  }
  return count;
};

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

/** Read attendance punches from the device. */
const getAttendance = async (device) => {
  const handle = await connect(device);
  if (handle.mock) {
    return getMock(device).logs.map((l) => ({ ...l }));
  }
  let res;
  try {
    res = await withTimeout(handle.getAttendances(), DEFAULT_TIMEOUT * 3, 'getAttendances');
  } catch (err) {
    logger.warn(`[biometric] getAttendances(${keyOf(device)}) failed: ${err.message}`);
    return [];
  }
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
};

const clearAttendance = async (device) => {
  const handle = await connect(device);
  if (handle.mock) {
    getMock(device).logs = [];
    return;
  }
  if (typeof handle.clearAttendanceLog === 'function') {
    await withTimeout(handle.clearAttendanceLog(), DEFAULT_TIMEOUT, 'clearAttendanceLog');
  }
};

const restart = async (device) => {
  const handle = await connect(device);
  if (handle.mock) return;
  try {
    await withTimeout(handle.executeCmd(CMD.RESTART, ''), DEFAULT_TIMEOUT, 'restart');
  } catch (err) {
    // A restart typically closes the socket while we're still waiting on ACK,
    // which the library surfaces as an error. Treat that as success.
    logger.warn(`[biometric] restart(${keyOf(device)}): ${err.message} (ignored)`);
  }
  handles.delete(keyOf(device));
};

// Test helper (used by tests only): inject a punch into the mock device.
const _mockPunch = (device, payload) => {
  if (!MOCK) return;
  getMock(device).logs.push({
    deviceUserId: String(payload.deviceUserId),
    timestamp: payload.timestamp || new Date(),
    checkType: payload.checkType || CHECK_TYPE.CHECK_IN,
    verificationMode: payload.verificationMode || VERIFICATION_MODE.FINGERPRINT,
  });
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
  _mockPunch,
};
