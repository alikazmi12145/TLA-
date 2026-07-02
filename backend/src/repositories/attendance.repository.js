/**
 * Attendance repository — helpers for biometric attendance import.
 * The transactional day-summary schema (one row per employee per date) is kept
 * unchanged; each device punch is folded into the existing daily record.
 */
const Attendance = require('../models/Attendance');
const { startOfDay } = require('../utils/date');
const { ATTENDANCE_METHOD, ATTENDANCE_STATUS, CHECK_TYPE } = require('../config/constants');

const listByFilter = async (filter, { page = 1, limit = 50 } = {}) => {
  const [items, total] = await Promise.all([
    Attendance.find(filter)
      .populate('employee', 'fullName employeeId email')
      .populate('device', 'name serialNumber ip')
      .sort({ date: -1, devicePunchAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Attendance.countDocuments(filter),
  ]);
  return { items, total };
};

/**
 * Merge a single device punch into the daily attendance row.
 * checkType decides which timestamp field is written.
 */
const upsertPunch = async ({
  employeeId,
  deviceId,
  terminal,
  deviceUserId,
  checkType,
  verificationMode,
  punchAt,
}) => {
  const date = startOfDay(punchAt);
  const punchDate = new Date(punchAt);

  const doc = await Attendance.findOneAndUpdate(
    { employee: employeeId, date },
    {
      $setOnInsert: {
        method: ATTENDANCE_METHOD.FINGERPRINT,
        status: ATTENDANCE_STATUS.PRESENT,
        device: deviceId,
        deviceUserId,
        terminal,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Snapshot pre-change state so we can classify the effect of this punch.
  const prevClockIn = doc.clockIn ? new Date(doc.clockIn) : null;
  const prevClockOut = doc.clockOut ? new Date(doc.clockOut) : null;

  // Track most recent device metadata (helps when multiple terminals feed one row).
  doc.device = deviceId;
  doc.deviceUserId = deviceUserId;
  doc.terminal = terminal;
  doc.verificationMode = verificationMode;
  doc.devicePunchAt = punchDate;
  doc.method = ATTENDANCE_METHOD.FINGERPRINT;

  // Same-status dedupe: reject any punch that lands within 30 s of the
  // employee's most recent recorded punch (clockIn or clockOut). This blocks
  // accidental double-taps and stops re-imports from re-firing notifications.
  const DEDUPE_MS = 30 * 1000;
  const lastPunch = prevClockOut && prevClockIn
    ? (prevClockOut > prevClockIn ? prevClockOut : prevClockIn)
    : (prevClockOut || prevClockIn);
  if (lastPunch && Math.abs(punchDate.getTime() - lastPunch.getTime()) < DEDUPE_MS) {
    return { doc, event: 'DUPLICATE' };
  }

  // Pair-punch semantics: the K40 (and most standalone terminals in tap-only
  // mode) reports every scan as type=0. So we don't trust `checkType`; instead
  // the FIRST punch of the day is the clock-in, and every LATER punch updates
  // clock-out (latest wins). Explicit IN/OUT hints from the device are
  // honoured when present.
  const isExplicitOut =
    checkType === CHECK_TYPE.CHECK_OUT || checkType === CHECK_TYPE.OVERTIME_OUT;

  if (isExplicitOut) {
    if (!doc.clockOut || punchDate > doc.clockOut) doc.clockOut = punchDate;
    if (!doc.clockIn) doc.clockIn = punchDate;
  } else if (!doc.clockIn) {
    doc.clockIn = punchDate;
  } else if (punchDate < doc.clockIn) {
    // A retro-imported punch earlier than the current clockIn — shift the
    // current clockIn out to clockOut, then use the earlier punch as clockIn.
    if (!doc.clockOut || doc.clockIn > doc.clockOut) doc.clockOut = doc.clockIn;
    doc.clockIn = punchDate;
  } else if (punchDate.getTime() === doc.clockIn.getTime()) {
    // Same punch being replayed by the 60 s poller — no-op.
  } else if (!doc.clockOut || punchDate > doc.clockOut) {
    // Second+ punch of the day → this is (an updated) clock-out.
    doc.clockOut = punchDate;
  }

  // Reflect the resolved state back onto the row's checkType field so the UI
  // can show the last operation performed.
  doc.checkType = doc.clockOut ? CHECK_TYPE.CHECK_OUT : CHECK_TYPE.CHECK_IN;

  if (doc.clockIn && doc.clockOut) {
    const mins = Math.max(0, Math.round((doc.clockOut - doc.clockIn) / 60000));
    doc.workMinutes = mins;
  }

  // Classify the punch effect so callers can emit notifications. To keep the
  // admin dashboard quiet, we only signal CHECK_IN on the very first punch of
  // the day and CHECK_OUT on the FIRST time a clock-out is recorded. Later
  // clock-out updates (i.e. the employee tapping again after leaving) still
  // extend the timestamp in the DB but do NOT fire another notification.
  let event = 'DUPLICATE';
  if (!prevClockIn && doc.clockIn) event = 'CHECK_IN';
  else if (!prevClockOut && doc.clockOut) event = 'CHECK_OUT';

  await doc.save();
  return { doc, event };
};

module.exports = {
  listByFilter,
  upsertPunch,
};
