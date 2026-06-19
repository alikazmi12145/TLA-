/**
 * One-off: generate Zain's payroll for May 2026.
 *
 * Inputs (per the request):
 *   basicSalary = 45000
 *   daily ticket target = 120 (uses Setting.dailyTicketTarget)
 *   5 days with 150 tickets each
 *   present 25, absent 5, late 3 (lates are inside the 25 present)
 *
 * Run:
 *   cd backend
 *   node src/scripts/generate-zain-may-2026.js
 *
 * Idempotent: safe to re-run; it upserts attendance, targets and the payroll row.
 */
require('dotenv').config();
const path = require('path');
const dayjs = require('dayjs');
const mongoose = require('mongoose');

const connectDB = require('../config/db');
const User = require('../models/User');
const Attendance = require('../models/Attendance');
const Target = require('../models/Target');
const Setting = require('../models/Setting');
const Payroll = require('../models/Payroll');
const Notification = require('../models/Notification');
const { generatePayslipPDF } = require('../services/payslip.service');

const MONTH = 5;
const YEAR = 2026;

const PRESENT_DAYS = 25; // includes the 3 lates
const ABSENT_DAYS = 5;
const LATE_DAYS = 3;
const TICKET_DAYS = 5;
const TICKETS_PER_DAY = 150;
const BASIC_SALARY = 45000;

const round2 = (n) => Math.round(n * 100) / 100;

async function findZain() {
  const candidates = await User.find({
    $or: [
      { fullName: { $regex: /zain/i } },
      { employeeId: { $regex: /^zain$/i } },
      { email: { $regex: /^zain@/i } },
    ],
  });
  if (candidates.length === 0) {
    throw new Error("No user matching 'zain' found. Create the user first or update the script's lookup.");
  }
  if (candidates.length > 1) {
    const list = candidates.map((u) => `${u.fullName} <${u.email}>`).join(', ');
    throw new Error(`Multiple users match 'zain': ${list}. Narrow the lookup in the script.`);
  }
  return candidates[0];
}

async function ensureSetting() {
  let s = await Setting.findOne();
  if (!s) s = await Setting.create({});
  // Per-request rule: every late = PKR 500, no grace.
  let dirty = false;
  if (Number(s.lateDeductionPerDay) !== 500) {
    s.lateDeductionPerDay = 500;
    dirty = true;
  }
  if (Number(s.lateGraceCount) !== 0) {
    s.lateGraceCount = 0;
    dirty = true;
  }
  if (dirty) await s.save();
  return s;
}

function pickMonthDates(month, year, count, skipDates = new Set()) {
  // Pick `count` dates from the given month in calendar order, preferring weekdays
  // first but falling back to Sundays when more dates are needed.
  const start = dayjs(`${year}-${String(month).padStart(2, '0')}-01`);
  const daysInMonth = start.daysInMonth();
  const weekdays = [];
  const sundays = [];
  for (let d = 1; d <= daysInMonth; d += 1) {
    const day = start.date(d);
    const iso = day.format('YYYY-MM-DD');
    if (skipDates.has(iso)) continue;
    if (day.day() === 0) sundays.push(day.toDate());
    else weekdays.push(day.toDate());
  }
  const all = [...weekdays, ...sundays];
  if (all.length < count) {
    throw new Error(`Not enough available dates in ${year}-${month} to allocate ${count} entries.`);
  }
  return all.slice(0, count);
}

async function seedAttendance(employeeId) {
  // Reset prior May-2026 records for a clean slate, then insert exactly the requested mix.
  const start = dayjs(`${YEAR}-${MONTH}-01`).startOf('month').toDate();
  const end = dayjs(start).endOf('month').toDate();
  await Attendance.deleteMany({ employee: employeeId, date: { $gte: start, $lte: end } });

  const presentDates = pickMonthDates(MONTH, YEAR, PRESENT_DAYS);
  const presentIso = new Set(presentDates.map((d) => dayjs(d).format('YYYY-MM-DD')));
  const absentDates = pickMonthDates(MONTH, YEAR, ABSENT_DAYS, presentIso);

  // First LATE_DAYS of presentDates are marked LATE; the rest PRESENT.
  const docs = [];
  presentDates.forEach((date, idx) => {
    const isLate = idx < LATE_DAYS;
    const clockIn = dayjs(date).hour(isLate ? 9 : 9).minute(isLate ? 35 : 0).second(0).toDate();
    const clockOut = dayjs(date).hour(17).minute(30).second(0).toDate();
    docs.push({
      employee: employeeId,
      date,
      method: 'LOGIN',
      clockIn,
      clockOut,
      workMinutes: Math.round((clockOut - clockIn) / 60000),
      status: isLate ? 'LATE' : 'PRESENT',
      isLate,
      lateMinutes: isLate ? 35 : 0,
    });
  });
  absentDates.forEach((date) => {
    docs.push({
      employee: employeeId,
      date,
      method: 'MANUAL',
      status: 'ABSENT',
      isLate: false,
      lateMinutes: 0,
      workMinutes: 0,
    });
  });

  await Attendance.insertMany(docs);
  return docs;
}

async function seedTickets(employeeId) {
  const start = dayjs(`${YEAR}-${MONTH}-01`).startOf('month').toDate();
  const end = dayjs(start).endOf('month').toDate();
  await Target.deleteMany({
    employee: employeeId,
    type: 'DAILY',
    periodStart: { $gte: start, $lte: end },
  });

  // First TICKET_DAYS weekdays of the month get a DAILY target.
  const dates = pickMonthDates(MONTH, YEAR, TICKET_DAYS);
  const docs = dates.map((d) => ({
    employee: employeeId,
    type: 'DAILY',
    periodStart: dayjs(d).startOf('day').toDate(),
    periodEnd: dayjs(d).endOf('day').toDate(),
    targetValue: 120,
    achievedValue: TICKETS_PER_DAY,
    note: 'Seeded by generate-zain-may-2026 script',
  }));
  await Target.insertMany(docs);
  return docs;
}

async function computePayroll(employee, setting) {
  const start = dayjs(`${YEAR}-${MONTH}-01`).startOf('month').toDate();
  const end = dayjs(start).endOf('month').toDate();

  const records = await Attendance.find({ employee: employee._id, date: { $gte: start, $lte: end } });
  const presentDays = records.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length;
  const absentDays = records.filter((r) => r.status === 'ABSENT').length;
  const leaveDays = records.filter((r) => r.status === 'LEAVE').length;
  const lateDays = records.filter((r) => r.isLate || r.status === 'LATE').length;
  const halfDays = records.filter((r) => r.status === 'HALF_DAY').length;
  const workMinutes = records.reduce((s, r) => s + (r.workMinutes || 0), 0);

  const basicSalary = employee.basicSalary || 0;
  const workingDays = Number(setting.workingDaysPerMonth) || 26;
  const perDayRate = workingDays > 0 ? basicSalary / workingDays : 0;

  const absentDeduction = perDayRate * (absentDays + halfDays * 0.5);

  const grace = Number.isFinite(setting.lateGraceCount) ? Number(setting.lateGraceCount) : 0;
  const perLateCharge = Math.max(0, Number(setting.lateDeductionPerDay) || 0);
  const chargeableLates = Math.max(0, lateDays - grace);
  const lateDeduction = chargeableLates * perLateCharge;

  const dailyTarget = Number(setting.dailyTicketTarget) || 0;
  const perTicketIncentive = Number(setting.incentivePerExtraTicket) || 0;
  let ticketIncentive = 0;
  let extraTickets = 0;
  if (dailyTarget > 0 && perTicketIncentive > 0) {
    const dailyDocs = await Target.find({
      employee: employee._id,
      type: 'DAILY',
      periodStart: { $gte: start, $lte: end },
    });
    for (const d of dailyDocs) {
      const tickets = Number(d.achievedValue || 0);
      const extras = Math.max(0, tickets - dailyTarget);
      extraTickets += extras;
      ticketIncentive += extras * perTicketIncentive;
    }
  }

  const attendanceBonus =
    setting.attendanceBonusThreshold && presentDays >= setting.attendanceBonusThreshold
      ? setting.attendanceBonusAmount || 0
      : 0;

  const gross = basicSalary + ticketIncentive + attendanceBonus;
  const taxPct = Math.max(0, Math.min(100, Number(setting.taxPercentage) || 0));
  const tax = (gross * taxPct) / 100;
  const totalDeductions = lateDeduction + absentDeduction + tax;
  const netSalary = gross - totalDeductions;

  return {
    persisted: {
      basicSalary,
      commission: 0,
      attendanceBonus,
      incentives: round2(ticketIncentive),
      overtime: 0,
      lateDeduction: round2(lateDeduction),
      absentDeduction: round2(absentDeduction),
      otherDeductions: round2(tax),
      netSalary: round2(netSalary),
      presentDays,
      absentDays,
      leaveDays,
      lateDays,
      workMinutes,
    },
    meta: {
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
      bonus: 0,
      manualIncentives: 0,
      gross: round2(gross),
    },
  };
}

(async () => {
  try {
    await connectDB();
    const zain = await findZain();
    if (zain.basicSalary !== BASIC_SALARY) {
      zain.basicSalary = BASIC_SALARY;
      await zain.save();
      console.log(`Updated ${zain.fullName} basicSalary to ${BASIC_SALARY}`);
    }

    const setting = await ensureSetting();
    await seedAttendance(zain._id);
    await seedTickets(zain._id);

    const { persisted, meta } = await computePayroll(zain, setting);
    const payslipPath = await generatePayslipPDF(
      { ...persisted, _meta: meta, month: MONTH, year: YEAR },
      zain,
      setting
    );

    const payroll = await Payroll.findOneAndUpdate(
      { employee: zain._id, month: MONTH, year: YEAR },
      {
        ...persisted,
        month: MONTH,
        year: YEAR,
        payslipPath,
        status: 'GENERATED',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await Notification.create({
      user: zain._id,
      type: 'SALARY',
      title: 'Salary generated',
      message: `Your payslip for ${dayjs(`${YEAR}-${MONTH}-01`).format('MMMM YYYY')} is ready.`,
      link: '/payroll',
    });

    console.log('--- Payroll generated ---');
    console.log({
      employee: zain.fullName,
      month: `${MONTH}/${YEAR}`,
      gross: meta.gross,
      ticketIncentive: meta.ticketIncentive,
      absentDeduction: persisted.absentDeduction,
      lateDeduction: persisted.lateDeduction,
      tax: meta.tax,
      netSalary: persisted.netSalary,
      payslip: path.posix.normalize(payslipPath),
      payrollId: String(payroll._id),
    });

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('FAILED:', err.message);
    try {
      await mongoose.disconnect();
    } catch (_) {
      /* noop */
    }
    process.exit(1);
  }
})();
