/**
 * Device repository — thin data-access layer around the Device model.
 * All Mongo access for devices lives here so services stay database-agnostic.
 */
const Device = require('../models/Device');

const create = (payload) => Device.create(payload);

const findById = (id) => Device.findById(id);

const findByIp = (ip, port) => Device.findOne({ ip, port });

const findEnabled = () => Device.find({ enabled: true }).sort({ isPrimary: -1, name: 1 });

const findPrimary = () => Device.findOne({ enabled: true, isPrimary: true });

const list = (filter = {}) => Device.find(filter).sort({ isPrimary: -1, name: 1 });

const update = (id, patch) =>
  Device.findByIdAndUpdate(id, patch, { new: true, runValidators: true });

const remove = (id) => Device.findByIdAndDelete(id);

const updateTelemetry = (id, patch) =>
  Device.findByIdAndUpdate(id, { $set: patch }, { new: true });

module.exports = {
  create,
  findById,
  findByIp,
  findEnabled,
  findPrimary,
  list,
  update,
  remove,
  updateTelemetry,
};
