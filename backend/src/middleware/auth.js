const asyncHandler = require('express-async-handler');
const { verifyAccess } = require('../utils/jwt');
const ApiError = require('../utils/ApiError');
const User = require('../models/User');

const getTokenFromReq = (req) => {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  if (req.cookies && req.cookies.accessToken) return req.cookies.accessToken;
  return null;
};

const protect = asyncHandler(async (req, _res, next) => {
  const token = getTokenFromReq(req);
  if (!token) throw new ApiError(401, 'Not authenticated');
  const decoded = verifyAccess(token);
  const user = await User.findById(decoded.id).select('-password');
  if (!user || !user.isActive) throw new ApiError(401, 'User no longer exists or is disabled');
  req.user = user;
  next();
});

const authorize = (...roles) => (req, _res, next) => {
  if (!req.user) throw new ApiError(401, 'Not authenticated');
  if (roles.length && !roles.includes(req.user.role)) throw new ApiError(403, 'Forbidden: insufficient role');
  next();
};

module.exports = { protect, authorize };
