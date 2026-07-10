const mongoose = require('mongoose');
const {
  ATTENDANCE_STATUS,
  ATTENDANCE_METHOD,
  CHECK_TYPE,
  VERIFICATION_MODE,
} = require('../config/constants');

/**
 * A single work session inside a day. An employee may run multiple sessions
 * on the same calendar date (e.g. split shifts). Each session lives inside
 * the parent Attendance row's `sessions[]` array; the row's top-level
 * clockIn/clockOut/deviceCheckInAt/deviceCheckOutAt fields are kept as
 * denormalised aggregates that mirror the LAST session so the existing
 * frontend, payroll, and reports continue to work unchanged.
 */
const sessionSchema = new mongoose.Schema(
  {
    clockIn: Date,
    clockOut: Date,
    deviceCheckInAt: Date,
    deviceCheckOutAt: Date,
    workMinutes: { type: Number, default: 0 },
    isLate: { type: Boolean, default: false },
    lateMinutes: { type: Number, default: 0 },
  },
  { _id: true, timestamps: false }
);

const attendanceSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    date: { type: Date, required: true, index: true }, // start of day (clock-in day)
    method: { type: String, enum: Object.values(ATTENDANCE_METHOD), default: ATTENDANCE_METHOD.LOGIN },
    // Top-level clock fields — kept for backward compatibility. They mirror
    // the LAST entry in `sessions[]` so existing UI/queries keep working.
    clockIn: Date,
    clockOut: Date,
    // Sum of workMinutes across every session on this day (aggregate).
    workMinutes: { type: Number, default: 0 },
    status: { type: String, enum: Object.values(ATTENDANCE_STATUS), default: ATTENDANCE_STATUS.PRESENT },
    // Lateness aggregates rolled up from sessions[0] (only the first session
    // of the day is evaluated against the scheduled shift start; subsequent
    // sessions on the same day don't re-trigger lateness).
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
    // Aggregates mirroring the LAST session's device stamps.
    deviceCheckInAt: { type: Date },
    deviceCheckOutAt: { type: Date },
    checkType: { type: String, enum: Object.values(CHECK_TYPE) },
    verificationMode: { type: String, enum: Object.values(VERIFICATION_MODE) },

    // Ordered list of work sessions on this day. Empty for legacy rows —
    // the repository lazily migrates legacy top-level fields into sessions[0]
    // on the first write, so reads and writes are always consistent.
    sessions: { type: [sessionSchema], default: [] },
  },
  { timestamps: true }
);

attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Attendance', attendanceSchema);
