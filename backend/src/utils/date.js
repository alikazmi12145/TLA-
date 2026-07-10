const dayjs = require('dayjs');

const startOfDay = (d = new Date()) => dayjs(d).startOf('day').toDate();
const endOfDay = (d = new Date()) => dayjs(d).endOf('day').toDate();
const startOfMonth = (d = new Date()) => dayjs(d).startOf('month').toDate();
const endOfMonth = (d = new Date()) => dayjs(d).endOf('month').toDate();
const diffMinutes = (a, b) => dayjs(b).diff(dayjs(a), 'minute');

/**
 * Compute the attendance-anchor date for a punch, given the employee's
 * assigned shift. This is the SHIFT START calendar date — the day on
 * which the shift *began*, even for overnight shifts that cross midnight.
 *
 *   - No shift assigned                → startOfDay(punchAt) (legacy).
 *   - Day shift (startTime < endTime)  → startOfDay(punchAt).
 *   - Overnight shift (end <= start)   → if the punch's time-of-day is
 *     within [00:00 .. endTime + tailWindowMinutes], the punch belongs to
 *     YESTERDAY'S shift instance which started the previous evening.
 *     Otherwise the punch belongs to today's instance that will end after
 *     midnight.
 *
 * `tailWindowMinutes` is a small grace band after the scheduled shift end
 * so a late check-out shortly after the shift ends still anchors to the
 * correct shift start date instead of spawning a fresh next-day row.
 */
const resolveShiftAnchorDate = (punchAt, shift, { tailWindowMinutes = 120 } = {}) => {
  const punch = dayjs(punchAt);
  if (!shift || !shift.startTime || !shift.endTime) {
    return punch.startOf('day').toDate();
  }
  const [sh, sm] = String(shift.startTime).split(':').map(Number);
  const [eh, em] = String(shift.endTime).split(':').map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) {
    return punch.startOf('day').toDate();
  }
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const isOvernight = endMin <= startMin;
  if (!isOvernight) return punch.startOf('day').toDate();
  const punchMin = punch.hour() * 60 + punch.minute();
  if (punchMin <= endMin + tailWindowMinutes) {
    return punch.startOf('day').subtract(1, 'day').toDate();
  }
  return punch.startOf('day').toDate();
};

module.exports = {
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  diffMinutes,
  resolveShiftAnchorDate,
};
