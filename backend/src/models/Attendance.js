const mongoose = require('mongoose');
const { ATTENDANCE_STATUS, ATTENDANCE_METHOD } = require('../config/constants');

const attendanceSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    date: { type: Date, required: true, index: true }, // start of day
    method: { type: String, enum: Object.values(ATTENDANCE_METHOD), default: ATTENDANCE_METHOD.LOGIN },
    clockIn: Date,
    clockOut: Date,
    breakStart: Date,
    breakEnd: Date,
    lunchStart: Date,
    lunchEnd: Date,
    workMinutes: { type: Number, default: 0 },
    status: { type: String, enum: Object.values(ATTENDANCE_STATUS), default: ATTENDANCE_STATUS.PRESENT },
    isLate: { type: Boolean, default: false },
    lateMinutes: { type: Number, default: 0 },
    note: String,
    adjustedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
