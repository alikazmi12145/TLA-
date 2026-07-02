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
const User = require('../models/User');
const Notification = require('../models/Notification');
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

const notifyAdminsOfPunch = async ({ employee, event, punchAt, device, doc }) => {
  try {
    if (event !== 'CHECK_IN' && event !== 'CHECK_OUT') return;
    const recipients = await getAdminRecipients();
    if (!recipients.length) return;
    const name = employee.fullName || employee.employeeId || 'Employee';
    const when = _fmtTime(punchAt);
    const isIn = event === 'CHECK_IN';
    const title = isIn ? `${name} checked in` : `${name} checked out`;
    const message = isIn
      ? `${name} punched in at ${when} on ${device?.name || 'biometric device'}.`
      : `${name} punched out at ${when} on ${device?.name || 'biometric device'}.` +
        (doc?.workMinutes
          ? ` Total worked: ${Math.floor(doc.workMinutes / 60)}h ${doc.workMinutes % 60}m.`
          : '');
    const type = isIn ? 'ATTENDANCE_CLOCK_IN' : 'ATTENDANCE_CLOCK_OUT';
    const meta = {
      employeeId: employee._id,
      employeeName: name,
      deviceId: device?._id,
      deviceName: device?.name,
      event,
      punchAt,
      attendanceId: doc?._id,
      clockIn: doc?.clockIn,
      clockOut: doc?.clockOut,
      workMinutes: doc?.workMinutes,
    };
    const docs = recipients.map((uid) => ({
      user: uid, type, title, message, meta, link: '/attendance',
    }));
    await Notification.insertMany(docs, { ordered: false });
    logger.info(`[biometric] notify ${event} for ${name} → ${recipients.length} admin(s)`);
  } catch (err) {
    logger.warn(`[biometric] notifyAdminsOfPunch failed: ${err.message}`);
  }
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
    if (!deviceUserId || String(employee.deviceId) !== String(device._id)) {
      deviceUserId = await employeeRepo.nextFreeDeviceUserId(device._id);
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

    const updated = await employeeRepo.setSyncSuccess(employee._id, {
      deviceId: device._id,
      deviceUserId,
      fingerprintStatus:
        employee.fingerprintStatus === FINGERPRINT_STATUS.ENROLLED
          ? FINGERPRINT_STATUS.ENROLLED
          : FINGERPRINT_STATUS.NOT_ENROLLED,
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

/** Push every active employee to the given device. */
const syncAllEmployees = async (deviceId) => {
  const device = await resolveDevice(deviceId);
  if (!device) throw new Error('No device configured');
  const employees = await employeeRepo.listSyncable();
  let synced = 0;
  let failed = 0;
  const errors = [];
  for (const emp of employees) {
    const res = await syncEmployee(emp, { device });
    if (res.ok) synced += 1;
    else {
      failed += 1;
      errors.push({ employee: emp._id, name: emp.fullName, error: res.error });
    }
  }
  await refreshDeviceTelemetry(device);
  return { total: employees.length, synced, failed, errors };
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
  // getUsers() from node-zklib does NOT include the template count, so probe
  // per-finger via CMD_USERTEMP_RRQ to get the real enrolment count.
  const count = await zk.getUserFingerCount(device, row.uid ?? employee.deviceUserId);
  const status = count > 0 ? FINGERPRINT_STATUS.ENROLLED : FINGERPRINT_STATUS.NOT_ENROLLED;
  const updated = await employeeRepo.setFingerprintStatus(employee._id, status, count);
  return { ok: true, employee: updated, fingerCount: count };
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
    // eslint-disable-next-line no-await-in-loop
    const count = await zk.getUserFingerCount(device, row.uid ?? emp.deviceUserId);
    const status = count > 0 ? FINGERPRINT_STATUS.ENROLLED : FINGERPRINT_STATUS.NOT_ENROLLED;
    if (emp.fingerprintStatus !== status || emp.fingerCount !== count) {
      // eslint-disable-next-line no-await-in-loop
      await employeeRepo.setFingerprintStatus(emp._id, status, count);
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
  const rawPunches = await zk.getAttendance(device);

  // Collapse identical rows (same user + timestamp). Some K40 firmwares log
  // each physical tap as two verify/attendance records with the same
  // timestamp; without this the same punch would fire twice.
  const seen = new Set();
  const punches = [];
  for (const p of rawPunches) {
    const k = `${String(p.deviceUserId)}|${new Date(p.timestamp).getTime()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    punches.push(p);
  }

  // Build a device userId-string → uid map. When a punch's `deviceUserId`
  // (which is the device's userId STRING) does not directly match an HRMS
  // record, we fall back to the numeric uid — that's how legacy or
  // out-of-band device registrations still get matched.
  const users = await zk.getUsers(device).catch(() => []);
  const userIdToUid = new Map(users.map((u) => [String(u.userId), String(u.uid)]));

  let imported = 0;
  let skipped = 0;
  let lastAt = null;
  for (const p of punches) {
    const raw = String(p.deviceUserId);
    let emp = await employeeRepo.findByDeviceUserId(device._id, raw);
    if (!emp && userIdToUid.has(raw)) {
      // Try again via the device's numeric uid — handles cases where the
      // device stores userId="-0011" but HRMS stored deviceUserId="2".
      emp = await employeeRepo.findByDeviceUserId(device._id, userIdToUid.get(raw));
    }
    if (!emp) { skipped += 1; continue; }
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
    emp.lastAttendance = p.timestamp;
    await emp.save().catch(() => {});
    imported += 1;
    if (event === 'CHECK_IN' || event === 'CHECK_OUT') {
      // Fire and forget — never block the import loop on notification delivery.
      notifyAdminsOfPunch({ employee: emp, event, punchAt: p.timestamp, device, doc });
    }
  }
  await deviceRepo.updateTelemetry(device._id, {
    lastSync: new Date(),
    connectionStatus: DEVICE_CONN_STATUS.ONLINE,
    lastError: null,
  });
  if (clearAfter && imported > 0) {
    try { await zk.clearAttendance(device); } catch (err) {
      logger.warn(`[biometric] clearAttendance failed after import: ${err.message}`);
    }
  }
  return { imported, skipped, total: punches.length, lastAt };
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
