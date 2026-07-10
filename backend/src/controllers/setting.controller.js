const asyncHandler = require('express-async-handler');
const Setting = require('../models/Setting');
const { normalizeRolePermissions } = require('../config/permissions');
const { success } = require('../utils/response');

exports.get = asyncHandler(async (_req, res) => {
  let s = await Setting.findOne();
  if (!s) s = await Setting.create({});
  return success(res, s, 'Settings');
});

exports.update = asyncHandler(async (req, res) => {
  const body = { ...req.body };
  if (typeof body.permissions === 'string') {
    try {
      body.permissions = normalizeRolePermissions(JSON.parse(body.permissions));
    } catch {
      body.permissions = normalizeRolePermissions();
    }
  }
  // Nested `leaveAllotments` is transported as a JSON string because the
  // Settings form is submitted as multipart/form-data (needed for the
  // logo/signature uploads). Coerce each value to a non-negative int so
  // a stray empty string can't corrupt the document.
  if (typeof body.leaveAllotments === 'string') {
    try {
      const parsed = JSON.parse(body.leaveAllotments) || {};
      body.leaveAllotments = ['CASUAL', 'SICK', 'ANNUAL', 'EMERGENCY'].reduce((acc, k) => {
        const n = Number(parsed[k]);
        acc[k] = Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
        return acc;
      }, {});
    } catch {
      delete body.leaveAllotments;
    }
  }
  if (req.files?.logo?.[0]) body.logoUrl = `/uploads/logo/${req.files.logo[0].filename}`;
  if (req.files?.ceoSignature?.[0]) body.ceoSignatureUrl = `/uploads/logo/${req.files.ceoSignature[0].filename}`;
  // Backward compat for legacy single-upload callers.
  if (req.file) body.logoUrl = `/uploads/logo/${req.file.filename}`;
  const s = await Setting.findOneAndUpdate({}, body, { new: true, upsert: true, setDefaultsOnInsert: true });
  return success(res, s, 'Settings updated');
});
