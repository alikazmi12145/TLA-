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
const { ROLES, ATTENDANCE_STATUS, FINGERPRINT_STATUS, SYNC_STATUS } = require('../config/constants');

// A row only counts as "present" once it carries at least one FULLY
// CLOSED session (Device-In → Clock-In → Device-Out → Clock-Out). This
// keeps every dashboard tile in sync with the Attendance log, which
// renders one row per completed session and hides in-progress /
// device-only / partial rows. Without this filter, a stray device punch
// that upserted `status: PRESENT` would inflate the count while the log
// showed nothing — the exact discrepancy users report as "4 presents but
// no session records".
const HAS_COMPLETED_SESSION = {
  sessions: { $elemMatch: { clockIn: { $ne: null }, clockOut: { $ne: null } } },
};
const isCompletedAttendance = (a) =>
  Array.isArray(a?.sessions) && a.sessions.some((s) => s && s.clockIn && s.clockOut);

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
    Attendance.countDocuments({
      date: today,
      status: { $in: [ATTENDANCE_STATUS.PRESENT, ATTENDANCE_STATUS.LATE] },
      ...HAS_COMPLETED_SESSION,
    }),
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

  const presentDays = att.filter(
    (a) => (a.status === 'PRESENT' || a.status === 'LATE') && isCompletedAttendance(a)
  ).length;
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
    Leave.find().populate('employee', 'fullName').sort({ createdAt: -1 }).limit(10),
    Payroll.find().populate('employee', 'fullName').sort({ createdAt: -1 }).limit(10),
  ]);
  const items = [
    ...latestLeaves
      // Skip leaves whose employee has been deleted — otherwise the
      // populate returns null and the activity feed would read
      // "null requested … leave".
      .filter((l) => l.employee && l.employee.fullName)
      .map((l) => ({
        type: 'LEAVE',
        title: `${l.employee.fullName} requested ${l.type} leave`,
        status: l.status,
        at: l.createdAt,
      })),
    ...latestPayrolls
      .filter((p) => p.employee && p.employee.fullName)
      .map((p) => ({
        type: 'PAYROLL',
        title: `Payroll ${p.status} for ${p.employee.fullName}`,
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
        present: {
          $sum: {
            $size: {
              $filter: {
                input: '$att',
                as: 'a',
                cond: {
                  $and: [
                    { $in: ['$$a.status', ['PRESENT', 'LATE']] },
                    {
                      $gt: [
                        {
                          $size: {
                            $filter: {
                              input: { $ifNull: ['$$a.sessions', []] },
                              as: 's',
                              cond: {
                                $and: [
                                  { $ne: ['$$s.clockIn', null] },
                                  { $ne: ['$$s.clockOut', null] },
                                ],
                              },
                            },
                          },
                        },
                        0,
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
        totalDays: { $sum: { $size: '$att' } },
      },
    },
    { $sort: { employees: -1 } },
  ]);
  return success(res, items, 'Department performance');
});

/**
 * GET /dashboard/enrollment — fingerprint enrollment snapshot for the admin.
 * Returns counts + a short list of employees still awaiting enrollment on
 * the device (deviceSynced but fingerprintStatus != ENROLLED).
 */
exports.enrollmentSummary = asyncHandler(async (_req, res) => {
  const activeFilter = { isActive: true, role: { $ne: ROLES.SUPER_ADMIN } };
  const [
    totalEmployees,
    enrolled,
    pendingEnrollment,
    notSynced,
    syncFailed,
    pendingList,
  ] = await Promise.all([
    User.countDocuments(activeFilter),
    User.countDocuments({ ...activeFilter, fingerprintStatus: FINGERPRINT_STATUS.ENROLLED }),
    User.countDocuments({
      ...activeFilter,
      deviceSynced: true,
      fingerprintStatus: { $ne: FINGERPRINT_STATUS.ENROLLED },
    }),
    User.countDocuments({
      ...activeFilter,
      $or: [{ deviceSynced: { $ne: true } }, { deviceId: null }, { deviceId: { $exists: false } }],
    }),
    User.countDocuments({ ...activeFilter, syncStatus: SYNC_STATUS.FAILED }),
    User.find({
      ...activeFilter,
      deviceSynced: true,
      fingerprintStatus: { $ne: FINGERPRINT_STATUS.ENROLLED },
    })
      .select('fullName employeeId deviceUserId fingerprintStatus syncStatus deviceId createdAt')
      .populate('deviceId', 'name ip')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
  ]);

  return success(res, {
    totalEmployees,
    enrolled,
    pendingEnrollment,
    notSynced,
    syncFailed,
    pending: pendingList.map((e) => ({
      _id: e._id,
      fullName: e.fullName,
      employeeId: e.employeeId,
      deviceUserId: e.deviceUserId,
      fingerprintStatus: e.fingerprintStatus,
      syncStatus: e.syncStatus,
      device: e.deviceId ? { _id: e.deviceId._id, name: e.deviceId.name, ip: e.deviceId.ip } : null,
      createdAt: e.createdAt,
    })),
  }, 'Enrollment summary');
});
