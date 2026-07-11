require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');
const Shift = require('../models/Shift');

(async () => {
  await connectDB();
  const name = 'Shehroz Shift';
  let shift = await Shift.findOne({ name });
  if (!shift) {
    shift = await Shift.create({
      name,
      startTime: '16:00',
      endTime: '00:30',
      type: 'CUSTOM',
      graceMinutes: 10,
      isActive: true,
    });
    console.log('Created shift:', shift.name, shift.startTime, '->', shift.endTime);
  } else {
    shift.startTime = '16:00';
    shift.endTime = '00:30';
    shift.type = 'CUSTOM';
    shift.isActive = true;
    await shift.save();
    console.log('Updated shift:', shift.name, shift.startTime, '->', shift.endTime);
  }
  const user = await User.findOne({ employeeId: 'shehroz.ali' });
  if (!user) { console.error('Shehroz not found'); process.exit(1); }
  user.shift = shift._id;
  await user.save();
  const populated = await User.findById(user._id).populate('shift').lean();
  console.log('Shehroz shift now:', populated.shift);
  process.exit(0);
})();
