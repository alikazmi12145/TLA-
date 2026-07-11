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
    // Explicit pool + timeouts — the defaults are fine for small VPS
    // deployments, but stating them is safer for MongoDB Atlas.
    maxPoolSize: Number(process.env.MONGO_POOL_MAX || 20),
    minPoolSize: Number(process.env.MONGO_POOL_MIN || 2),
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_MS || 10_000),
    socketTimeoutMS: Number(process.env.MONGO_SOCKET_MS || 45_000),
  });
  logger.info(`MongoDB connected: ${c.connection.host}/${c.connection.name}`);
  return c;
};

module.exports = connectDB;
