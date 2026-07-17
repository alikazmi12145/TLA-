const mongoose = require('mongoose');

const ACCESSORY_REQUEST_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  ISSUED: 'ISSUED',
  COMPLETED: 'COMPLETED',
};

const accessoryRequestSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Snapshot of employee's department at request time — kept for
    // reporting even if the employee later moves departments.
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
    accessory: { type: mongoose.Schema.Types.ObjectId, ref: 'Accessory', required: true, index: true },
    quantity: { type: Number, required: true, min: 1 },
    note: { type: String, trim: true },
    status: {
      type: String,
      enum: Object.values(ACCESSORY_REQUEST_STATUS),
      default: ACCESSORY_REQUEST_STATUS.PENDING,
      index: true,
    },
    remarks: { type: String, trim: true },
    requestedAt: { type: Date, default: Date.now },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectedAt: Date,
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    issuedAt: Date,
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    completedAt: Date,
  },
  { timestamps: true }
);

accessoryRequestSchema.index({ employee: 1, status: 1, createdAt: -1 });
accessoryRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('AccessoryRequest', accessoryRequestSchema);
module.exports.ACCESSORY_REQUEST_STATUS = ACCESSORY_REQUEST_STATUS;
