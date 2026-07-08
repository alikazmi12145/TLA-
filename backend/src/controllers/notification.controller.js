const asyncHandler = require('express-async-handler');
const Notification = require('../models/Notification');
const { success } = require('../utils/response');

// Attendance clock-in / clock-out notifications are intentionally hidden from
// the admin dashboard & notification bell. Existing DB rows are ignored via
// this filter so no data-migration is required.
const HIDDEN_TYPES = ['ATTENDANCE_CLOCK_IN', 'ATTENDANCE_CLOCK_OUT'];

exports.list = asyncHandler(async (req, res) => {
  const baseFilter = { user: req.user._id, type: { $nin: HIDDEN_TYPES } };
  const items = await Notification.find(baseFilter).sort({ createdAt: -1 }).limit(50);
  const unread = await Notification.countDocuments({ ...baseFilter, isRead: false });
  return success(res, { items, unread }, 'Notifications');
});

exports.markRead = asyncHandler(async (req, res) => {
  await Notification.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, { isRead: true });
  return success(res, {}, 'Marked read');
});

exports.markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ user: req.user._id, isRead: false }, { isRead: true });
  return success(res, {}, 'All marked read');
});

exports.remove = asyncHandler(async (req, res) => {
  await Notification.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  return success(res, {}, 'Deleted');
});
