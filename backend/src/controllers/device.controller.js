const asyncHandler = require('express-async-handler');
const ApiError = require('../utils/ApiError');
const { success } = require('../utils/response');
const deviceRepo = require('../repositories/device.repository');
const biometric = require('../services/biometric.service');
const { DEVICE_CONN_TYPE } = require('../config/constants');

const parseBody = (body = {}) => {
  const out = { ...body };
  if (out.port !== undefined) out.port = Number(out.port);
  if (out.inport !== undefined) out.inport = Number(out.inport);
  if (out.commKey !== undefined) out.commKey = Number(out.commKey) || 0;
  if (out.enabled !== undefined) out.enabled = out.enabled === true || out.enabled === 'true';
  if (out.isPrimary !== undefined) out.isPrimary = out.isPrimary === true || out.isPrimary === 'true';
  if (out.connectionType && !Object.values(DEVICE_CONN_TYPE).includes(out.connectionType)) {
    delete out.connectionType;
  }
  return out;
};

exports.list = asyncHandler(async (_req, res) => {
  const items = await deviceRepo.list();
  return success(res, items, 'Devices');
});

exports.getOne = asyncHandler(async (req, res) => {
  const item = await deviceRepo.findById(req.params.id);
  if (!item) throw new ApiError(404, 'Device not found');
  return success(res, item, 'Device');
});

exports.create = asyncHandler(async (req, res) => {
  const body = parseBody(req.body);
  if (!body.name) throw new ApiError(400, 'Device name is required');
  if (!body.ip) throw new ApiError(400, 'Device IP is required');
  const item = await deviceRepo.create(body);
  return success(res, item, 'Device created', 201);
});

exports.update = asyncHandler(async (req, res) => {
  const body = parseBody(req.body);
  const item = await deviceRepo.update(req.params.id, body);
  if (!item) throw new ApiError(404, 'Device not found');
  return success(res, item, 'Device updated');
});

exports.remove = asyncHandler(async (req, res) => {
  const item = await deviceRepo.remove(req.params.id);
  if (!item) throw new ApiError(404, 'Device not found');
  return success(res, {}, 'Device deleted');
});

exports.connect = asyncHandler(async (req, res) => {
  const item = await biometric.connectDevice(req.params.id);
  return success(res, item, 'Device connected');
});

exports.disconnect = asyncHandler(async (req, res) => {
  const item = await biometric.disconnectDevice(req.params.id);
  return success(res, item, 'Device disconnected');
});

exports.test = asyncHandler(async (req, res) => {
  const result = await biometric.testConnection(req.params.id);
  return success(res, result, result.ok ? 'Device reachable' : 'Device unreachable');
});

exports.restart = asyncHandler(async (req, res) => {
  const item = await biometric.restartDevice(req.params.id);
  return success(res, item, 'Device restart requested');
});

exports.syncAll = asyncHandler(async (req, res) => {
  const result = await biometric.syncAllEmployees(req.params.id);
  return success(res, result, 'Employees synchronized');
});

exports.importEmployees = asyncHandler(async (req, res) => {
  const result = await biometric.importEmployeesFromDevice(req.params.id);
  return success(res, result, 'Users imported from device');
});

exports.importAttendance = asyncHandler(async (req, res) => {
  const clearAfter = req.body?.clearAfter === true || req.body?.clearAfter === 'true';
  const result = await biometric.importAttendance(req.params.id, { clearAfter });
  return success(res, result, 'Attendance imported');
});

exports.refreshFingerprints = asyncHandler(async (req, res) => {
  const result = await biometric.refreshAllFingerprintStatuses(req.params.id);
  return success(res, result, 'Fingerprint statuses refreshed');
});

exports.clearAttendance = asyncHandler(async (req, res) => {
  const result = await biometric.clearAttendanceLogs(req.params.id);
  return success(res, result, 'Attendance logs cleared on device');
});
