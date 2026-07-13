const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');
  mongoose.set('strictQuery', true);

  // Wire connection-lifecycle listeners BEFORE `connect` so we never miss
  // an early failure. `error` and `disconnected` must not crash the
  // process — the driver auto-reconnects and we surface via logs.
  const conn = mongoose.connection;
  conn.on('error', (err) => logger.error(`[mongo] connection error: ${err.message}`));
  conn.on('disconnected', () => logger.warn('[mongo] disconnected — driver will auto-reconnect.'));
  conn.on('reconnected', () => logger.info('[mongo] reconnected.'));

  const c = await mongoose.connect(uri, {
    // Only build indexes automatically in non-production; in production
    // deploys, indexes should be built once explicitly (or via a migration)
    // so a hot restart doesn't stall on a large collection.
    autoIndex: process.env.NODE_ENV !== 'production',
    // Explicit pool + timeouts tuned for a 2 vCPU / 4 GB VPS running
    // Node + MongoDB side-by-side. Pool caps concurrent Mongo ops; a
    // long idle timeout releases sockets on quiet nights; heartbeat 10s
    // is the sweet spot for failover detection vs chatter.
    maxPoolSize: Number(process.env.MONGO_POOL_MAX || 20),
    minPoolSize: Number(process.env.MONGO_POOL_MIN || 2),
    maxIdleTimeMS: Number(process.env.MONGO_MAX_IDLE_MS || 60_000),
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_MS || 10_000),
    socketTimeoutMS: Number(process.env.MONGO_SOCKET_MS || 45_000),
    heartbeatFrequencyMS: Number(process.env.MONGO_HEARTBEAT_MS || 10_000),
    // Idempotent writes survive network blips at zero cost.
    retryWrites: true,
    retryReads: true,
    // Prefer zstd (fast + high ratio) then zlib for wire compression.
    // The driver silently falls back to no compression if the server
    // doesn't advertise support, so this is safe on old MongoDB too.
    compressors: (process.env.MONGO_COMPRESSORS || 'zstd,zlib').split(','),
  });
  logger.info(`MongoDB connected: ${c.connection.host}/${c.connection.name}`);
  return c;
};

module.exports = connectDB;
