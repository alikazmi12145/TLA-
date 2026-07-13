const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, default: 'INFO' }, // LEAVE_APPROVED, LEAVE_REJECTED, SALARY, REMINDER ...
    title: { type: String, required: true },
    message: String,
    link: String,
    isRead: { type: Boolean, default: false, index: true },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

// Inbox query pattern: filter by user + isRead, sort by createdAt desc.
// A single compound covers all three columns with a single b-tree walk.
notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
