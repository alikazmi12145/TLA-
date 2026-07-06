// Deletes today's Attendance rows so the "verify finger first" rule can take effect cleanly.
// Usage:  node src/scripts/clear-today-attendance.js
require('dotenv').config();
const connectDB = require('../config/db');
const Attendance = require('../models/Attendance');
const { startOfDay, endOfDay } = require('../utils/date');

(async () => {
  await connectDB();
  const from = startOfDay();
  const to = endOfDay();
  const res = await Attendance.deleteMany({ date: { $gte: from, $lte: to } });
  console.log(`Deleted ${res.deletedCount} attendance row(s) for ${from.toISOString().slice(0, 10)}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
