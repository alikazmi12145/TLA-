const asyncHandler = require('express-async-handler');
const Notification = require('../models/Notification');
const { success } = require('../utils/response');

exports.list = asyncHandler(async (req, res) => {
  const items = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50);
  const unread = await Notification.countDocuments({ user: req.user._id, isRead: false });
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
