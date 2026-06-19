const mongoose = require('mongoose');

const holidaySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    date: { type: Date, required: true, index: true },
    description: String,
    isRecurring: { type: Boolean, default: false },
  },
  { timestamps: true }
);

holidaySchema.index({ title: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Holiday', holidaySchema);
