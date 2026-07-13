const mongoose = require('mongoose');
const { CHECK_TYPE, VERIFICATION_MODE } = require('../config/constants');

const devicePunchSchema = new mongoose.Schema(
  {
    device: { type: mongoose.Schema.Types.ObjectId, ref: 'Device', required: true, index: true },
    deviceUserId: { type: String, required: true, trim: true, index: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    punchAt: { type: Date, required: true, index: true },
    checkType: { type: String, enum: Object.values(CHECK_TYPE) },
    verificationMode: { type: String, enum: Object.values(VERIFICATION_MODE) },
    terminal: { type: String, trim: true },
    matched: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

// Dedupe re-imports: the same (device, user, timestamp) tuple is a single physical tap.
devicePunchSchema.index(
  { device: 1, deviceUserId: 1, punchAt: 1 },
  { unique: true }
);
// Per-employee punch history sorted by newest first (used by enrolment
// verification + audit view).
devicePunchSchema.index({ employee: 1, punchAt: -1 });
// Device-scoped chronology for the raw audit trail.
devicePunchSchema.index({ device: 1, punchAt: -1 });

module.exports = mongoose.model('DevicePunch', devicePunchSchema);
