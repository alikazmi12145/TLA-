const mongoose = require('mongoose');
const {
  ATTENDANCE_STATUS,
  ATTENDANCE_METHOD,
  CHECK_TYPE,
  VERIFICATION_MODE,
} = require('../config/constants');

const attendanceSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    date: { type: Date, required: true, index: true }, // start of day
    method: { type: String, enum: Object.values(ATTENDANCE_METHOD), default: ATTENDANCE_METHOD.LOGIN },
    clockIn: Date,
    clockOut: Date,
    workMinutes: { type: Number, default: 0 },
    status: { type: String, enum: Object.values(ATTENDANCE_STATUS), default: ATTENDANCE_STATUS.PRESENT },
    isLate: { type: Boolean, default: false },
    lateMinutes: { type: Number, default: 0 },
    note: String,
    adjustedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // -------- Biometric device metadata (populated when method=FINGERPRINT) --------
    device: { type: mongoose.Schema.Types.ObjectId, ref: 'Device', index: true },
    deviceUserId: { type: String, trim: true },
    terminal: { type: String, trim: true }, // human name/serial of terminal that captured the punch
    // Raw device timestamp for the individual punch that produced this row
    devicePunchAt: { type: Date },
    // First and last physical device punches of the day. These are gates for
    // the app Clock In / Clock Out buttons but do NOT themselves start the
    // work-hours timer — the app buttons still set clockIn/clockOut.
    deviceCheckInAt: { type: Date },
    deviceCheckOutAt: { type: Date },
    checkType: { type: String, enum: Object.values(CHECK_TYPE) },
    verificationMode: { type: String, enum: Object.values(VERIFICATION_MODE) },
  },
  { timestamps: true }
);

attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
