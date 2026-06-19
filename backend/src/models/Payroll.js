const mongoose = require('mongoose');

const payrollSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    month: { type: Number, required: true, min: 1, max: 12 }, // 1..12
    year: { type: Number, required: true },
    basicSalary: { type: Number, required: true, min: 0 },
    commission: { type: Number, default: 0 },
    attendanceBonus: { type: Number, default: 0 },
    incentives: { type: Number, default: 0 },
    overtime: { type: Number, default: 0 },
    lateDeduction: { type: Number, default: 0 },
    absentDeduction: { type: Number, default: 0 },
    otherDeductions: { type: Number, default: 0 },
    netSalary: { type: Number, required: true },
    presentDays: Number,
    absentDays: Number,
    leaveDays: Number,
    lateDays: Number,
    workMinutes: Number,
    payslipPath: String,
    status: { type: String, enum: ['DRAFT', 'GENERATED', 'PAID'], default: 'GENERATED' },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    paidAt: Date,
  },
  { timestamps: true }
);

payrollSchema.index({ employee: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('Payroll', payrollSchema);
