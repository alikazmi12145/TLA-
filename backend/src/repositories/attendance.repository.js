/**
 * Attendance repository — helpers for biometric attendance import.
 *
 * Data model: attendance is anchored to the employee's SHIFT START date
 * (not the raw calendar day of the punch). Each row carries an ordered
 * `sessions[]` array — one entry per complete work session on that shift
 * date. Overnight shifts stay on the shift-start date: a post-midnight
 * punch folds into the still-open last session rather than spawning a new
 * row, and a fresh post-midnight check-in for the same overnight shift
 * anchors back to the previous day.
 *
 * Top-level clockIn/clockOut/deviceCheckInAt/deviceCheckOutAt/workMinutes/
 * isLate/lateMinutes are denormalised aggregates that mirror the LAST
 * session (with workMinutes/lateMinutes summed) so existing frontend,
 * payroll, dashboard, and reports continue to work unchanged.
 */
const Attendance = require('../models/Attendance');
const User = require('../models/User');
const { startOfDay, diffMinutes, resolveShiftAnchorDate } = require('../utils/date');
const { ATTENDANCE_METHOD, ATTENDANCE_STATUS, CHECK_TYPE } = require('../config/constants');

// Maximum age (in hours) an "open" shift is allowed to remain claimable by a
// subsequent punch. This exists purely as a safety net for a forgotten
// clock-out — without it, a stale row from days ago would silently consume
// the next real check-in as a check-out. Covers any realistic overnight
// shift; anything longer must be corrected via the manual adjust endpoint.
const OPEN_SHIFT_MAX_HOURS = 24;

/**
 * Ensure `sessions` is an array so callers can operate on it uniformly.
 *
 * Legacy migration REMOVED: rows that pre-date the sessions[] field are
 * NOT folded into sessions[0]. Attendance logs represent COMPLETED punch
 * cycles (Device-In → Clock-In → Device-Out → Clock-Out) — silently
 * synthesising a session from ancient top-level clockIn/clockOut fields
 * would resurrect historical rows as fake logs, which is exactly what the
 * new requirement forbids. Legacy rows stay with `sessions: []` forever;
 * they simply do not surface as attendance logs.
 */
const ensureSessions = (row) => {
  if (!row.sessions) row.sessions = [];
};

const _computeSessionMinutes = (s) => {
  if (!s || !s.clockIn || !s.clockOut) return 0;
  return Math.max(0, diffMinutes(s.clockIn, s.clockOut));
};

/**
 * Recompute the row's denormalised aggregates from sessions[]. The last
 * session drives the "current state" fields the frontend reads (clockIn,
 * clockOut, deviceCheckInAt, deviceCheckOutAt) so the UI reflects the
 * shift that is ready to act on. workMinutes and lateMinutes are summed
 * across every session so payroll totals stay correct on multi-shift days.
 */
const recomputeAggregates = (row) => {
  const s = row.sessions || [];
  if (s.length === 0) return;
  const last = s[s.length - 1];
  row.clockIn = last.clockIn || null;
  row.clockOut = last.clockOut || null;
  row.deviceCheckInAt = last.deviceCheckInAt || null;
  row.deviceCheckOutAt = last.deviceCheckOutAt || null;
  row.workMinutes = s.reduce((acc, x) => acc + (Number(x.workMinutes) || 0), 0);
  row.isLate = s.some((x) => x.isLate);
  row.lateMinutes = s.reduce((acc, x) => acc + (Number(x.lateMinutes) || 0), 0);
  // Keep checkType consistent with the last session's state — used by the UI
  // to distinguish "in-progress" vs "closed" attendance rows.
  row.checkType = last.deviceCheckOutAt ? CHECK_TYPE.CHECK_OUT : CHECK_TYPE.CHECK_IN;
};

/**
 * Find the employee's currently OPEN shift row (checked in, not yet checked
 * out) so an overnight punch or a follow-up web action can be folded into
 * the correct row instead of spawning a new one when the calendar date
 * rolls over.
 *
 * "Open" means the row's top-level clockOut / deviceCheckOutAt is missing
 * (which — via recomputeAggregates — is equivalent to the last session
 * still being open). Returns null when no open shift exists, or when the
 * only candidate is older than OPEN_SHIFT_MAX_HOURS and treated as stale.
 */
const findOpenForEmployee = async (employeeId) => {
  const doc = await Attendance.findOne({
    employee: employeeId,
    $or: [
      { clockIn: { $ne: null }, clockOut: null },
      { deviceCheckInAt: { $ne: null }, deviceCheckOutAt: null },
    ],
  }).sort({ date: -1 });
  if (!doc) return null;
  // Legacy rows with no sessions[] cannot be reopened. Since ensureSessions
  // no longer migrates top-level clock data into sessions[0], such rows
  // don't participate in the modern punch flow — a new punch must create a
  // fresh row for today rather than resurrecting an ancient legacy anchor.
  if (!Array.isArray(doc.sessions) || doc.sessions.length === 0) return null;
  // Staleness anchor: prefer the last session's device-in (or clock-in) —
  // this is when the currently open shift *actually* started, which is what
  // matters for an overnight/forgotten-punch cap.
  const lastSession = doc.sessions[doc.sessions.length - 1];
  const anchor = lastSession.deviceCheckInAt || lastSession.clockIn;
  if (!anchor) return null;
  const ageMs = Date.now() - new Date(anchor).getTime();
  if (ageMs > OPEN_SHIFT_MAX_HOURS * 60 * 60 * 1000) return null;
  return doc;
};

const listByFilter = async (filter, { page = 1, limit = 50 } = {}) => {
  const [items, total] = await Promise.all([
    Attendance.find(filter)
      .populate({
        path: 'employee',
        select: 'fullName employeeId email shift',
        populate: { path: 'shift', select: 'name startTime endTime graceMinutes' },
      })
      .populate('device', 'name serialNumber ip')
      .sort({ date: -1, devicePunchAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Attendance.countDocuments(filter),
  ]);
  return { items, total };
};

/**
 * Merge a single device punch into the correct attendance row / session.
 *
 *  - When an OPEN shift already exists for the employee (may be dated to a
 *    previous day for overnight workers), the punch is folded into that
 *    row's last session: either updating deviceCheckInAt (if the last
 *    session still has no check-in — should never happen in practice) or
 *    stamping deviceCheckOutAt to close it.
 *  - When no open shift exists, we upsert on the day of the punch. If the
 *    row already exists with all sessions closed (e.g. a second shift on
 *    the same calendar day) we APPEND a fresh session; otherwise we start
 *    sessions[0].
 *
 * The row's top-level aggregate fields are always resynced from sessions[]
 * afterwards so existing readers keep seeing a consistent, single-shift-
 * shaped view of the day.
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
  const punchDate = new Date(punchAt);

  // 1) Pick the target row: existing open shift, or a fresh row anchored to
  //    the employee's SHIFT START date (not raw calendar day). For overnight
  //    shifts this ensures a 22:00 → 02:00 punch always lands on the shift's
  //    start-of-day, whether the punch itself is at 22:15 (before midnight)
  //    or at 01:55 (after midnight) — Rules 1, 2, 3, 14.
  let doc = await findOpenForEmployee(employeeId);
  if (!doc) {
    const employee = await User.findById(employeeId).populate('shift').lean();
    const shift = employee ? employee.shift : null;
    const date = resolveShiftAnchorDate(punchAt, shift);
    doc = await Attendance.findOneAndUpdate(
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
  }

  // 2) Ensure sessions[] exists (legacy migration is intentionally NOT run
  //    — pre-sessions[] rows stay archived and never resurface as logs).
  ensureSessions(doc);

  // 3) Row-level metadata (always reflects the latest hardware source).
  doc.device = deviceId;
  doc.deviceUserId = deviceUserId;
  doc.terminal = terminal;
  doc.verificationMode = verificationMode;
  doc.devicePunchAt = punchDate;
  doc.method = ATTENDANCE_METHOD.FINGERPRINT;

  // 4) Decide whether this punch extends the current session or opens a
  //    brand-new one (multi-shift on the same day).
  const isExplicitOut =
    checkType === CHECK_TYPE.CHECK_OUT || checkType === CHECK_TYPE.OVERTIME_OUT;
  const lastIdx = doc.sessions.length - 1;
  const last = lastIdx >= 0 ? doc.sessions[lastIdx] : null;
  // A session is "open on the device side" until deviceCheckOutAt is stamped.
  const lastOpenOnDevice = !!(last && last.deviceCheckInAt && !last.deviceCheckOutAt);
  // A session is "fully closed" only after both device- and web-out are set.
  const lastFullyClosed =
    !!last && !!last.deviceCheckOutAt && !!(last.clockIn ? last.clockOut : true);

  // 5) Dedupe: reject any tap within 30 s of the most recent stamp on the
  //    currently open (or just closed) session. Blocks double-taps and
  //    re-imports from re-firing notifications.
  const DEDUPE_MS = 30 * 1000;
  const dedupeAnchor = last
    ? (last.deviceCheckOutAt || last.deviceCheckInAt || null)
    : null;
  if (dedupeAnchor && Math.abs(punchDate.getTime() - new Date(dedupeAnchor).getTime()) < DEDUPE_MS) {
    return { doc, event: 'DUPLICATE' };
  }

  let event = 'DUPLICATE';

  if (!last || lastFullyClosed) {
    // No sessions yet, or the previous shift is fully closed → open a new
    // session for this punch. Rule 6 (multiple shifts per day) + Rule 8
    // (overnight already handled by findOpenForEmployee upstream).
    doc.sessions.push({ deviceCheckInAt: punchDate });
    event = 'CHECK_IN';
  } else if (lastOpenOnDevice) {
    // Existing session is still open on the device side. Any subsequent
    // punch closes it — Rule 3/9 (device is source of truth for check-out).
    if (isExplicitOut) {
      last.deviceCheckOutAt = punchDate;
      event = 'CHECK_OUT';
    } else if (punchDate < last.deviceCheckInAt) {
      // A retro punch older than the current check-in: pull check-in back
      // and treat the previous check-in as the check-out (preserves the
      // "earliest in / latest out" invariant on the session).
      const previousIn = last.deviceCheckInAt;
      last.deviceCheckInAt = punchDate;
      if (!last.deviceCheckOutAt || previousIn > last.deviceCheckOutAt) {
        last.deviceCheckOutAt = previousIn;
      }
      event = 'CHECK_OUT';
    } else if (punchDate.getTime() === new Date(last.deviceCheckInAt).getTime()) {
      // exact duplicate replay from the poller — no-op
    } else {
      last.deviceCheckOutAt = punchDate;
      event = 'CHECK_OUT';
    }
  } else {
    // The last session's device side is closed but web side isn't (waiting
    // for the employee to press Clock Out in the app). A stray device punch
    // in this window shouldn't rewrite the closure timestamp — record it
    // as a duplicate/no-op so the web clock-out gate stays intact.
    if (last.deviceCheckOutAt && punchDate > last.deviceCheckOutAt) {
      last.deviceCheckOutAt = punchDate;
    }
  }

  // 6) Resync top-level aggregates for the frontend / payroll / reports.
  recomputeAggregates(doc);

  await doc.save();
  return { doc, event };
};

module.exports = {
  listByFilter,
  upsertPunch,
  findOpenForEmployee,
  ensureSessions,
  recomputeAggregates,
};
