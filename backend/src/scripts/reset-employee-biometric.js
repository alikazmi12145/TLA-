// Fixes an employee whose fingerprintStatus is wrongly ENROLLED (or stuck
// NOT_ENROLLED because the UID is at the K40's 10-template cap) because
// residual templates from a previous holder are sitting under the same UID.
//
// This script:
// - Deletes all Attendance + DevicePunch rows for this employee.
// - HARD-PURGES the user record on the K40 (which also removes any residual
//   templates), then re-creates the user under the same UID → device count
//   drops to 0.
// - Resets baseline = 0, fingerprintStatus = NOT_ENROLLED, fingerCount = 0.
//
// Usage:  node src/scripts/reset-employee-biometric.js <employeeId|email|name>
require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');
const Device = require('../models/Device');
const Attendance = require('../models/Attendance');
const DevicePunch = require('../models/DevicePunch');
const zk = require('../services/zkteco.service');
const { FINGERPRINT_STATUS, ZK_PRIVILEGE } = require('../config/constants');

const arg = (process.argv[2] || '').trim();
if (!arg) { console.error('Usage: node src/scripts/reset-employee-biometric.js <employeeId|email|name>'); process.exit(1); }

(async () => {
  await connectDB();

  const emp = await User.findOne({
    $or: [
      { employeeId: arg },
      { email: arg.toLowerCase() },
      { fullName: new RegExp(`^${arg}$`, 'i') },
    ],
  });
  if (!emp) { console.error(`No employee matched "${arg}"`); process.exit(1); }

  const attDel = await Attendance.deleteMany({ employee: emp._id });
  const punchDel = await DevicePunch.deleteMany({ employee: emp._id });

  let baseline = 0;
  let purgedCount = 0;
  if (emp.deviceId && emp.deviceUserId) {
    const device = await Device.findById(emp.deviceId);
    if (device) {
      // Probe first — for the log.
      try {
        const usersBefore = await zk.getUsers(device);
        const rowBefore = usersBefore.find((u) => String(u.userId) === String(emp.deviceUserId) || String(u.uid) === String(emp.deviceUserId));
        purgedCount = Number(rowBefore?.fingerCount) || 0;
        console.log(`Before purge — K40 UID=${emp.deviceUserId} had ${purgedCount} template(s).`);
      } catch (e) {
        console.warn(`Could not probe device — assuming 0. (${e.message})`);
      }

      // Hard-purge: delete the user record (removes templates on most K40 firmwares),
      // then re-create the user record under the same UID so future enrolments work.
      try {
        await zk.deleteUser(device, emp.deviceUserId);
        console.log(`Purged K40 user UID=${emp.deviceUserId}.`);
      } catch (e) {
        console.warn(`deleteUser failed (probably not present): ${e.message}`);
      }

      const privilege = Number.isFinite(emp.devicePrivilege) ? emp.devicePrivilege : ZK_PRIVILEGE.USER;
      try {
        await zk.createUser(device, {
          uid: Number(emp.deviceUserId),
          userId: String(emp.deviceUserId),
          name: emp.fullName,
          privilege,
          password: '',
        });
        console.log(`Recreated user record for "${emp.fullName}" on K40 under UID=${emp.deviceUserId}.`);
      } catch (e) {
        console.warn(`createUser failed: ${e.message}`);
      }

      // Verify — should now be 0.
      try {
        const usersAfter = await zk.getUsers(device);
        const rowAfter = usersAfter.find((u) => String(u.userId) === String(emp.deviceUserId) || String(u.uid) === String(emp.deviceUserId));
        baseline = Number(rowAfter?.fingerCount) || 0;
        console.log(`After purge — K40 UID=${emp.deviceUserId} has ${baseline} template(s).`);
      } catch { baseline = 0; }
    }
  }

  emp.fingerprintStatus = FINGERPRINT_STATUS.NOT_ENROLLED;
  emp.fingerCount = 0;
  emp.fingerBaseline = baseline; // should be 0 after purge
  emp.lastSync = new Date();
  await emp.save();

  console.log(`\nReset ${emp.fullName} (${emp.employeeId})`);
  console.log(`  deleted ${attDel.deletedCount} attendance row(s)`);
  console.log(`  deleted ${punchDel.deletedCount} device punch(es)`);
  console.log(`  templates purged  : ${purgedCount} → ${baseline}`);
  console.log(`  fingerprintStatus → NOT_ENROLLED, fingerCount → 0`);
  console.log(`  fingerBaseline    → ${baseline}`);
  console.log(`  lastSync          → now`);
  console.log(`  deviceId retained : ${emp.deviceId}`);
  console.log(`  deviceUserId      : ${emp.deviceUserId}\n`);
  if (baseline > 0) {
    console.log(`⚠ Baseline is still ${baseline}. Your K40 firmware isn't clearing templates on user-delete.`);
    console.log('   Manually delete UID ' + emp.deviceUserId + ' on the K40: Menu → User Mgt → find the user → Delete User → Delete Fingerprint too.');
    console.log('   Then re-run this script.\n');
    process.exit(0);
  }
  console.log('Next steps:');
  console.log('  1. Have this employee enrol a finger on the K40 (Menu → User Mgt → find the user → Enroll FP).');
  console.log('  2. Any template added now will flip HRMS to ENROLLED on the next Refresh.');
  console.log('  3. HRMS → Devices → Refresh Fingerprints.');
  console.log('  4. Tap the finger for attendance → device notification.');
  console.log('  5. Click Clock In in the app → work timer starts.\n');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
