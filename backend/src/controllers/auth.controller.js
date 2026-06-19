const asyncHandler = require('express-async-handler');
const crypto = require('crypto');
const ApiError = require('../utils/ApiError');
const { signAccess, signRefresh, verifyRefresh } = require('../utils/jwt');
const { sendMail } = require('../utils/mailer');
const { success } = require('../utils/response');
const User = require('../models/User');

const issueTokens = async (user) => {
  const payload = { id: user._id, role: user.role };
  const accessToken = signAccess(payload);
  const refreshToken = signRefresh(payload);
  user.refreshTokens = [...(user.refreshTokens || []).slice(-4), { token: refreshToken }];
  await user.save();
  return { accessToken, refreshToken };
};

exports.login = asyncHandler(async (req, res) => {
  const { userId, email, password } = req.body;
  const identifier = (userId ?? email ?? '').toString().trim();
  if (!identifier || !password) throw new ApiError(400, 'User ID and password are required');
  const lower = identifier.toLowerCase();
  const user = await User.findOne({
    $or: [
      { email: lower },
      { employeeId: identifier },
      { employeeId: identifier.toUpperCase() },
    ],
  }).select('+password');
  if (!user || !user.isActive) throw new ApiError(401, 'Invalid credentials');
  const ok = await user.comparePassword(password);
  if (!ok) throw new ApiError(401, 'Invalid credentials');
  user.lastLoginAt = new Date();
  const tokens = await issueTokens(user);
  return success(res, { user: user.toSafeJSON(), ...tokens }, 'Login successful');
});

exports.refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw new ApiError(400, 'refreshToken required');
  let decoded;
  try { decoded = verifyRefresh(refreshToken); } catch { throw new ApiError(401, 'Invalid refresh token'); }
  const user = await User.findById(decoded.id);
  if (!user || !user.isActive) throw new ApiError(401, 'User not found');
  const exists = (user.refreshTokens || []).some((t) => t.token === refreshToken);
  if (!exists) throw new ApiError(401, 'Refresh token revoked');
  // rotate
  user.refreshTokens = (user.refreshTokens || []).filter((t) => t.token !== refreshToken);
  const tokens = await issueTokens(user);
  return success(res, tokens, 'Token refreshed');
});

exports.logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken && req.user) {
    req.user.refreshTokens = (req.user.refreshTokens || []).filter((t) => t.token !== refreshToken);
    await req.user.save();
  }
  return success(res, {}, 'Logged out');
});

exports.me = asyncHandler(async (req, res) =>
  success(res, { user: req.user.toSafeJSON() }, 'Current user')
);

exports.updateProfile = asyncHandler(async (req, res) => {
  const allowed = ['fullName', 'phone', 'cnic'];
  const update = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) update[k] = req.body[k];
  }
  if (req.file) update.profilePicture = `/uploads/profiles/${req.file.filename}`;
  const user = await User.findByIdAndUpdate(req.user._id, update, { new: true, runValidators: true });
  return success(res, { user: user.toSafeJSON() }, 'Profile updated');
});

exports.changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) throw new ApiError(400, 'Both passwords required');
  if (newPassword.length < 6) throw new ApiError(400, 'New password too short');
  const user = await User.findById(req.user._id).select('+password');
  const ok = await user.comparePassword(currentPassword);
  if (!ok) throw new ApiError(400, 'Current password is incorrect');
  user.password = newPassword;
  user.refreshTokens = []; // invalidate everywhere
  await user.save();
  return success(res, {}, 'Password changed');
});

exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email: (email || '').toLowerCase() });
  // Always respond OK (avoid user enumeration)
  if (!user) return success(res, {}, 'If the email exists, a reset link has been sent');
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  user.resetPasswordToken = hash;
  user.resetPasswordExpires = new Date(Date.now() + 30 * 60 * 1000);
  await user.save();
  const link = `${process.env.CLIENT_URL || 'http://localhost:5173'}/reset-password?token=${raw}&email=${encodeURIComponent(user.email)}`;
  await sendMail({
    to: user.email,
    subject: 'TLA HRMS - Password Reset',
    html: `<p>Hello ${user.fullName},</p><p>Click the link to reset your password (valid 30 minutes):</p><p><a href="${link}">${link}</a></p>`,
  });
  return success(res, {}, 'If the email exists, a reset link has been sent');
});

exports.resetPassword = asyncHandler(async (req, res) => {
  const { email, token, newPassword } = req.body;
  if (!email || !token || !newPassword) throw new ApiError(400, 'Missing fields');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.findOne({
    email: email.toLowerCase(),
    resetPasswordToken: hash,
    resetPasswordExpires: { $gt: new Date() },
  }).select('+password +resetPasswordToken +resetPasswordExpires');
  if (!user) throw new ApiError(400, 'Invalid or expired reset token');
  user.password = newPassword;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  user.refreshTokens = [];
  await user.save();
  return success(res, {}, 'Password has been reset');
});
