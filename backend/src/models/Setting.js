const mongoose = require('mongoose');
const { getDefaultPermissions } = require('../config/permissions');

const settingSchema = new mongoose.Schema(
  {
    companyName: { type: String, default: 'The Live Agents' },
    logoUrl: String,
    // Authorized signatory shown on payslips
    ceoName: { type: String, default: 'CEO' },
    ceoTitle: { type: String, default: 'Chief Executive Officer' },
    ceoSignatureUrl: String,
    address: String,
    contactEmail: String,
    contactPhone: String,
    currency: { type: String, default: 'PKR' },
    workingDaysPerMonth: { type: Number, default: 26 },
    workingHoursPerDay: { type: Number, default: 8 },
    // Flat charge per late arrival (applied after lateGraceCount lates are ignored).
    lateDeductionPerDay: { type: Number, default: 500 },
    absentDeductionPerDay: { type: Number, default: 0 },
    attendanceBonusThreshold: { type: Number, default: 0 }, // present days threshold
    attendanceBonusAmount: { type: Number, default: 0 },
    // Salary management — ticket incentive + late rule + tax + closing date
    dailyTicketTarget: { type: Number, default: 120, min: 0 },
    incentivePerExtraTicket: { type: Number, default: 5, min: 0 },
    lateGraceCount: { type: Number, default: 0, min: 0 }, // first N lates ignored before per-late charge applies
    latesPerAbsent: { type: Number, default: 3, min: 1 }, // legacy: retained for backward compatibility, no longer used
    taxPercentage: { type: Number, default: 0, min: 0, max: 100 },
    payrollClosingDate: { type: Number, default: 25, min: 1, max: 31 },
    timezone: { type: String, default: 'Asia/Karachi' },
    theme: {
      mode: { type: String, enum: ['light', 'dark'], default: 'light' },
      primary: { type: String, default: '#5b6ef5' },
    },
    permissions: {
      type: mongoose.Schema.Types.Mixed,
      default: getDefaultPermissions,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Setting', settingSchema);
