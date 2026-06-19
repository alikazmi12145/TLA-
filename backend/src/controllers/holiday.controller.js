const asyncHandler = require('express-async-handler');
const Holiday = require('../models/Holiday');
const ApiError = require('../utils/ApiError');
const { success } = require('../utils/response');
const { startOfDay } = require('../utils/date');

exports.list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.year) {
    const y = Number(req.query.year);
    filter.date = { $gte: new Date(`${y}-01-01`), $lte: new Date(`${y}-12-31T23:59:59`) };
  }
  const items = await Holiday.find(filter).sort({ date: 1 });
  return success(res, items, 'Holidays');
});

exports.create = asyncHandler(async (req, res) => {
  const body = { ...req.body, date: startOfDay(req.body.date) };
  const item = await Holiday.create(body);
  return success(res, item, 'Holiday created', 201);
});
exports.update = asyncHandler(async (req, res) => {
  const body = { ...req.body };
  if (body.date) body.date = startOfDay(body.date);
  const item = await Holiday.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });
  if (!item) throw new ApiError(404, 'Holiday not found');
  return success(res, item, 'Holiday updated');
});
exports.remove = asyncHandler(async (req, res) => {
  const item = await Holiday.findByIdAndDelete(req.params.id);
  if (!item) throw new ApiError(404, 'Holiday not found');
  return success(res, {}, 'Holiday deleted');
});

exports.upcoming = asyncHandler(async (_req, res) => {
  const items = await Holiday.find({ date: { $gte: startOfDay() } }).sort({ date: 1 }).limit(5);
  return success(res, items, 'Upcoming holidays');
});
