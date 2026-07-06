// Repoints an employee's device binding.
// Usage:
//   node src/scripts/fix-employee-device.js <employeeId> <newDeviceId> [newDeviceUserId]
// Examples:
//   node src/scripts/fix-employee-device.js TLA-0011 6a46b40199abcdef01234567
//   node src/scripts/fix-employee-device.js TLA-0011 6a46b40199abcdef01234567 2
require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');
const Device = require('../models/Device');
const { SYNC_STATUS } = require('../config/constants');

const [empArg, deviceIdArg, deviceUserIdArg] = process.argv.slice(2);
if (!empArg || !deviceIdArg) {
  console.error('Usage: node src/scripts/fix-employee-device.js <employeeId> <newDeviceId> [newDeviceUserId]');
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

  const device = await Device.findById(deviceIdArg);
  if (!device) { console.error(`No device with _id="${deviceIdArg}" — run list-devices.js first.`); process.exit(1); }

  const before = { deviceId: emp.deviceId, deviceUserId: emp.deviceUserId, syncStatus: emp.syncStatus };

  emp.deviceId = device._id;
  if (deviceUserIdArg) emp.deviceUserId = String(deviceUserIdArg);
  emp.syncStatus = SYNC_STATUS.SYNCED;
  emp.deviceSynced = true;
  emp.syncError = undefined;
  emp.lastSync = new Date();
  // Reset fingerprint tracking — the operator is telling us this employee is
  // now bound to a specific UID; assume no residual templates until the next
  // Refresh Fingerprints (or the poller) probes the device.
  emp.fingerBaseline = 0;
  emp.fingerCount = 0;
  emp.fingerprintStatus = 'NOT_ENROLLED';
  await emp.save();

  console.log(`\nUpdated ${emp.fullName} (${emp.employeeId})`);
  console.log('  before :', before);
  console.log('  after  :', { deviceId: emp.deviceId, deviceUserId: emp.deviceUserId, syncStatus: emp.syncStatus });
  console.log(`  device : ${device.name} @ ${device.ip}:${device.port}\n`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
