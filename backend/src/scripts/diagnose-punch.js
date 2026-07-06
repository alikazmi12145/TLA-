// Diagnoses why an app clock-in is being blocked for a given employee.
// Usage:  node src/scripts/diagnose-punch.js ali
//         node src/scripts/diagnose-punch.js ali@example.com
//         node src/scripts/diagnose-punch.js EMP001
require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');
const Device = require('../models/Device');
const Attendance = require('../models/Attendance');
const DevicePunch = require('../models/DevicePunch');
const { startOfDay, endOfDay } = require('../utils/date');
const biometric = require('../services/biometric.service');
const zk = require('../services/zkteco.service');

const arg = (process.argv[2] || '').trim();
if (!arg) { console.error('Usage: node src/scripts/diagnose-punch.js <name|email|employeeId>'); process.exit(1); }

const line = (label, value) => console.log(String(label).padEnd(28), value);
const banner = (t) => console.log(`\n=== ${t} ===`);

(async () => {
  await connectDB();

  banner('1. Employee lookup');
  const emp = await User.findOne({
    $or: [
      { email: arg.toLowerCase() },
      { employeeId: arg },
      { fullName: new RegExp(`^${arg}$`, 'i') },
      { fullName: new RegExp(arg, 'i') },
    ],
  });
  if (!emp) { console.error(`No employee matched "${arg}"`); process.exit(1); }
  line('_id', emp._id.toString());
  line('fullName', emp.fullName);
  line('email', emp.email);
  line('employeeId', emp.employeeId || '(none)');
  line('deviceId (HRMS)', emp.deviceId ? emp.deviceId.toString() : '(none — NOT SYNCED)');
  line('deviceUserId', emp.deviceUserId || '(none — NOT SYNCED)');
  line('fingerprintStatus', emp.fingerprintStatus);
  line('fingerCount (HRMS)', emp.fingerCount);
  line('fingerBaseline', emp.fingerBaseline || 0);
  line('syncStatus', emp.syncStatus);
  line('lastSync', emp.lastSync);

  if (!emp.deviceId || !emp.deviceUserId) {
    console.error('\n❌ Employee is NOT synced to any device. Fix: Devices → Sync All.');
    process.exit(0);
  }

  banner('2. Device status');
  const device = await Device.findById(emp.deviceId);
  if (!device) { console.error(`Device ${emp.deviceId} not found`); process.exit(1); }
  line('name', device.name);
  line('ip:port', `${device.ip}:${device.port}`);
  line('enabled', device.enabled);
  line('connectionStatus', device.connectionStatus);
  line('lastPing', device.lastPing);
  line('lastSync', device.lastSync);
  line('lastError', device.lastError || '(none)');

  banner('3. Ping test');
  try {
    const p = await zk.ping(device);
    line('ping ok?', p.ok);
    line('latencyMs', p.latencyMs);
    line('error', p.error || '(none)');
  } catch (e) { console.error('ping threw:', e.message); }

  banner('4. Users currently on the K40');
  let deviceUsers = [];
  try {
    deviceUsers = await zk.getUsers(device);
    if (!deviceUsers.length) console.log('  (device returned no users)');
    deviceUsers.forEach((u) => {
      const marker = String(u.userId) === String(emp.deviceUserId) ? '  ← THIS EMPLOYEE' : '';
      console.log(`  uid=${u.uid}  userId="${u.userId}"  name="${u.name}"${marker}`);
    });
  } catch (e) { console.error('  getUsers failed:', e.message); }

  banner(`5. Template count on device for UID=${emp.deviceUserId}`);
  let rawCount = 0;
  try {
    rawCount = await zk.getUserFingerCount(device, emp.deviceUserId);
    line('raw template count', rawCount);
    line('baseline', emp.fingerBaseline || 0);
    line('new fingers (raw − baseline)', Math.max(0, rawCount - (emp.fingerBaseline || 0)));
    if (rawCount === 0) {
      console.log(`  ⚠ Device reports ZERO templates for UID=${emp.deviceUserId}.`);
      console.log('     → Either the employee enrolled under a DIFFERENT UID on the K40, or');
      console.log('       the device isn\'t returning template data. See section 4 for the real UIDs.');
    } else if (rawCount <= (emp.fingerBaseline || 0)) {
      console.log(`  ⚠ Templates exist but ≤ baseline (${emp.fingerBaseline}). No NEW finger has been enrolled since sync.`);
      console.log('     → Add another finger on the K40, OR reset the baseline: node src/scripts/reset-employee-biometric.js ' + (emp.employeeId || emp.fullName));
    }
  } catch (e) { console.error('  getUserFingerCount failed:', e.message); }

  banner('6. Force live import right now');
  try {
    const r = await biometric.importAttendance(device._id);
    line('imported', r.imported);
    line('skipped', r.skipped);
    line('total from device', r.total);
    line('lastAt', r.lastAt);
  } catch (e) { console.error('importAttendance failed:', e.message); }

  banner('7. Raw device punches for this employee TODAY');
  const from = startOfDay();
  const to = endOfDay();
  const punches = await DevicePunch.find({
    $or: [{ employee: emp._id }, { deviceUserId: String(emp.deviceUserId) }],
    punchAt: { $gte: from, $lte: to },
  }).sort({ punchAt: 1 });
  line('count', punches.length);
  punches.forEach((p, i) => {
    console.log(`  [${i + 1}] ${p.punchAt.toISOString()}  user=${p.deviceUserId}  matched=${p.matched}  type=${p.checkType || '-'}`);
  });

  banner('8. Any unmatched punches today (wrong deviceUserId mapping)?');
  const unmatched = await DevicePunch.find({ matched: false, punchAt: { $gte: from, $lte: to } })
    .sort({ punchAt: -1 }).limit(10);
  if (!unmatched.length) console.log('  none');
  unmatched.forEach((p) => console.log(`  ${p.punchAt.toISOString()}  deviceUserId=${p.deviceUserId}  terminal=${p.terminal}`));

  banner('9. Today\'s Attendance row');
  const att = await Attendance.findOne({ employee: emp._id, date: from });
  if (!att) {
    console.log('  (no row) → app Clock In will return "Verify finger from device first"');
  } else {
    line('method', att.method);
    line('deviceCheckInAt', att.deviceCheckInAt || '(not set)');
    line('deviceCheckOutAt', att.deviceCheckOutAt || '(not set)');
    line('clockIn (app)', att.clockIn || '(not set)');
    line('clockOut (app)', att.clockOut || '(not set)');
  }

  banner('Verdict');
  const matchingDeviceUser = deviceUsers.find((u) => String(u.userId) === String(emp.deviceUserId));
  if (!matchingDeviceUser) {
    console.log(`❌ K40 has NO user with userId="${emp.deviceUserId}" (HRMS's deviceUserId for this employee).`);
    console.log('   → The employee was enrolled on the K40 under a DIFFERENT UID than HRMS assigned.');
    console.log('   → Section 4 lists what UIDs actually exist on the device.');
    console.log(`   Fix: pick the correct UID from section 4, then run:`);
    console.log(`     node src/scripts/fix-employee-device.js ${emp.employeeId || emp.fullName} ${device._id} <correctUid>`);
  } else if (rawCount === 0) {
    console.log(`❌ K40 user "${matchingDeviceUser.name}" (uid=${matchingDeviceUser.uid}) has NO templates.`);
    console.log('   → Enrol the finger on the K40 for this user (Menu → User Mgt → Enroll FP).');
  } else if (rawCount <= (emp.fingerBaseline || 0)) {
    console.log(`⚠ Baseline (${emp.fingerBaseline}) is too high — HRMS thinks these templates are residual.`);
    console.log('   → Reset baseline: node src/scripts/reset-employee-biometric.js ' + (emp.employeeId || emp.fullName));
    console.log('     Then re-enrol the finger on the K40.');
  } else if (emp.fingerprintStatus !== 'ENROLLED') {
    console.log('⚠ Templates exceed baseline but HRMS status is stale. The 60s poller will fix it,');
    console.log('   or click Devices → Refresh Fingerprints in the UI right now.');
  } else if (!punches.length) {
    console.log('❌ Enrolled but no punches today. Tap the finger; watch the K40 screen for "Verified".');
  } else if (!att || !att.deviceCheckInAt) {
    console.log('⚠ Punches exist but Attendance row wasn\'t updated. Send the output above.');
  } else {
    console.log('✅ Everything is in place. Clock In should work now.');
  }

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
