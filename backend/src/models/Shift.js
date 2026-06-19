const mongoose = require('mongoose');

const shiftSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    startTime: { type: String, required: true }, // "09:00"
    endTime: { type: String, required: true },   // "18:00"
    graceMinutes: { type: Number, default: 10, min: 0 },
    type: { type: String, enum: ['MORNING', 'EVENING', 'NIGHT', 'CUSTOM'], default: 'CUSTOM' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Shift', shiftSchema);
