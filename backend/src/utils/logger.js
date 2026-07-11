const winston = require('winston');

// Ensures Error instances passed to logger.error(err) print their stack.
const errorStackFormat = winston.format((info) => {
  if (info instanceof Error) {
    return { ...info, message: info.stack || info.message };
  }
  if (info.message instanceof Error) {
    info.message = info.message.stack || info.message.message;
  }
  return info;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    errorStackFormat(),
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => `[${timestamp}] ${level.toUpperCase()}: ${message}`)
  ),
  transports: [new winston.transports.Console({ handleExceptions: false })],
  exitOnError: false,
});

module.exports = logger;
