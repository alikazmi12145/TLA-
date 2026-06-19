const asyncHandler = require('express-async-handler');
const Shift = require('../models/Shift');
const ApiError = require('../utils/ApiError');
const { success } = require('../utils/response');

exports.list = asyncHandler(async (_req, res) => {
  const items = await Shift.find().sort({ name: 1 });
  return success(res, items, 'Shifts');
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
