import { useState } from 'react';
import { Card, CardContent, Stack, TextField, Box, Chip } from '@mui/material';
import dayjs from 'dayjs';
import { useQuery } from '@tanstack/react-query';

import PageHeader from '../../components/common/PageHeader';
import { TableSkeleton, Empty } from '../../components/common/States';
import { attendanceService } from '../../services';
import { minutesToHours } from '../../lib/format';

const statusColor = { PRESENT: 'success', LATE: 'warning', ABSENT: 'error', LEAVE: 'info', HOLIDAY: 'default', HALF_DAY: 'secondary' };

export default function MyAttendancePage() {
  const [month, setMonth] = useState(dayjs().format('YYYY-MM'));
  const { data, isLoading } = useQuery({ queryKey: ['my-att', month], queryFn: () => attendanceService.myMonth(month) });
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
        {isLoading ? <TableSkeleton /> : (data?.data?.length ? (
          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left' }}>
                {['Date', 'Status', 'In', 'Out', 'Hours'].map((h) => (
                  <th key={h} style={{ padding: '10px 8px', fontSize: 12, opacity: 0.7, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {data.data.map((a) => (
                  <tr key={a._id} style={{ borderBottom: '1px dashed rgba(0,0,0,0.08)' }}>
                    <td style={{ padding: '10px 8px' }}>{dayjs(a.date).format('ddd, MMM D')}</td>
                    <td style={{ padding: '10px 8px' }}><Chip size="small" label={a.status} color={statusColor[a.status]} /></td>
                    <td style={{ padding: '10px 8px' }}>{a.clockIn ? dayjs(a.clockIn).format('HH:mm') : '—'}</td>
                    <td style={{ padding: '10px 8px' }}>{a.clockOut ? dayjs(a.clockOut).format('HH:mm') : '—'}</td>
                    <td style={{ padding: '10px 8px' }}>{minutesToHours(a.workMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        ) : <Empty title="No records this month" />)}
      </CardContent></Card>
    </>
  );
}
