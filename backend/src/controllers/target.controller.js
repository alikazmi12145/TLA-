const asyncHandler = require('express-async-handler');
const dayjs = require('dayjs');
const Target = require('../models/Target');
const Notification = require('../models/Notification');
const ApiError = require('../utils/ApiError');
const { success } = require('../utils/response');

const fmtPeriod = (start, end) =>
  `${dayjs(start).format('MMM D')} → ${dayjs(end).format('MMM D, YYYY')}`;

exports.list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.employee) filter.employee = req.query.employee;
  if (req.query.type) filter.type = req.query.type;
  const items = await Target.find(filter)
    .populate('employee', 'fullName employeeId')
    .sort({ periodStart: -1 });
  return success(res, items, 'Targets');
});

exports.mine = asyncHandler(async (req, res) => {
  const items = await Target.find({ employee: req.user._id }).sort({ periodStart: -1 });
  return success(res, items, 'My targets');
});

exports.create = asyncHandler(async (req, res) => {
  const item = await Target.create({ ...req.body, setBy: req.user._id });
  try {
    await Notification.create({
      user: item.employee,
      type: 'TARGET_ASSIGNED',
      title: 'New target assigned',
      message: `A ${String(item.type || '').toLowerCase()} target of ${item.targetValue} has been set for you (${fmtPeriod(item.periodStart, item.periodEnd)}).`,
      meta: { targetId: item._id, type: item.type, targetValue: item.targetValue },
    });
  } catch {}
  return success(res, item, 'Target created', 201);
});

exports.update = asyncHandler(async (req, res) => {
  const prev = await Target.findById(req.params.id);
  if (!prev) throw new ApiError(404, 'Target not found');
  const item = await Target.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  try {
    const changed = [];
    if (req.body.targetValue !== undefined && Number(req.body.targetValue) !== prev.targetValue) {
      changed.push(`target ${prev.targetValue} → ${item.targetValue}`);
    }
    if (req.body.achievedValue !== undefined && Number(req.body.achievedValue) !== prev.achievedValue) {
      changed.push(`achieved ${prev.achievedValue} → ${item.achievedValue}`);
    }
    if (changed.length) {
      await Notification.create({
        user: item.employee,
        type: 'TARGET_UPDATED',
        title: 'Your target was updated',
        message: `${changed.join(', ')} (${fmtPeriod(item.periodStart, item.periodEnd)})`,
        meta: { targetId: item._id },
      });
    }
  } catch {}
  return success(res, item, 'Target updated');
});

exports.remove = asyncHandler(async (req, res) => {
  const item = await Target.findByIdAndDelete(req.params.id);
  if (!item) throw new ApiError(404, 'Target not found');
  return success(res, {}, 'Target deleted');
});

exports.ranking = asyncHandler(async (_req, res) => {
  const items = await Target.aggregate([
    {
      $group: {
        _id: '$employee',
        target: { $sum: '$targetValue' },
        achieved: { $sum: '$achievedValue' },
      },
    },
    {
      $project: {
        target: 1,
        achieved: 1,
        completion: {
          $cond: [{ $gt: ['$target', 0] }, { $multiply: [{ $divide: ['$achieved', '$target'] }, 100] }, 0],
        },
      },
    },
    { $sort: { completion: -1 } },
    { $limit: 20 },
    {
      $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'employee' },
    },
    { $unwind: '$employee' },
    {
      $project: {
        target: 1,
        achieved: 1,
        completion: 1,
        'employee.fullName': 1,
        'employee.employeeId': 1,
        'employee.profilePicture': 1,
      },
    },
  ]);
  return success(res, items, 'Performance ranking');
});
