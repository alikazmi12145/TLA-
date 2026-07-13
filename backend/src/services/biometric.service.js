/**
 * Biometric service — high-level orchestration.
 *
 * Layers on top of the ZKTeco adapter + repositories to implement the
 * business rules required by the HRMS:
 *   - Employee synchronisation to the primary device
 *   - Attendance import into MongoDB
 *   - Fingerprint status refresh (never uploads templates)
 *   - Device connect/test/restart/clear helpers
 */
const zk = require('./zkteco.service');
const deviceRepo = require('../repositories/device.repository');
const employeeRepo = require('../repositories/employee.repository');
const attendanceRepo = require('../repositories/attendance.repository');
const realtime = require('./realtime.service');
const attendanceLock = require('../utils/attendanceLock');
const User = require('../models/User');
const Notification = require('../models/Notification');
const DevicePunch = require('../models/DevicePunch');
const logger = require('../utils/logger');
const {
  SYNC_STATUS,
  FINGERPRINT_STATUS,
  DEVICE_CONN_STATUS,
  ZK_PRIVILEGE,
  ROLES,
} = require('../config/constants');

// ------------------------------------------------------------------
// Admin notification fan-out (biometric punch events)
// ------------------------------------------------------------------

// Cache admin recipients for 60 s to avoid a User query on every punch.
let _adminCache = { ids: [], expiresAt: 0 };
const getAdminRecipients = async () => {
  const now = Date.now();
  if (_adminCache.expiresAt > now) return _adminCache.ids;
  const admins = await User.find({
    role: { $in: [ROLES.SUPER_ADMIN, ROLES.HR_MANAGER] },
    isActive: { $ne: false },
  }).select('_id').lean();
  _adminCache = { ids: admins.map((a) => a._id), expiresAt: now + 60_000 };
  return _adminCache.ids;
};

const _fmtTime = (d) => {
  try {
    return new Date(d).toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch { return String(d); }
};

const notifyAdminsOfPunch = async () => {
  // Clock-in / clock-out admin notifications are intentionally disabled
  // to reduce dashboard noise. The punch is still persisted on the
  // attendance row; only the fan-out to admin notification inboxes is skipped.
  return;
};

// ------------------------------------------------------------------
// Device helpers
// ------------------------------------------------------------------

const resolveDevice = async (deviceId) => {
  if (deviceId) {
    const d = await deviceRepo.findById(deviceId);
    if (!d) throw new Error('Device not found');
    return d;
  }
  const primary = await deviceRepo.findPrimary();
  if (primary) return primary;
  // Fallback: first enabled device.
  const [first] = await deviceRepo.findEnabled();
  return first || null;
};

/** Refresh telemetry (connection status, counters, firmware) for a device. */
const refreshDeviceTelemetry = async (device) => {
  try {
    const info = await zk.getInfo(device);
    return deviceRepo.updateTelemetry(device._id, {
      connectionStatus: DEVICE_CONN_STATUS.ONLINE,
      lastPing: new Date(),
      lastError: null,
      userCount: info.userCount || 0,
      fingerCount: info.fingerCount || 0,
      recordCount: info.recordCount || 0,
      ...(info.firmware ? { firmware: info.firmware } : {}),
      ...(info.serialNumber ? { serialNumber: info.serialNumber } : {}),
    });
  } catch (err) {
    return deviceRepo.updateTelemetry(device._id, {
      connectionStatus: DEVICE_CONN_STATUS.OFFLINE,
      lastPing: new Date(),
      lastError: err.message,
    });
  }
};

const testConnection = async (deviceId) => {
  const device = await resolveDevice(deviceId);
  if (!device) throw new Error('No device configured');
  const result = await zk.ping(device);
  await deviceRepo.updateTelemetry(device._id, {
    lastPing: new Date(),
    connectionStatus: result.ok ? DEVICE_CONN_STATUS.ONLINE : DEVICE_CONN_STATUS.OFFLINE,
    lastError: result.ok ? null : result.error,
  });
  return { ...result, device: device.toObject() };
};

const connectDevice = async (deviceId) => {
  const device = await resolveDevice(deviceId);
  if (!device) throw new Error('No device configured');
  await zk.connect(device);
  const refreshed = await refreshDeviceTelemetry(device);
  return refreshed;
};

const disconnectDevice = async (deviceId) => {
  const device = await resolveDevice(deviceId);
  if (!device) throw new Error('No device configured');
  await zk.disconnect(device);
  return deviceRepo.updateTelemetry(device._id, {
    connectionStatus: DEVICE_CONN_STATUS.OFFLINE,
  });
};

const restartDevice = async (deviceId) => {
  const device = await resolveDevice(deviceId);
  if (!device) throw new Error('No device configured');
  await zk.restart(device);
  return deviceRepo.updateTelemetry(device._id, {
    connectionStatus: DEVICE_CONN_STATUS.UNKNOWN,
    lastPing: new Date(),
  });
};

const clearAttendanceLogs = async (deviceId) => {
  const device = await resolveDevice(deviceId);
  if (!device) throw new Error('No device configured');
  await zk.clearAttendance(device);
  return { ok: true };
};

// ------------------------------------------------------------------
// Employee sync
// ------------------------------------------------------------------

/**
 * Push a single employee to the device.
 * Never rolls back the Mongo record on failure — that's a hard requirement.
 * Returns { ok, device, deviceUserId, error? } and always leaves the User
 * doc with a consistent syncStatus.
 */
const syncEmployee = async (employee, opts = {}) => {
  const device = opts.device || (await resolveDevice(employee.deviceId || opts.deviceId));
  if (!device) {
    await employeeRepo.setSyncFailure(employee._id, 'No biometric device configured');
    return { ok: false, error: 'No biometric device configured' };
  }
  if (!device.enabled) {
    await employeeRepo.setSyncFailure(employee._id, 'Device is disabled');
    return { ok: false, error: 'Device is disabled' };
  }

  try {
    let deviceUserId = employee.deviceUserId;
    // Assign a fresh UID when this employee is being bound to a device for
    // the first time, or is being rebound to a different device.
    const isFreshBinding =
      !deviceUserId || String(employee.deviceId) !== String(device._id);
    if (isFreshBinding) {
      deviceUserId = await employeeRepo.nextFreeDeviceUserId(device._id);
      // Best-effort: purge any stale user record already sitting under this
      // UID on the device (previous holder, ghost row, etc.) — otherwise
      // residual finger templates would auto-mark the new employee as
      // enrolled without them ever touching the sensor.
      try { await zk.deleteUser(device, deviceUserId); } catch { /* not present */ }
    }

    const privilege = Number.isFinite(employee.devicePrivilege)
      ? employee.devicePrivilege
      : ZK_PRIVILEGE.USER;

    await zk.createUser(device, {
      uid: Number(deviceUserId),
      // IMPORTANT: keep device `userId` string aligned with our HRMS
      // `deviceUserId` so attendance punches (which carry userId, not uid)
      // match on import. Do NOT use `employee.employeeId` here — that
      // creates a divergence and every punch would then be skipped.
      userId: String(deviceUserId),
      name: employee.fullName,
      privilege,
      // ZKTeco only stores numeric passwords <= 8 chars; skip for now.
      password: '',
    });

    // Capture a fingerprint baseline via getUsers().fingerCount (the reliable
    // per-user field). Any templates still present under this UID after
    // createUser are considered "residual" — they belong to a previous
    // holder that the device firmware didn't purge. The employee will only
    // be marked ENROLLED once the count rises ABOVE this baseline.
    let fingerBaseline = 0;
    if (isFreshBinding) {
      try {
        const users = await zk.getUsers(device);
        const self = users.find(
          (u) => String(u.userId) === String(deviceUserId) || String(u.uid) === String(deviceUserId)
        );
        fingerBaseline = Number(self?.fingerCount) || 0;
      } catch { fingerBaseline = 0; }
    } else {
      fingerBaseline = Number(employee.fingerBaseline) || 0;
    }

    const updated = await employeeRepo.setSyncSuccess(employee._id, {
      deviceId: device._id,
      deviceUserId,
      // A fresh binding always starts unenrolled — the admin must physically
      // enrol the finger on the K40 and then click Refresh Fingerprints for
      // the status to flip to ENROLLED.
      fingerprintStatus: isFreshBinding
        ? FINGERPRINT_STATUS.NOT_ENROLLED
        : employee.fingerprintStatus === FINGERPRINT_STATUS.ENROLLED
          ? FINGERPRINT_STATUS.ENROLLED
          : FINGERPRINT_STATUS.NOT_ENROLLED,
      fingerBaseline,
      fingerCount: 0,
      devicePrivilege: privilege,
      deviceUserEnabled: true,
    });

    await refreshDeviceTelemetry(device);
    return { ok: true, device, deviceUserId, employee: updated };
  } catch (err) {
    logger.error(`[biometric] syncEmployee(${employee._id}) failed: ${err.message}`);
    await employeeRepo.setSyncFailure(employee._id, err);
    await deviceRepo.updateTelemetry(device._id, {
      connectionStatus: DEVICE_CONN_STATUS.ERROR,
      lastError: err.message,
    });
    return { ok: false, error: err.message, device };
  }
};

/**
 * Bulk employee synchronisation — diff-based.
 *
 * The naive "push everyone every time" strategy hammers the K40 (each
 * createUser is a serialised round-trip) and thrashes the Mongo `User`
 * doc. Instead we:
 *
 *   1. Read every syncable HRMS employee.
 *   2. Read every user currently on the device.
 *   3. Build a canonical (uid, userId, name, privilege) tuple for both
 *      sides and diff them.
 *   4. CREATE users missing on the device.
 *   5. UPDATE users whose name/privilege drifted.
 *   6. DELETE users that exist on the device but not in HRMS — only when
 *      the caller passes `deleteOrphans: true` (default is safe: NO
 *      deletes). This matches the "if configured" requirement in §4.
 *   7. SKIP identical users (biggest win).
 *
 * Returns a structured summary consumed by the API + logs.
 */
const _canonicalDeviceUser = (u) => ({
  uid: Number(u.uid),
  userId: String(u.userId ?? u.uid),
  name: String(u.name || '').trim().slice(0, 24),
  privilege: Number(u.role ?? u.privilege ?? 0) || 0,
});

const syncAllEmployees = async (deviceId, opts = {}) => {
  const startedAt = Date.now();
  const deleteOrphans = opts.deleteOrphans === true
    || String(process.env.BIOMETRIC_DELETE_ORPHANS || '').toLowerCase() === 'true';
  const device = await resolveDevice(deviceId);
  if (!device) throw new Error('No device configured');

  const employees = await employeeRepo.listSyncable();

  // Fetch the device roster ONCE. If the device is unreachable we fall back
  // to the legacy behaviour (push every employee) so we never leave the
  // system in a worse state than before.
  let deviceUsers = [];
  let rosterOk = true;
  try {
    deviceUsers = await zk.getUsers(device);
  } catch (err) {
    rosterOk = false;
    logger.warn(`[biometric] syncAllEmployees: could not read device roster (${err.message}); falling back to full push`);
  }

  // Index device rows by userId (canonical HRMS matching key). Some
  // firmwares report userId="" — index by numeric uid too so we can still
  // recognise those rows.
  const byUserId = new Map();
  const byUid = new Map();
  for (const u of deviceUsers) {
    const c = _canonicalDeviceUser(u);
    if (c.userId) byUserId.set(c.userId, c);
    if (c.uid) byUid.set(String(c.uid), c);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let deleted = 0;
  let failed = 0;
  const errors = [];

  // Track which device UIDs we've reconciled so the delete pass only
  // touches truly orphan rows.
  const seenDeviceUids = new Set();

  for (const emp of employees) {
    // A brand-new binding (no deviceUserId yet) always goes through
    // syncEmployee — it allocates a free UID, purges residuals, resets
    // fingerBaseline, etc. Cheap short-circuit that reuses existing logic.
    if (!emp.deviceUserId || String(emp.deviceId) !== String(device._id) || !rosterOk) {
      // eslint-disable-next-line no-await-in-loop
      const res = await syncEmployee(emp, { device });
      if (res.ok) {
        created += 1;
        if (res.deviceUserId) seenDeviceUids.add(String(res.deviceUserId));
      } else {
        failed += 1;
        errors.push({ employee: emp._id, name: emp.fullName, error: res.error });
      }
      continue;
    }

    const key = String(emp.deviceUserId);
    seenDeviceUids.add(key);
    const row = byUserId.get(key) || byUid.get(key);
    const wantName = String(emp.fullName || '').trim().slice(0, 24);
    const wantPriv = Number.isFinite(emp.devicePrivilege) ? emp.devicePrivilege : ZK_PRIVILEGE.USER;

    if (!row) {
      // Present in HRMS, missing on device — create.
      try {
        // eslint-disable-next-line no-await-in-loop
        await zk.createUser(device, {
          uid: Number(emp.deviceUserId),
          userId: String(emp.deviceUserId),
          name: wantName,
          privilege: wantPriv,
          password: '',
        });
        // eslint-disable-next-line no-await-in-loop
        await employeeRepo.setSyncSuccess(emp._id, {
          deviceId: device._id,
          deviceUserId: emp.deviceUserId,
          fingerprintStatus: emp.fingerprintStatus || FINGERPRINT_STATUS.NOT_ENROLLED,
          fingerBaseline: Number(emp.fingerBaseline) || 0,
          fingerCount: Number(emp.fingerCount) || 0,
          devicePrivilege: wantPriv,
          deviceUserEnabled: true,
        });
        created += 1;
      } catch (err) {
        failed += 1;
        errors.push({ employee: emp._id, name: emp.fullName, error: err.message });
      }
    } else if (row.name !== wantName || row.privilege !== wantPriv) {
      // Drifted metadata — push an update (same protocol command).
      try {
        // eslint-disable-next-line no-await-in-loop
        await zk.updateUser(device, {
          uid: Number(emp.deviceUserId),
          userId: String(emp.deviceUserId),
          name: wantName,
          privilege: wantPriv,
          password: '',
        });
        updated += 1;
      } catch (err) {
        failed += 1;
        errors.push({ employee: emp._id, name: emp.fullName, error: err.message });
      }
    } else {
      // Identical on both sides — no write.
      skipped += 1;
    }
  }

  // Optional orphan cleanup — deletes users present on the device but not
  // tied to any HRMS employee. Guarded because on shared devices this
  // could nuke rows created out-of-band (contractors, admin-only cards).
  if (rosterOk && deleteOrphans) {
    const hrmsUids = new Set(employees
      .filter((e) => e.deviceId && String(e.deviceId) === String(device._id))
      .map((e) => String(e.deviceUserId)));
    for (const row of deviceUsers) {
      const key = String(row.userId ?? row.uid);
      if (hrmsUids.has(key)) continue;
      if (seenDeviceUids.has(key)) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        await zk.deleteUser(device, row.uid);
        deleted += 1;
      } catch (err) {
        errors.push({ deviceUserId: key, error: err.message });
      }
    }
  }

  await refreshDeviceTelemetry(device);
  const durationMs = Date.now() - startedAt;
  const summary = {
    total: employees.length,
    created,
    updated,
    skipped,
    deleted,
    failed,
    // Kept for backward compatibility with existing controllers/clients
    // that reference the old field name.
    synced: created + updated,
    errors,
    durationMs,
  };
  logger.info(
    `[biometric] syncAllEmployees(${device.name}) created=${created} updated=${updated} skipped=${skipped} deleted=${deleted} failed=${failed} in ${durationMs}ms`
  );
  return summary;
};

const deleteEmployeeFromDevice = async (employee) => {
  if (!employee.deviceId || !employee.deviceUserId) {
    await employeeRepo.clearDevice(employee._id);
    return { ok: true, skipped: true };
  }
  const device = await deviceRepo.findById(employee.deviceId);
  if (!device) {
    await employeeRepo.clearDevice(employee._id);
    return { ok: true, skipped: true };
  }
  try {
    await zk.deleteUser(device, employee.deviceUserId);
    await employeeRepo.clearDevice(employee._id);
    await refreshDeviceTelemetry(device);
    return { ok: true };
  } catch (err) {
    await employeeRepo.setSyncFailure(employee._id, err);
    return { ok: false, error: err.message };
  }
};

const setEmployeeEnabled = async (employee, enabled) => {
  if (!employee.deviceId || !employee.deviceUserId) {
    throw new Error('Employee is not synced to any device');
  }
  const device = await deviceRepo.findById(employee.deviceId);
  if (!device) throw new Error('Device not found');
  if (enabled) {
    // K40 has no per-user enable command; re-push the user record so it
    // reappears on the device if it had been removed.
    await zk.enableUser(device, {
      uid: Number(employee.deviceUserId),
      userId: String(employee.deviceUserId),
      name: employee.fullName || '',
      privilege: Number(employee.devicePrivilege) || 0,
    });
  } else {
    await zk.disableUser(device, employee.deviceUserId);
  }
  return employeeRepo.setDeviceEnabled(employee._id, enabled);
};

// ------------------------------------------------------------------
// Fingerprint status refresh
// ------------------------------------------------------------------

/** Refresh fingerprint enrolment state for one employee. */
const refreshFingerprintStatus = async (employee) => {
  if (!employee.deviceId || !employee.deviceUserId) {
    return { ok: false, error: 'Employee not synced to any device' };
  }
  const device = await deviceRepo.findById(employee.deviceId);
  if (!device) return { ok: false, error: 'Device not found' };

  const users = await zk.getUsers(device);
  const row = users.find(
    (u) => String(u.userId) === String(employee.deviceUserId) || String(u.uid) === String(employee.deviceUserId)
  );
  if (!row) {
    // The device no longer knows this user — mark as failed sync.
    await employeeRepo.setSyncFailure(employee._id, 'User not present on device');
    return { ok: false, error: 'User not present on device' };
  }
  // Use the reliable per-user fingerCount from getUsers() — the low-level
  // USERTEMP_RRQ probe is broken on some K40 firmwares (returns 10 for every
  // slot regardless of reality).
  const rawCount = Number(row.fingerCount) || 0;
  const baseline = Number(employee.fingerBaseline) || 0;
  const newFingers = Math.max(0, rawCount - baseline);
  // Fallback proof: some K40 firmwares don't expose fingerCount at all
  // (always 0). A successful device punch is definitive proof the finger is
  // enrolled — the K40 only records punches AFTER verifying against a template.
  const cutoff = employee.createdAt;
  const punchExists = await DevicePunch.exists({
    employee: employee._id,
    matched: true,
    ...(cutoff ? { punchAt: { $gte: new Date(cutoff) } } : {}),
  });
  const status = (newFingers > 0 || punchExists)
    ? FINGERPRINT_STATUS.ENROLLED
    : FINGERPRINT_STATUS.NOT_ENROLLED;
  const updated = await employeeRepo.setFingerprintStatus(employee._id, status, Math.max(newFingers, punchExists ? 1 : 0));
  return { ok: true, employee: updated, fingerCount: newFingers, rawCount, baseline, punchProof: !!punchExists };
};

/** Refresh fingerprint status for every synced employee on a device. */
const refreshAllFingerprintStatuses = async (deviceId, { onlyNotEnrolled = false } = {}) => {
  const device = await resolveDevice(deviceId);
  if (!device) throw new Error('No device configured');
  const users = await zk.getUsers(device);
  const byId = new Map(users.map((u) => [String(u.userId), u]));
  let employees = await employeeRepo.listSyncable({ deviceId: device._id });
  if (onlyNotEnrolled) {
    employees = employees.filter((e) => e.fingerprintStatus !== FINGERPRINT_STATUS.ENROLLED);
  }
  let updated = 0;
  for (const emp of employees) {
    const row = byId.get(String(emp.deviceUserId));
    if (!row) continue;
    // Trust getUsers().fingerCount — the K40 firmware's per-slot probe is
    // unreliable (returns 10 for every user regardless of reality).
    const rawCount = Number(row.fingerCount) || 0;
    const baseline = Number(emp.fingerBaseline) || 0;
    const newFingers = Math.max(0, rawCount - baseline);
    // Fallback proof: a successful device punch means the K40 verified this
    // employee's finger, which is definitive proof of enrolment even when
    // fingerCount is stuck at 0 on this firmware.
    const cutoff = emp.createdAt;
    // eslint-disable-next-line no-await-in-loop
    const punchExists = await DevicePunch.exists({
      employee: emp._id,
      matched: true,
      ...(cutoff ? { punchAt: { $gte: new Date(cutoff) } } : {}),
    });
    const status = (newFingers > 0 || punchExists)
      ? FINGERPRINT_STATUS.ENROLLED
      : FINGERPRINT_STATUS.NOT_ENROLLED;
    const displayCount = Math.max(newFingers, punchExists ? 1 : 0);
    if (emp.fingerprintStatus !== status || emp.fingerCount !== displayCount) {
      // eslint-disable-next-line no-await-in-loop
      await employeeRepo.setFingerprintStatus(emp._id, status, displayCount);
      updated += 1;
    }
  }
  return { total: employees.length, updated };
};

// ------------------------------------------------------------------
// Attendance import
// ------------------------------------------------------------------

/** Pull attendance from device and fold each punch into MongoDB. */
const importAttendance = async (deviceId, { clearAfter = false } = {}) => {
  const device = await resolveDevice(deviceId);
  if (!device) throw new Error('No device configured');

  // Serialise imports per device. If a previous import is still running we
  // skip this cycle rather than piling up — the next tick will retry with a
  // fresh HWM. The lock has a stale-lease TTL so a crashed caller can't
  // wedge the poller forever.
  const release = attendanceLock.acquire(device._id);
  if (!release) {
    logger.warn(`[biometric] importAttendance(${device.name}) skipped — previous import still in flight`);
    return { imported: 0, skipped: 0, total: 0, lastAt: null, locked: true };
  }

  realtime.emit('attendance-import-started', {
    deviceId: String(device._id),
    name: device.name,
    at: new Date(),
  });

  try {
    const rawPunches = await zk.getAttendance(device);

  // Collapse identical rows (same user + timestamp). Some K40 firmwares log
  // each physical tap as two verify/attendance records with the same
  // timestamp; without this the same punch would fire twice.
  //
  // The `seen` Set is scoped tightly so its ~O(punches) memory can be
  // reclaimed by GC as soon as the de-dup pass finishes, even if the
  // outer function is still processing.
  const punches = (() => {
    const seen = new Set();
    const out = [];
    for (const p of rawPunches) {
      const k = `${String(p.deviceUserId)}|${new Date(p.timestamp).getTime()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p);
    }
    return out;
  })();

  // High-water mark: node-zklib always returns the FULL punch log (all 80+
  // records the K40 keeps in memory) on every getAttendance() call. Without
  // this filter we re-run upsertPunch + DevicePunch.updateOne for every
  // historical punch on every poll cycle — that's what was making the web
  // Clock In / Clock Out feel "very slow" and re-polluting attendance rows
  // with old check-outs. We only process punches strictly newer than the
  // last punch we've already imported for this device.
  const hwm = device.lastPunchAt ? new Date(device.lastPunchAt).getTime() : 0;
  const freshPunches = hwm
    ? punches.filter((p) => new Date(p.timestamp).getTime() > hwm)
    : punches;
  // Compute new HWM up front from the FULL punch set (so replays past
  // history don't move the mark backwards).
  let newestSeen = hwm;
  for (const p of punches) {
    const t = new Date(p.timestamp).getTime();
    if (t > newestSeen) newestSeen = t;
  }

  // Build a device userId-string → uid map. When a punch's `deviceUserId`
  // (which is the device's userId STRING) does not directly match an HRMS
  // record, we fall back to the numeric uid — that's how legacy or
  // out-of-band device registrations still get matched.
  const users = await zk.getUsers(device).catch(() => []);
  const userIdToUid = new Map(users.map((u) => [String(u.userId), String(u.uid)]));

  // Per-cycle employee cache. The K40 typically returns several punches for
  // the same user in one import (check-in + check-out on the same tick, or
  // multiple ticks during a shift). Without a cache each punch fires a
  // fresh `User.findOne({ deviceId, deviceUserId })` — with 20 punches for
  // 10 employees that's 20 Mongo round-trips. With this cache it's 10.
  const empCache = new Map();
  const resolveEmployee = async (raw) => {
    if (empCache.has(raw)) return empCache.get(raw);
    let emp = await employeeRepo.findByDeviceUserId(device._id, raw);
    if (!emp && userIdToUid.has(raw)) {
      emp = await employeeRepo.findByDeviceUserId(device._id, userIdToUid.get(raw));
    }
    empCache.set(raw, emp || null);
    return emp;
  };

  // DevicePunch is a pure audit-trail collection with no business-logic
  // dependency during the loop. Collect upserts into a single bulkWrite
  // so N punches produce ONE Mongo round-trip instead of N.
  const punchOps = [];
  // Track the latest punch per employee so we can flush `lastAttendance`
  // updates in a single bulkWrite at the end (was one User.save() per
  // punch, i.e. quadratic writes on a busy day).
  const lastAttPerEmp = new Map();

  let imported = 0;
  let skipped = 0;
  let lastAt = null;
  for (const p of freshPunches) {
    const raw = String(p.deviceUserId);
    // eslint-disable-next-line no-await-in-loop
    const emp = await resolveEmployee(raw);
    if (!emp) { skipped += 1; }

    // Queue the DevicePunch audit row — deduped by the collection's unique
    // (device, deviceUserId, punchAt) index, so replaying a cycle is safe.
    punchOps.push({
      updateOne: {
        filter: { device: device._id, deviceUserId: raw, punchAt: new Date(p.timestamp) },
        update: {
          $setOnInsert: {
            device: device._id,
            deviceUserId: raw,
            punchAt: new Date(p.timestamp),
          },
          $set: {
            employee: emp ? emp._id : null,
            checkType: p.checkType,
            verificationMode: p.verificationMode,
            terminal: device.name,
            matched: !!emp,
          },
        },
        upsert: true,
      },
    });
    if (!emp) continue;

    // Gate — ignore stale device history. Reject punches that happened
    // BEFORE the employee record was created in HRMS. This kills old K40
    // history under a recycled UID (previous holder) without depending on
    // lastSync, which gets bumped by every re-sync / rebaseline operation.
    const cutoff = emp.createdAt;
    if (cutoff && new Date(p.timestamp) < new Date(cutoff)) {
      skipped += 1;
      continue;
    }

    // Auto-enrol on first successful fingerprint punch. The K40 only records
    // a punch AFTER it has verified the finger against a stored template, so
    // the punch itself is proof of enrolment. This is essential on firmwares
    // where getUsers().fingerCount always reports 0 (node-zklib can't read
    // the template count field they use).
    if (emp.fingerprintStatus !== FINGERPRINT_STATUS.ENROLLED) {
      // eslint-disable-next-line no-await-in-loop
      await employeeRepo.setFingerprintStatus(emp._id, FINGERPRINT_STATUS.ENROLLED, 1);
      emp.fingerprintStatus = FINGERPRINT_STATUS.ENROLLED;
      logger.info(`[biometric] auto-enrolled ${emp.fullName} (${emp.employeeId}) on first verified punch.`);
    }

    // eslint-disable-next-line no-await-in-loop
    const { doc, event } = await attendanceRepo.upsertPunch({
      employeeId: emp._id,
      deviceId: device._id,
      terminal: device.name,
      deviceUserId: String(emp.deviceUserId), // canonical HRMS value
      checkType: p.checkType,
      verificationMode: p.verificationMode,
      punchAt: p.timestamp,
    });
    if (!lastAt || p.timestamp > lastAt) lastAt = p.timestamp;
    // Track newest timestamp per employee — flushed in a single bulkWrite
    // once the loop finishes (used to be one User.save() per punch).
    const prev = lastAttPerEmp.get(String(emp._id));
    if (!prev || p.timestamp > prev) lastAttPerEmp.set(String(emp._id), p.timestamp);
    imported += 1;
    // Broadcast the newly-recorded punch so the dashboard updates without
    // polling. Delivery is best-effort — if socket.io isn't initialised
    // this is a no-op.
    realtime.emit('attendance-created', {
      employeeId: String(emp._id),
      employeeName: emp.fullName,
      device: { id: String(device._id), name: device.name, ip: device.ip },
      timestamp: p.timestamp,
      status: event || p.checkType || null,
      checkType: p.checkType,
      verificationMode: p.verificationMode,
    });
    if (event === 'CHECK_IN' || event === 'CHECK_OUT') {
      // Fire and forget — never block the import loop on notification delivery.
      notifyAdminsOfPunch({ employee: emp, event, punchAt: p.timestamp, device, doc });
    }
  }

  // -------- Batch flush: DevicePunch audit + User.lastAttendance --------
  if (punchOps.length > 0) {
    try {
      await DevicePunch.bulkWrite(punchOps, { ordered: false });
    } catch (err) {
      // Duplicate-key errors are expected when replaying (the unique index
      // enforces one row per physical tap); other errors just log.
      if (err.code !== 11000) {
        logger.warn(`[biometric] DevicePunch bulkWrite: ${err.message}`);
      }
    }
  }
  if (lastAttPerEmp.size > 0) {
    const userOps = [];
    for (const [id, ts] of lastAttPerEmp) {
      userOps.push({
        updateOne: {
          filter: { _id: id },
          update: { $set: { lastAttendance: new Date(ts) } },
        },
      });
    }
    try { await User.bulkWrite(userOps, { ordered: false }); } catch (err) {
      logger.warn(`[biometric] User lastAttendance bulkWrite: ${err.message}`);
    }
  }
  await deviceRepo.updateTelemetry(device._id, {
    lastSync: new Date(),
    connectionStatus: DEVICE_CONN_STATUS.ONLINE,
    lastError: null,
    // Persist the high-water mark so the next importAttendance skips every
    // punch we've already processed — this is the biggest single perf win
    // (turns a 5-10s import into <100 ms on average).
    ...(newestSeen > hwm ? { lastPunchAt: new Date(newestSeen) } : {}),
  });
  if (clearAfter && imported > 0) {
    try { await zk.clearAttendance(device); } catch (err) {
      logger.warn(`[biometric] clearAttendance failed after import: ${err.message}`);
    }
  }
    const result = { imported, skipped, total: punches.length, lastAt };
    realtime.emit('attendance-import-finished', {
      deviceId: String(device._id),
      name: device.name,
      ...result,
      at: new Date(),
    });
    return result;
  } catch (err) {
    // Surface import failures via socket so the UI can show a toast.
    realtime.emit('attendance-import-failed', {
      deviceId: String(device._id),
      name: device.name,
      error: err.message,
      at: new Date(),
    });
    throw err;
  } finally {
    // ALWAYS release the lock, even on throw — that's the whole point of
    // acquiring it inside a try/finally block.
    release();
  }
};

/** Import users from the device into HRMS (best-effort — reports orphan device rows). */
const importEmployeesFromDevice = async (deviceId) => {
  const device = await resolveDevice(deviceId);
  if (!device) throw new Error('No device configured');
  const users = await zk.getUsers(device);
  const results = [];
  for (const u of users) {
    const existing = await employeeRepo.findByDeviceUserId(device._id, String(u.userId));
    results.push({
      deviceUserId: String(u.userId),
      name: u.name,
      fingerCount: u.fingerCount,
      matched: !!existing,
      employee: existing ? existing._id : null,
    });
  }
  return { total: users.length, results };
};

module.exports = {
  // devices
  resolveDevice,
  refreshDeviceTelemetry,
  testConnection,
  connectDevice,
  disconnectDevice,
  restartDevice,
  clearAttendanceLogs,
  // employees
  syncEmployee,
  syncAllEmployees,
  deleteEmployeeFromDevice,
  setEmployeeEnabled,
  refreshFingerprintStatus,
  refreshAllFingerprintStatuses,
  // attendance
  importAttendance,
  importEmployeesFromDevice,
};
