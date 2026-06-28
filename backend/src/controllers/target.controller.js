const asyncHandler = require('express-async-handler');
const dayjs = require('dayjs');
const Target = require('../models/Target');
const Notification = require('../models/Notification');
const ApiError = require('../utils/ApiError');
const { success } = require('../utils/response');
const { ROLES } = require('../config/constants');

const fmtPeriod = (start, end) =>
  `${dayjs(start).format('MMM D')} → ${dayjs(end).format('MMM D, YYYY')}`;

// Migrate legacy DAILY type → ONCE and expire any past PENDING tasks.
const sweepTargets = async (filter = {}) => {
  try {
    await Target.updateMany({ ...filter, type: 'DAILY' }, { $set: { type: 'ONCE' } });
    await Target.updateMany(
      { ...filter, periodEnd: { $lt: new Date() }, status: 'PENDING' },
      { $set: { status: 'EXPIRED' } }
    );
  } catch {}
};

exports.list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.employee) filter.employee = req.query.employee;
  if (req.query.type) filter.type = req.query.type;
  await sweepTargets();
  const items = await Target.find(filter)
    .populate('employee', 'fullName employeeId')
    .sort({ periodStart: -1 });
  return success(res, items, 'Tasks');
});

exports.mine = asyncHandler(async (req, res) => {
  await sweepTargets({ employee: req.user._id });
  const items = await Target.find({ employee: req.user._id }).sort({ periodStart: -1 });
  return success(res, items, 'My tasks');
});

exports.create = asyncHandler(async (req, res) => {
  const body = { ...req.body, setBy: req.user._id };
  // Migrate legacy values coming from older clients.
  if (String(body.type).toUpperCase() === 'DAILY') body.type = 'ONCE';
  // For a ONCE task without an explicit period, default to today.
  if (String(body.type).toUpperCase() === 'ONCE' && !body.periodStart) {
    body.periodStart = dayjs().startOf('day').toDate();
    body.periodEnd = dayjs().endOf('day').toDate();
    body.status = 'PENDING';
  }
  const item = await Target.create(body);
  try {
    await Notification.create({
      user: item.employee,
      type: 'TARGET_ASSIGNED',
      title: 'New task assigned',
      message: `A ${String(item.type || '').toLowerCase()} task of ${item.targetValue} has been set for you (${fmtPeriod(item.periodStart, item.periodEnd)}).`,
      meta: { targetId: item._id, type: item.type, targetValue: item.targetValue },
    });
  } catch {}
  return success(res, item, 'Task created', 201);
});

exports.update = asyncHandler(async (req, res) => {
  const prev = await Target.findById(req.params.id);
  if (!prev) throw new ApiError(404, 'Task not found');
  if (String(req.body.type).toUpperCase() === 'DAILY') req.body.type = 'ONCE';
  if (req.body.complete === true && prev.status !== 'COMPLETED') {
    req.body.achievedValue = prev.targetValue;
    req.body.status = 'COMPLETED';
    req.body.completedAt = new Date();
    req.body.completedBy = req.user._id;
  }
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
        title: 'Your task was updated',
        message: `${changed.join(', ')} (${fmtPeriod(item.periodStart, item.periodEnd)})`,
        meta: { targetId: item._id },
      });
    }
    if (req.body.status === 'COMPLETED') {
      try {
        await Notification.create({
          user: item.setBy,
          type: 'TARGET_COMPLETED',
          title: 'Task completed',
          message: `${item.employee} completed a task (${fmtPeriod(item.periodStart, item.periodEnd)}).`,
          meta: { targetId: item._id },
        });
      } catch {}
    }
  } catch {}
  return success(res, item, 'Task updated');
});

exports.remove = asyncHandler(async (req, res) => {
  const item = await Target.findByIdAndDelete(req.params.id);
  if (!item) throw new ApiError(404, 'Task not found');
  return success(res, {}, 'Task deleted');
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

exports.complete = asyncHandler(async (req, res) => {
  const existing = await Target.findById(req.params.id);
  if (!existing) throw new ApiError(404, 'Task not found');
  const isOwner = existing.employee && existing.employee.equals
    ? existing.employee.equals(req.user._id)
    : String(existing.employee) === String(req.user._id);
  if (!isOwner && ![ROLES.SUPER_ADMIN, ROLES.TEAM_LEADER].includes(req.user.role)) {
    throw new ApiError(403, 'Forbidden');
  }
  if (existing.status === 'COMPLETED') return success(res, existing, 'Task already completed');
  if (existing.status === 'EXPIRED' || (existing.periodEnd && new Date(existing.periodEnd) < new Date())) {
    throw new ApiError(400, 'This task has expired and can no longer be completed');
  }

  // Use findByIdAndUpdate (no full-doc revalidation) to avoid failures from legacy fields.
  const item = await Target.findByIdAndUpdate(
    req.params.id,
    {
      $set: {
        achievedValue: existing.targetValue,
        status: 'COMPLETED',
        completedAt: new Date(),
        completedBy: req.user._id,
        ...(existing.type === 'DAILY' ? { type: 'ONCE' } : {}),
      },
    },
    { new: true }
  );

  try {
    if (item.setBy) {
      await Notification.create({
        user: item.setBy,
        type: 'TARGET_COMPLETED',
        title: 'Task completed',
        message: `${req.user.fullName || req.user._id} completed a task (${fmtPeriod(item.periodStart, item.periodEnd)}).`,
        meta: { targetId: item._id },
      });
    }
  } catch {}
  return success(res, item, 'Task completed');
});
