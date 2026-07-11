import { useState } from 'react';
import { Card, CardContent, Stack, TextField, Box, Chip } from '@mui/material';
import dayjs from 'dayjs';
import { useQuery } from '@tanstack/react-query';

import PageHeader from '../../components/common/PageHeader';
import { TableSkeleton, Empty } from '../../components/common/States';
import { attendanceService } from '../../services';
import { minutesToHours } from '../../lib/format';

const statusColor = { PRESENT: 'success', LATE: 'warning', ABSENT: 'error', LEAVE: 'info', HOLIDAY: 'default', HALF_DAY: 'secondary' };

// One visible row per COMPLETED session. Attendance logs only exist for
// fully-closed Device-In → Clock-In → Device-Out → Clock-Out cycles.
// Partial, blank, in-progress or legacy pre-sessions[] rows are never rendered.
const isCompletedSession = (s) => !!(s && s.clockIn && s.clockOut);

const expandSessions = (docs) => {
  const rows = [];
  if (!Array.isArray(docs)) return rows;
  for (const a of docs) {
    const sessions = Array.isArray(a.sessions)
      ? a.sessions.filter(isCompletedSession)
      : [];
    if (sessions.length === 0) continue;
    sessions.forEach((s, idx) => {
      rows.push({
        key: `${a._id}-${s._id || idx}`,
        doc: a,
        session: s,
        sessionIndex: idx,
        totalSessions: sessions.length,
        isFirstSession: idx === 0,
      });
    });
  }
  return rows;
};

const fmtTime = (v) => (v ? dayjs(v).format('HH:mm') : '—');

export default function MyAttendancePage() {
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const { data, isLoading } = useQuery({ queryKey: ['my-att', month], queryFn: () => attendanceService.myMonth(month) });
  const rows = expandSessions(data?.data);
  return (
    <>
      <PageHeader title="My Attendance" />
      <Card sx={{ mb: 2 }}><CardContent>
        <Stack direction="row" spacing={1.5}>
          <TextField type="month" label="Month" InputLabelProps={{ shrink: true }} value={month}
            onChange={(e) => setMonth(e.target.value)} size="small" />
        </Stack>
      </CardContent></Card>
      <Card><CardContent>
        {isLoading ? <TableSkeleton /> : (rows.length ? (
          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 780, borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left' }}>
                {['Date', 'Shift', 'Shift Time', 'Session', 'Status', 'Device In', 'Clock In', 'Device Out', 'Clock Out', 'Hours'].map((h) => (
                  <th key={h} style={{ padding: '10px 8px', fontSize: 12, opacity: 0.7, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {rows.map(({ key, doc: a, session: s, sessionIndex, totalSessions, isFirstSession }) => {
                  // Row date = SHIFT START calendar day (Rule 1 / 14). The
                  // backend anchors it via resolveShiftAnchorDate so overnight
                  // shifts stay on their original date.
                  const shift = a.employee?.shift;
                  const shiftName = shift?.name || '—';
                  const shiftTime = (shift?.startTime && shift?.endTime)
                    ? `${shift.startTime} – ${shift.endTime}`
                    : '—';
                  const sessionLabel = totalSessions > 1
                    ? `${sessionIndex + 1} of ${totalSessions}`
                    : '1';
                  return (
                    <tr
                      key={key}
                      style={{
                        borderBottom: '1px dashed rgba(0,0,0,0.08)',
                        background: isFirstSession ? 'transparent' : 'rgba(0,0,0,0.015)',
                      }}
                    >
                      <td style={{ padding: '10px 8px' }}>{dayjs(a.date).format('ddd, MMM D')}</td>
                      <td style={{ padding: '10px 8px' }}>{shiftName}</td>
                      <td style={{ padding: '10px 8px', fontSize: 12, opacity: 0.85 }}>{shiftTime}</td>
                      <td style={{ padding: '10px 8px', fontSize: 12, opacity: 0.85 }}>{sessionLabel}</td>
                      <td style={{ padding: '10px 8px' }}>
                        <Chip size="small" label={a.status} color={statusColor[a.status]} />
                      </td>
                      <td style={{ padding: '10px 8px' }}>{fmtTime(s.deviceCheckInAt)}</td>
                      <td style={{ padding: '10px 8px' }}>{fmtTime(s.clockIn)}</td>
                      <td style={{ padding: '10px 8px' }}>{fmtTime(s.deviceCheckOutAt)}</td>
                      <td style={{ padding: '10px 8px' }}>{fmtTime(s.clockOut)}</td>
                      <td style={{ padding: '10px 8px' }}>{minutesToHours(s.workMinutes || 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Box>
        ) : <Empty title="No records this month" />)}
      </CardContent></Card>
    </>
  );
}
