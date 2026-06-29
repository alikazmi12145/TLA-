const mongoose = require('mongoose');
const { TARGET_TYPES } = require('../config/constants');

// Accept legacy 'DAILY' so old documents still validate; controllers migrate it to 'ONCE'.
const TARGET_TYPE_ENUM = Array.from(new Set([...TARGET_TYPES, 'DAILY']));

const targetSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: TARGET_TYPE_ENUM, required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    targetValue: { type: Number, required: true, min: 0 },
    achievedValue: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['PENDING', 'COMPLETED', 'EXPIRED'], default: 'PENDING', index: true },
    completedAt: { type: Date },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: String,
    employeeNote: String,
    employeeNoteAt: { type: Date },
    setBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

targetSchema.virtual('completion').get(function () {
  if (!this.targetValue) return 0;
  return Math.round((this.achievedValue / this.targetValue) * 10000) / 100;
});

targetSchema.set('toJSON', { virtuals: true });
targetSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Target', targetSchema);
