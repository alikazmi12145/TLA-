const nodemailer = require('nodemailer');
const logger = require('./logger');

let transporter;
const getTransporter = () => {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT || 587),
    secure: Number(process.env.MAIL_PORT) === 465,
    auth: process.env.MAIL_USER ? { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS } : undefined,
  });
  return transporter;
};

const sendMail = async ({ to, subject, html, text }) => {
  try {
    if (!process.env.MAIL_HOST) {
      logger.warn(`Mail skipped (no MAIL_HOST): ${subject} -> ${to}`);
      return { skipped: true };
    }
    const info = await getTransporter().sendMail({
      from: process.env.MAIL_FROM || 'TLA HRMS <no-reply@tlahrms.com>',
      to,
      subject,
      html,
      text,
    });
    return { messageId: info.messageId };
  } catch (err) {
    logger.error(`Mail error: ${err.message}`);
    return { error: err.message };
  }
};

module.exports = { sendMail };
