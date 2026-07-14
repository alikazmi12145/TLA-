const asyncHandler = require('express-async-handler');
const path = require('path');
const ApiError = require('../utils/ApiError');
const { success } = require('../utils/response');
const User = require('../models/User');
const biometric = require('../services/biometric.service');
const logger = require('../utils/logger');

const normalizeOffDays = (raw) => {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const arr = Array.isArray(raw) ? raw : String(raw).split(',');
  const cleaned = arr
    .map((v) => Number(String(v).trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return Array.from(new Set(cleaned));
};

const buildFilter = (q) => {
  const filter = {};
  if (q.role) filter.role = q.role;
  if (q.department) filter.department = q.department;
  if (q.status) filter.status = q.status;
  if (q.search) {
    const rx = new RegExp(q.search.trim(), 'i');
    filter.$or = [{ fullName: rx }, { email: rx }, { employeeId: rx }, { phone: rx }, { cnic: rx }];
  }
  return filter;
};

exports.list = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 10);
  const filter = buildFilter(req.query);
  const [items, total] = await Promise.all([
    User.find(filter)
      .populate('department', 'name code')
      .populate('shift', 'name startTime endTime')
      .populate('deviceId', 'name ip port serialNumber')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(filter),
  ]);
  return success(res, items, 'Employees', 200, { page, limit, total, pages: Math.ceil(total / limit) });
});

exports.getOne = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id)
    .populate('department', 'name code')
    .populate('shift', 'name startTime endTime')
    .populate('deviceId', 'name ip port serialNumber connectionStatus');
  if (!user) throw new ApiError(404, 'Employee not found');
  return success(res, user.toSafeJSON(), 'Employee');
});

exports.create = asyncHandler(async (req, res) => {
  const body = { ...req.body };
  const offDays = normalizeOffDays(body.weeklyOffDays);
  if (offDays !== undefined) body.weeklyOffDays = offDays;
  if (req.file) body.profilePicture = `/uploads/profiles/${req.file.filename}`;
  if (!body.password) body.password = 'Welcome@123';

  // 1) Persist employee first. Device sync is best-effort and MUST NOT roll this back.
  const user = await User.create(body);

  // 2) Push to biometric device (never throw — swallow + record on the user).
  let biometricResult = { ok: false, skipped: true };
  try {
    const device = await biometric.resolveDevice();
    if (device) {
      biometricResult = await biometric.syncEmployee(user, { device });
    } else {
      biometricResult = { ok: false, error: 'No biometric device configured' };
    }
  } catch (err) {
    logger.error(`[employee.create] biometric sync error: ${err.message}`);
    biometricResult = { ok: false, error: err.message };
  }

  // 3) Return the freshest copy of the user (sync mutates fields).
  const fresh = await User.findById(user._id);
  return success(
    res,
    { employee: fresh.toSafeJSON(), biometric: biometricResult },
    biometricResult.ok
      ? 'Employee created and synchronized to device'
      : 'Employee created; device synchronization failed',
    201
  );
});

exports.update = asyncHandler(async (req, res) => {
  const body = { ...req.body };
  const offDays = normalizeOffDays(body.weeklyOffDays);
  if (offDays !== undefined) body.weeklyOffDays = offDays;
  if (req.file) body.profilePicture = `/uploads/profiles/${req.file.filename}`;
  delete body.password; // password is changed via dedicated endpoint
  const user = await User.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });
  if (!user) throw new ApiError(404, 'Employee not found');
  return success(res, user.toSafeJSON(), 'Employee updated');
});

exports.remove = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) throw new ApiError(404, 'Employee not found');
  // Cascade-delete records that reference this employee so they don't
  // surface as orphaned rows (e.g. attendance sessions with a null
  // `employee` populate result) after the user is removed. Also null
  // out references on records we keep (Department.head, Target.setBy /
  // completedBy) so populates don't return stale ids.
  const Attendance = require('../models/Attendance');
  const DevicePunch = require('../models/DevicePunch');
  const Leave = require('../models/Leave');
  const Payroll = require('../models/Payroll');
  const Notification = require('../models/Notification');
  const Commission = require('../models/Commission');
  const Target = require('../models/Target');
  const Department = require('../models/Department');
  await Promise.allSettled([
    Attendance.deleteMany({ employee: user._id }),
    DevicePunch.deleteMany({ employee: user._id }),
    Leave.deleteMany({ employee: user._id }),
    Payroll.deleteMany({ employee: user._id }),
    Notification.deleteMany({ user: user._id }),
    Commission.deleteMany({ employee: user._id }),
    Target.deleteMany({ employee: user._id }),
    Target.updateMany({ completedBy: user._id }, { $set: { completedBy: null } }),
    Target.updateMany({ setBy: user._id }, { $set: { setBy: null } }),
    Department.updateMany({ head: user._id }, { $set: { head: null } }),
  ]);
  return success(res, {}, 'Employee deleted');
});

exports.toggleStatus = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'Employee not found');
  user.isActive = !user.isActive;
  user.status = user.isActive ? 'ACTIVE' : 'INACTIVE';
  await user.save();
  return success(res, user.toSafeJSON(), 'Status updated');
});

exports.resetEmployeePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'Employee not found');
  user.password = req.body.newPassword || 'Welcome@123';
  user.refreshTokens = [];
  await user.save();
  return success(res, {}, 'Password reset for employee');
});

// -------- Biometric endpoints -----------------------------------------------

const requireEmployee = async (id) => {
  const user = await User.findById(id);
  if (!user) throw new ApiError(404, 'Employee not found');
  return user;
};

/** POST /employees/:id/sync — push the employee to a device (primary by default). */
exports.syncToDevice = asyncHandler(async (req, res) => {
  const user = await requireEmployee(req.params.id);
  const result = await biometric.syncEmployee(user, { deviceId: req.body?.deviceId });
  const fresh = await User.findById(user._id);
  if (!result.ok) throw new ApiError(502, result.error || 'Device sync failed', { biometric: result });
  return success(res, { employee: fresh.toSafeJSON(), biometric: result }, 'Employee synchronized');
});

/** POST /employees/:id/delete-device — remove the employee from the device. */
exports.deleteFromDevice = asyncHandler(async (req, res) => {
  const user = await requireEmployee(req.params.id);
  const result = await biometric.deleteEmployeeFromDevice(user);
  if (!result.ok) throw new ApiError(502, result.error || 'Device delete failed');
  const fresh = await User.findById(user._id);
  return success(res, { employee: fresh.toSafeJSON() }, 'Employee removed from device');
});

/** POST /employees/:id/refresh-fingerprint — pull the latest enrolment state. */
exports.refreshFingerprint = asyncHandler(async (req, res) => {
  const user = await requireEmployee(req.params.id);
  const result = await biometric.refreshFingerprintStatus(user);
  if (!result.ok) throw new ApiError(502, result.error || 'Refresh failed');
  return success(res, { employee: result.employee.toSafeJSON(), fingerCount: result.fingerCount }, 'Fingerprint status refreshed');
});

/**
 * GET /employees/:id/enrollment-status — poll-friendly enrolment probe.
 * Used by the create-employee wizard to wait for the admin to physically
 * punch the finger on the device. Never throws on device errors — the UI
 * needs a stable shape to keep polling until the finger is enrolled.
 */
exports.enrollmentStatus = asyncHandler(async (req, res) => {
  const user = await requireEmployee(req.params.id);
  const base = {
    employeeId: user._id,
    deviceUserId: user.deviceUserId || null,
    deviceSynced: !!user.deviceSynced,
    fingerprintStatus: user.fingerprintStatus,
    fingerCount: user.fingerCount || 0,
    enrolled: user.fingerprintStatus === 'ENROLLED',
    error: null,
  };
  if (!user.deviceSynced || !user.deviceId || !user.deviceUserId) {
    return success(res, base, 'Enrollment status');
  }
  try {
    const result = await biometric.refreshFingerprintStatus(user);
    if (!result.ok) {
      return success(res, { ...base, error: result.error }, 'Enrollment status');
    }
    const fresh = result.employee;
    return success(
      res,
      {
        employeeId: fresh._id,
        deviceUserId: fresh.deviceUserId || null,
        deviceSynced: !!fresh.deviceSynced,
        fingerprintStatus: fresh.fingerprintStatus,
        fingerCount: fresh.fingerCount || 0,
        enrolled: fresh.fingerprintStatus === 'ENROLLED',
        error: null,
      },
      'Enrollment status'
    );
  } catch (err) {
    logger.warn(`[employee.enrollmentStatus] ${err.message}`);
    return success(res, { ...base, error: err.message }, 'Enrollment status');
  }
});

/** POST /employees/:id/enable-device — enable the record on the device. */
exports.enableOnDevice = asyncHandler(async (req, res) => {
  const user = await requireEmployee(req.params.id);
  const updated = await biometric.setEmployeeEnabled(user, true);
  return success(res, { employee: updated.toSafeJSON() }, 'User enabled on device');
});

/** POST /employees/:id/disable-device — disable the record on the device. */
exports.disableOnDevice = asyncHandler(async (req, res) => {
  const user = await requireEmployee(req.params.id);
  const updated = await biometric.setEmployeeEnabled(user, false);
  return success(res, { employee: updated.toSafeJSON() }, 'User disabled on device');
});
