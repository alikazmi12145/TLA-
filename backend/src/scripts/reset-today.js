// One-shot: reset today's Attendance row for one (or all) employees to a
// clean shape by rebuilding sessions[] from raw DevicePunch records with
// the CURRENT anti-toggle logic. Also stamps device.lastPunchAt so the
// K40 stops replaying historical punches into today's row on every poll.
//
// Usage:  node src/scripts/reset-today.js <name|email|employeeId>
//         node src/scripts/reset-today.js --all
require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');
const Device = require('../models/Device');
const Attendance = require('../models/Attendance');
const DevicePunch = require('../models/DevicePunch');
const attendanceRepo = require('../repositories/attendance.repository');
const { startOfDay } = require('../utils/date');
require('../models/Shift');

const arg = (process.argv[2] || '').trim();
if (!arg) {
  console.error('Usage: node src/scripts/reset-today.js <name|email|employeeId|--all>');
  process.exit(1);
}

const resetEmployeeForToday = async (emp) => {
  // 1) NUKE every Attendance row for this employee. Historical rows are
  //    all polluted with pre-fix multi-session garbage; we rebuild
  //    everything from DevicePunch (which is idempotent by
  //    {device, deviceUserId, punchAt}).
  const del = await Attendance.deleteMany({ employee: emp._id });
  console.log(`  ${emp.fullName}: deleted ${del.deletedCount} row(s)`);

  // 2) Rebuild by replaying EVERY matched DevicePunch record for this
  //    employee (in chronological order) through the current upsertPunch
  //    logic — the anti-toggle merge model produces clean single-session
  //    rows anchored to the correct shift-start date.
  const punches = await DevicePunch.find({
    employee: emp._id,
    matched: true,
  }).sort({ punchAt: 1 });
  console.log(`    replaying ${punches.length} device punch(es)…`);
  for (const p of punches) {
    // eslint-disable-next-line no-await-in-loop
    await attendanceRepo.upsertPunch({
      employeeId: emp._id,
      deviceId: p.device,
      terminal: p.terminal,
      deviceUserId: p.deviceUserId,
      checkType: p.checkType,
      verificationMode: p.verificationMode,
      punchAt: p.punchAt,
    });
  }
  const rebuilt = await Attendance.find({ employee: emp._id }).sort({ date: -1 }).limit(3).lean();
  for (const r of rebuilt) {
    console.log(`    ✓ ${r.date.toISOString().slice(0, 10)}  sessions=${r.sessions.length}  in=${r.deviceCheckInAt || '-'}  out=${r.deviceCheckOutAt || '-'}`);
  }
};

(async () => {
  await connectDB();

  // 0) FIRST stamp device.lastPunchAt = now() so the running server's
  //    biometric poller (which fires every 60 s) will NOT re-import any
  //    historical punches into our freshly-rebuilt rows while we work.
  //    This is the critical step — without it the poller races us and
  //    keeps re-polluting the sessions we just cleaned.
  const now = new Date();
  const lockedDevices = await Device.updateMany({ enabled: true }, { $set: { lastPunchAt: now } });
  console.log(`Locked poller: lastPunchAt=${now.toISOString()} on ${lockedDevices.modifiedCount} device(s).\n`);

  let employees;
  if (arg === '--all') {
    employees = await User.find({ isActive: true }).select('_id fullName');
  } else {
    const emp = await User.findOne({
      $or: [
        { email: arg.toLowerCase() },
        { employeeId: arg },
        { fullName: new RegExp(`^${arg}$`, 'i') },
        { fullName: new RegExp(arg, 'i') },
      ],
    }).select('_id fullName');
    if (!emp) { console.error(`No employee matched "${arg}"`); process.exit(1); }
    employees = [emp];
  }

  for (const emp of employees) {
    // eslint-disable-next-line no-await-in-loop
    await resetEmployeeForToday(emp);
  }

  console.log('\nDone. Future imports will only process punches after the lockPunchAt timestamp above.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
