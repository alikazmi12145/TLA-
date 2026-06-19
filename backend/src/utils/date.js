const dayjs = require('dayjs');

const startOfDay = (d = new Date()) => dayjs(d).startOf('day').toDate();
const endOfDay = (d = new Date()) => dayjs(d).endOf('day').toDate();
const startOfMonth = (d = new Date()) => dayjs(d).startOf('month').toDate();
const endOfMonth = (d = new Date()) => dayjs(d).endOf('month').toDate();
const diffMinutes = (a, b) => dayjs(b).diff(dayjs(a), 'minute');

module.exports = { startOfDay, endOfDay, startOfMonth, endOfMonth, diffMinutes };
