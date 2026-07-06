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
  const prevDeviceIn = doc.deviceCheckInAt ? new Date(doc.deviceCheckInAt) : null;
  const prevDeviceOut = doc.deviceCheckOutAt ? new Date(doc.deviceCheckOutAt) : null;

  // Track most recent device metadata (helps when multiple terminals feed one row).
  doc.device = deviceId;
  doc.deviceUserId = deviceUserId;
  doc.terminal = terminal;
  doc.verificationMode = verificationMode;
  doc.devicePunchAt = punchDate;
  doc.method = ATTENDANCE_METHOD.FINGERPRINT;

  // Same-punch dedupe: reject any tap that lands within 30 s of the
  // previously recorded device punch. Blocks accidental double-taps and
  // stops re-imports from re-firing notifications.
  const DEDUPE_MS = 30 * 1000;
  const lastPunch = prevDeviceOut && prevDeviceIn
    ? (prevDeviceOut > prevDeviceIn ? prevDeviceOut : prevDeviceIn)
    : (prevDeviceOut || prevDeviceIn);
  if (lastPunch && Math.abs(punchDate.getTime() - lastPunch.getTime()) < DEDUPE_MS) {
    return { doc, event: 'DUPLICATE' };
  }

  // Device punches ONLY populate the device-side fields — they never touch
  // clockIn/clockOut. Those are stamped exclusively by the app Clock In /
  // Clock Out buttons. First punch of the day = deviceCheckInAt, every
  // later punch updates deviceCheckOutAt (latest wins).
  const isExplicitOut =
    checkType === CHECK_TYPE.CHECK_OUT || checkType === CHECK_TYPE.OVERTIME_OUT;

  if (isExplicitOut) {
    if (!doc.deviceCheckOutAt || punchDate > doc.deviceCheckOutAt) doc.deviceCheckOutAt = punchDate;
    if (!doc.deviceCheckInAt) doc.deviceCheckInAt = punchDate;
  } else if (!doc.deviceCheckInAt) {
    doc.deviceCheckInAt = punchDate;
  } else if (punchDate < doc.deviceCheckInAt) {
    if (!doc.deviceCheckOutAt || doc.deviceCheckInAt > doc.deviceCheckOutAt) doc.deviceCheckOutAt = doc.deviceCheckInAt;
    doc.deviceCheckInAt = punchDate;
  } else if (punchDate.getTime() === doc.deviceCheckInAt.getTime()) {
    // duplicate replay from the poller — no-op
  } else if (!doc.deviceCheckOutAt || punchDate > doc.deviceCheckOutAt) {
    doc.deviceCheckOutAt = punchDate;
  }

  // Reflect the resolved state on the row for the UI.
  doc.checkType = doc.deviceCheckOutAt ? CHECK_TYPE.CHECK_OUT : CHECK_TYPE.CHECK_IN;

  // Classify the punch effect so callers can emit notifications. Only fire on
  // the first device check-in and the first device check-out of the day.
  let event = 'DUPLICATE';
  if (!prevDeviceIn && doc.deviceCheckInAt) event = 'CHECK_IN';
  else if (!prevDeviceOut && doc.deviceCheckOutAt) event = 'CHECK_OUT';

  await doc.save();
  return { doc, event };
};

module.exports = {
  listByFilter,
  upsertPunch,
};
