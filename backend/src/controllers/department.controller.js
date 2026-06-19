const asyncHandler = require('express-async-handler');
const Department = require('../models/Department');
const ApiError = require('../utils/ApiError');
const { success } = require('../utils/response');

exports.list = asyncHandler(async (_req, res) => {
  const items = await Department.find().populate('head', 'fullName email').sort({ name: 1 });
  return success(res, items, 'Departments');
});
exports.create = asyncHandler(async (req, res) => {
  const item = await Department.create(req.body);
  return success(res, item, 'Department created', 201);
});
exports.update = asyncHandler(async (req, res) => {
  const item = await Department.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!item) throw new ApiError(404, 'Department not found');
  return success(res, item, 'Department updated');
});
exports.remove = asyncHandler(async (req, res) => {
  const item = await Department.findByIdAndDelete(req.params.id);
  if (!item) throw new ApiError(404, 'Department not found');
  return success(res, {}, 'Department deleted');
});
