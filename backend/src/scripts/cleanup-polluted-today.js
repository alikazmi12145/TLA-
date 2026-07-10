// One-shot cleanup: undo the buggy auto-heal that turned K40 double-tap
// micro-sessions into fake "completed" attendance logs. For the given
// employee's most recent attendance row, keeps ONLY the last session
// (which is the one they actually clocked in on) and discards every
// earlier micro-session that had its clockIn/clockOut backfilled from
// device stamps.
//
// Usage:  node src/scripts/cleanup-polluted-today.js <name|email|employeeId>
//         node src/scripts/cleanup-polluted-today.js --all
require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
require('../models/Shift'); // register for populate()

const arg = (process.argv[2] || '').trim();
if (!arg) {
  console.error('Usage: node src/scripts/cleanup-polluted-today.js <name|email|employeeId|--all>');
  process.exit(1);
}

const cleanupRow = (row) => {
  if (!Array.isArray(row.sessions) || row.sessions.length <= 1) return { changed: false, removed: 0 };
  const originalCount = row.sessions.length;
  // Keep only the LAST session — that's where the current/most recent web
  // clock-in lives. Everything before it was a K40 auto-toggle artefact.
  const last = row.sessions[row.sessions.length - 1];
  row.sessions = [last];
  // Rebuild aggregates from the surviving session.
  row.clockIn = last.clockIn || null;
  row.clockOut = last.clockOut || null;
  row.deviceCheckInAt = last.deviceCheckInAt || null;
  row.deviceCheckOutAt = last.deviceCheckOutAt || null;
  row.workMinutes = Number(last.workMinutes) || 0;
  row.isLate = !!last.isLate;
  row.lateMinutes = Number(last.lateMinutes) || 0;
  return { changed: true, removed: originalCount - 1 };
};

const cleanupEmployee = async (emp) => {
  // Most recent row (may be today or an overnight anchor from yesterday).
  const row = await Attendance.findOne({ employee: emp._id }).sort({ date: -1, updatedAt: -1 });
  if (!row) {
    console.log(`  ${emp.fullName}: no attendance row`);
    return 0;
  }
  const { changed, removed } = cleanupRow(row);
  if (!changed) {
    console.log(`  ${emp.fullName}: nothing to clean (${row.sessions.length} session)`);
    return 0;
  }
  await row.save();
  console.log(`  ${emp.fullName}: removed ${removed} bogus session(s), kept last`);
  return removed;
};

(async () => {
  await connectDB();
  let employees;
  if (arg === '--all') {
    employees = await User.find({ isActive: true }).select('_id fullName email employeeId');
    console.log(`Scanning ${employees.length} active employees…\n`);
  } else {
    const emp = await User.findOne({
      $or: [
        { email: arg.toLowerCase() },
        { employeeId: arg },
        { fullName: new RegExp(`^${arg}$`, 'i') },
        { fullName: new RegExp(arg, 'i') },
      ],
    }).select('_id fullName email employeeId');
    if (!emp) { console.error(`No employee matched "${arg}"`); process.exit(1); }
    employees = [emp];
  }

  let totalRemoved = 0;
  for (const emp of employees) {
    // eslint-disable-next-line no-await-in-loop
    totalRemoved += await cleanupEmployee(emp);
  }
  console.log(`\nDone. Removed ${totalRemoved} bogus session(s) total.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
