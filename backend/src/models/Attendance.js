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
    // Per-session early-out / overtime — measured against the row-level
    // shift snapshot (shiftStart / shiftEnd). Computed by the repository
    // in `recomputeAggregates` whenever the session mutates.
    earlyOutMinutes: { type: Number, default: 0 },
    overtimeMinutes: { type: Number, default: 0 },
  },
  { _id: true, timestamps: false }
);

// ------------------------------------------------------------------
// Canonical high-level status per the production spec. Kept SEPARATE
// from the legacy `status` field (PRESENT / LATE / ABSENT / HOLIDAY / …)
// so payroll / reports that already read `status` keep working while a
// clean state-machine value (`attendanceStatus`) drives UI + realtime.
//
//   DEVICE_IN    → device check-in stamped, waiting for web Clock In
//   CLOCKED_IN   → web Clock In done, waiting for device check-out
//   DEVICE_OUT   → device check-out stamped, waiting for web Clock Out
//   COMPLETED    → web Clock Out done, row closed and `isOpen = false`
// ------------------------------------------------------------------
const ATTENDANCE_LIFECYCLE = ['DEVICE_IN', 'CLOCKED_IN', 'DEVICE_OUT', 'COMPLETED'];

const attendanceSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // `date` is the ATTENDANCE DATE per the spec — set ONCE at row creation
    // (device check-in date, or clock-in date if no device tap). NEVER
    // reassigned after midnight, so overnight shifts stay grouped under a
    // single day for reports.
    date: { type: Date, required: true, index: true },
    method: { type: String, enum: Object.values(ATTENDANCE_METHOD), default: ATTENDANCE_METHOD.LOGIN },

    // Snapshot of the assigned shift at the moment the row was opened.
    // Used by reports + late/early-out/overtime maths without having to
    // re-populate the Shift for every read. Nullable when the employee
    // has no shift assigned.
    shift: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift' },
    shiftStart: { type: Date },
    shiftEnd: { type: Date },

    // Top-level clock fields — kept for backward compatibility. They mirror
    // the LAST entry in `sessions[]` so existing UI/queries keep working.
    clockIn: Date,
    clockOut: Date,
    // Sum of workMinutes across every session on this day (aggregate).
    workMinutes: { type: Number, default: 0 },
    status: { type: String, enum: Object.values(ATTENDANCE_STATUS), default: ATTENDANCE_STATUS.PRESENT },
    // Canonical state-machine value (see ATTENDANCE_LIFECYCLE above).
    // Populated + updated by the repository. Null on brand-new / legacy rows.
    attendanceStatus: { type: String, enum: ATTENDANCE_LIFECYCLE, default: null, index: true },
    // TRUE while the row is awaiting the next lifecycle step (any state
    // except COMPLETED). The single canonical lookup for the punch flow is
    // `{ employee, isOpen: true }`. Rule 3 of the spec.
    isOpen: { type: Boolean, default: false, index: true },
    // Lateness aggregates rolled up from sessions[0] (only the first session
    // of the day is evaluated against the scheduled shift start; subsequent
    // sessions on the same day don't re-trigger lateness).
    isLate: { type: Boolean, default: false },
    lateMinutes: { type: Number, default: 0 },
    // Aggregate early-out / overtime — summed across sessions[].
    earlyOutMinutes: { type: Number, default: 0 },
    isEarlyOut: { type: Boolean, default: false },
    overtimeMinutes: { type: Number, default: 0 },
    note: String,
    lateReason: String,
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
// PRIMARY lookup for the punch flow — spec Rule 3 / 4 / 17.
// UNIQUE partial index enforces spec Rule 1 / 14 at the DATABASE level:
// exactly ONE row per employee can carry `isOpen: true`. A race or bug
// that tries to create a second open row fails atomically with E11000
// instead of silently corrupting the lifecycle. The partial filter keeps
// the index tiny — only OPEN rows are ever stored / probed.
attendanceSchema.index(
  { employee: 1, isOpen: 1 },
  { unique: true, partialFilterExpression: { isOpen: true } }
);
// Compound indexes tuned for the hottest read paths:
//  - `{ date: -1, status: 1 }` powers the admin "today" / range list.
//  - `{ employee: 1, status: 1, date: -1 }` powers per-employee history.
//  - `{ device: 1, devicePunchAt: -1 }` powers device-scoped punch history.
//  - `{ devicePunchAt: -1 }` powers the raw punch chronology view.
attendanceSchema.index({ date: -1, status: 1 });
attendanceSchema.index({ employee: 1, status: 1, date: -1 });
attendanceSchema.index({ device: 1, devicePunchAt: -1 });
attendanceSchema.index({ devicePunchAt: -1 });

// Read-only alias so callers using the spec-canonical name `attendanceDate`
// get the same value as `date`. Preserves backward compatibility for every
// existing consumer of `date`.
attendanceSchema.virtual('attendanceDate').get(function () { return this.date; });
attendanceSchema.set('toJSON', { virtuals: true });
attendanceSchema.set('toObject', { virtuals: true });

attendanceSchema.statics.LIFECYCLE = ATTENDANCE_LIFECYCLE;

module.exports = mongoose.model('Attendance', attendanceSchema);
