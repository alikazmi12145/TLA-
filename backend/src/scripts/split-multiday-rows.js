/**
 * split-multiday-rows.js
 *
 * One-off cleanup: finds attendance rows whose sessions[] span more than
 * one shift-anchor date (a symptom of the "cross-day merge" bug where a
 * forgotten clock-out caused subsequent days' punches to be appended to
 * a stale open row). For each such row it re-distributes sessions to the
 * correct per-day rows, creating new rows as needed.
 *
 * Idempotent: running twice is a no-op because after the first pass every
 * row's sessions[] all share the same anchor date.
 *
 * Usage:
 *   cd /var/www/tla-hrms/backend
 *   node src/scripts/split-multiday-rows.js               # dry-run
 *   node src/scripts/split-multiday-rows.js --commit      # apply changes
 *   node src/scripts/split-multiday-rows.js --employee <id> --commit
 */

require('dotenv').config();
const mongoose = require('mongoose');

const Attendance = require('../models/Attendance');
const User = require('../models/User');
require('../models/Shift');
const { resolveShiftAnchorDate } = require('../utils/date');

const args = process.argv.slice(2);
const commit = args.includes('--commit');
const empIdx = args.indexOf('--employee');
const onlyEmployee = empIdx >= 0 ? args[empIdx + 1] : null;

const sessionAnchor = (session, shift) => {
  const at = session.deviceCheckInAt || session.clockIn || session.deviceCheckOutAt || session.clockOut;
  if (!at) return null;
  return resolveShiftAnchorDate(at, shift);
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`[split] connected. commit=${commit} employee=${onlyEmployee || 'ALL'}`);

  const query = onlyEmployee ? { employee: onlyEmployee } : {};
  const rows = await Attendance.find(query);
  let touched = 0;
  let created = 0;

  for (const row of rows) {
    if (!Array.isArray(row.sessions) || row.sessions.length < 2) continue;

    const emp = await User.findById(row.employee).populate('shift').lean();
    const shift = emp ? emp.shift : null;

    // Group sessions by their true anchor date.
    const buckets = new Map();
    for (const s of row.sessions) {
      const anchor = sessionAnchor(s, shift);
      if (!anchor) continue;
      const key = anchor.toISOString();
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(s);
    }

    if (buckets.size <= 1) continue; // already single-day — skip

    console.log(`\n[row] ${row._id}  employee=${emp?.fullName || row.employee}  date=${row.date.toISOString().slice(0,10)}  sessions=${row.sessions.length}  spans=${buckets.size} days`);

    // Keep the row's own date bucket (the earliest) on this row; migrate
    // the others to their own rows.
    const sortedKeys = [...buckets.keys()].sort();
    const keepKey = row.date.toISOString();
    const keepSessions = buckets.get(keepKey) || buckets.get(sortedKeys[0]);

    for (const key of sortedKeys) {
      if (key === keepKey || (key === sortedKeys[0] && !buckets.has(keepKey))) continue;
      const sessions = buckets.get(key);
      console.log(`   ↳ migrate ${sessions.length} session(s) to new row dated ${key.slice(0,10)}`);
      if (commit) {
        // Upsert a new row for that anchor date and append the sessions.
        const target = await Attendance.findOneAndUpdate(
          { employee: row.employee, date: new Date(key) },
          {
            $setOnInsert: {
              method: row.method,
              status: row.status,
              shift: row.shift,
              isOpen: false,
              attendanceStatus: 'COMPLETED',
            },
          },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        target.sessions = [...(target.sessions || []), ...sessions];
        // Reset _id on migrated subdocs to avoid duplicate-key.
        target.sessions = target.sessions.map((s) => {
          const clone = s.toObject ? s.toObject() : { ...s };
          delete clone._id;
          return clone;
        });
        await target.save();
        created += 1;
      }
    }

    // Trim this row down to just its own day's sessions.
    if (commit) {
      row.sessions = keepSessions || [];
      row.isOpen = false;
      row.attendanceStatus = 'COMPLETED';
      await row.save();
    }
    touched += 1;
  }

  console.log(`\n[split] done. rows_touched=${touched} rows_created=${created} commit=${commit}`);
  await mongoose.disconnect();
})().catch((err) => { console.error(err); process.exit(1); });
