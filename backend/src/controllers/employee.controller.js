const asyncHandler = require('express-async-handler');
const path = require('path');
const ApiError = require('../utils/ApiError');
const { success } = require('../utils/response');
const User = require('../models/User');

const normalizeOffDays = (raw) => {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const arr = Array.isArray(raw) ? raw : String(raw).split(',');
  const cleaned = arr
    .map((v) => Number(String(v).trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return Array.from(new Set(cleaned));
};

const buildFilter = (q) => {
  const filter = {};
  if (q.role) filter.role = q.role;
  if (q.department) filter.department = q.department;
  if (q.status) filter.status = q.status;
  if (q.search) {
    const rx = new RegExp(q.search.trim(), 'i');
    filter.$or = [{ fullName: rx }, { email: rx }, { employeeId: rx }, { phone: rx }, { cnic: rx }];
  }
  return filter;
};

exports.list = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 10);
  const filter = buildFilter(req.query);
  const [items, total] = await Promise.all([
    User.find(filter)
      .populate('department', 'name code')
      .populate('shift', 'name startTime endTime')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    User.countDocuments(filter),
  ]);
  return success(res, items, 'Employees', 200, { page, limit, total, pages: Math.ceil(total / limit) });
});

exports.getOne = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id)
    .populate('department', 'name code')
    .populate('shift', 'name startTime endTime');
  if (!user) throw new ApiError(404, 'Employee not found');
  return success(res, user.toSafeJSON(), 'Employee');
});

exports.create = asyncHandler(async (req, res) => {
  const body = { ...req.body };
  const offDays = normalizeOffDays(body.weeklyOffDays);
  if (offDays !== undefined) body.weeklyOffDays = offDays;
  if (req.file) body.profilePicture = `/uploads/profile/${req.file.filename}`;
  if (!body.password) body.password = 'Welcome@123';
  const user = await User.create(body);
  return success(res, user.toSafeJSON(), 'Employee created', 201);
});

exports.update = asyncHandler(async (req, res) => {
  const body = { ...req.body };
  const offDays = normalizeOffDays(body.weeklyOffDays);
  if (offDays !== undefined) body.weeklyOffDays = offDays;
  if (req.file) body.profilePicture = `/uploads/profile/${req.file.filename}`;
  delete body.password; // password is changed via dedicated endpoint
  const user = await User.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });
  if (!user) throw new ApiError(404, 'Employee not found');
  return success(res, user.toSafeJSON(), 'Employee updated');
});

exports.remove = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) throw new ApiError(404, 'Employee not found');
  return success(res, {}, 'Employee deleted');
});

exports.toggleStatus = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'Employee not found');
  user.isActive = !user.isActive;
  user.status = user.isActive ? 'ACTIVE' : 'INACTIVE';
  await user.save();
  return success(res, user.toSafeJSON(), 'Status updated');
});

exports.resetEmployeePassword = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError(404, 'Employee not found');
  user.password = req.body.newPassword || 'Welcome@123';
  user.refreshTokens = [];
  await user.save();
  return success(res, {}, 'Password reset for employee');
});
