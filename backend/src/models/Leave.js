const mongoose = require('mongoose');
const { LEAVE_TYPES, LEAVE_STATUS } = require('../config/constants');

const leaveSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: LEAVE_TYPES, required: true },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    days: { type: Number, required: true, min: 0.5 },
    reason: { type: String, required: true },
    status: { type: String, enum: Object.values(LEAVE_STATUS), default: LEAVE_STATUS.PENDING, index: true },
    remarks: String,
    actionedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actionedAt: Date,
    attachment: String,
  },
  { timestamps: true }
);

// Common read patterns: per-employee history sorted by newest first,
// and admin "pending approvals" list scoped by status.
leaveSchema.index({ employee: 1, status: 1, createdAt: -1 });
leaveSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Leave', leaveSchema);
