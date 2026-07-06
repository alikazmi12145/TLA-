// Fixes bogus fingerBaselines that were set by the broken USERTEMP_RRQ probe.
// For every employee bound to a device, re-reads the current template count
// via getUsers().fingerCount (the reliable field) and stores it as the new
// baseline. Status is set based on whether templates already exceed baseline.
//
// Usage:  node src/scripts/rebaseline-all.js [deviceId]
require('dotenv').config();
const connectDB = require('../config/db');
const Device = require('../models/Device');
const User = require('../models/User');
const zk = require('../services/zkteco.service');
const { FINGERPRINT_STATUS } = require('../config/constants');

(async () => {
  await connectDB();
  const deviceId = process.argv[2];
  const device = deviceId
    ? await Device.findById(deviceId)
    : await Device.findOne({ isPrimary: true }) || await Device.findOne({ enabled: true });
  if (!device) { console.error('No device found'); process.exit(1); }
  console.log(`\nRebaselining employees on "${device.name}" @ ${device.ip}:${device.port}\n`);

  const users = await zk.getUsers(device);
  const byId = new Map(users.map((u) => [String(u.userId), u]));

  const emps = await User.find({ deviceId: device._id });
  let updated = 0;
  for (const emp of emps) {
    const row = byId.get(String(emp.deviceUserId));
    const rawCount = Number(row?.fingerCount) || 0;
    // Baseline = whatever is on the device RIGHT NOW → any FUTURE enrollment
    // pushes count above baseline and flips to ENROLLED.
    emp.fingerBaseline = rawCount;
    emp.fingerCount = 0;
    emp.fingerprintStatus = FINGERPRINT_STATUS.NOT_ENROLLED;
    await emp.save();
    console.log(`  ${emp.fullName.padEnd(20)} uid=${emp.deviceUserId}  device says ${rawCount} → baseline=${rawCount}, status=NOT_ENROLLED`);
    updated += 1;
  }
  console.log(`\n✅ Rebaselined ${updated} employee(s). Now:`);
  console.log('   1. Physically enrol each employee\'s finger on the K40.');
  console.log('   2. In HRMS: Devices → Refresh Fingerprints.');
  console.log('   3. Anyone whose device fingerCount rises above their baseline flips to ENROLLED.\n');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
