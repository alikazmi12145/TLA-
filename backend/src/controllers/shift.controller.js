const asyncHandler = require('express-async-handler');
const Shift = require('../models/Shift');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { success } = require('../utils/response');

exports.list = asyncHandler(async (_req, res) => {
  const items = await Shift.find().sort({ name: 1 });
  return success(res, items, 'Shifts');
});
exports.summary = asyncHandler(async (_req, res) => {
  const totals = await User.aggregate([
    { $match: { shift: { $exists: true, $ne: null } } },
    { $group: { _id: '$shift', count: { $sum: 1 } } },
  ]);
  const shifts = await Shift.find().sort({ name: 1 }).lean();
  const shiftSummary = shifts.map((shift) => {
    const match = totals.find((item) => String(item._id) === String(shift._id));
    return {
      _id: shift._id,
      name: shift.name,
      type: shift.type,
      startTime: shift.startTime,
      endTime: shift.endTime,
      graceMinutes: shift.graceMinutes,
      employeeCount: match ? match.count : 0,
    };
  });
  return success(res, shiftSummary, 'Shift employee summary');
});
exports.create = asyncHandler(async (req, res) => {
  const item = await Shift.create(req.body);
  return success(res, item, 'Shift created', 201);
});
exports.update = asyncHandler(async (req, res) => {
  const item = await Shift.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!item) throw new ApiError(404, 'Shift not found');
  return success(res, item, 'Shift updated');
});
exports.remove = asyncHandler(async (req, res) => {
  const item = await Shift.findByIdAndDelete(req.params.id);
  if (!item) throw new ApiError(404, 'Shift not found');
  return success(res, {}, 'Shift deleted');
});
