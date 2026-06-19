const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES, EMP_STATUS } = require('../config/constants');

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
