const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const {
  ROLES,
  EMP_STATUS,
  SYNC_STATUS,
  FINGERPRINT_STATUS,
  FACE_STATUS,
} = require('../config/constants');

const userSchema = new mongoose.Schema(
  {
    employeeId: { type: String, unique: true, sparse: true, trim: true, index: true },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    password: { type: String, required: true, minlength: 6, select: false },
    phone: { type: String, trim: true },
    cnic: { type: String, trim: true },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.EMPLOYEE, index: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
    designation: { type: String, trim: true },
    joiningDate: { type: Date },
    shift: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift' },
    // Per-employee weekly off days (0=Sun, 1=Mon, ... 6=Sat). Default: Sunday off.
    weeklyOffDays: { type: [Number], default: [0] },
    basicSalary: { type: Number, default: 0, min: 0 },
    dailyTarget: { type: Number, default: 0, min: 0 },
    commissionRate: { type: Number, default: 0, min: 0, max: 100 },
    profilePicture: { type: String },
    fingerprintId: { type: String, unique: true, sparse: true },
    status: { type: String, enum: EMP_STATUS, default: 'ACTIVE' },
    isActive: { type: Boolean, default: true },

    // -------- Biometric device integration --------
    // The device this employee is enrolled on (ZKTeco K40 typically).
    deviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Device', index: true },
    // Numeric or string ID on the device (ZK "userId"). Must be unique per device.
    deviceUserId: { type: String, trim: true, index: true },
    // Has the record been pushed to the device successfully?
    deviceSynced: { type: Boolean, default: false, index: true },
    syncStatus: {
      type: String,
      enum: Object.values(SYNC_STATUS),
      default: SYNC_STATUS.PENDING,
      index: true,
    },
    // Enrollment state pulled back from the device (fingerprints/faces NEVER live in Mongo).
    fingerprintStatus: {
      type: String,
      enum: Object.values(FINGERPRINT_STATUS),
      default: FINGERPRINT_STATUS.NOT_ENROLLED,
      index: true,
    },
    faceStatus: {
      type: String,
      enum: Object.values(FACE_STATUS),
      default: FACE_STATUS.NOT_ENROLLED,
    },
    // Number of finger templates registered on the device (0..10)
    fingerCount: { type: Number, default: 0 },
    // Baseline template count observed on the device for this UID at sync time.
    // An employee is only considered ENROLLED once fingerCount rises above this
    // baseline — prevents residual templates from a previously deleted holder
    // of the same UID from auto-marking a new employee as enrolled.
    fingerBaseline: { type: Number, default: 0 },
    lastSync: { type: Date },
    lastAttendance: { type: Date },
    // Last error message when a sync operation failed
    syncError: { type: String },
    // ZKTeco privilege (0=user, 14=admin)
    devicePrivilege: { type: Number, default: 0 },
    // Whether the record on the device is currently enabled (some models support disable/enable)
    deviceUserEnabled: { type: Boolean, default: true },

    refreshTokens: [{ token: String, createdAt: { type: Date, default: Date.now } }],
    resetPasswordToken: { type: String, select: false },
    resetPasswordExpires: { type: Date, select: false },
    lastLoginAt: Date,
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const rounds = Number(process.env.BCRYPT_SALT_ROUNDS || 10);
  this.password = await bcrypt.hash(this.password, rounds);
  next();
});

userSchema.methods.comparePassword = function (raw) {
  return bcrypt.compare(raw, this.password);
};

userSchema.methods.toSafeJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshTokens;
  delete obj.resetPasswordToken;
  delete obj.resetPasswordExpires;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
