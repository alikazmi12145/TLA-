// Wipes every user and template from the K40 (via node-zklib), then resets
// every HRMS employee bound to that device back to a clean state.
//
// Usage:
//   node src/scripts/wipe-device.js <deviceId>
//   node src/scripts/wipe-device.js <deviceId> --keep-attendance
//
// After this:
//   - Every employee: syncStatus=PENDING, deviceUserId cleared, fingerprint reset.
//   - Device has no users, no fingerprints. (Attendance logs cleared unless --keep-attendance.)
//   - Follow up with: Devices → Sync All in HRMS.
//   - Then physically re-enrol fingerprints on the K40.
require('dotenv').config();
const readline = require('readline');
const connectDB = require('../config/db');
const Device = require('../models/Device');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const DevicePunch = require('../models/DevicePunch');
const zk = require('../services/zkteco.service');

const [deviceIdArg, ...flags] = process.argv.slice(2);
const keepAttendance = flags.includes('--keep-attendance');
if (!deviceIdArg) {
  console.error('Usage: node src/scripts/wipe-device.js <deviceId> [--keep-attendance]');
  process.exit(1);
}

const ask = (q) => new Promise((r) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (a) => { rl.close(); r(a.trim()); });
});

(async () => {
  await connectDB();
  const device = await Device.findById(deviceIdArg);
  if (!device) { console.error(`Device ${deviceIdArg} not found. Run: node src/scripts/list-devices.js`); process.exit(1); }

  console.log(`\n⚠ About to WIPE device "${device.name}" @ ${device.ip}:${device.port}`);
  console.log('   - All users on the K40 will be deleted (fingerprints included).');
  console.log('   - Every HRMS employee bound to this device will be un-bound and reset.');
  if (!keepAttendance) console.log('   - Attendance logs on the K40 AND in Mongo (Attendance + DevicePunch) for this device will be cleared.');
  console.log('   - Network/comm config on the K40 is untouched.\n');
  const ok = await ask('Type "WIPE" to proceed: ');
  if (ok !== 'WIPE') { console.log('Aborted.'); process.exit(0); }

  // 1. Snapshot current users on the K40 so we know what to delete.
  let users = [];
  try { users = await zk.getUsers(device); } catch (e) {
    console.error(`Cannot read users from K40: ${e.message}`);
    process.exit(1);
  }
  console.log(`\nFound ${users.length} user(s) on the device.`);

  // 2. Delete each user (removes templates on most K40 firmwares).
  let deleted = 0, failed = 0;
  for (const u of users) {
    try {
      await zk.deleteUser(device, u.uid);
      deleted += 1;
      process.stdout.write(`  deleted uid=${u.uid} userId=${u.userId} name="${u.name}"\n`);
    } catch (e) {
      failed += 1;
      console.warn(`  FAILED uid=${u.uid}: ${e.message}`);
    }
  }
  console.log(`\nDevice user delete: ${deleted} ok, ${failed} failed.`);

  // 3. Verify empty.
  try {
    const after = await zk.getUsers(device);
    console.log(`Remaining users on device: ${after.length}`);
    if (after.length > 0) {
      console.log('⚠ Some users still remain. Firmware may not accept remote delete for all UIDs.');
      console.log('   Do a factory reset on the K40: Menu → System → Reset → Factory Reset.');
    }
  } catch { /* not critical */ }

  // 4. Clear attendance logs on device.
  if (!keepAttendance) {
    try { await zk.clearAttendance(device); console.log('Cleared device attendance logs.'); }
    catch (e) { console.warn(`Could not clear device attendance: ${e.message}`); }
  }

  // 5. Reset every HRMS employee bound to this device.
  const bound = await User.find({ deviceId: device._id });
  let resetCount = 0;
  for (const emp of bound) {
    emp.deviceSynced = false;
    emp.syncStatus = 'PENDING';
    emp.syncError = undefined;
    emp.fingerprintStatus = 'NOT_ENROLLED';
    emp.fingerCount = 0;
    emp.fingerBaseline = 0;
    emp.lastSync = null;
    // Keep deviceId and deviceUserId so re-sync reuses same UIDs. Set them
    // undefined instead if you want a fresh UID allocation next time.
    await emp.save();
    resetCount += 1;
  }
  console.log(`Reset ${resetCount} HRMS employee(s) bound to this device.`);

  // 6. Wipe stored attendance for this device in Mongo (unless --keep-attendance).
  if (!keepAttendance) {
    const a = await Attendance.deleteMany({ device: device._id });
    const p = await DevicePunch.deleteMany({ device: device._id });
    console.log(`Cleared ${a.deletedCount} Attendance row(s) and ${p.deletedCount} DevicePunch row(s) for this device.`);
  }

  console.log('\n✅ Wipe complete. Next steps:');
  console.log('   1. HRMS → Devices → Sync All (pushes every employee back to the K40).');
  console.log('   2. Physically enrol each employee\'s finger on the K40 (Menu → User Mgt → Enroll FP).');
  console.log('   3. HRMS → Devices → Refresh Fingerprints.\n');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
