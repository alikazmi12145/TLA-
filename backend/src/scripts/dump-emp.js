require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
require('../models/Shift');

(async () => {
  await connectDB();
  const emp = await User.findOne({ employeeId: process.argv[2] || 'ali.kazmi' });
  console.log('Employee:', emp.fullName, emp._id.toString());
  const rows = await Attendance.find({ employee: emp._id }).sort({ date: -1 }).limit(5).lean();
  for (const r of rows) {
    console.log('--- row date:', r.date.toISOString(), '  updatedAt:', r.updatedAt.toISOString());
    console.log('   agg  in=', r.deviceCheckInAt, 'out=', r.deviceCheckOutAt, 'clockIn=', r.clockIn, 'clockOut=', r.clockOut);
    for (const [i, s] of r.sessions.entries()) {
      console.log(`   s[${i}] in=${s.deviceCheckInAt}  out=${s.deviceCheckOutAt}  clockIn=${s.clockIn}  clockOut=${s.clockOut}`);
    }
  }
  process.exit(0);
})();
