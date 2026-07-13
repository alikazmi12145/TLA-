require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const app = require('./app');
const connectDB = require('./config/db');
const { validateEnv } = require('./config/env');
const logger = require('./utils/logger');
const Target = require('./models/Target');
const Device = require('./models/Device');
const biometric = require('./services/biometric.service');
const zk = require('./services/zkteco.service');
const realtime = require('./services/realtime.service');
const deviceMetrics = require('./services/deviceMetrics.service');
const deviceHealth = require('./services/deviceHealth.service');

// Fail-fast env validation BEFORE any work is scheduled.
validateEnv(logger);

const PORT = process.env.PORT || 5000;

// ------------------------------------------------------------------
// Background jobs
// ------------------------------------------------------------------

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
 *
 * `_biometricPollInFlight` is the process-level mutex that prevents
 * overlapping polls. Combined with the per-device serialisation inside
 * `zkteco.service`, this makes duplicate imports impossible.
 */
let _biometricPollInFlight = false;
const pollBiometricDevices = async () => {
  if (_biometricPollInFlight) return;
  if (_shuttingDown) return;
  _biometricPollInFlight = true;
  try {
    const devices = await Device.find({ enabled: true }).select('_id name');
    for (const d of devices) {
      if (_shuttingDown) break;
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await biometric.importAttendance(d._id);
        if (r.imported) logger.info(`[biometric] ${d.name}: imported ${r.imported} punch(es)`);
      } catch (err) {
        logger.warn(`[biometric] ${d.name} attendance poll failed: ${err.message}`);
      }
      try {
        // eslint-disable-next-line no-await-in-loop
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

// ------------------------------------------------------------------
// Graceful shutdown
// ------------------------------------------------------------------

let _shuttingDown = false;
const _intervals = new Set();
const _timeouts = new Set();
let _server = null;

const scheduleInterval = (fn, ms) => {
  const id = setInterval(fn, ms);
  _intervals.add(id);
  return id;
};
const scheduleTimeout = (fn, ms) => {
  const id = setTimeout(() => {
    _timeouts.delete(id);
    fn();
  }, ms);
  _timeouts.add(id);
  return id;
};

const shutdown = async (signal, exitCode = 0) => {
  if (_shuttingDown) return;
  _shuttingDown = true;
  logger.info(`[shutdown] received ${signal} — starting graceful shutdown`);

  // 1) Stop all timers so no new work is scheduled.
  for (const id of _intervals) clearInterval(id);
  for (const id of _timeouts) clearTimeout(id);
  _intervals.clear();
  _timeouts.clear();
  // Also stop the standalone monitors that manage their own timers.
  try { deviceHealth.stop(); } catch { /* ignore */ }
  try { deviceMetrics.stop(); } catch { /* ignore */ }
  // Flush any buffered device metrics before we tear sockets down.
  try { await deviceMetrics.flush(); } catch { /* ignore */ }

  // 2) Stop accepting new HTTP connections. Existing ones drain until the
  //    hard deadline below.
  if (_server) {
    await new Promise((resolve) => _server.close(() => resolve()));
    logger.info('[shutdown] HTTP server closed');
  }

  // 3) Wait briefly for the in-flight biometric poll to settle. We DO NOT
  //    await forever — the process must exit within a bounded window so PM2
  //    doesn't SIGKILL us. If a poll is still running at the deadline we
  //    tear down the sockets anyway (safe: exec()'s tearDown handles it).
  const pollDeadline = Date.now() + 5_000;
  while (_biometricPollInFlight && Date.now() < pollDeadline) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 100));
  }

  // 4) Disconnect every biometric device — releases TCP sockets cleanly.
  try {
    const devices = await Device.find({ enabled: true }).select('ip port name connectionType inport').lean();
    await Promise.all(devices.map((d) => zk.disconnect(d).catch(() => {})));
    logger.info(`[shutdown] disconnected ${devices.length} biometric device(s)`);
  } catch (err) {
    logger.warn(`[shutdown] biometric disconnect failed: ${err.message}`);
  }

  // 5) Close MongoDB connections.
  try {
    await mongoose.connection.close(false);
    logger.info('[shutdown] MongoDB connection closed');
  } catch (err) {
    logger.warn(`[shutdown] MongoDB close failed: ${err.message}`);
  }

  logger.info('[shutdown] done');
  // Give winston a tick to flush before exit.
  setTimeout(() => process.exit(exitCode), 100).unref();
};

// Hard deadline — if graceful shutdown can't finish in 15 s, exit anyway.
const forceExit = (signal) => {
  setTimeout(() => {
    logger.error(`[shutdown] forced exit after ${signal} timeout`);
    process.exit(1);
  }, 15_000).unref();
};

// ------------------------------------------------------------------
// Boot
// ------------------------------------------------------------------

(async () => {
  try {
    await connectDB();
    _server = http.createServer(app);
    // Tune keep-alive so Nginx (default 60s keepalive) doesn't hit a
    // shorter server timeout and produce spurious 502s.
    _server.keepAliveTimeout = 65_000;
    _server.headersTimeout = 66_000;
    _server.requestTimeout = 60_000;

    _server.listen(PORT, () => {
      logger.info(`TLA HRMS API running on http://localhost:${PORT}`);
    });

    // ------------------------------------------------------------------
    // Realtime + telemetry wiring.
    //   - socket.io shares the HTTP server (no extra port).
    //   - Every zkteco op forwards its result to the metrics buffer.
    //   - The metrics buffer flushes to Mongo every DEVICE_METRICS_FLUSH_MS.
    //   - The health monitor pings every enabled device every 30 s and
    //     emits device-online / device-offline on state change.
    // ------------------------------------------------------------------
    realtime.init(_server);
    zk.setMetricsHook(deviceMetrics.record);
    deviceMetrics.start();
    deviceHealth.start();

    // Prune the zkteco connection-cache and mock stores every 10 minutes
    // so devices removed/disabled in Mongo don't leak their state buckets
    // (zk handle, per-device chain closure) for the process lifetime.
    const prune = async () => {
      try {
        const rows = await Device.find({ enabled: true }).select('ip port').lean();
        const active = rows.map((d) => `${d.ip}:${d.port}`);
        await zk.pruneStale(active);
      } catch (err) {
        logger.warn(`[biometric] prune cycle failed: ${err.message}`);
      }
    };
    scheduleInterval(prune, 10 * 60 * 1000);

    // Run once at startup, then every 15 minutes.
    sweepExpiredTargets();
    scheduleInterval(sweepExpiredTargets, 15 * 60 * 1000);

    // Biometric attendance auto-import (opt-out with BIOMETRIC_POLL_INTERVAL_MS=0).
    const biometricInterval = Number(process.env.BIOMETRIC_POLL_INTERVAL_MS ?? 60_000);
    if (biometricInterval > 0) {
      scheduleTimeout(pollBiometricDevices, 5_000); // warm-up delay
      scheduleInterval(pollBiometricDevices, biometricInterval);
      logger.info(`Biometric poller enabled every ${Math.round(biometricInterval / 1000)}s`);
    } else {
      logger.info('Biometric poller disabled (BIOMETRIC_POLL_INTERVAL_MS=0)');
    }

    // ------------------------------------------------------------------
    // Process-level safety nets.
    //
    // Never let a stray promise rejection (typically from the biometric
    // driver's async socket callbacks) kill the API. Log and keep serving.
    // On truly-fatal `uncaughtException` we STILL initiate graceful
    // shutdown so PM2 can restart us with a clean slate.
    // ------------------------------------------------------------------
    process.on('unhandledRejection', (err) => {
      const msg = err && err.message ? err.message : String(err);
      logger.error(`UnhandledRejection: ${msg}`);
    });
    process.on('uncaughtException', (err) => {
      logger.error(`UncaughtException: ${err && err.stack ? err.stack : err}`);
      // Only exit for truly-fatal errors that leave the process in an
      // undefined state. Everything else is already handled above.
      if (err && /EADDRINUSE|ENOSPC|ENOMEM|out of memory/i.test(String(err.message))) {
        forceExit('uncaughtException');
        shutdown('uncaughtException', 1);
      }
    });

    // Graceful shutdown for PM2 / systemd / docker.
    process.on('SIGTERM', () => { forceExit('SIGTERM'); shutdown('SIGTERM'); });
    process.on('SIGINT', () => { forceExit('SIGINT'); shutdown('SIGINT'); });
  } catch (err) {
    logger.error(`Startup failed: ${err.message}`);
    process.exit(1);
  }
})();
