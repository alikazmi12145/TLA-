// Repair a specific employee's active row: sets each session's
// deviceCheckInAt to the actual first RECENT device punch, not the
// ancient one an earlier auto-reopen collapsed in.
//
// Usage:  node src/scripts/repair-current-row.js <name|email|employeeId>
require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const DevicePunch = require('../models/DevicePunch');

const arg = (process.argv[2] || '').trim();
if (!arg) { console.error('Usage: node src/scripts/repair-current-row.js <name|email|employeeId>'); process.exit(1); }

const RECENT_MS = 12 * 60 * 60 * 1000;

(async () => {
  await connectDB();
  const emp = await User.findOne({
    $or: [
      { email: arg.toLowerCase() },
      { employeeId: arg },
      { fullName: new RegExp(`^${arg}$`, 'i') },
      { fullName: new RegExp(arg, 'i') },
    ],
  });
  if (!emp) { console.error(`No employee matched "${arg}"`); process.exit(1); }

  const row = await Attendance.findOne({
    employee: emp._id,
    $or: [
      { clockIn: { $ne: null }, clockOut: null },
      { deviceCheckInAt: { $ne: null }, deviceCheckOutAt: null },
    ],
  }).sort({ date: -1 });

  if (!row) {
    console.log(`${emp.fullName}: no open row to repair`);
    process.exit(0);
  }

  const last = row.sessions[row.sessions.length - 1];
  if (!last) { console.log('empty sessions'); process.exit(0); }

  const now = Date.now();
  const before = {
    deviceCheckInAt: last.deviceCheckInAt,
    deviceCheckOutAt: last.deviceCheckOutAt,
    clockIn: last.clockIn,
  };

  // Anchor for "which punches belong to this shift" = clockIn (or now if
  // absent) minus RECENT window.
  const anchorTime = last.clockIn ? new Date(last.clockIn).getTime() : now;
  const windowStart = anchorTime - RECENT_MS;
  const windowEnd = last.clockOut ? new Date(last.clockOut).getTime() + RECENT_MS : now + RECENT_MS;

  // Find recent DevicePunches for this employee inside the window.
  const punches = await DevicePunch.find({
    employee: emp._id,
    matched: true,
    punchAt: { $gte: new Date(windowStart), $lte: new Date(windowEnd) },
  }).sort({ punchAt: 1 }).lean();

  if (punches.length === 0) {
    console.log(`${emp.fullName}: no recent device punches in the shift window — leaving row as-is`);
    process.exit(0);
  }

  const firstPunch = punches[0].punchAt;
  const lastPunch = punches[punches.length - 1].punchAt;

  // Pull deviceCheckInAt back to the FIRST recent punch (real shift start).
  last.deviceCheckInAt = firstPunch;
  // Set deviceCheckOutAt to the last recent punch IF it's after clockIn
  // (post-clockIn tap → leaving punch). Otherwise leave as-is.
  if (last.clockIn && new Date(lastPunch).getTime() > new Date(last.clockIn).getTime()) {
    last.deviceCheckOutAt = lastPunch;
  }

  // Recompute aggregates.
  row.deviceCheckInAt = last.deviceCheckInAt;
  row.deviceCheckOutAt = last.deviceCheckOutAt || null;
  row.clockIn = last.clockIn || null;
  row.clockOut = last.clockOut || null;
  await row.save();

  console.log(`${emp.fullName}:`);
  console.log('  before  deviceIn=', before.deviceCheckInAt, ' deviceOut=', before.deviceCheckOutAt, ' clockIn=', before.clockIn);
  console.log('  after   deviceIn=', last.deviceCheckInAt, ' deviceOut=', last.deviceCheckOutAt, ' clockIn=', last.clockIn);
  console.log(`  used ${punches.length} recent punch(es)  window=[${new Date(windowStart).toISOString()} .. ${new Date(windowEnd).toISOString()}]`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
