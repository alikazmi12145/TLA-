// Compares TWO ways of reading template counts from the K40:
//   A) getInfo — device-wide total
//   B) getUsers — per-user (may or may not populate fingerCount)
//   C) getUserFingerCount (our per-finger USERTEMP_RRQ probe)
//
// If (A) > 0 but (C) always returns 0, the firmware isn't answering USERTEMP_RRQ
// and we need to switch detection strategy.
//
// Usage:  node src/scripts/inspect-device-fingers.js [deviceId]
require('dotenv').config();
const connectDB = require('../config/db');
const Device = require('../models/Device');
const User = require('../models/User');
const zk = require('../services/zkteco.service');

(async () => {
  await connectDB();
  const deviceId = process.argv[2];
  const device = deviceId
    ? await Device.findById(deviceId)
    : await Device.findOne({ isPrimary: true }) || await Device.findOne({ enabled: true });
  if (!device) { console.error('No device found'); process.exit(1); }
  console.log(`\nDevice: ${device.name} @ ${device.ip}:${device.port}\n`);

  console.log('--- A) getInfo (device totals) ---');
  try {
    const info = await zk.getInfo(device);
    console.log(`  userCount   : ${info.userCount}`);
    console.log(`  fingerCount : ${info.fingerCount}   ← TOTAL templates across all users`);
    console.log(`  recordCount : ${info.recordCount}`);
  } catch (e) { console.log('  getInfo failed:', e.message); }

  console.log('\n--- B) getUsers (per-user list from device) ---');
  let users = [];
  try {
    users = await zk.getUsers(device);
    if (!users.length) console.log('  (no users)');
    users.forEach((u) => {
      console.log(`  uid=${String(u.uid).padEnd(4)} userId="${String(u.userId).padEnd(6)}" name="${(u.name || '').padEnd(24)}" fingerCount(reported)=${u.fingerCount}`);
    });
  } catch (e) { console.log('  getUsers failed:', e.message); }

  console.log('\n--- C) getUserFingerCount (per-finger USERTEMP_RRQ probe) ---');
  for (const u of users) {
    try {
      const c = await zk.getUserFingerCount(device, u.uid);
      console.log(`  uid=${u.uid}  userId="${u.userId}"  probed count = ${c}`);
    } catch (e) {
      console.log(`  uid=${u.uid}  probe failed: ${e.message}`);
    }
  }

  console.log('\n--- HRMS view of these employees ---');
  const emps = await User.find({ deviceId: device._id, deviceUserId: { $in: users.map((u) => String(u.userId)) } });
  emps.forEach((e) => {
    console.log(`  ${e.fullName} (${e.employeeId})  deviceUserId=${e.deviceUserId}  status=${e.fingerprintStatus}  baseline=${e.fingerBaseline}  fingerCount(HRMS)=${e.fingerCount}`);
  });

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
