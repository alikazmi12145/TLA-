const mongoose = require('mongoose');

const accessorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Human-friendly unique identifier (e.g. "KB-001"). Stored uppercase.
    code: { type: String, required: true, unique: true, trim: true, uppercase: true, index: true },
    category: { type: String, trim: true },
    totalQuantity: { type: Number, required: true, min: 0, default: 0 },
    // availableQuantity is decremented atomically when a request is issued
    // and incremented back if an issued request is later returned/reset.
    // It must never go negative — enforced in the repository via a
    // conditional update.
    availableQuantity: { type: Number, required: true, min: 0, default: 0 },
    description: { type: String, trim: true },
    isActive: { type: Boolean, default: true, index: true },
    // Soft-delete flag. Consumers must always filter { isDeleted: false }.
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

accessorySchema.index({ name: 'text', code: 'text', category: 'text', description: 'text' });

module.exports = mongoose.model('Accessory', accessorySchema);
