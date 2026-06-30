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
  if (req.files?.logo?.[0]) body.logoUrl = `/uploads/logo/${req.files.logo[0].filename}`;
  if (req.files?.ceoSignature?.[0]) body.ceoSignatureUrl = `/uploads/logo/${req.files.ceoSignature[0].filename}`;
  // Backward compat for legacy single-upload callers.
  if (req.file) body.logoUrl = `/uploads/logo/${req.file.filename}`;
  const s = await Setting.findOneAndUpdate({}, body, { new: true, upsert: true, setDefaultsOnInsert: true });
  return success(res, s, 'Settings updated');
});
