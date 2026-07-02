/**
 * Employee repository — biometric-focused view over the User model.
 * The rest of the app still uses User directly; this module centralises the
 * queries used by the biometric flow so services do not touch Mongoose.
 */
const User = require('../models/User');

const findById = (id) => User.findById(id);

const findByDeviceUserId = (deviceId, deviceUserId) =>
  User.findOne({ deviceId, deviceUserId });

/**
 * Returns the numerically smallest free deviceUserId (1..) that is not yet
 * assigned on the given device. The ZK K40 uses uint16 IDs so we cap at 65534.
 */
const nextFreeDeviceUserId = async (deviceId) => {
  const rows = await User.find({ deviceId })
    .select('deviceUserId')
    .lean();
  const used = new Set(
    rows.map((r) => Number(r.deviceUserId)).filter((n) => Number.isFinite(n) && n > 0)
  );
  for (let i = 1; i <= 65534; i += 1) {
    if (!used.has(i)) return String(i);
  }
  throw new Error('No free device user IDs available (65534 used).');
};

const listSyncable = (filter = {}) =>
  User.find({ isActive: true, ...filter }).select(
    'employeeId fullName deviceId deviceUserId devicePrivilege syncStatus deviceSynced fingerprintStatus'
  );

const setSyncSuccess = (userId, patch) =>
  User.findByIdAndUpdate(
    userId,
    {
      $set: {
        deviceSynced: true,
        syncStatus: 'SYNCED',
        lastSync: new Date(),
        syncError: null,
        ...patch,
      },
    },
    { new: true }
  );

const setSyncFailure = (userId, error) =>
  User.findByIdAndUpdate(
    userId,
    {
      $set: {
        deviceSynced: false,
        syncStatus: 'FAILED',
        syncError: String(error?.message || error || 'Unknown device error').slice(0, 500),
      },
    },
    { new: true }
  );

const setFingerprintStatus = (userId, status, count) =>
  User.findByIdAndUpdate(
    userId,
    {
      $set: {
        fingerprintStatus: status,
        ...(Number.isFinite(count) ? { fingerCount: count } : {}),
      },
    },
    { new: true }
  );

const setDeviceEnabled = (userId, enabled) =>
  User.findByIdAndUpdate(userId, { $set: { deviceUserEnabled: !!enabled } }, { new: true });

const clearDevice = (userId) =>
  User.findByIdAndUpdate(
    userId,
    {
      $set: {
        deviceSynced: false,
        syncStatus: 'PENDING',
        fingerprintStatus: 'NOT_ENROLLED',
        fingerCount: 0,
        lastSync: null,
      },
      $unset: { deviceId: '', deviceUserId: '', syncError: '' },
    },
    { new: true }
  );

module.exports = {
  findById,
  findByDeviceUserId,
  nextFreeDeviceUserId,
  listSyncable,
  setSyncSuccess,
  setSyncFailure,
  setFingerprintStatus,
  setDeviceEnabled,
  clearDevice,
};
