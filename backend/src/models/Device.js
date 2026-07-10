const mongoose = require('mongoose');
const { DEVICE_CONN_STATUS, DEVICE_CONN_TYPE } = require('../config/constants');

/**
 * Biometric device (ZKTeco K40 by default).
 * Holds connection info, capabilities and last-known telemetry.
 * Actual live socket lifecycle is owned by the ZKTeco service singleton;
 * this model only records configuration + last-observed state.
 */
const deviceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    ip: { type: String, required: true, trim: true },
    port: { type: Number, required: true, default: 4370, min: 1, max: 65535 },
    // 5-second UDP inport is required by node-zklib for UDP mode
    inport: { type: Number, default: 5200 },
    serialNumber: { type: String, trim: true, index: true, sparse: true },
    firmware: { type: String, trim: true },
    connectionType: {
      type: String,
      enum: Object.values(DEVICE_CONN_TYPE),
      default: DEVICE_CONN_TYPE.TCP,
    },
    // ZKTeco commkey password (0 if not set)
    commKey: { type: Number, default: 0 },
    location: { type: String, trim: true },
    model: { type: String, default: 'ZKTeco K40', trim: true },
    enabled: { type: Boolean, default: true, index: true },
    // Marks this device as the target for auto-sync when a new employee is created
    isPrimary: { type: Boolean, default: false, index: true },
    // Telemetry
    connectionStatus: {
      type: String,
      enum: Object.values(DEVICE_CONN_STATUS),
      default: DEVICE_CONN_STATUS.UNKNOWN,
    },
    lastPing: { type: Date },
    lastSync: { type: Date },
    // Newest punch timestamp we've ever processed from this device. Used as
    // a high-water mark by importAttendance so we don't re-run upsertPunch
    // (or re-log DevicePunch upserts) for the tens of thousands of
    // historical punches the K40 keeps returning on every getAttendance()
    // call. Set to the max(recordTime) of the last import cycle.
    lastPunchAt: { type: Date },
    lastError: { type: String },
    // Counters (best-effort, refreshed on sync operations)
    userCount: { type: Number, default: 0 },
    fingerCount: { type: Number, default: 0 },
    recordCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

deviceSchema.index({ ip: 1, port: 1 }, { unique: true });

// Only one primary device at a time.
deviceSchema.pre('save', async function preSave(next) {
  if (this.isPrimary && this.isModified('isPrimary')) {
    await this.constructor.updateMany(
      { _id: { $ne: this._id }, isPrimary: true },
      { $set: { isPrimary: false } }
    );
  }
  next();
});

module.exports = mongoose.model('Device', deviceSchema);
