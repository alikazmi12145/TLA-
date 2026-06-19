const asyncHandler = require('express-async-handler');
const dayjs = require('dayjs');
const ApiError = require('../utils/ApiError');
const { success } = require('../utils/response');
const Leave = require('../models/Leave');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { LEAVE_STATUS, ROLES } = require('../config/constants');
const { sendMail } = require('../utils/mailer');

const calcDays = (from, to) => Math.max(0.5, dayjs(to).startOf('day').diff(dayjs(from).startOf('day'), 'day') + 1);

exports.apply = asyncHandler(async (req, res) => {
  const { type, fromDate, toDate, reason } = req.body;
  if (!type || !fromDate || !toDate || !reason) throw new ApiError(400, 'Missing fields');
  const days = calcDays(fromDate, toDate);
  const leave = await Leave.create({
    employee: req.user._id,
    type,
    fromDate,
    toDate,
    days,
    reason,
  });
  return success(res, leave, 'Leave applied', 201);
});

exports.myLeaves = asyncHandler(async (req, res) => {
  const items = await Leave.find({ employee: req.user._id }).sort({ createdAt: -1 });
  return success(res, items, 'My leaves');
});

exports.list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.employee) filter.employee = req.query.employee;
  if (req.query.type) filter.type = req.query.type;
  const items = await Leave.find(filter)
    .populate('employee', 'fullName employeeId email department')
    .populate('actionedBy', 'fullName')
    .sort({ createdAt: -1 });
  return success(res, items, 'Leaves');
});

exports.action = asyncHandler(async (req, res) => {
  const { status, remarks } = req.body;
  if (![LEAVE_STATUS.APPROVED, LEAVE_STATUS.REJECTED].includes(status)) throw new ApiError(400, 'Invalid status');
  const leave = await Leave.findById(req.params.id).populate('employee', 'fullName email');
  if (!leave) throw new ApiError(404, 'Leave not found');
  if (leave.status !== LEAVE_STATUS.PENDING) throw new ApiError(400, 'Leave already processed');
  leave.status = status;
  leave.remarks = remarks;
  leave.actionedBy = req.user._id;
  leave.actionedAt = new Date();
  await leave.save();

  await Notification.create({
    user: leave.employee._id,
    type: status === LEAVE_STATUS.APPROVED ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
    title: `Leave ${status.toLowerCase()}`,
    message: `Your leave (${leave.type}) was ${status.toLowerCase()}.${remarks ? ' Remarks: ' + remarks : ''}`,
    link: '/leaves',
  });

  await sendMail({
    to: leave.employee.email,
    subject: `Leave ${status === LEAVE_STATUS.APPROVED ? 'Approved' : 'Rejected'}`,
    html: `<p>Hello ${leave.employee.fullName},</p><p>Your ${leave.type} leave from ${dayjs(leave.fromDate).format('YYYY-MM-DD')} to ${dayjs(leave.toDate).format('YYYY-MM-DD')} has been <b>${status}</b>.</p>${remarks ? `<p>Remarks: ${remarks}</p>` : ''}`,
  });

  return success(res, leave, `Leave ${status.toLowerCase()}`);
});

exports.balance = asyncHandler(async (req, res) => {
  const employeeId = req.params.id || req.user._id;
  if (req.params.id && ![ROLES.SUPER_ADMIN, ROLES.HR_MANAGER, ROLES.TEAM_LEADER].includes(req.user.role)) {
    throw new ApiError(403, 'Forbidden');
  }
  const year = Number(req.query.year) || new Date().getFullYear();
  const start = new Date(`${year}-01-01`);
  const end = new Date(`${year}-12-31T23:59:59`);
  const items = await Leave.aggregate([
    {
      $match: {
        employee: new (require('mongoose').Types.ObjectId)(String(employeeId)),
        status: 'APPROVED',
        fromDate: { $gte: start, $lte: end },
      },
    },
    { $group: { _id: '$type', used: { $sum: '$days' } } },
  ]);
  const allotment = { CASUAL: 10, SICK: 8, ANNUAL: 14, EMERGENCY: 5 };
  const result = Object.keys(allotment).map((k) => {
    const used = items.find((i) => i._id === k)?.used || 0;
    return { type: k, allotment: allotment[k], used, remaining: Math.max(0, allotment[k] - used) };
  });
  return success(res, result, 'Leave balance');
});

exports.analytics = asyncHandler(async (_req, res) => {
  const items = await Leave.aggregate([
    { $group: { _id: { type: '$type', status: '$status' }, count: { $sum: 1 } } },
  ]);
  return success(res, items, 'Leave analytics');
});

exports.calendar = asyncHandler(async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const month = Number(req.query.month);
  const filter = { status: 'APPROVED' };
  if (month) {
    filter.fromDate = { $gte: new Date(year, month - 1, 1), $lte: new Date(year, month, 0, 23, 59, 59) };
  } else {
    filter.fromDate = { $gte: new Date(`${year}-01-01`), $lte: new Date(`${year}-12-31T23:59:59`) };
  }
  const items = await Leave.find(filter).populate('employee', 'fullName employeeId').sort({ fromDate: 1 });
  return success(res, items, 'Leave calendar');
});
