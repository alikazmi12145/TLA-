/**
 * One-time cleanup: remove blank (no-timestamp) session entries from every
 * Attendance document.
 *
 * Blank sessions were previously created by the old `adjust` write path
 * (status-only updates on days with no punches would push `{}` into
 * sessions[]) and by the legacy `ensureSessions` migration path (removed).
 * A blank session — no `clockIn` / `clockOut` / `deviceCheckInAt` /
 * `deviceCheckOutAt` — carries no information and shouldn't sit in the DB.
 *
 * This script never touches sessions that have any real timestamp. It also
 * doesn't recompute top-level aggregates or delete any Attendance
 * documents — payroll totals, historical data, and status-only rows all
 * remain untouched. Run once after deploying the fix:
 *
 *   node src/scripts/cleanup-blank-sessions.js
 */
require('dotenv').config();
const connectDB = require('../config/db');
const Attendance = require('../models/Attendance');

const isBlankSession = (s) =>
  !s || (!s.clockIn && !s.clockOut && !s.deviceCheckInAt && !s.deviceCheckOutAt);

(async () => {
  await connectDB();
  const cursor = Attendance.find({ 'sessions.0': { $exists: true } }).cursor();
  let scanned = 0;
  let touched = 0;
  let removed = 0;

  for await (const doc of cursor) {
    scanned += 1;
    const before = doc.sessions.length;
    const kept = doc.sessions.filter((s) => !isBlankSession(s));
    if (kept.length === before) continue;
    doc.sessions = kept;
    // Do not recompute aggregates: the top-level clockIn / clockOut / etc.
    // fields on the row already mirror the LAST real session (or are the
    // legacy pre-sessions[] values). Blank sessions never influenced them,
    // so leaving them alone preserves whatever historical shape callers
    // outside the log page already rely on.
    await doc.save();
    touched += 1;
    removed += before - kept.length;
  }

  console.log(
    `[cleanup-blank-sessions] scanned=${scanned} touched=${touched} removed=${removed}`
  );
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
