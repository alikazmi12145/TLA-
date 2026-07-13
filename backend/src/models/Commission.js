const mongoose = require('mongoose');

const commissionSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    period: { type: String, enum: ['DAILY', 'WEEKLY', 'MONTHLY'], required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    achievedSales: { type: Number, default: 0, min: 0 },
    commissionRate: { type: Number, default: 0, min: 0, max: 100 },
    commissionAmount: { type: Number, default: 0, min: 0 },
    note: String,
  },
  { timestamps: true }
);

commissionSchema.pre('save', function (next) {
  this.commissionAmount = Math.round((this.achievedSales * this.commissionRate) / 100 * 100) / 100;
  next();
});

commissionSchema.index({ employee: 1, periodEnd: -1 });

module.exports = mongoose.model('Commission', commissionSchema);
