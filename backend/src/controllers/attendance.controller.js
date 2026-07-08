const asyncHandler = require('express-async-handler');
const dayjs = require('dayjs');
const ApiError = require('../utils/ApiError');
const { success } = require('../utils/response');
const { startOfDay, endOfDay, startOfMonth, endOfMonth, diffMinutes } = require('../utils/date');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const Shift = require('../models/Shift');
const Holiday = require('../models/Holiday');
const Notification = require('../models/Notification');
const { ATTENDANCE_STATUS, ATTENDANCE_METHOD, ROLES } = require('../config/constants');

const notifyAdmins = async ({ type, title, message, meta }) => {
  try {
    const admins = await User.find({
      role: { $in: [ROLES.SUPER_ADMIN, ROLES.HR_MANAGER] },
      isActive: { $ne: false },
    }).select('_id');
    if (!admins.length) {
      console.warn('[notifyAdmins] no admin recipients found for', type);
      return;
    }
    const docs = admins.map((a) => ({ user: a._id, type, title, message, meta }));
    await Notification.insertMany(docs);
    console.log(`[notifyAdmins] sent ${docs.length} "${type}" notifications`);
  } catch (e) {
    console.error('[notifyAdmins] failed:', e?.message || e);
  }
};

const computeWorkMinutes = (a) => {
  if (!a.clockIn || !a.clockOut) return 0;
  return Math.max(0, diffMinutes(a.clockIn, a.clockOut));
};

const evaluateLate = async (employeeId, clockIn) => {
  const user = await User.findById(employeeId).populate('shift');
  if (!user || !user.shift || !user.shift.startTime) return { isLate: false, lateMinutes: 0 };
  const [h, m] = user.shift.startTime.split(':').map(Number);
  const expected = dayjs(clockIn).startOf('day').hour(h).minute(m).second(0);
  const lateMinutes = Math.max(0, dayjs(clockIn).diff(expected, 'minute') - (user.shift.graceMinutes || 0));
  return { isLate: lateMinutes > 0, lateMinutes };
};

// Gate: the employee must have physically punched in on the biometric device
// before the app Clock In button is allowed. Returns today's Attendance row.
const requireDeviceCheckInToday = async (employeeId) => {
  const date = startOfDay();
  const doc = await Attendance.findOne({ employee: employeeId, date });
  if (!doc || !doc.deviceCheckInAt) {
    throw new ApiError(403, 'Verify finger from device first');
  }
  return doc;
};

// Gate: the employee must have physically punched out on the biometric device
// before the app Clock Out button is allowed.
const requireDeviceCheckOutToday = async (employeeId) => {
  const date = startOfDay();
  const doc = await Attendance.findOne({ employee: employeeId, date });
  if (!doc || !doc.deviceCheckOutAt) {
    throw new ApiError(403, 'Punch out on device first');
  }
  return doc;
};

exports.clockIn = asyncHandler(async (req, res) => {
  const doc = await requireDeviceCheckInToday(req.user._id);
  if (doc.clockIn) throw new ApiError(400, 'Already clocked in today');
  doc.clockIn = new Date();
  const { isLate, lateMinutes } = await evaluateLate(req.user._id, doc.clockIn);
  doc.isLate = isLate;
  doc.lateMinutes = lateMinutes;
  if (isLate) doc.status = ATTENDANCE_STATUS.LATE;
  if (req.body && typeof req.body.note === 'string' && req.body.note.trim()) {
    doc.note = req.body.note.trim();
  }
  await doc.save();

  // Clock-in admin notifications are intentionally disabled (dashboard noise reduction).

  return success(res, doc, 'Clocked in');
});

exports.clockOut = asyncHandler(async (req, res) => {
  const doc = await requireDeviceCheckOutToday(req.user._id);
  if (!doc.clockIn) throw new ApiError(400, 'Clock-in required first');
  if (doc.clockOut) throw new ApiError(400, 'Already clocked out');
  doc.clockOut = new Date();
  doc.workMinutes = computeWorkMinutes(doc);
  if (req.body && typeof req.body.note === 'string' && req.body.note.trim()) {
    const incoming = req.body.note.trim();
    doc.note = doc.note ? `${doc.note}\n${incoming}` : incoming;
  }
  await doc.save();

  // Clock-out admin notifications are intentionally disabled (dashboard noise reduction).

  return success(res, doc, 'Clocked out');
});

exports.today = asyncHandler(async (req, res) => {
  const date = startOfDay();
  const doc = await Attendance.findOne({ employee: req.user._id, date });
  return success(res, doc || null, 'Today attendance');
});

exports.myMonth = asyncHandler(async (req, res) => {
  const ref = req.query.month ? new Date(req.query.month) : new Date();
  const items = await Attendance.find({
    employee: req.user._id,
    date: { $gte: startOfMonth(ref), $lte: endOfMonth(ref) },
  }).sort({ date: 1 });
  return success(res, items, 'Monthly attendance');
});

exports.list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.employee) filter.employee = req.query.employee;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.from || req.query.to) {
    filter.date = {};
    if (req.query.from) filter.date.$gte = startOfDay(req.query.from);
    if (req.query.to) filter.date.$lte = endOfDay(req.query.to);
  } else if (req.query.month) {
    const ref = new Date(req.query.month);
    filter.date = { $gte: startOfMonth(ref), $lte: endOfMonth(ref) };
  }
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(1000, Number(req.query.limit) || 50);
  const [items, total] = await Promise.all([
    Attendance.find(filter)
      .populate('employee', 'fullName employeeId email department')
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Attendance.countDocuments(filter),
  ]);
  // Notes are visible only to SUPER_ADMIN
  const isSuperAdmin = req.user && req.user.role === ROLES.SUPER_ADMIN;
  const sanitized = isSuperAdmin
    ? items
    : items.map((it) => {
        const obj = it.toObject();
        delete obj.note;
        return obj;
      });
  return success(res, sanitized, 'Attendance', 200, { page, limit, total, pages: Math.ceil(total / limit) });
});

exports.adjust = asyncHandler(async (req, res) => {
  const { employee, date, status, clockIn, clockOut, note } = req.body;
  if (!employee || !date) throw new ApiError(400, 'employee and date required');
  const day = startOfDay(date);
  const doc = await Attendance.findOneAndUpdate(
    { employee, date: day },
    {
      $set: {
        method: ATTENDANCE_METHOD.MANUAL,
        status: status || ATTENDANCE_STATUS.PRESENT,
        clockIn: clockIn ? new Date(clockIn) : undefined,
        clockOut: clockOut ? new Date(clockOut) : undefined,
        note,
        adjustedBy: req.user._id,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (doc.clockIn && doc.clockOut) {
    doc.workMinutes = computeWorkMinutes(doc);
    await doc.save();
  }
  return success(res, doc, 'Attendance adjusted');
});

exports.dailySummary = asyncHandler(async (req, res) => {
  const date = startOfDay(req.query.date || new Date());
  const [total, present, absent, leave, late, halfDay] = await Promise.all([
    User.countDocuments({ isActive: true, role: { $ne: ROLES.SUPER_ADMIN } }),
    Attendance.countDocuments({ date, status: ATTENDANCE_STATUS.PRESENT }),
    Attendance.countDocuments({ date, status: ATTENDANCE_STATUS.ABSENT }),
    Attendance.countDocuments({ date, status: ATTENDANCE_STATUS.LEAVE }),
    Attendance.countDocuments({ date, status: ATTENDANCE_STATUS.LATE }),
    Attendance.countDocuments({ date, status: ATTENDANCE_STATUS.HALF_DAY }),
  ]);
  return success(res, { total, present, absent, leave, late, halfDay, date }, 'Daily summary');
});

exports.trend = asyncHandler(async (req, res) => {
  const days = Math.min(60, Number(req.query.days) || 30);
  const start = startOfDay(dayjs().subtract(days - 1, 'day').toDate());
  const items = await Attendance.aggregate([
    { $match: { date: { $gte: start } } },
    {
      $group: {
        _id: { date: '$date', status: '$status' },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.date': 1 } },
  ]);
  return success(res, items, 'Attendance trend');
});

// Bulk import from biometric/fingerprint device
exports.importBiometric = asyncHandler(async (req, res) => {
  const records = req.body.records || [];
  if (!Array.isArray(records)) throw new ApiError(400, 'records must be an array');
  let imported = 0, skipped = 0;
  for (const r of records) {
    const user = await User.findOne({ fingerprintId: r.fingerprintId });
    if (!user) { skipped++; continue; }
    const date = startOfDay(r.timestamp);
    const doc = await Attendance.findOneAndUpdate(
      { employee: user._id, date },
      { $setOnInsert: { method: ATTENDANCE_METHOD.FINGERPRINT, status: ATTENDANCE_STATUS.PRESENT } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (r.type === 'IN' && !doc.clockIn) {
      doc.clockIn = new Date(r.timestamp);
      const { isLate, lateMinutes } = await evaluateLate(user._id, doc.clockIn);
      doc.isLate = isLate; doc.lateMinutes = lateMinutes;
      if (isLate) doc.status = ATTENDANCE_STATUS.LATE;
    } else if (r.type === 'OUT') {
      doc.clockOut = new Date(r.timestamp);
      doc.workMinutes = computeWorkMinutes(doc);
    }
    await doc.save();
    imported++;
  }
  return success(res, { imported, skipped }, 'Biometric data imported');
});

// Mark today as Holiday for everyone if today is in Holiday table (utility)
exports.markHolidays = asyncHandler(async (_req, res) => {
  const date = startOfDay();
  const isHoliday = await Holiday.findOne({ date });
  if (!isHoliday) return success(res, {}, 'Today is not a holiday');
  const employees = await User.find({ isActive: true, role: { $ne: ROLES.SUPER_ADMIN } }).select('_id');
  const ops = employees.map((e) => ({
    updateOne: {
      filter: { employee: e._id, date },
      update: { $setOnInsert: { method: ATTENDANCE_METHOD.MANUAL, status: ATTENDANCE_STATUS.HOLIDAY } },
      upsert: true,
    },
  }));
  if (ops.length) await Attendance.bulkWrite(ops);
  return success(res, { count: ops.length }, 'Holiday attendance marked');
});
