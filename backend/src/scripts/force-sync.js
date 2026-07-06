// Force-runs the biometric import + fingerprint refresh cycle immediately.
// Useful when you don't want to wait 60s for the auto-poller or when you've
// just restarted the backend and want to reprocess the K40's attendance log.
//
// Usage:  node src/scripts/force-sync.js [deviceId]
require('dotenv').config();
const connectDB = require('../config/db');
const Device = require('../models/Device');
const User = require('../models/User');
const DevicePunch = require('../models/DevicePunch');
const zk = require('../services/zkteco.service');
const biometric = require('../services/biometric.service');
const { startOfDay, endOfDay } = require('../utils/date');

(async () => {
  await connectDB();
  const deviceId = process.argv[2];
  const device = deviceId
    ? await Device.findById(deviceId)
    : await Device.findOne({ isPrimary: true }) || await Device.findOne({ enabled: true });
  if (!device) { console.error('No device found'); process.exit(1); }
  console.log(`\nSyncing device "${device.name}" @ ${device.ip}:${device.port}\n`);

  console.log('--- 1. Raw punches on the K40 (last 30) ---');
  try {
    const raw = await zk.getAttendance(device);
    const recent = raw.slice(-30);
    if (!recent.length) console.log('  (device has no attendance log)');
    recent.forEach((p) => {
      console.log(`  ${new Date(p.timestamp).toISOString()}  userId=${String(p.deviceUserId).padEnd(6)}  type=${p.checkType || '-'}`);
    });
    console.log(`  Total on device: ${raw.length}`);
  } catch (e) { console.error('  getAttendance failed:', e.message); }

  console.log('\n--- 2. Importing attendance ---');
  try {
    const r = await biometric.importAttendance(device._id);
    console.log(`  imported: ${r.imported}`);
    console.log(`  skipped : ${r.skipped}`);
    console.log(`  total   : ${r.total}`);
    console.log(`  lastAt  : ${r.lastAt || '(none)'}`);
  } catch (e) { console.error('  FAILED:', e.message); }

  console.log('\n--- 3. Refreshing fingerprint statuses ---');
  try {
    const r = await biometric.refreshAllFingerprintStatuses(device._id);
    console.log(`  employees checked : ${r.total}`);
    console.log(`  status updated for: ${r.updated}`);
  } catch (e) { console.error('  FAILED:', e.message); }

  console.log('\n--- 4. Per-employee snapshot ---');
  const emps = await User.find({ deviceId: device._id }).sort({ deviceUserId: 1 });
  for (const e of emps) {
    // eslint-disable-next-line no-await-in-loop
    const punchesForUser = await DevicePunch.countDocuments({
      device: device._id,
      $or: [{ employee: e._id }, { deviceUserId: String(e.deviceUserId) }],
    });
    // eslint-disable-next-line no-await-in-loop
    const punchesToday = await DevicePunch.countDocuments({
      device: device._id,
      $or: [{ employee: e._id }, { deviceUserId: String(e.deviceUserId) }],
      punchAt: { $gte: startOfDay(), $lte: endOfDay() },
    });
    const cutoffOk = punchesForUser > 0;
    const bornBefore = e.createdAt < new Date();
    console.log(
      `  ${e.fullName.padEnd(20)} uid=${String(e.deviceUserId).padEnd(3)}  ` +
      `status=${e.fingerprintStatus.padEnd(14)}  ` +
      `punchesEver=${String(punchesForUser).padEnd(3)}  today=${String(punchesToday).padEnd(3)}  ` +
      `created=${e.createdAt.toISOString().slice(0, 19)}`
    );
    if (e.fingerprintStatus === 'NOT_ENROLLED' && punchesForUser === 0) {
      console.log(`     → No punch for ${e.fullName} on this device. Tap the finger on the K40 (must show "Verified").`);
    } else if (e.fingerprintStatus === 'NOT_ENROLLED' && punchesForUser > 0) {
      console.log(`     → Has punches but status stale — refresh should have flipped. Check createdAt vs punchAt.`);
    }
  }
  console.log('');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
