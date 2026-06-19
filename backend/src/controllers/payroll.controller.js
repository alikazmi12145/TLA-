const asyncHandler = require('express-async-handler');
const path = require('path');
const fs = require('fs');
const dayjs = require('dayjs');
const ApiError = require('../utils/ApiError');
const { success } = require('../utils/response');
const Payroll = require('../models/Payroll');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const Commission = require('../models/Commission');
const Target = require('../models/Target');
const Setting = require('../models/Setting');
const Holiday = require('../models/Holiday');
const Notification = require('../models/Notification');
const { sendMail } = require('../utils/mailer');
const { generatePayslipPDF } = require('../services/payslip.service');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v, fallback) => {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isNaN(n) ? fallback : n;
};

const computePayroll = async (employee, month, year, overrides = {}) => {
  const start = dayjs(`${year}-${month}-01`).startOf('month').toDate();
  const end = dayjs(start).endOf('month').toDate();
  const setting = (await Setting.findOne()) || {};
  const records = await Attendance.find({ employee: employee._id, date: { $gte: start, $lte: end } });

  // --- per-employee weekly off days (0=Sun..6=Sat). Default = Sunday off. ---
  const offDays = Array.isArray(employee.weeklyOffDays) && employee.weeklyOffDays.length
    ? employee.weeklyOffDays.map((n) => Number(n)).filter((n) => n >= 0 && n <= 6)
    : [0];
  const offDaySet = new Set(offDays);

  // --- count this employee's off-days + public holidays within the month ---
  const monthDays = dayjs(start).daysInMonth();
  let offDayCount = 0;
  for (let d = 1; d <= monthDays; d += 1) {
    const dow = dayjs(start).date(d).day();
    if (offDaySet.has(dow)) offDayCount += 1;
  }
  const publicHolidays = await Holiday.find({ date: { $gte: start, $lte: end } });
  let holidayCount = 0;
  publicHolidays.forEach((h) => {
    const dow = dayjs(h.date).day();
    if (!offDaySet.has(dow)) holidayCount += 1; // don't double-count holidays that fall on the employee's off day
  });
  const computedWorkingDays = Math.max(0, monthDays - offDayCount - holidayCount);

  // --- attendance defaults (overridable). Absences that fall on the employee's
  // own off day are NOT counted as absent (no salary cut for missing a day off). ---
  const dbPresent = records.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length;
  const dbAbsent = records.filter((r) => r.status === 'ABSENT' && !offDaySet.has(dayjs(r.date).day())).length;
  const dbLeave = records.filter((r) => r.status === 'LEAVE').length;
  const dbLate = records.filter((r) => r.isLate || r.status === 'LATE').length;
  const dbHalf = records.filter((r) => r.status === 'HALF_DAY').length;
  const dbWorkMin = records.reduce((s, r) => s + (r.workMinutes || 0), 0);

  const presentDays = num(overrides.presentDays, dbPresent);
  const absentDays = num(overrides.absentDays, dbAbsent);
  const leaveDays = num(overrides.leaveDays, dbLeave);
  const lateDays = num(overrides.lateDays, dbLate);
  const halfDays = num(overrides.halfDays, dbHalf);
  const workMinutes = num(overrides.workMinutes, dbWorkMin);

  // --- commission default (overridable) ---
  const commissionAgg = await Commission.aggregate([
    { $match: { employee: employee._id, periodStart: { $gte: start, $lte: end } } },
    { $group: { _id: null, total: { $sum: '$commissionAmount' } } },
  ]);
  const commission = num(overrides.commission, commissionAgg[0]?.total || 0);

  // --- basic salary + per-day rate ---
  // Working days = month days - this employee's off days - public holidays.
  // Falls back to Setting.workingDaysPerMonth only if the computed value is 0.
  const basicSalary = num(overrides.basicSalary, employee.basicSalary || 0);
  const workingDays = num(
    overrides.workingDays,
    computedWorkingDays > 0 ? computedWorkingDays : Number(setting.workingDaysPerMonth) || 26
  );
  const perDayRate = workingDays > 0 ? basicSalary / workingDays : 0;

  // --- deductions ---
  const dbAbsentDeduction = perDayRate * (absentDays + halfDays * 0.5);
  const absentDeduction = num(overrides.absentDeduction, dbAbsentDeduction);

  const grace = num(overrides.lateGraceCount, Number.isFinite(setting.lateGraceCount) ? Number(setting.lateGraceCount) : 0);
  const perLateCharge = Math.max(0, num(overrides.perLateCharge, Number(setting.lateDeductionPerDay) || 0));
  const chargeableLates = Math.max(0, lateDays - grace);
  const dbLateDeduction = chargeableLates * perLateCharge;
  const lateDeduction = num(overrides.lateDeduction, dbLateDeduction);

  // --- ticket incentive ---
  // Per-employee daily target wins over the global default so different
  // employees can have different targets. Global Setting is the fallback.
  const employeeDailyTarget = Number(employee.dailyTarget) || 0;
  const dailyTarget = num(
    overrides.dailyTicketTarget,
    employeeDailyTarget > 0 ? employeeDailyTarget : Number(setting.dailyTicketTarget) || 0
  );
  const perTicketIncentive = num(overrides.incentivePerExtraTicket, Number(setting.incentivePerExtraTicket) || 0);
  let dbTicketIncentive = 0;
  let dbExtraTickets = 0;
  if (dailyTarget > 0 && perTicketIncentive > 0) {
    const dailyDocs = await Target.find({
      employee: employee._id,
      type: 'DAILY',
      periodStart: { $gte: start, $lte: end },
    });
    for (const d of dailyDocs) {
      const tickets = Number(d.achievedValue || 0);
      const extras = Math.max(0, tickets - dailyTarget);
      dbExtraTickets += extras;
      dbTicketIncentive += extras * perTicketIncentive;
    }
  }
  const extraTickets = num(overrides.extraTickets, dbExtraTickets);
  // If admin edited extraTickets but not ticketIncentive, recompute incentive from extras.
  const derivedTicketIncentive =
    overrides.extraTickets !== undefined && overrides.ticketIncentive === undefined
      ? extraTickets * perTicketIncentive
      : dbTicketIncentive;
  const ticketIncentive = num(overrides.ticketIncentive, derivedTicketIncentive);

  // --- attendance bonus default ---
  const dbAttendanceBonus =
    setting.attendanceBonusThreshold && presentDays >= setting.attendanceBonusThreshold
      ? setting.attendanceBonusAmount || 0
      : 0;
  const attendanceBonus = num(overrides.attendanceBonus, dbAttendanceBonus);

  const bonus = num(overrides.bonus, 0);
  const manualIncentives = num(overrides.incentives, 0);
  const overtime = num(overrides.overtime, 0);
  const otherDeductionsInput = num(overrides.otherDeductions, 0);

  const gross = basicSalary + ticketIncentive + attendanceBonus + bonus + manualIncentives + commission + overtime;

  const taxPct = Math.max(0, Math.min(100, num(overrides.taxPercentage, Number(setting.taxPercentage) || 0)));
  const dbTax = (gross * taxPct) / 100;
  const tax = num(overrides.tax, dbTax);

  const totalDeductions = lateDeduction + absentDeduction + otherDeductionsInput + tax;
  const netSalary = gross - totalDeductions;

  return {
    // ----- persisted on Payroll schema -----
    basicSalary,
    commission,
    attendanceBonus,
    // schema doesn't have separate columns for ticket / bonus / manual incentives — fold them in
    incentives: round2(ticketIncentive + bonus + manualIncentives),
    overtime,
    lateDeduction: round2(lateDeduction),
    absentDeduction: round2(absentDeduction),
    otherDeductions: round2(otherDeductionsInput + tax),
    netSalary: round2(netSalary),
    presentDays,
    absentDays,
    leaveDays,
    lateDays,
    workMinutes,
    // ----- not persisted: surfaced for PDF + preview UI -----
    _meta: {
      ticketIncentive: round2(ticketIncentive),
      extraTickets,
      dailyTicketTarget: dailyTarget,
      incentivePerExtraTicket: perTicketIncentive,
      chargeableLates,
      perLateCharge,
      lateGraceCount: grace,
      tax: round2(tax),
      taxPercentage: taxPct,
      perDayRate: round2(perDayRate),
      workingDays,
      monthDays,
      offDays,
      offDayCount,
      holidayCount,
      bonus,
      manualIncentives,
      otherDeductionsInput: round2(otherDeductionsInput),
      gross: round2(gross),
    },
  };
};

exports.preview = asyncHandler(async (req, res) => {
  const { employee: employeeId, month, year, ...overrides } = req.body;
  if (!employeeId || !month || !year) throw new ApiError(400, 'employee, month, year required');
  const employee = await User.findById(employeeId);
  if (!employee) throw new ApiError(404, 'Employee not found');
  const computed = await computePayroll(employee, month, year, overrides);
  return success(
    res,
    {
      employee: {
        _id: employee._id,
        fullName: employee.fullName,
        employeeId: employee.employeeId,
        designation: employee.designation,
        email: employee.email,
        basicSalary: employee.basicSalary,
        dailyTarget: employee.dailyTarget,
        weeklyOffDays: employee.weeklyOffDays,
      },
      month: Number(month),
      year: Number(year),
      ...computed,
    },
    'Payroll preview'
  );
});

exports.generate = asyncHandler(async (req, res) => {
  const { employee: employeeId, month, year, ...overrides } = req.body;
  if (!employeeId || !month || !year) throw new ApiError(400, 'employee, month, year required');
  const employee = await User.findById(employeeId);
  if (!employee) throw new ApiError(404, 'Employee not found');
  const computed = await computePayroll(employee, month, year, overrides);
  const setting = await Setting.findOne();
  const { _meta, ...persisted } = computed;
  const payslipPath = await generatePayslipPDF(
    { ...persisted, _meta, month, year, status: 'GENERATED', generatedAt: new Date() },
    employee,
    setting
  );
  const payroll = await Payroll.findOneAndUpdate(
    { employee: employeeId, month, year },
    { ...persisted, month, year, payslipPath, generatedBy: req.user._id, status: 'GENERATED' },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await Notification.create({
    user: employee._id,
    type: 'SALARY',
    title: 'Salary generated',
    message: `Your payslip for ${dayjs(`${year}-${month}-01`).format('MMMM YYYY')} is ready.`,
    link: '/payroll',
  });
  await sendMail({
    to: employee.email,
    subject: `Payslip for ${dayjs(`${year}-${month}-01`).format('MMMM YYYY')}`,
    html: `<p>Dear ${employee.fullName},</p><p>Your payslip has been generated. Please log in to download.</p>`,
  });
  return success(res, payroll, 'Payroll generated', 201);
});

exports.generateBulk = asyncHandler(async (req, res) => {
  const { month, year } = req.body;
  if (!month || !year) throw new ApiError(400, 'month and year required');
  const employees = await User.find({ isActive: true, role: { $ne: 'SUPER_ADMIN' } });
  const setting = await Setting.findOne();
  const results = [];
  for (const e of employees) {
    const computed = await computePayroll(e, month, year);
    const { _meta, ...persisted } = computed;
    const payslipPath = await generatePayslipPDF(
      { ...persisted, _meta, month, year, status: 'GENERATED', generatedAt: new Date() },
      e,
      setting
    );
    const p = await Payroll.findOneAndUpdate(
      { employee: e._id, month, year },
      { ...persisted, month, year, payslipPath, generatedBy: req.user._id, status: 'GENERATED' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    results.push(p);
  }
  return success(res, { count: results.length }, 'Bulk payroll generated', 201);
});

exports.list = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.employee) filter.employee = req.query.employee;
  if (req.query.month) filter.month = Number(req.query.month);
  if (req.query.year) filter.year = Number(req.query.year);
  const items = await Payroll.find(filter).populate('employee', 'fullName employeeId email').sort({ year: -1, month: -1 });
  return success(res, items, 'Payrolls');
});

exports.mine = asyncHandler(async (req, res) => {
  const items = await Payroll.find({ employee: req.user._id }).sort({ year: -1, month: -1 });
  return success(res, items, 'My payrolls');
});

exports.monthlyTotal = asyncHandler(async (req, res) => {
  const month = Number(req.query.month) || new Date().getMonth() + 1;
  const year = Number(req.query.year) || new Date().getFullYear();
  const result = await Payroll.aggregate([
    { $match: { month, year } },
    { $group: { _id: null, total: { $sum: '$netSalary' }, count: { $sum: 1 } } },
  ]);
  return success(res, result[0] || { total: 0, count: 0 }, 'Monthly payroll total');
});

exports.payslip = asyncHandler(async (req, res) => {
  const p = await Payroll.findById(req.params.id).populate('employee');
  if (!p) throw new ApiError(404, 'Payroll not found');
  if (
    String(p.employee._id) !== String(req.user._id) &&
    !['SUPER_ADMIN', 'HR_MANAGER'].includes(req.user.role)
  )
    throw new ApiError(403, 'Forbidden');
  let filePath = p.payslipPath ? path.join(process.cwd(), p.payslipPath.replace(/^\/+/, '')) : null;
  if (!filePath || !fs.existsSync(filePath)) {
    const setting = await Setting.findOne();
    const computed = await computePayroll(p.employee, p.month, p.year);
    const { _meta } = computed;
    const newPath = await generatePayslipPDF(
      { ...p.toObject(), _meta, generatedAt: p.createdAt },
      p.employee.toObject(),
      setting
    );
    p.payslipPath = newPath;
    await p.save();
    filePath = path.join(process.cwd(), newPath.replace(/^\/+/, ''));
  }
  return res.download(filePath);
});

exports.markPaid = asyncHandler(async (req, res) => {
  const p = await Payroll.findByIdAndUpdate(
    req.params.id,
    { status: 'PAID', paidAt: new Date() },
    { new: true }
  ).populate('employee');
  if (!p) throw new ApiError(404, 'Payroll not found');
  // Regenerate the PDF so the PAID stamp + paid-on date are reflected.
  try {
    const setting = await Setting.findOne();
    const computed = await computePayroll(p.employee, p.month, p.year);
    const { _meta } = computed;
    const newPath = await generatePayslipPDF(
      { ...p.toObject(), _meta, status: 'PAID', paidAt: p.paidAt, generatedAt: p.createdAt },
      p.employee.toObject(),
      setting
    );
    p.payslipPath = newPath;
    await p.save();
  } catch (e) {
    // Don't fail the mark-paid action if PDF regen has trouble; the status update is the source of truth.
  }
  return success(res, p, 'Payroll marked as paid');
});

exports.trend = asyncHandler(async (_req, res) => {
  const items = await Payroll.aggregate([
    { $group: { _id: { year: '$year', month: '$month' }, total: { $sum: '$netSalary' } } },
    { $sort: { '_id.year': 1, '_id.month': 1 } },
    { $limit: 12 },
  ]);
  return success(res, items, 'Payroll trend');
});
