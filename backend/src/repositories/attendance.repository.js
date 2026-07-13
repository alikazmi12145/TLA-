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
const dayjs = require('dayjs');
// Explicitly registered so ad-hoc callers (scripts, controllers that only
// require this repo) can safely do `User.populate('shift')` even when the
// Shift model hasn't been touched elsewhere in the process.
require('../models/Shift');
const { startOfDay, diffMinutes, resolveShiftAnchorDate, evaluateShiftLateness } = require('../utils/date');
const { ATTENDANCE_METHOD, ATTENDANCE_STATUS, CHECK_TYPE } = require('../config/constants');

// Maximum age (in hours) an "open" shift is allowed to remain claimable by a
// subsequent punch. This exists purely as a safety net for a forgotten
// clock-out — without it, a stale row from days ago would silently consume
// the next real check-in as a check-out. Bumped to 36 h so overnight
// shifts that start at 22:00 and clock out the next morning still resolve
// cleanly even if the last activity anchor is the initial device-in.
// Anything longer must be corrected via the manual adjust endpoint.
const OPEN_SHIFT_MAX_HOURS = 36;

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

// -------------------------------------------------------------------
// Shift snapshot helpers.
//
// A row's `shiftStart` / `shiftEnd` are stored on the row itself at open
// time so reports / early-out / overtime maths never have to re-populate
// the Shift model and never drift if the employee's shift changes later.
// Both are absolute Date instances anchored to the row's `date`.
// -------------------------------------------------------------------
const _computeShiftBounds = (shift, anchorDate) => {
  if (!shift || !shift.startTime || !shift.endTime || !anchorDate) return null;
  const [sh, sm] = String(shift.startTime).split(':').map(Number);
  const [eh, em] = String(shift.endTime).split(':').map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return null;
  const base = dayjs(anchorDate).startOf('day');
  const start = base.hour(sh).minute(sm).second(0).millisecond(0);
  let end = base.hour(eh).minute(em).second(0).millisecond(0);
  // Overnight shift (end <= start) crosses midnight → end date is next day.
  if (end.valueOf() <= start.valueOf()) end = end.add(1, 'day');
  return { shiftStart: start.toDate(), shiftEnd: end.toDate() };
};

const _resolveLifecycle = (last) => {
  if (!last) return null;
  if (last.clockOut) return 'COMPLETED';
  if (last.deviceCheckOutAt) return 'DEVICE_OUT';
  if (last.clockIn) return 'CLOCKED_IN';
  if (last.deviceCheckInAt) return 'DEVICE_IN';
  return null;
};

/**
 * Recompute the row's denormalised aggregates from sessions[]. The last
 * session drives the "current state" fields the frontend reads (clockIn,
 * clockOut, deviceCheckInAt, deviceCheckOutAt) so the UI reflects the
 * shift that is ready to act on. workMinutes and lateMinutes are summed
 * across every session so payroll totals stay correct on multi-shift days.
 *
 * Also maintains the spec-canonical fields:
 *   - `attendanceStatus` — DEVICE_IN | CLOCKED_IN | DEVICE_OUT | COMPLETED
 *   - `isOpen`           — true until the final web Clock Out lands
 *   - `earlyOutMinutes` / `overtimeMinutes` — computed against `shiftEnd`
 * so every reader has the same single source of truth.
 */
const recomputeAggregates = (row) => {
  const s = row.sessions || [];
  if (s.length === 0) {
    // Legacy row with no sessions[] — leave aggregates but reflect the
    // openness of the top-level state so `isOpen` is still correct.
    row.isOpen = !!((row.clockIn && !row.clockOut) || (row.deviceCheckInAt && !row.deviceCheckOutAt));
    return;
  }
  const last = s[s.length - 1];

  // Per-session early-out / overtime, recomputed every time so an admin
  // adjustment or a fresh device tap flows through immediately.
  if (row.shiftEnd) {
    for (const seg of s) {
      const outAt = seg.clockOut || seg.deviceCheckOutAt;
      if (!outAt) { seg.earlyOutMinutes = 0; seg.overtimeMinutes = 0; continue; }
      const delta = diffMinutes(row.shiftEnd, outAt); // + = overtime, - = early
      seg.earlyOutMinutes = delta < 0 ? Math.abs(delta) : 0;
      seg.overtimeMinutes = delta > 0 ? delta : 0;
    }
  }

  row.clockIn = last.clockIn || null;
  row.clockOut = last.clockOut || null;
  row.deviceCheckInAt = last.deviceCheckInAt || null;
  row.deviceCheckOutAt = last.deviceCheckOutAt || null;
  row.workMinutes = s.reduce((acc, x) => acc + (Number(x.workMinutes) || 0), 0);
  row.isLate = s.some((x) => x.isLate);
  row.lateMinutes = s.reduce((acc, x) => acc + (Number(x.lateMinutes) || 0), 0);
  row.earlyOutMinutes = s.reduce((acc, x) => acc + (Number(x.earlyOutMinutes) || 0), 0);
  row.isEarlyOut = row.earlyOutMinutes > 0;
  row.overtimeMinutes = s.reduce((acc, x) => acc + (Number(x.overtimeMinutes) || 0), 0);
  // Keep checkType consistent with the last session's state — used by the UI
  // to distinguish "in-progress" vs "closed" attendance rows.
  row.checkType = last.deviceCheckOutAt ? CHECK_TYPE.CHECK_OUT : CHECK_TYPE.CHECK_IN;

  // Canonical state-machine + open flag. `isOpen` becomes false ONLY once
  // the final web Clock Out has landed (COMPLETED). All other states
  // (DEVICE_IN / CLOCKED_IN / DEVICE_OUT) keep the row claimable by the
  // primary `{ employee, isOpen: true }` lookup.
  const life = _resolveLifecycle(last);
  row.attendanceStatus = life;
  row.isOpen = life !== 'COMPLETED';
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
/**
 * Self-heal rows corrupted by the LEGACY 6-hour session-window merger.
 *
 * The old logic (removed) would spawn a NEW session on the same row when a
 * device check-out tap arrived >6 h after the last activity — which is
 * exactly what happens on an overnight shift (e.g. clock-in 22:00, device
 * check-out 06:00 = 8 h gap). The result was two sessions on one row:
 *
 *   [0] { deviceCheckInAt: 22:00, clockIn: 22:00 }   ← real, still open
 *   [1] { deviceCheckInAt: 06:00 }                   ← PHANTOM: this tap
 *                                                      was the check-OUT
 *
 * Because `recomputeAggregates` mirrors the LAST session, the row's
 * top-level `clockIn` was wiped to null — so after midnight the frontend
 * saw an "unclocked" row and offered Clock In again.
 *
 * Repair rule (only touches rows that clearly show the polluted pattern —
 * one session with a web clockIn but no clockOut, followed by one or more
 * later sessions with ONLY device stamps and no web activity at all):
 *   - Merge the phantom sessions' device stamps into the open session.
 *   - The LATEST device stamp across the phantoms becomes the real
 *     `deviceCheckOutAt` of the open session.
 *   - Drop the phantom sessions.
 *
 * Returns true when the row was mutated (caller should save).
 */
const _repairOvernightPhantomSessions = (doc) => {
  if (!doc || !Array.isArray(doc.sessions) || doc.sessions.length < 2) return false;
  // Find the earliest session that has a web clockIn but no clockOut — the
  // "real" open session the user is currently working.
  const openIdx = doc.sessions.findIndex((s) => s && s.clockIn && !s.clockOut);
  if (openIdx < 0 || openIdx === doc.sessions.length - 1) return false;
  const tail = doc.sessions.slice(openIdx + 1);
  // Every trailing session must be pure device noise (no web activity).
  const allPhantom = tail.every((s) => s && !s.clockIn && !s.clockOut);
  if (!allPhantom) return false;
  const open = doc.sessions[openIdx];
  // Collect every device stamp from the phantoms; pick the latest as the
  // real check-out.
  const stamps = [];
  for (const s of tail) {
    if (s.deviceCheckInAt) stamps.push(new Date(s.deviceCheckInAt).getTime());
    if (s.deviceCheckOutAt) stamps.push(new Date(s.deviceCheckOutAt).getTime());
  }
  if (stamps.length === 0) return false;
  const latest = new Date(Math.max(...stamps));
  // Only accept the repair if the "check-out" actually postdates the
  // check-in — otherwise this isn't the overnight-phantom pattern.
  if (open.deviceCheckInAt && latest <= new Date(open.deviceCheckInAt)) return false;
  open.deviceCheckOutAt = latest;
  // Drop the phantoms.
  doc.sessions = doc.sessions.slice(0, openIdx + 1);
  return true;
};

const findOpenForEmployee = async (employeeId) => {
  // PRIMARY lookup — spec Rule 3: `{ employee, isOpen: true }`. Backed by
  // the partial index on { employee: 1, isOpen: 1 } so this is a single
  // b-tree hit. Every row created / mutated after the refactor carries
  // `isOpen`; the fallback below covers rows that predate the field.
  let doc = await Attendance.findOne({ employee: employeeId, isOpen: true }).sort({ date: -1 });
  if (!doc) {
    // Backward-compat fallback: rows created before `isOpen` existed still
    // need to be reachable so overnight shifts started under the old
    // schema keep working across the deploy boundary.
    doc = await Attendance.findOne({
      employee: employeeId,
      $or: [
        { clockIn: { $ne: null }, clockOut: null },
        { deviceCheckInAt: { $ne: null }, deviceCheckOutAt: null },
      ],
    }).sort({ date: -1 });
  }
  if (!doc) return null;
  // Legacy rows with no sessions[] normally cannot participate in the
  // modern punch flow. HOWEVER — if such a row is currently OPEN (top-level
  // clockIn or deviceCheckInAt set with no corresponding out), refusing to
  // return it strands the shift: a subsequent device check-out (e.g. after
  // midnight for an overnight shift) has nowhere to land and spawns a new
  // row for the next calendar day, and the frontend then sees an unclosed
  // check-in from the current day and offers Clock In again instead of
  // Clock Out. Migrate JUST the open legacy row into sessions[0] so it
  // can be closed cleanly. Closed legacy rows (both clockIn AND clockOut,
  // or both device stamps set) are left untouched so they never resurface
  // as attendance logs.
  if (!Array.isArray(doc.sessions) || doc.sessions.length === 0) {
    const isOpen =
      (doc.clockIn && !doc.clockOut) ||
      (doc.deviceCheckInAt && !doc.deviceCheckOutAt);
    if (!isOpen) return null;
    doc.sessions = [{
      clockIn: doc.clockIn || null,
      clockOut: doc.clockOut || null,
      deviceCheckInAt: doc.deviceCheckInAt || null,
      deviceCheckOutAt: doc.deviceCheckOutAt || null,
      workMinutes: 0,
      isLate: !!doc.isLate,
      lateMinutes: Number(doc.lateMinutes) || 0,
    }];
    recomputeAggregates(doc);
    await doc.save();
  }
  // Self-heal the overnight-phantom pattern left by the legacy merger so
  // the top-level aggregates the frontend reads reflect the real open
  // session (real clockIn, real deviceCheckOutAt) — Rule: after midnight
  // the app must show Clock Out, never Clock In, once the device check-out
  // has arrived.
  if (_repairOvernightPhantomSessions(doc)) {
    recomputeAggregates(doc);
    await doc.save();
  }
  // Backfill isOpen / attendanceStatus for rows produced before the
  // canonical fields existed. Idempotent — this is a no-op after the
  // first save().
  if (doc.isOpen !== true || !doc.attendanceStatus) {
    recomputeAggregates(doc);
    if (doc.isModified()) await doc.save();
  }
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
    // Snapshot the shift onto the row at open time — spec: shiftStart /
    // shiftEnd should live on the attendance row so reports + late /
    // early-out / overtime maths don't depend on the employee's current
    // shift assignment (which may change later).
    const bounds = _computeShiftBounds(shift, date);
    doc = await Attendance.findOneAndUpdate(
      { employee: employeeId, date },
      {
        $setOnInsert: {
          method: ATTENDANCE_METHOD.FINGERPRINT,
          status: ATTENDANCE_STATUS.PRESENT,
          device: deviceId,
          deviceUserId,
          terminal,
          // spec-canonical state fields — set ONCE at row creation
          isOpen: true,
          attendanceStatus: 'DEVICE_IN',
          ...(shift ? { shift: shift._id } : {}),
          ...(bounds ? { shiftStart: bounds.shiftStart, shiftEnd: bounds.shiftEnd } : {}),
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

  // 4) STRICT FLOW (no exceptions):
  //
  //      Device Check-In  →  App Clock-In  →  Device Check-Out  →  App Clock-Out
  //
  //    Because the K40 sends every tap as `checkType: CHECK_IN` unless F4
  //    was pressed, we CANNOT rely on the tap kind. Instead the session's
  //    own state decides what a new tap means:
  //
  //      * No last session (or last session fully closed on the device):
  //          → the tap OPENS a new session (deviceCheckInAt).
  //      * Last session has deviceCheckInAt but NO deviceCheckOutAt (open):
  //          → the tap CLOSES it (deviceCheckOutAt = punchDate) regardless
  //            of how long ago the check-in happened. This is what fixes
  //            overnight shifts — a 22:00 → 07:00 pair is 9 h apart and
  //            must still resolve to a single closed session.
  //      * Duplicate replay from the poller (identical timestamp already
  //        recorded on this session) → silent no-op.
  //      * Retro / out-of-order tap that predates the current open
  //        check-in → treated as an earlier check-in anchor (lateness
  //        stays honest) but does not close the session.
  //
  //    Rapid-fire retaps within RETAP_WINDOW_MS of the current session's
  //    check-in (before the user has web-clocked-in) are still coalesced
  //    as duplicates so a "did that register?" second tap does not
  //    immediately close the session the user just opened.
  const RETAP_WINDOW_MS = 60 * 1000; // 60 s — physical retap window
  const lastIdx = doc.sessions.length - 1;
  const last = lastIdx >= 0 ? doc.sessions[lastIdx] : null;
  const lastActivity = last
    ? (last.deviceCheckOutAt || last.deviceCheckInAt || null)
    : null;

  // Duplicate replay from the poller — same tap already processed.
  if (last && lastActivity && punchDate.getTime() === new Date(lastActivity).getTime()) {
    return { doc, event: 'DUPLICATE' };
  }

  let event = 'DUPLICATE';

  // -------- Rule 8: late is computed ONCE, at DEVICE_IN, against the
  // snapshotted shiftStart. Applied on any code path that opens a new
  // session so the aggregate `lateMinutes` is present BEFORE the user
  // web-clocks in. `evaluateShiftLateness` uses the shift start-time to
  // reconstruct the expected moment on the row's anchor date, so overnight
  // shifts are evaluated correctly.
  const _stampDeviceInLateness = (session) => {
    if (!session || !doc.shift) return;
    // Idempotent: never overwrite a previously-computed value.
    if (Number(session.lateMinutes) > 0 || session.isLate === true) return;
    // Prefer the row's snapshotted shift bounds; fall back to a synthetic
    // shift object for the pure evaluator when only shiftStart is present
    // (e.g. legacy rows migrated in-flight).
    let shiftLike = null;
    if (doc.shiftStart) {
      const d = new Date(doc.shiftStart);
      shiftLike = { startTime: `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`, graceMinutes: 0 };
    }
    if (!shiftLike) return;
    const { isLate, lateMinutes } = evaluateShiftLateness(shiftLike, session.deviceCheckInAt, doc.date);
    session.isLate = isLate;
    session.lateMinutes = lateMinutes;
  };

  if (!last || (last.deviceCheckInAt && last.deviceCheckOutAt)) {
    // No sessions yet, or last session is fully closed on the device
    // → this tap starts a new session.
    doc.sessions.push({ deviceCheckInAt: punchDate });
    _stampDeviceInLateness(doc.sessions[doc.sessions.length - 1]);
    event = 'CHECK_IN';
  } else if (last.deviceCheckInAt && !last.deviceCheckOutAt) {
    // Session is OPEN on the device. Any subsequent tap closes it.
    const checkInMs = new Date(last.deviceCheckInAt).getTime();
    const gapMs = punchDate.getTime() - checkInMs;

    if (gapMs < 0) {
      // Retro tap that predates the current check-in → shift the anchor
      // earlier (protects lateness against out-of-order imports) and stop.
      last.deviceCheckInAt = punchDate;
      // Re-stamp lateness against the earlier anchor. Reset first so the
      // idempotency guard inside `_stampDeviceInLateness` doesn't skip.
      last.isLate = false;
      last.lateMinutes = 0;
      _stampDeviceInLateness(last);
      event = 'DUPLICATE';
    } else if (gapMs <= RETAP_WINDOW_MS && !last.clockIn) {
      // Rapid "did that register?" retap before the user has web
      // clocked-in — treat as duplicate; do NOT close the session.
      event = 'DUPLICATE';
    } else {
      // Genuine check-out tap — close the session regardless of gap.
      last.deviceCheckOutAt = punchDate;
      event = 'CHECK_OUT';
    }
  } else {
    // Defensive fallback: sessions[] is in an unexpected shape (e.g.
    // deviceCheckOutAt set but no deviceCheckInAt). Start a fresh session.
    doc.sessions.push({ deviceCheckInAt: punchDate });
    _stampDeviceInLateness(doc.sessions[doc.sessions.length - 1]);
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
  ensureSessions,
  recomputeAggregates,
};
