require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');
const Shift = require('../models/Shift');
const Attendance = require('../models/Attendance');

(async () => {
  await connectDB();
  const users = await User.find({
    $or: [
      { fullName: /shehroz/i },
      { employeeId: /shehroz/i },
      { email: /shehroz/i },
    ],
  }).populate('shift').lean();
  console.log('--- Matching users ---');
  for (const u of users) {
    console.log({
      id: u._id.toString(),
      employeeId: u.employeeId,
      fullName: u.fullName,
      shift: u.shift ? { name: u.shift.name, start: u.shift.startTime, end: u.shift.endTime, type: u.shift.type } : null,
      isActive: u.isActive,
      deviceUserId: u.deviceUserId,
      fingerprintStatus: u.fingerprintStatus,
    });
  }
  console.log('\n--- Ali Kazmi for comparison ---');
  const ali = await User.findOne({ $or: [{ fullName: /ali kazmi/i }, { employeeId: /ali\.kazmi/i }] }).populate('shift').lean();
  if (ali) {
    console.log({
      id: ali._id.toString(),
      employeeId: ali.employeeId,
      fullName: ali.fullName,
      shift: ali.shift ? { name: ali.shift.name, start: ali.shift.startTime, end: ali.shift.endTime, type: ali.shift.type } : null,
    });
  }
  console.log('\n--- All shifts ---');
  const shifts = await Shift.find().lean();
  for (const s of shifts) {
    console.log({ id: s._id.toString(), name: s.name, start: s.startTime, end: s.endTime, type: s.type, isActive: s.isActive });
  }

  if (users[0]) {
    console.log('\n--- Shehroz recent attendance rows ---');
    const rows = await Attendance.find({ employee: users[0]._id }).sort({ date: -1 }).limit(5).lean();
    for (const r of rows) {
      console.log('row date:', r.date && r.date.toISOString(), 'clockIn=', r.clockIn, 'clockOut=', r.clockOut, 'devIn=', r.deviceCheckInAt, 'devOut=', r.deviceCheckOutAt, 'sessions=', r.sessions?.length);
    }
  }
  process.exit(0);
})();
