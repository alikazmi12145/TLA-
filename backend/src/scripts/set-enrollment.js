// Manually flip an employee's fingerprint enrollment status.
// Use this when the device firmware refuses to report enrollment reliably
// and you've physically confirmed the finger works.
//
// Usage:
//   node src/scripts/set-enrollment.js <employeeId> enrolled
//   node src/scripts/set-enrollment.js <employeeId> not-enrolled
require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');
const { FINGERPRINT_STATUS } = require('../config/constants');

const [empArg, statusArg] = process.argv.slice(2);
if (!empArg || !statusArg) {
  console.error('Usage: node src/scripts/set-enrollment.js <employeeId|email|name> <enrolled|not-enrolled>');
  process.exit(1);
}

const wantEnrolled = /^enrolled$/i.test(statusArg);
const wantNotEnrolled = /^not[-_]?enrolled$/i.test(statusArg);
if (!wantEnrolled && !wantNotEnrolled) {
  console.error('Second argument must be either "enrolled" or "not-enrolled".');
  process.exit(1);
}

(async () => {
  await connectDB();
  const emp = await User.findOne({
    $or: [
      { employeeId: empArg },
      { email: empArg.toLowerCase() },
      { fullName: new RegExp(`^${empArg}$`, 'i') },
    ],
  });
  if (!emp) { console.error(`No employee matched "${empArg}"`); process.exit(1); }

  const before = { status: emp.fingerprintStatus, fingerCount: emp.fingerCount };
  emp.fingerprintStatus = wantEnrolled ? FINGERPRINT_STATUS.ENROLLED : FINGERPRINT_STATUS.NOT_ENROLLED;
  emp.fingerCount = wantEnrolled ? Math.max(1, emp.fingerCount) : 0;
  await emp.save();
  console.log(`\nUpdated ${emp.fullName} (${emp.employeeId})`);
  console.log('  before :', before);
  console.log('  after  :', { status: emp.fingerprintStatus, fingerCount: emp.fingerCount });
  console.log('');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
