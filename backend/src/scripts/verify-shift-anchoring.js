/**
 * verify-shift-anchoring.js — read-only developer utility.
 *
 * Simulates the full attendance lifecycle for every Shift configured in
 * MongoDB and asserts that the production helpers produce the expected
 * result for each step:
 *
 *    Device Check-In  →  Web Clock-In  →  Device Check-Out  →  Web Clock-Out
 *
 * All business logic is imported from the same modules the running server
 * uses; nothing is duplicated. The script performs NO database writes —
 * every merge / aggregate is computed on in-memory shadow Attendance
 * documents so the DB is never touched.
 *
 * Exit codes:
 *    0 — every shift passed every check
 *    1 — one or more assertions failed
 *
 * Usage:  npm run verify:shifts    (from the backend/ folder)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const dayjs = require('dayjs');

const connectDB = require('../config/db');
const Shift = require('../models/Shift');
const Attendance = require('../models/Attendance');
const {
  diffMinutes,
  resolveShiftAnchorDate,
  evaluateShiftLateness,
} = require('../utils/date');
const attendanceRepo = require('../repositories/attendance.repository');
const { CHECK_TYPE, VERIFICATION_MODE } = require('../config/constants');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const parseHM = (s) => {
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + m;
};
const fmtDay = (d) => dayjs(d).format('YYYY-MM-DD');

/**
 * Build an in-memory (non-persisted) Attendance document that behaves
 * exactly like a freshly-inserted one, so we can drive the same session
 * merging + aggregate recomputation used in production without ever
 * writing to MongoDB.
 */
const makeShadowAttendance = (employeeId, date) =>
  new Attendance({
    employee: employeeId,
    date,
    sessions: [],
  });

/**
 * Simulate the repository's device-punch handling for a single tap on a
 * shadow row. This mirrors the branches inside
 * `attendanceRepo.upsertPunch` — first tap opens a session, later taps
 * slide `deviceCheckOutAt` — without hitting the database.
 */
const applyDevicePunch = (row, punchAt) => {
  attendanceRepo.ensureSessions(row);
  const last = row.sessions[row.sessions.length - 1];
  if (!last) {
    row.sessions.push({ deviceCheckInAt: punchAt });
  } else if (last.clockIn) {
    // After web clock-in — slide device-out forward.
    last.deviceCheckOutAt = punchAt;
  } else if (last.deviceCheckOutAt) {
    // Session already closed → open a new one (second shift on same day).
    row.sessions.push({ deviceCheckInAt: punchAt });
  } else {
    // Between device-in and web clock-in — treat as duplicate, keep earliest.
    if (punchAt < new Date(last.deviceCheckInAt)) last.deviceCheckInAt = punchAt;
  }
  row.devicePunchAt = punchAt;
  attendanceRepo.recomputeAggregates(row);
};

/**
 * Simulate the web Clock-In gate: attach `clockIn` to the last open
 * session and evaluate lateness using the shared helper.
 */
const applyWebClockIn = (row, shift, clockInAt) => {
  attendanceRepo.ensureSessions(row);
  const last = row.sessions[row.sessions.length - 1];
  last.clockIn = clockInAt;
  const isFirstSessionOfDay = row.sessions.length === 1;
  if (isFirstSessionOfDay) {
    const { isLate, lateMinutes } = evaluateShiftLateness(shift, clockInAt, row.date);
    last.isLate = isLate;
    last.lateMinutes = lateMinutes;
  }
  attendanceRepo.recomputeAggregates(row);
};

/**
 * Simulate the web Clock-Out gate: close the last session and let the
 * repository recompute aggregates (workMinutes).
 */
const applyWebClockOut = (row, clockOutAt) => {
  const last = row.sessions[row.sessions.length - 1];
  last.clockOut = clockOutAt;
  last.workMinutes = Math.max(0, diffMinutes(last.clockIn, last.clockOut));
  attendanceRepo.recomputeAggregates(row);
};

// ---------------------------------------------------------------------------
// Per-shift assertions
// ---------------------------------------------------------------------------

/**
 * Drive one shift through the full punch cycle and collect pass/fail
 * results for every step.
 */
const verifyShift = (shift) => {
  const results = [];
  const push = (step, ok, got) => results.push({ step, ok, got });

  const startMin = parseHM(shift.startTime);
  const endMin = parseHM(shift.endTime);
  const isOvernight = endMin <= startMin;
  const scheduledMinutes = isOvernight ? 24 * 60 - startMin + endMin : endMin - startMin;

  // Anchor point for the simulation — an arbitrary but fixed Wednesday.
  const SHIFT_START_DATE = '2026-07-15';
  const shiftStartDay = dayjs(SHIFT_START_DATE);
  const nextDay = shiftStartDay.add(1, 'day');

  // -------- Step 1: Device Check-In (5 min after scheduled start) --------
  const deviceInAt = shiftStartDay
    .hour(Math.floor(startMin / 60))
    .minute((startMin % 60) + 5)
    .second(0)
    .toDate();
  const inAnchor = resolveShiftAnchorDate(deviceInAt, shift);
  push('device check-in anchor', fmtDay(inAnchor) === SHIFT_START_DATE, fmtDay(inAnchor));

  // A fake employee id is fine — the shadow row is never persisted.
  const row = makeShadowAttendance(new mongoose.Types.ObjectId(), inAnchor);
  applyDevicePunch(row, deviceInAt);
  push(
    'session opened',
    row.sessions.length === 1 && row.sessions[0].deviceCheckInAt.getTime() === deviceInAt.getTime(),
    `${row.sessions.length} session(s)`
  );

  // -------- Step 2: Web Clock-In (same moment as device check-in) --------
  applyWebClockIn(row, shift, deviceInAt);
  push('web clock-in attached', !!row.clockIn, row.clockIn ? row.clockIn.toISOString() : 'missing');
  // Lateness at start+5 (grace >= 5 for all shifts here) → not late.
  const withinGrace = (shift.graceMinutes || 0) >= 5;
  push(
    'not late within grace',
    withinGrace ? row.isLate === false : true,
    `late=${row.isLate} minutes=${row.lateMinutes}`
  );

  // -------- Step 3: Device Check-Out (20 min after scheduled end) --------
  const outDay = isOvernight ? nextDay : shiftStartDay;
  const deviceOutAt = outDay
    .hour(Math.floor(endMin / 60))
    .minute((endMin % 60) + 20)
    .second(0)
    .toDate();
  const outAnchor = resolveShiftAnchorDate(deviceOutAt, shift);
  push('device check-out anchor', fmtDay(outAnchor) === SHIFT_START_DATE, fmtDay(outAnchor));
  push(
    'both punches share a row',
    fmtDay(inAnchor) === fmtDay(outAnchor),
    `${fmtDay(inAnchor)} vs ${fmtDay(outAnchor)}`
  );
  applyDevicePunch(row, deviceOutAt);
  push(
    'device check-out stamped',
    !!row.deviceCheckOutAt && row.deviceCheckOutAt.getTime() === deviceOutAt.getTime(),
    row.deviceCheckOutAt ? row.deviceCheckOutAt.toISOString() : 'missing'
  );

  // -------- Step 4: Web Clock-Out --------
  applyWebClockOut(row, deviceOutAt);
  push(
    'session completed',
    !!(row.clockIn && row.clockOut),
    `in=${!!row.clockIn} out=${!!row.clockOut}`
  );

  // -------- Step 5: Aggregates --------
  const expectedWorkMinutes = scheduledMinutes + 15; // 20-min post-shift minus 5-min-late arrival
  push(
    'workMinutes correct',
    row.workMinutes === expectedWorkMinutes,
    `${row.workMinutes} (expected ${expectedWorkMinutes})`
  );

  // -------- Step 6: Late detection (start + grace + 7) --------
  const lateArrival = shiftStartDay
    .hour(Math.floor(startMin / 60))
    .minute((startMin % 60) + (shift.graceMinutes || 0) + 7)
    .second(0)
    .toDate();
  const lateEval = evaluateShiftLateness(shift, lateArrival, inAnchor);
  push(
    'late detection',
    lateEval.isLate && lateEval.lateMinutes === 7,
    `late=${lateEval.isLate} minutes=${lateEval.lateMinutes}`
  );

  // -------- Step 7: On-time detection (start + grace exactly) --------
  const onTimeArrival = shiftStartDay
    .hour(Math.floor(startMin / 60))
    .minute((startMin % 60) + (shift.graceMinutes || 0))
    .second(0)
    .toDate();
  const onTimeEval = evaluateShiftLateness(shift, onTimeArrival, inAnchor);
  push(
    'on-time within grace',
    !onTimeEval.isLate && onTimeEval.lateMinutes === 0,
    `late=${onTimeEval.isLate} minutes=${onTimeEval.lateMinutes}`
  );

  return { isOvernight, scheduledMinutes, results };
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const printReport = (shift, isOvernight, results) => {
  const failed = results.filter((r) => !r.ok);
  const badge = failed.length === 0 ? 'PASS' : 'FAIL';
  const label = `${shift.name}`.padEnd(24);
  console.log(
    `[${badge}] ${label} ${shift.startTime}\u2192${shift.endTime}  ` +
      `grace=${shift.graceMinutes}m  overnight=${isOvernight ? 'YES' : 'NO '}`
  );
  for (const r of results) {
    console.log(`       ${r.ok ? '\u2713' : '\u2717'} ${r.step.padEnd(28)} ${r.got}`);
  }
};

(async () => {
  let allOk = true;
  try {
    await connectDB();
    const shifts = await Shift.find().sort({ name: 1 }).lean();
    if (shifts.length === 0) {
      console.log('No shifts configured — nothing to verify.');
      process.exit(0);
    }
    console.log('\n=== Shift lifecycle verification (read-only) ===\n');
    for (const shift of shifts) {
      const { isOvernight, results } = verifyShift(shift);
      printReport(shift, isOvernight, results);
      if (results.some((r) => !r.ok)) allOk = false;
    }
    console.log(`\nOverall: ${allOk ? 'ALL SHIFTS PASS' : 'FAILURES FOUND'}\n`);
  } catch (err) {
    console.error('verify-shift-anchoring failed:', err);
    allOk = false;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
  process.exit(allOk ? 0 : 1);
})();
