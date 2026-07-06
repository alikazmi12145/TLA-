// Lists every device configured in HRMS.
// Usage:  node src/scripts/list-devices.js
require('dotenv').config();
const connectDB = require('../config/db');
const Device = require('../models/Device');

(async () => {
  await connectDB();
  const devices = await Device.find({}).sort({ isPrimary: -1, createdAt: 1 });
  if (!devices.length) { console.log('No devices configured.'); process.exit(0); }
  console.log(`\nFound ${devices.length} device(s):\n`);
  devices.forEach((d, i) => {
    console.log(`[${i + 1}] ${d.isPrimary ? '★ PRIMARY  ' : '           '}${d.name}`);
    console.log(`    _id              : ${d._id}`);
    console.log(`    ip:port          : ${d.ip}:${d.port}`);
    console.log(`    enabled          : ${d.enabled}`);
    console.log(`    connectionStatus : ${d.connectionStatus}`);
    console.log(`    lastPing         : ${d.lastPing || '(never)'}`);
    console.log('');
  });
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
