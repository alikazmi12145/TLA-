const asyncHandler = require('express-async-handler');
const ApiError = require('../utils/ApiError');
const Setting = require('../models/Setting');
const { hasModuleAccess } = require('../config/permissions');

const authorizeModule = (moduleKey, minLevel = 'read') =>
  asyncHandler(async (req, _res, next) => {
    if (!req.user) throw new ApiError(401, 'Not authenticated');

    const setting = await Setting.findOne().select('permissions').lean();
    if (!hasModuleAccess(setting?.permissions, req.user.role, moduleKey, minLevel)) {
      throw new ApiError(403, 'Forbidden: insufficient permission');
    }

    next();
  });

module.exports = { authorizeModule };