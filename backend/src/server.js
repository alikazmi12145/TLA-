require('dotenv').config();
const http = require('http');
const app = require('./app');
const connectDB = require('./config/db');
const logger = require('./utils/logger');
const Target = require('./models/Target');
const Device = require('./models/Device');
const biometric = require('./services/biometric.service');

const PORT = process.env.PORT || 5000;

const sweepExpiredTargets = async () => {
  try {
    await Target.updateMany({ type: 'DAILY' }, { $set: { type: 'ONCE' } });
    const res = await Target.updateMany(
      { periodEnd: { $lt: new Date() }, status: 'PENDING' },
      { $set: { status: 'EXPIRED' } }
    );
    if (res?.modifiedCount) logger.info(`Expired ${res.modifiedCount} overdue task(s).`);
  } catch (err) {
    logger.error(`Task sweep failed: ${err.message}`);
  }
};

/**
 * Background biometric poller — pulls attendance and refreshes fingerprint
 * status from every enabled device. Interval controlled by
 * BIOMETRIC_POLL_INTERVAL_MS (default 60s). Set to 0 to disable.
 */
let _biometricPollInFlight = false;
const pollBiometricDevices = async () => {
  // Skip if the previous cycle is still running. Prevents overlapping polls
  // (which would double-import the same punches and double-notify admins).
  if (_biometricPollInFlight) return;
  _biometricPollInFlight = true;
  try {
    const devices = await Device.find({ enabled: true }).select('_id name');
    for (const d of devices) {
      try {
        const r = await biometric.importAttendance(d._id);
        if (r.imported) logger.info(`[biometric] ${d.name}: imported ${r.imported} punch(es)`);
      } catch (err) {
        logger.warn(`[biometric] ${d.name} attendance poll failed: ${err.message}`);
      }
      try {
        // Only scan employees whose fingerprint is still marked NOT_ENROLLED —
        // once a template exists it doesn't disappear silently, so we save the
        // (slow) per-finger probe on people we already know are enrolled.
        await biometric.refreshAllFingerprintStatuses(d._id, { onlyNotEnrolled: true });
      } catch (err) {
        logger.warn(`[biometric] ${d.name} fingerprint refresh failed: ${err.message}`);
      }
    }
  } catch (err) {
    logger.error(`[biometric] poll cycle failed: ${err.message}`);
  } finally {
    _biometricPollInFlight = false;
  }
};

(async () => {
  try {
    await connectDB();
    const server = http.createServer(app);
    server.listen(PORT, () => {
      logger.info(`TLA HRMS API running on http://localhost:${PORT}`);
    });

    // Run once at startup, then every 15 minutes.
    sweepExpiredTargets();
    setInterval(sweepExpiredTargets, 15 * 60 * 1000);

    // Biometric attendance auto-import (opt-out with BIOMETRIC_POLL_INTERVAL_MS=0).
    const biometricInterval = Number(process.env.BIOMETRIC_POLL_INTERVAL_MS ?? 60_000);
    if (biometricInterval > 0) {
      setTimeout(pollBiometricDevices, 5_000); // let the API warm up first
      setInterval(pollBiometricDevices, biometricInterval);
      logger.info(`Biometric poller enabled every ${Math.round(biometricInterval / 1000)}s`);
    } else {
      logger.info('Biometric poller disabled (BIOMETRIC_POLL_INTERVAL_MS=0)');
    }

    // Never let a stray promise rejection (typically from the biometric
    // driver's async socket callbacks) kill the API. Log and keep serving.
    process.on('unhandledRejection', (err) => {
      const msg = err && err.message ? err.message : String(err);
      logger.error(`UnhandledRejection: ${msg}`);
    });
    process.on('uncaughtException', (err) => {
      const msg = err && err.message ? err.message : String(err);
      logger.error(`UncaughtException: ${msg}`);
    });
  } catch (err) {
    logger.error(`Startup failed: ${err.message}`);
    process.exit(1);
  }
})();
