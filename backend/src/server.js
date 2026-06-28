require('dotenv').config();
const http = require('http');
const app = require('./app');
const connectDB = require('./config/db');
const logger = require('./utils/logger');
const Target = require('./models/Target');

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

    process.on('unhandledRejection', (err) => {
      logger.error(`UnhandledRejection: ${err.message}`);
      server.close(() => process.exit(1));
    });
  } catch (err) {
    logger.error(`Startup failed: ${err.message}`);
    process.exit(1);
  }
})();
