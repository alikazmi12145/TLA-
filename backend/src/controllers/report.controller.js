const asyncHandler = require('express-async-handler');
const ExcelJS = require('exceljs');
const dayjs = require('dayjs');
const ApiError = require('../utils/ApiError');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const Payroll = require('../models/Payroll');
const Commission = require('../models/Commission');
const Target = require('../models/Target');

const dateRange = (q) => {
  const filter = {};
  if (q.from || q.to) {
    filter.$gte = q.from ? new Date(q.from) : new Date(0);
    filter.$lte = q.to ? new Date(`${q.to}T23:59:59`) : new Date();
  } else if (q.month && q.year) {
    const ref = new Date(`${q.year}-${q.month}-01`);
    filter.$gte = dayjs(ref).startOf('month').toDate();
    filter.$lte = dayjs(ref).endOf('month').toDate();
  }
  return filter;
};

const sendExcel = async (res, fileName, sheetName, columns, rows) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.columns = columns;
  ws.getRow(1).font = { bold: true };
  rows.forEach((r) => ws.addRow(r));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
};

exports.attendance = asyncHandler(async (req, res) => {
  const filter = {};
  const range = dateRange(req.query);
  if (Object.keys(range).length) filter.date = range;
  if (req.query.employee) filter.employee = req.query.employee;
  const items = await Attendance.find(filter).populate('employee', 'fullName employeeId email department').sort({ date: -1 });

  if (req.query.format === 'xlsx') {
    return sendExcel(res, 'attendance-report', 'Attendance',
      [
        { header: 'Employee', key: 'name', width: 25 },
        { header: 'Employee ID', key: 'eid', width: 15 },
        { header: 'Date', key: 'date', width: 14 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Clock In', key: 'in', width: 22 },
        { header: 'Clock Out', key: 'out', width: 22 },
        { header: 'Work Hours', key: 'hrs', width: 12 },
        { header: 'Late (mins)', key: 'late', width: 12 },
      ],
      items.map((i) => ({
        name: i.employee?.fullName,
        eid: i.employee?.employeeId,
        date: dayjs(i.date).format('YYYY-MM-DD'),
        status: i.status,
        in: i.clockIn ? dayjs(i.clockIn).format('YYYY-MM-DD HH:mm') : '',
        out: i.clockOut ? dayjs(i.clockOut).format('YYYY-MM-DD HH:mm') : '',
        hrs: ((i.workMinutes || 0) / 60).toFixed(2),
        late: i.lateMinutes || 0,
      }))
    );
  }
  res.json({ success: true, data: items });
});

exports.leave = asyncHandler(async (req, res) => {
  const filter = {};
  const range = dateRange(req.query);
  if (Object.keys(range).length) filter.fromDate = range;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.employee) filter.employee = req.query.employee;
  const items = await Leave.find(filter).populate('employee', 'fullName employeeId').sort({ fromDate: -1 });

  if (req.query.format === 'xlsx') {
    return sendExcel(res, 'leave-report', 'Leaves',
      [
        { header: 'Employee', key: 'name', width: 25 },
        { header: 'Type', key: 'type', width: 12 },
        { header: 'From', key: 'from', width: 14 },
        { header: 'To', key: 'to', width: 14 },
        { header: 'Days', key: 'days', width: 8 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Reason', key: 'reason', width: 40 },
      ],
      items.map((i) => ({
        name: i.employee?.fullName,
        type: i.type,
        from: dayjs(i.fromDate).format('YYYY-MM-DD'),
        to: dayjs(i.toDate).format('YYYY-MM-DD'),
        days: i.days,
        status: i.status,
        reason: i.reason,
      }))
    );
  }
  res.json({ success: true, data: items });
});

exports.salary = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.month) filter.month = Number(req.query.month);
  if (req.query.year) filter.year = Number(req.query.year);
  if (req.query.employee) filter.employee = req.query.employee;
  const items = await Payroll.find(filter).populate('employee', 'fullName employeeId').sort({ year: -1, month: -1 });

  if (req.query.format === 'xlsx') {
    return sendExcel(res, 'salary-report', 'Salary',
      [
        { header: 'Employee', key: 'name', width: 25 },
        { header: 'Month', key: 'month', width: 10 },
        { header: 'Year', key: 'year', width: 8 },
        { header: 'Basic', key: 'basic', width: 12 },
        { header: 'Commission', key: 'comm', width: 12 },
        { header: 'Bonus', key: 'bonus', width: 12 },
        { header: 'Deductions', key: 'ded', width: 12 },
        { header: 'Net', key: 'net', width: 14 },
        { header: 'Status', key: 'status', width: 12 },
      ],
      items.map((i) => ({
        name: i.employee?.fullName,
        month: i.month,
        year: i.year,
        basic: i.basicSalary,
        comm: i.commission,
        bonus: i.attendanceBonus + i.incentives + i.overtime,
        ded: i.lateDeduction + i.absentDeduction + i.otherDeductions,
        net: i.netSalary,
        status: i.status,
      }))
    );
  }
  res.json({ success: true, data: items });
});

exports.commission = asyncHandler(async (req, res) => {
  const filter = {};
  const range = dateRange(req.query);
  if (Object.keys(range).length) filter.periodStart = range;
  if (req.query.employee) filter.employee = req.query.employee;
  const items = await Commission.find(filter).populate('employee', 'fullName employeeId').sort({ periodStart: -1 });

  if (req.query.format === 'xlsx') {
    return sendExcel(res, 'commission-report', 'Commission',
      [
        { header: 'Employee', key: 'name', width: 25 },
        { header: 'Period', key: 'p', width: 10 },
        { header: 'From', key: 'from', width: 14 },
        { header: 'To', key: 'to', width: 14 },
        { header: 'Sales', key: 'sales', width: 14 },
        { header: 'Rate %', key: 'rate', width: 10 },
        { header: 'Amount', key: 'amount', width: 14 },
      ],
      items.map((i) => ({
        name: i.employee?.fullName,
        p: i.period,
        from: dayjs(i.periodStart).format('YYYY-MM-DD'),
        to: dayjs(i.periodEnd).format('YYYY-MM-DD'),
        sales: i.achievedSales,
        rate: i.commissionRate,
        amount: i.commissionAmount,
      }))
    );
  }
  res.json({ success: true, data: items });
});

exports.performance = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.employee) filter.employee = req.query.employee;
  if (req.query.type) filter.type = req.query.type;
  const items = await Target.find(filter).populate('employee', 'fullName employeeId').sort({ periodStart: -1 });

  if (req.query.format === 'xlsx') {
    return sendExcel(res, 'performance-report', 'Performance',
      [
        { header: 'Employee', key: 'name', width: 25 },
        { header: 'Type', key: 'type', width: 10 },
        { header: 'From', key: 'from', width: 14 },
        { header: 'To', key: 'to', width: 14 },
        { header: 'Target', key: 't', width: 12 },
        { header: 'Achieved', key: 'a', width: 12 },
        { header: 'Completion %', key: 'c', width: 14 },
      ],
      items.map((i) => ({
        name: i.employee?.fullName,
        type: i.type,
        from: dayjs(i.periodStart).format('YYYY-MM-DD'),
        to: dayjs(i.periodEnd).format('YYYY-MM-DD'),
        t: i.targetValue,
        a: i.achievedValue,
        c: i.targetValue ? Math.round((i.achievedValue / i.targetValue) * 10000) / 100 : 0,
      }))
    );
  }
  res.json({ success: true, data: items });
});
