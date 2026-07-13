/**
 * Device health monitor.
 *
 * Every INTERVAL_MS the monitor pings every enabled biometric device via
 * the ZKTeco service and updates its telemetry. State transitions
 * (online <-> offline) emit socket.io events; identical states never
 * spam the wire.
 *
 * The monitor is self-serialising: if a previous tick is still running,
 * the next tick returns immediately. Combined with the per-device queue in
 * `zkteco.service`, that gives us at most one ping in flight per device.
 */
const zk = require('./zkteco.service');
const realtime = require('./realtime.service');
const deviceRepo = require('../repositories/device.repository');
const logger = require('../utils/logger');
const { DEVICE_CONN_STATUS } = require('../config/constants');

const INTERVAL_MS = Number(process.env.DEVICE_HEALTH_INTERVAL_MS || 30_000);

// deviceId -> { online: boolean }  Last emitted state, used to suppress
// duplicate events. In-memory is fine; on restart every device is re-probed
// and the correct state is broadcast on the first tick.
const lastState = new Map();

let _timer = null;
let _inFlight = false;

const pingOne = async (device) => {
  const t0 = Date.now();
  const result = await zk.ping(device);
  const latency = result.latencyMs != null ? result.latencyMs : Date.now() - t0;
  const now = new Date();
  const prev = lastState.get(String(device._id));

  if (result.ok) {
    // Successful ping — mark online. `updateTelemetry` auto-stamps lastSeen.
    const patch = {
      online: true,
      status: DEVICE_CONN_STATUS.ONLINE,
      connectionStatus: DEVICE_CONN_STATUS.ONLINE,
      lastPing: now,
      lastLatency: latency,
      lastError: null,
    };
    // Coming back online after being offline — remember reconnect time.
    if (!prev || prev.online === false) {
      patch.lastConnectedAt = now;
    }
    await deviceRepo.updateTelemetry(device._id, patch);
    if (!prev || prev.online !== true) {
      lastState.set(String(device._id), { online: true });
      const payload = {
        deviceId: String(device._id),
        name: device.name,
        ip: device.ip,
        latency,
        at: now,
      };
      // First observation is "online"; subsequent recoveries are "reconnected".
      realtime.emit('device-online', payload);
      if (prev && prev.online === false) realtime.emit('device-reconnected', payload);
      logger.info(`[health] ${device.name} ONLINE (${latency}ms)`);
    }
  } else {
    // Failed ping — mark offline and bump failure count.
    const patch = {
      online: false,
      status: DEVICE_CONN_STATUS.OFFLINE,
      connectionStatus: DEVICE_CONN_STATUS.OFFLINE,
      lastPing: now,
      lastLatency: latency,
      lastError: result.error || 'ping failed',
    };
    if (!prev || prev.online !== false) {
      patch.lastDisconnectedAt = now;
    }
    await deviceRepo.updateTelemetry(device._id, patch);
    // Failure counter is authoritative — increment even when state is unchanged.
    await deviceRepo.recordFailure(device._id, result.error || 'ping failed');
    if (!prev || prev.online !== false) {
      lastState.set(String(device._id), { online: false });
      realtime.emit('device-offline', {
        deviceId: String(device._id),
        name: device.name,
        ip: device.ip,
        error: result.error,
        at: now,
      });
      logger.warn(`[health] ${device.name} OFFLINE: ${result.error}`);
    }
  }
};

const tick = async () => {
  if (_inFlight) return;
  _inFlight = true;
  try {
    const devices = await deviceRepo.findEnabled('_id name ip port connectionType inport enabled', { lean: true });
    // Prune `lastState` for devices that are no longer enabled/present —
    // otherwise we accumulate one Map entry per ever-seen device for the
    // process lifetime (memory grows on VPS with device churn).
    if (lastState.size > devices.length) {
      const keep = new Set(devices.map((d) => String(d._id)));
      for (const k of lastState.keys()) {
        if (!keep.has(k)) lastState.delete(k);
      }
    }
    await Promise.all(devices.map((d) => pingOne(d).catch((err) => {
      logger.warn(`[health] ${d.name} ping errored: ${err.message}`);
    })));
  } catch (err) {
    logger.error(`[health] tick failed: ${err.message}`);
  } finally {
    _inFlight = false;
  }
};

const start = () => {
  if (_timer || INTERVAL_MS <= 0) {
    if (INTERVAL_MS <= 0) logger.info('[health] monitor disabled (DEVICE_HEALTH_INTERVAL_MS=0)');
    return;
  }
  // Kick off a first probe shortly after boot, then on a fixed interval.
  setTimeout(() => { tick().catch(() => {}); }, 3_000).unref?.();
  _timer = setInterval(() => { tick().catch(() => {}); }, INTERVAL_MS);
  if (_timer.unref) _timer.unref();
  logger.info(`[health] monitor enabled every ${Math.round(INTERVAL_MS / 1000)}s`);
};

const stop = () => {
  if (_timer) clearInterval(_timer);
  _timer = null;
};

module.exports = { start, stop, tick };
