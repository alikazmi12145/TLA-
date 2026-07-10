/**
 * Delete Attendance / DevicePunch / Leave / Payroll / Notification docs
 * whose `employee` (or `user`) reference no longer points to an existing
 * User. Run once after deleting employees who were created before the
 * cascade-delete was added to employee.controller#remove.
 *
 *   node src/scripts/cleanup-orphan-attendance.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');

const User = require('../models/User');
const Attendance = require('../models/Attendance');
const DevicePunch = require('../models/DevicePunch');
const Leave = require('../models/Leave');
const Payroll = require('../models/Payroll');
const Notification = require('../models/Notification');
const Commission = require('../models/Commission');
const Target = require('../models/Target');
const Department = require('../models/Department');

const purgeByRef = async (Model, field) => {
  const ids = await Model.distinct(field);
  const valid = new Set(
    (await User.find({ _id: { $in: ids } }, { _id: 1 }).lean()).map((u) => String(u._id))
  );
  const orphanIds = ids.filter((id) => id && !valid.has(String(id)));
  if (!orphanIds.length) return { model: Model.modelName, deleted: 0 };
  const res = await Model.deleteMany({ [field]: { $in: orphanIds } });
  return { model: Model.modelName, deleted: res.deletedCount || 0, orphanRefs: orphanIds.length };
};

(async () => {
  await connectDB();
  try {
    const results = await Promise.all([
      purgeByRef(Attendance, 'employee'),
      purgeByRef(DevicePunch, 'employee'),
      purgeByRef(Leave, 'employee'),
      purgeByRef(Payroll, 'employee'),
      purgeByRef(Notification, 'user'),
      purgeByRef(Commission, 'employee'),
      purgeByRef(Target, 'employee'),
    ]);
    // Null out stale head references on Department instead of deleting
    // the department (departments outlive individual managers).
    const validUserIds = new Set(
      (await User.find({}, { _id: 1 }).lean()).map((u) => String(u._id))
    );
    const staleDeptHeads = await Department.find({ head: { $ne: null } }, { head: 1 }).lean();
    const staleIds = staleDeptHeads
      .filter((d) => d.head && !validUserIds.has(String(d.head)))
      .map((d) => d._id);
    if (staleIds.length) {
      await Department.updateMany({ _id: { $in: staleIds } }, { $set: { head: null } });
      results.push({ model: 'Department (head nulled)', deleted: staleIds.length });
    }
    console.table(results);
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
