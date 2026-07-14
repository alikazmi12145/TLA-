const asyncHandler = require('express-async-handler');
const dayjs = require('dayjs');
const ApiError = require('../utils/ApiError');
const { success } = require('../utils/response');
const {
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  diffMinutes,
  resolveShiftAnchorDate,
  evaluateShiftLateness,
} = require('../utils/date');
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const Shift = require('../models/Shift');
const Holiday = require('../models/Holiday');
const Notification = require('../models/Notification');
const attendanceRepo = require('../repositories/attendance.repository');
const biometric = require('../services/biometric.service');
const logger = require('../utils/logger');
const {
  ATTENDANCE_STATUS,
  ATTENDANCE_METHOD,
  ROLES,
  FINGERPRINT_STATUS,
} = require('../config/constants');

// Opportunistically pull the freshest attendance punches from the employee's
// K40 before running the web Clock In / Clock Out gates. The background
// poller only runs every 60 s, so without this the user can be blocked
// simply because their real device punch hasn't been imported yet. A
// failing device sync must never prevent the fallback gate check from
// running, but we DO capture the error and surface it in the gate's 403
// so the user isn't told "punch your finger on the device first" when the
// real cause is a network glitch to the K40.
//
// Perf: node-zklib always returns the full punch history on every call
// (5-10s over LAN, more over WAN). We debounce so back-to-back web clicks
// don't stack multiple full imports — if the background poller (or a prior
// on-demand refresh) touched this device in the last DEBOUNCE_MS, we skip.
//
// The debounce MUST be >= the background poller cadence
// (BIOMETRIC_POLL_INTERVAL_MS, default 60s) — otherwise a shift-start burst
// of clock-ins (10-20 employees clicking within seconds of each other)
// each trigger a fresh 5-10s device import, and because attendanceLock
// serialises them, the API queues 50-100s of held HTTP requests. That's
// the exact "server overloaded during punches" spike we were seeing.
const _REFRESH_DEBOUNCE_MS = Number(process.env.ATTENDANCE_REFRESH_DEBOUNCE_MS) || 60 * 1000;
const _refreshDeviceStateFor = async (user) => {
  if (!user || !user.deviceId) return { synced: false, reason: 'no-device' };
  try {
    const Device = require('../models/Device');
    const dev = await Device.findById(user.deviceId).select('lastSync').lean();
    const age = dev?.lastSync ? Date.now() - new Date(dev.lastSync).getTime() : Infinity;
    if (age < _REFRESH_DEBOUNCE_MS) {
      return { synced: true, result: { skipped: true, reason: 'debounced' } };
    }
    const r = await biometric.importAttendance(user.deviceId);
    return { synced: true, result: r };
  } catch (err) {
    logger.warn(`[attendance] on-demand device sync failed: ${err.message}`);
    return { synced: false, reason: 'device-unreachable', error: err.message };
  }
};

// Explain to the user WHY the clock-in gate rejected them. Runs when
// `findOpenForEmployee` returned no open row — inspects today's row (if
// any) to pick a precise, actionable message instead of the generic
// "punch your finger on device first".
const _diagnoseNoOpenRow = async (employeeId, syncStatus) => {
  // Device sync failed → tell the user the device is unreachable, don't
  // blame them for not punching.
  if (syncStatus && syncStatus.synced === false && syncStatus.reason === 'device-unreachable') {
    return `Biometric device is unreachable right now — the server couldn't pull your latest punch. Try again in a moment, or contact HR. (${syncStatus.error})`;
  }
  const today = await Attendance.findOne({
    employee: employeeId,
    date: startOfDay(),
  }).lean();
  if (!today) {
    return 'Punch your finger on the device first, then try again';
  }
  const sessions = Array.isArray(today.sessions) ? today.sessions : [];
  const last = sessions[sessions.length - 1];
  // A legacy row with no sessions[] — punch never landed on the new
  // sessions[] model. Prompt a fresh punch.
  if (!last) {
    return 'Punch your finger on the device first, then try again';
  }
  // Session was already closed on the device (device-in AND device-out
  // stamped) but never web-clocked in. The K40 probably auto-toggled on a
  // repeat tap, or someone punched twice thinking the first didn't take.
  if (last.deviceCheckInAt && last.deviceCheckOutAt && !last.clockIn) {
    return 'Your last device punch was already registered as a check-OUT (the device treats a repeat tap as the opposite action). Punch your finger on the device again to start a fresh session, then click Clock In.';
  }
  // Session was fully closed (both device and web) — user needs to punch
  // again to open a new session for a second shift.
  if (last.deviceCheckInAt && last.deviceCheckOutAt && last.clockIn && last.clockOut) {
    return 'Your previous shift is fully closed. Punch your finger on the device to start a new session, then try again.';
  }
  return 'Punch your finger on the device first, then try again';
};

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
  if (!a || !a.clockIn || !a.clockOut) return 0;
  return Math.max(0, diffMinutes(a.clockIn, a.clockOut));
};

const evaluateLate = async (employeeId, clockIn, anchorDate) => {
  const user = await User.findById(employeeId).populate('shift');
  if (!user || !user.shift) return { isLate: false, lateMinutes: 0 };
  // Delegate to the shared pure helper (also used by verify-shift-anchoring.js)
  // so lateness rules stay in one place — Rule 11.
  return evaluateShiftLateness(user.shift, clockIn, anchorDate);
};

// Locate the row + last-session index the web Clock In button should act on.
// Returns the row when the employee has an OPEN shift whose last session has
// a fresh device check-in waiting for the app clock-in — Rule 2/9/10.3.
// `syncStatus` (optional) is the return value from `_refreshDeviceStateFor`
// and is used only to enrich the 403 message when the gate rejects.
const requireDeviceCheckInToday = async (employeeId, syncStatus) => {
  // Strict flow: no auto-reopen fallbacks. The employee MUST have a real
  // open device check-in on the K40 before Clock In is allowed.
  const row = await attendanceRepo.findOpenForEmployee(employeeId);
  if (!row) {
    const msg = await _diagnoseNoOpenRow(employeeId, syncStatus);
    throw new ApiError(403, msg);
  }
  attendanceRepo.ensureSessions(row);
  const last = row.sessions[row.sessions.length - 1];
  if (!last || !last.deviceCheckInAt) {
    const msg = await _diagnoseNoOpenRow(employeeId, syncStatus);
    throw new ApiError(403, msg);
  }
  return { row, last };
};

// Locate the row + last-session index the web Clock Out button should act on.
// Requires an OPEN shift whose last session already carries a device
// check-out — Rule 3/9/11.2.
const requireDeviceCheckOutToday = async (employeeId, syncStatus) => {
  const row = await attendanceRepo.findOpenForEmployee(employeeId);
  if (!row) {
    if (syncStatus && syncStatus.synced === false && syncStatus.reason === 'device-unreachable') {
      throw new ApiError(
        403,
        `Biometric device is unreachable right now — the server couldn't pull your latest punch. Try again in a moment. (${syncStatus.error})`
      );
    }
    throw new ApiError(
      403,
      'No active shift found. Punch your finger on the device to check out, then try again.'
    );
  }
  attendanceRepo.ensureSessions(row);
  const last = row.sessions[row.sessions.length - 1];
  if (!last || !last.deviceCheckOutAt) {
    if (syncStatus && syncStatus.synced === false && syncStatus.reason === 'device-unreachable') {
      throw new ApiError(
        403,
        `Biometric device is unreachable right now — the server couldn't pull your latest punch. Try again in a moment. (${syncStatus.error})`
      );
    }
    throw new ApiError(
      403,
      'No device check-out recorded yet. Wait a moment, punch your finger on the device to check out, then try again. (The K40 rejects repeat punches within its configured window — wait 30-60s if it beeps "duplicate".)'
    );
  }
  return { row, last };
};

exports.clockIn = asyncHandler(async (req, res) => {
  // Rule 10.1 — authenticated user is guaranteed by the protect middleware.
  // Rule 10.2 — employee must be enrolled on the biometric device.
  if (req.user.fingerprintStatus !== FINGERPRINT_STATUS.ENROLLED) {
    throw new ApiError(403, 'Enroll your fingerprint on the device first');
  }

  // Best-effort: pull any pending device punches BEFORE checking the gate so
  // a real device check-in that hasn't been picked up by the 60 s poller
  // yet is honoured immediately.
  const syncStatus = await _refreshDeviceStateFor(req.user);

  // Rule 10.3 — device check-in must exist on the open session.
  const { row, last } = await requireDeviceCheckInToday(req.user._id, syncStatus);

  // Rule 4 / 10.5 — reject if this session already has a web clock-in.
  if (last.clockIn) throw new ApiError(400, 'Already clocked in — clock out first');

  // NOTE: earlier revisions auto-backfilled prior sessions' web times from
  // device stamps here. That was wrong — every K40 auto-toggle micro-
  // session then rendered as a "completed" log entry. Leave prior sessions
  // untouched: without clockIn/clockOut they don't appear in the log
  // (isCompletedSession filters them out) and they don't contribute to
  // workMinutes. Any real prior shift still shows because it has real web
  // clock times.

  last.clockIn = new Date();

  // Only the FIRST session of the day is evaluated for lateness — split-shift
  // returns after lunch shouldn't be re-flagged against the shift start time.
  const isFirstSessionOfDay = row.sessions.length === 1;
  if (isFirstSessionOfDay) {
    const { isLate, lateMinutes } = await evaluateLate(req.user._id, last.clockIn, row.date);
    last.isLate = isLate;
    last.lateMinutes = lateMinutes;
    if (isLate) row.status = ATTENDANCE_STATUS.LATE;
  } else {
    last.isLate = false;
    last.lateMinutes = 0;
  }

  if (req.body && typeof req.body.note === 'string' && req.body.note.trim()) {
    row.note = req.body.note.trim();
  }

  attendanceRepo.recomputeAggregates(row);
  await row.save();

  // Clock-in admin notifications are intentionally disabled (dashboard noise reduction).

  return success(res, row, 'Clocked in');
});

exports.clockOut = asyncHandler(async (req, res) => {
  // Best-effort: pull any pending device punches BEFORE checking the gate
  // so a fresh device check-out isn't rejected just because the 60 s
  // background poller hasn't run yet.
  const syncStatus = await _refreshDeviceStateFor(req.user);

  // Rule 11.2 — device checkout must be present on the open session.
  const { row, last } = await requireDeviceCheckOutToday(req.user._id, syncStatus);

  // Rule 11.1 — active web clock-in must exist on this session.
  if (!last.clockIn) throw new ApiError(400, 'Clock-in required first');
  // Rule 5 / 11.3 — reject double clock-out.
  if (last.clockOut) throw new ApiError(400, 'Already clocked out');

  last.clockOut = new Date();
  last.workMinutes = computeWorkMinutes(last);

  if (req.body && typeof req.body.note === 'string' && req.body.note.trim()) {
    const incoming = req.body.note.trim();
    row.note = row.note ? `${row.note}\n${incoming}` : incoming;
  }

  attendanceRepo.recomputeAggregates(row);
  await row.save();

  // Clock-out admin notifications are intentionally disabled (dashboard noise reduction).

  return success(res, row, 'Clocked out');
});

exports.today = asyncHandler(async (req, res) => {
  // Surface any in-progress overnight shift first — its `date` may point at
  // the previous calendar day, but from the employee's POV that's still
  // "today's" active session until they clock out.
  const open = await attendanceRepo.findOpenForEmployee(req.user._id);
  if (open) {
    await open.populate({ path: 'employee', select: 'fullName employeeId email shift', populate: { path: 'shift', select: 'name startTime endTime graceMinutes' } });
    return success(res, open, 'Today attendance');
  }
  const date = startOfDay();
  const doc = await Attendance.findOne({ employee: req.user._id, date })
    .populate({ path: 'employee', select: 'fullName employeeId email shift', populate: { path: 'shift', select: 'name startTime endTime graceMinutes' } });
  return success(res, doc || null, 'Today attendance');
});

exports.myMonth = asyncHandler(async (req, res) => {
  const ref = req.query.month ? new Date(req.query.month) : new Date();
  const items = await Attendance.find({
    employee: req.user._id,
    date: { $gte: startOfMonth(ref), $lte: endOfMonth(ref) },
  })
    .populate({ path: 'employee', select: 'fullName employeeId shift', populate: { path: 'shift', select: 'name startTime endTime graceMinutes' } })
    .sort({ date: 1 });
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
      .populate({
        path: 'employee',
        select: 'fullName employeeId email department shift',
        populate: { path: 'shift', select: 'name startTime endTime graceMinutes' },
      })
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
  // Only $set fields the caller actually provided — passing `undefined` in a
  // $set is harmless for Mongoose but muddies intent, and (more importantly)
  // lets us keep the write purely status-only when no clock times are given.
  const setDoc = {
    method: ATTENDANCE_METHOD.MANUAL,
    status: status || ATTENDANCE_STATUS.PRESENT,
    adjustedBy: req.user._id,
  };
  if (clockIn) setDoc.clockIn = new Date(clockIn);
  if (clockOut) setDoc.clockOut = new Date(clockOut);
  if (note !== undefined) setDoc.note = note;
  const doc = await Attendance.findOneAndUpdate(
    { employee, date: day },
    { $set: setDoc },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Admin adjust is authoritative for the *last* session on the day. Fold
  // any legacy top-level data into sessions[] first, then apply the manual
  // times to the last session so aggregates and multi-shift history stay
  // in sync.
  //
  // IMPORTANT: never seed a blank session. A status-only adjust (e.g.
  // marking a no-punch day ABSENT/HOLIDAY/LEAVE) must NOT push `{}` into
  // sessions[] — that would materialise as a placeholder row in the
  // Attendance Logs (Rule 1 / Rule 5 / Rule 10). We only push when this
  // adjust carries real clock times.
  attendanceRepo.ensureSessions(doc);
  if (doc.sessions.length === 0) {
    if (clockIn || clockOut) {
      doc.sessions.push({
        clockIn: clockIn ? new Date(clockIn) : undefined,
        clockOut: clockOut ? new Date(clockOut) : undefined,
      });
    }
  } else {
    const last = doc.sessions[doc.sessions.length - 1];
    if (clockIn) last.clockIn = new Date(clockIn);
    if (clockOut) last.clockOut = new Date(clockOut);
  }
  const last = doc.sessions.length ? doc.sessions[doc.sessions.length - 1] : null;
  if (last && last.clockIn && last.clockOut) {
    last.workMinutes = computeWorkMinutes(last);
  }
  attendanceRepo.recomputeAggregates(doc);
  await doc.save();
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
    const user = await User.findOne({ fingerprintId: r.fingerprintId }).populate('shift');
    if (!user) { skipped++; continue; }

    // Same session-aware routing as the live device sync: prefer an existing
    // OPEN shift so post-midnight OUTs fold into their originating session;
    // otherwise upsert on the row anchored to the employee's SHIFT START
    // date (Rules 1/2/3/14) — a 22:00 → 02:00 shift never spawns a new row
    // just because the punch crosses midnight.
    let doc = await attendanceRepo.findOpenForEmployee(user._id);
    if (!doc) {
      const date = resolveShiftAnchorDate(r.timestamp, user.shift);
      doc = await Attendance.findOneAndUpdate(
        { employee: user._id, date },
        { $setOnInsert: { method: ATTENDANCE_METHOD.FINGERPRINT, status: ATTENDANCE_STATUS.PRESENT } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
    attendanceRepo.ensureSessions(doc);

    const ts = new Date(r.timestamp);
    const lastIdx = doc.sessions.length - 1;
    const last = lastIdx >= 0 ? doc.sessions[lastIdx] : null;
    const lastFullyClosed =
      !!last && !!last.deviceCheckOutAt && !!(last.clockIn ? last.clockOut : true);

    if (r.type === 'IN') {
      if (!last || lastFullyClosed) {
        // Start a fresh session for this bulk-imported check-in.
        doc.sessions.push({ clockIn: ts, deviceCheckInAt: ts });
      } else if (!last.clockIn) {
        // The device row already had a device check-in; stamp the web one.
        last.clockIn = ts;
        if (!last.deviceCheckInAt) last.deviceCheckInAt = ts;
      }
      const target = doc.sessions[doc.sessions.length - 1];
      // Only evaluate lateness for the first session of the day. Shift
      // anchor date drives the "expected" comparison (Rule 11).
      if (doc.sessions.length === 1) {
        const { isLate, lateMinutes } = await evaluateLate(user._id, target.clockIn, doc.date);
        target.isLate = isLate;
        target.lateMinutes = lateMinutes;
        if (isLate) doc.status = ATTENDANCE_STATUS.LATE;
      }
    } else if (r.type === 'OUT' && last) {
      if (!last.clockOut) last.clockOut = ts;
      if (!last.deviceCheckOutAt) last.deviceCheckOutAt = ts;
      last.workMinutes = computeWorkMinutes(last);
    }

    attendanceRepo.recomputeAggregates(doc);
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
