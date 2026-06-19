const asyncHandler = require('express-async-handler');
const dayjs = require('dayjs');
const { success } = require('../utils/response');
const { startOfDay, startOfMonth, endOfMonth } = require('../utils/date');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const Holiday = require('../models/Holiday');
const Department = require('../models/Department');
const Payroll = require('../models/Payroll');
const Commission = require('../models/Commission');
const { ROLES, ATTENDANCE_STATUS } = require('../config/constants');

exports.adminSummary = asyncHandler(async (_req, res) => {
  const today = startOfDay();
  const monthStart = startOfMonth();
  const monthEnd = endOfMonth();

  const [
    totalEmployees,
    presentToday,
    absentToday,
    onLeaveToday,
    totalHolidays,
    payrollAgg,
    commissionAgg,
    totalDepartments,
  ] = await Promise.all([
    User.countDocuments({ role: { $ne: ROLES.SUPER_ADMIN }, isActive: true }),
    Attendance.countDocuments({ date: today, status: { $in: [ATTENDANCE_STATUS.PRESENT, ATTENDANCE_STATUS.LATE] } }),
    Attendance.countDocuments({ date: today, status: ATTENDANCE_STATUS.ABSENT }),
    Attendance.countDocuments({ date: today, status: ATTENDANCE_STATUS.LEAVE }),
    Holiday.countDocuments({ date: { $gte: new Date(`${dayjs().year()}-01-01`), $lte: new Date(`${dayjs().year()}-12-31T23:59:59`) } }),
    Payroll.aggregate([
      { $match: { month: dayjs().month() + 1, year: dayjs().year() } },
      { $group: { _id: null, total: { $sum: '$netSalary' } } },
    ]),
    Commission.aggregate([
      { $match: { periodStart: { $gte: monthStart, $lte: monthEnd } } },
      { $group: { _id: null, total: { $sum: '$commissionAmount' } } },
    ]),
    Department.countDocuments({ isActive: true }),
  ]);

  return success(res, {
    totalEmployees,
    presentToday,
    absentToday,
    onLeaveToday,
    totalHolidays,
    monthlyPayroll: payrollAgg[0]?.total || 0,
    monthlyCommission: commissionAgg[0]?.total || 0,
    totalDepartments,
  }, 'Admin dashboard summary');
});

exports.employeeSummary = asyncHandler(async (req, res) => {
  const monthStart = startOfMonth();
  const monthEnd = endOfMonth();
  const userId = req.user._id;

  const [att, leaves, holidays, payroll, commissionAgg] = await Promise.all([
    Attendance.find({ employee: userId, date: { $gte: monthStart, $lte: monthEnd } }),
    Leave.find({ employee: userId, status: 'APPROVED', fromDate: { $gte: monthStart, $lte: monthEnd } }),
    Holiday.find({ date: { $gte: monthStart, $lte: monthEnd } }),
    Payroll.findOne({ employee: userId, month: dayjs().month() + 1, year: dayjs().year() }),
    Commission.aggregate([
      { $match: { employee: userId, periodStart: { $gte: monthStart, $lte: monthEnd } } },
      { $group: { _id: null, total: { $sum: '$commissionAmount' } } },
    ]),
  ]);

  const presentDays = att.filter((a) => a.status === 'PRESENT' || a.status === 'LATE').length;
  const absentDays = att.filter((a) => a.status === 'ABSENT').length;
  const workMinutes = att.reduce((s, a) => s + (a.workMinutes || 0), 0);

  return success(res, {
    presentDays,
    absentDays,
    leaves: leaves.length,
    holidays: holidays.length,
    workHours: Math.round((workMinutes / 60) * 100) / 100,
    currentSalary: payroll?.netSalary || req.user.basicSalary || 0,
    currentCommission: commissionAgg[0]?.total || 0,
    dailyTarget: req.user.dailyTarget || 0,
  }, 'Employee dashboard summary');
});

exports.recentActivity = asyncHandler(async (_req, res) => {
  const [latestLeaves, latestPayrolls] = await Promise.all([
    Leave.find().populate('employee', 'fullName').sort({ createdAt: -1 }).limit(5),
    Payroll.find().populate('employee', 'fullName').sort({ createdAt: -1 }).limit(5),
  ]);
  const items = [
    ...latestLeaves.map((l) => ({
      type: 'LEAVE',
      title: `${l.employee?.fullName || 'Employee'} requested ${l.type} leave`,
      status: l.status,
      at: l.createdAt,
    })),
    ...latestPayrolls.map((p) => ({
      type: 'PAYROLL',
      title: `Payroll ${p.status} for ${p.employee?.fullName}`,
      at: p.createdAt,
    })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 10);
  return success(res, items, 'Recent activity');
});

exports.departmentPerformance = asyncHandler(async (_req, res) => {
  const monthStart = startOfMonth();
  const monthEnd = endOfMonth();
  const items = await User.aggregate([
    { $match: { isActive: true, role: { $ne: ROLES.SUPER_ADMIN } } },
    { $lookup: { from: 'departments', localField: 'department', foreignField: '_id', as: 'dept' } },
    { $unwind: { path: '$dept', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'attendances',
        let: { uid: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$employee', '$$uid'] }, date: { $gte: monthStart, $lte: monthEnd } } },
        ],
        as: 'att',
      },
    },
    {
      $group: {
        _id: '$dept.name',
        employees: { $sum: 1 },
        present: { $sum: { $size: { $filter: { input: '$att', as: 'a', cond: { $in: ['$$a.status', ['PRESENT', 'LATE']] } } } } },
        totalDays: { $sum: { $size: '$att' } },
      },
    },
    { $sort: { employees: -1 } },
  ]);
  return success(res, items, 'Department performance');
});
