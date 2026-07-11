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

/**
 * Pure lateness calculation shared by the attendance controller and any
 * verification / reporting utility. Lateness is always measured against
 * the SHIFT start on the row's anchor date (Rule 11) so overnight shifts
 * — where the clock-in day may differ from the shift-start day — are
 * evaluated against the correct scheduled start.
 *
 *  @param {{ startTime: string, graceMinutes?: number }} shift
 *  @param {Date|string} clockIn      actual clock-in moment
 *  @param {Date|string} [anchorDate] attendance row's shift-start day;
 *                                    falls back to startOf(clockIn day)
 *                                    for legacy day shifts.
 *  @returns {{ isLate: boolean, lateMinutes: number }}
 */
const evaluateShiftLateness = (shift, clockIn, anchorDate) => {
  if (!shift || !shift.startTime) return { isLate: false, lateMinutes: 0 };
  const [h, m] = String(shift.startTime).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) {
    return { isLate: false, lateMinutes: 0 };
  }
  const referenceDay = anchorDate ? dayjs(anchorDate) : dayjs(clockIn).startOf('day');
  const expected = referenceDay.startOf('day').hour(h).minute(m).second(0);
  const lateMinutes = Math.max(
    0,
    dayjs(clockIn).diff(expected, 'minute') - (Number(shift.graceMinutes) || 0)
  );
  return { isLate: lateMinutes > 0, lateMinutes };
};

module.exports = {
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  diffMinutes,
  resolveShiftAnchorDate,
  evaluateShiftLateness,
};
