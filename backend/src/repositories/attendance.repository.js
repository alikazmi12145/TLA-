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
// Explicitly registered so ad-hoc callers (scripts, controllers that only
// require this repo) can safely do `User.populate('shift')` even when the
// Shift model hasn't been touched elsewhere in the process.
require('../models/Shift');
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
  // Staleness anchor: use the MOST RECENT activity on the last session.
  // Using the oldest (deviceCheckInAt) fails for overnight shifts where the
  // session may have been auto-reopened from ancient device stamps or
  // collapsed from earlier punches — the current shift's real anchor is the
  // most recent clockIn / deviceCheckOutAt / deviceCheckInAt we've seen.
  const lastSession = doc.sessions[doc.sessions.length - 1];
  const anchor = [
    lastSession.clockOut,
    lastSession.deviceCheckOutAt,
    lastSession.clockIn,
    lastSession.deviceCheckInAt,
  ].find(Boolean);
  if (!anchor) return null;
  const ageMs = Date.now() - new Date(anchor).getTime();
  if (ageMs > OPEN_SHIFT_MAX_HOURS * 60 * 60 * 1000) return null;
  return doc;
};

// Window inside which a device-side "close" that never got a web clock-in
// is assumed to be a K40 double-tap and can be auto-reopened by a
// subsequent web Clock In. Must stay in sync with MIN_SESSION_MS in
// upsertPunch — anything closer than this could not have been a real shift.
const AUTO_REOPEN_WINDOW_MS = 15 * 60 * 1000;

/**
 * Find the employee's MOST RECENT attendance row that looks like it was
 * built entirely from K40 auto-toggled punches (the device sent only
 * CHECK_IN-type events, our old logic split them across multiple wrongly-
 * closed sessions, and the user never web-clocked-in on any of them).
 *
 * "Safe to auto-reopen" = the row's most recent device activity is recent
 * (within the last 12 h) AND NO session on the row has a web clockIn or
 * clockOut. Under those two conditions we know the user's intent was to
 * check in — they've been tapping their finger with no web action yet —
 * so we can safely collapse the mess into a single open session anchored
 * at the earliest device-in on the row.
 *
 * Returns { doc, earliestDeviceIn } when the row is safe to auto-reopen,
 * or null.
 */
const findAutoReopenableForClockIn = async (employeeId) => {
  const doc = await Attendance.findOne({ employee: employeeId })
    .sort({ date: -1, updatedAt: -1 });
  if (!doc || !Array.isArray(doc.sessions) || doc.sessions.length === 0) return null;
  // Any web activity anywhere on this row means we DO NOT touch it —
  // reopening would corrupt payroll totals or a prior clocked shift.
  const anyWebActivity = doc.sessions.some((s) => s.clockIn || s.clockOut);
  if (anyWebActivity) return null;
  // Only consider RECENT device stamps (last 12 h). Ancient stamps that
  // survive from earlier polluted sessions must not be used as the new
  // anchor — otherwise an auto-reopened session would look like it began
  // 2 days ago, breaking overnight-shift staleness and lateness logic.
  const RECENT_WINDOW_MS = 12 * 60 * 60 * 1000;
  const now = Date.now();
  const recentStamps = [];
  for (const s of doc.sessions) {
    if (s.deviceCheckInAt && now - new Date(s.deviceCheckInAt).getTime() <= RECENT_WINDOW_MS) {
      recentStamps.push(new Date(s.deviceCheckInAt).getTime());
    }
    if (s.deviceCheckOutAt && now - new Date(s.deviceCheckOutAt).getTime() <= RECENT_WINDOW_MS) {
      recentStamps.push(new Date(s.deviceCheckOutAt).getTime());
    }
  }
  if (recentStamps.length === 0) return null;
  const earliest = Math.min(...recentStamps);
  const latest = Math.max(...recentStamps);
  return { doc, earliestDeviceIn: new Date(earliest), latestDevice: new Date(latest) };
};

/**
 * Collapse a row's multiple auto-toggle-generated sessions into a single
 * open session anchored at the earliest device check-in. Caller must have
 * obtained the row via `findAutoReopenableForClockIn` (which enforces the
 * "no web activity anywhere" precondition).
 *
 * The web Clock In gate can then attach `clockIn = now()` to this session
 * exactly as if the user had just taken a single clean device punch.
 */
const reopenLastSessionForClockIn = async (doc, { earliestDeviceIn } = {}) => {
  if (!doc || !Array.isArray(doc.sessions) || doc.sessions.length === 0) {
    throw new Error('reopenLastSessionForClockIn: no sessions');
  }
  const anchor = earliestDeviceIn || doc.sessions[0].deviceCheckInAt;
  // Wipe every existing session and rebuild a single open one — safe
  // because the caller guaranteed no web activity anywhere on the row.
  doc.sessions = [{
    deviceCheckInAt: anchor,
    deviceCheckOutAt: null,
    clockIn: null,
    clockOut: null,
    workMinutes: 0,
    isLate: false,
    lateMinutes: 0,
  }];
  recomputeAggregates(doc);
  await doc.save();
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

  // 4) K40 sends every tap as `checkType: CHECK_IN` unless the user
  //    physically presses F4 first — which nobody does. So we can NOT
  //    infer intent (check-in vs check-out) from the tap itself. The
  //    working model is instead:
  //
  //      * First tap of a shift → opens a session (deviceCheckInAt).
  //      * Every subsequent tap within SESSION_WINDOW_MS of the last
  //        activity on that session (either the check-in or the current
  //        check-out) is treated as "still the same shift" — we just
  //        slide deviceCheckOutAt forward to the latest tap. Missed taps,
  //        double-taps, and "did it register?" retaps all collapse into
  //        one session naturally.
  //      * A tap that arrives AFTER SESSION_WINDOW_MS of quiet time is a
  //        genuine new shift — opens a fresh session on the same day.
  //      * An explicit CHECK_OUT/OVERTIME_OUT (F4 was pressed) closes the
  //        current session immediately regardless of gap.
  //      * Duplicate replays from the poller (same timestamp already
  //        processed) are silently no-ops.
  const isExplicitOut =
    checkType === CHECK_TYPE.CHECK_OUT || checkType === CHECK_TYPE.OVERTIME_OUT;
  const SESSION_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 h — one shift's worth
  const lastIdx = doc.sessions.length - 1;
  const last = lastIdx >= 0 ? doc.sessions[lastIdx] : null;
  const lastActivity = last
    ? (last.deviceCheckOutAt || last.deviceCheckInAt || null)
    : null;
  const gapMs = lastActivity
    ? punchDate.getTime() - new Date(lastActivity).getTime()
    : Infinity;

  // Duplicate replay from the poller — same tap already processed.
  if (last && lastActivity && punchDate.getTime() === new Date(lastActivity).getTime()) {
    return { doc, event: 'DUPLICATE' };
  }

  let event = 'DUPLICATE';

  if (!last) {
    // Empty row — open the first session of the day.
    doc.sessions.push({ deviceCheckInAt: punchDate });
    event = 'CHECK_IN';
  } else if (isExplicitOut && last.deviceCheckInAt && !last.deviceCheckOutAt) {
    // User pressed F4 before tapping → close the open session now.
    last.deviceCheckOutAt = punchDate;
    event = 'CHECK_OUT';
  } else if (!last.clockIn && gapMs >= 0 && gapMs <= SESSION_WINDOW_MS) {
    // *** BEFORE web clockIn ***  The user is still in the "punched but not
    // yet clocked in on the web" phase. Every subsequent tap in this phase
    // is either a "did that register?" retap or a delayed second attempt.
    // We treat them all as duplicates — the session stays OPEN
    // (deviceCheckOutAt untouched) so the web Clock In gate can attach.
    // We keep the EARLIEST tap as the check-in anchor so lateness is
    // computed against the true arrival time.
    if (punchDate < new Date(last.deviceCheckInAt)) {
      last.deviceCheckInAt = punchDate;
    }
    event = 'DUPLICATE';
  } else if (last.clockIn && gapMs >= 0 && gapMs <= SESSION_WINDOW_MS) {
    // *** AFTER web clockIn ***  User has already clocked in on the web.
    // A subsequent tap is their "leaving" punch → slide device-out to the
    // latest tap. Multiple taps around leaving time all collapse cleanly.
    if (punchDate > new Date(last.deviceCheckInAt)) {
      last.deviceCheckOutAt = punchDate;
      event = 'CHECK_OUT';
    }
  } else if (gapMs < 0) {
    // Retro import — safe fallback is to no-op.
    return { doc, event: 'DUPLICATE' };
  } else {
    // Genuine long-gap punch → new session (second shift on same day).
    doc.sessions.push({ deviceCheckInAt: punchDate });
    event = 'CHECK_IN';
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
  findAutoReopenableForClockIn,
  reopenLastSessionForClockIn,
  ensureSessions,
  recomputeAggregates,
};
