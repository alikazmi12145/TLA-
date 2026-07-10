const asyncHandler = require('express-async-handler');
const Commission = require('../models/Commission');
const User = require('../models/User');
const Notification = require('../models/Notification');
const ApiError = require('../utils/ApiError');
const { success } = require('../utils/response');
const { startOfMonth, endOfMonth } = require('../utils/date');
const logger = require('../utils/logger');

exports.list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.employee) filter.employee = req.query.employee;
  if (req.query.period) filter.period = req.query.period;
  const items = await Commission.find(filter).populate('employee', 'fullName employeeId').sort({ periodStart: -1 });
  return success(res, items, 'Commissions');
});

exports.mine = asyncHandler(async (req, res) => {
  const items = await Commission.find({ employee: req.user._id }).sort({ periodStart: -1 });
  return success(res, items, 'My commissions');
});

exports.create = asyncHandler(async (req, res) => {
  const body = { ...req.body };
  if (!body.commissionRate) {
    const u = await User.findById(body.employee);
    if (u) body.commissionRate = u.commissionRate || 0;
  }
  const item = await Commission.create(body);
  try {
    await Notification.create({
      user: item.employee,
      type: 'COMMISSION_ADDED',
      title: 'Commission added',
      message: `A commission entry of ${item.amount ?? item.commissionAmount ?? ''} has been recorded for you.`,
      meta: { commissionId: item._id },
    });
  } catch (err) { logger.error('commission notify failed:', err.message); }
  return success(res, item, 'Commission created', 201);
});

exports.update = asyncHandler(async (req, res) => {
  const item = await Commission.findById(req.params.id);
  if (!item) throw new ApiError(404, 'Commission not found');
  Object.assign(item, req.body);
  await item.save();
  return success(res, item, 'Commission updated');
});

exports.remove = asyncHandler(async (req, res) => {
  const item = await Commission.findByIdAndDelete(req.params.id);
  if (!item) throw new ApiError(404, 'Commission not found');
  return success(res, {}, 'Commission deleted');
});

exports.monthlyTotal = asyncHandler(async (req, res) => {
  const ref = req.query.month ? new Date(req.query.month) : new Date();
  const result = await Commission.aggregate([
    { $match: { periodStart: { $gte: startOfMonth(ref), $lte: endOfMonth(ref) } } },
    { $group: { _id: null, total: { $sum: '$commissionAmount' }, count: { $sum: 1 } } },
  ]);
  return success(res, result[0] || { total: 0, count: 0 }, 'Monthly commission total');
});
