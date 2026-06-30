import { useState } from 'react';
import { Card, CardContent, Stack, TextField, MenuItem, Box, Chip, Button, Select, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import StickyNote2OutlinedIcon from '@mui/icons-material/StickyNote2Outlined';
import dayjs from 'dayjs';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';

import PageHeader from '../../components/common/PageHeader';
import { TableSkeleton, Empty } from '../../components/common/States';
import useSettingsPermissions from '../../hooks/useSettingsPermissions';
import { attendanceService, employeeService } from '../../services';
import { minutesToHours } from '../../lib/format';
import { ROLES } from '../../lib/constants';

const statusColor = {
  PRESENT: 'success', LATE: 'warning', ABSENT: 'error',
  LEAVE: 'info', HOLIDAY: 'default', HALF_DAY: 'secondary',
};

const EDITABLE_STATUSES = ['PRESENT', 'LATE', 'ABSENT'];

export default function AttendancePage() {
  const role = useSelector((s) => s.auth.user?.role);
  const { canAccess } = useSettingsPermissions();
  const isSuperAdmin = role === ROLES.SUPER_ADMIN;
  const canEditStatus = canAccess('attendance', 'manage');
  const [filters, setFilters] = useState({ month: '', status: '', employee: '' });
  const [noteView, setNoteView] = useState({ open: false, employee: '', date: null, note: '' });
  const openNote = (a) => setNoteView({
    open: true,
    employee: a.employee?.fullName || 'Employee',
    date: a.date,
    note: a.note || '',
  });
  const closeNote = () => setNoteView((s) => ({ ...s, open: false }));
  const queryParams = {
    ...(filters.month ? { month: filters.month } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.employee ? { employee: filters.employee } : {}),
    limit: 500,
  };
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['attendance', queryParams],
    queryFn: () => attendanceService.list(queryParams),
    staleTime: 0,
    refetchInterval: 30000, // poll every 30s so admins see live clock-in/out
  });

  const { data: empData } = useQuery({
    queryKey: ['employees', 'attendance-filter'],
    queryFn: () => employeeService.list({ limit: 1000 }),
    staleTime: 5 * 60 * 1000,
  });
  const employees = empData?.data || [];

  const queryClient = useQueryClient();
  const updateStatus = useMutation({
    mutationFn: ({ employee, date, status }) => attendanceService.adjust({ employee, date, status }),
    onSuccess: () => {
      toast.success('Status updated');
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Failed to update status'),
  });

  const hasFilter = filters.month || filters.status || filters.employee;
  const count = data?.data?.length || 0;
  const subtitle = hasFilter
    ? `${count} record${count === 1 ? '' : 's'} (filtered)`
    : `${count} record${count === 1 ? '' : 's'} (all time)`;

  return (
    <>
      <PageHeader title="Attendance" subtitle={subtitle} />
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
            <TextField type="month" label="Month (optional)" InputLabelProps={{ shrink: true }} value={filters.month}
              onChange={(e) => setFilters({ ...filters, month: e.target.value })} size="small" sx={{ minWidth: 180 }} />
            <TextField select label="Status" size="small" sx={{ minWidth: 180 }} value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <MenuItem value="">All</MenuItem>
              {['PRESENT', 'LATE', 'ABSENT'].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
            <TextField select label="Employee" size="small" sx={{ minWidth: 220 }} value={filters.employee}
              onChange={(e) => setFilters({ ...filters, employee: e.target.value })}>
              <MenuItem value="">All employees</MenuItem>
              {employees.map((emp) => (
                <MenuItem key={emp._id} value={emp._id}>
                  {emp.fullName}{emp.employeeId ? ` (${emp.employeeId})` : ''}
                </MenuItem>
              ))}
            </TextField>
            {hasFilter && (
              <Button size="small" onClick={() => setFilters({ month: '', status: '', employee: '' })}>Clear filters</Button>
            )}
            {isFetching && <Box sx={{ ml: 'auto', fontSize: 12, opacity: 0.6 }}>Refreshing…</Box>}
          </Stack>
        </CardContent>
      </Card>
      <Card><CardContent>
        {isLoading ? <TableSkeleton /> : (data?.data?.length ? (
          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left' }}>
                {[
                  'Employee', 'Date', 'Status', 'Current', 'Clock In', 'Clock Out', 'Hours', 'Late (m)', 'Method',
                  ...(isSuperAdmin ? ['Note'] : []),
                ].map((h) => (
                  <th key={h} style={{ padding: '10px 8px', fontSize: 12, opacity: 0.7, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {data.data.map((a) => {
                  const isToday = dayjs(a.date).isSame(dayjs(), 'day');
                  let current = { label: '—', color: 'default' };
                  if (a.clockIn && a.clockOut) current = { label: 'Done', color: 'default' };
                  else if (a.clockIn && !a.clockOut) current = { label: isToday ? 'Active' : 'No clock-out', color: isToday ? 'success' : 'warning' };
                  return (
                  <tr key={a._id} style={{ borderBottom: '1px dashed rgba(0,0,0,0.08)' }}>
                    <td style={{ padding: '10px 8px' }}>{a.employee?.fullName}</td>
                    <td style={{ padding: '10px 8px' }}>{dayjs(a.date).format('MMM D, YYYY')}</td>
                    <td style={{ padding: '10px 8px' }}>
                      {canEditStatus ? (
                        <Select
                          size="small"
                          value={EDITABLE_STATUSES.includes(a.status) ? a.status : ''}
                          displayEmpty
                          disabled={updateStatus.isPending}
                          onChange={(e) => updateStatus.mutate({
                            employee: a.employee?._id || a.employee,
                            date: a.date,
                            status: e.target.value,
                          })}
                          renderValue={(val) => (
                            <Chip
                              size="small"
                              label={val || a.status || '—'}
                              color={statusColor[val || a.status] || 'default'}
                            />
                          )}
                          sx={{ minWidth: 120, '& .MuiSelect-select': { py: 0.5 } }}
                        >
                          {EDITABLE_STATUSES.map((s) => (
                            <MenuItem key={s} value={s}>{s}</MenuItem>
                          ))}
                        </Select>
                      ) : (
                        <Chip size="small" label={a.status} color={statusColor[a.status] || 'default'} />
                      )}
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      <Chip size="small" label={current.label} color={current.color} variant={current.color === 'success' ? 'filled' : 'outlined'} />
                    </td>
                    <td style={{ padding: '10px 8px' }}>{a.clockIn ? dayjs(a.clockIn).format('HH:mm') : '—'}</td>
                    <td style={{ padding: '10px 8px' }}>{a.clockOut ? dayjs(a.clockOut).format('HH:mm') : '—'}</td>
                    <td style={{ padding: '10px 8px' }}>{minutesToHours(a.workMinutes)}</td>
                    <td style={{ padding: '10px 8px' }}>{a.lateMinutes || 0}</td>
                    <td style={{ padding: '10px 8px' }}>{a.method}</td>
                    {isSuperAdmin && (
                      <td style={{ padding: '10px 8px' }}>
                        {a.note ? (
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<StickyNote2OutlinedIcon fontSize="small" />}
                            onClick={() => openNote(a)}
                            sx={{ textTransform: 'none', fontWeight: 600 }}
                          >
                            Check Note
                          </Button>
                        ) : <span style={{ opacity: 0.4 }}>—</span>}
                      </td>
                    )}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </Box>
        ) : <Empty title="No attendance records" subtitle={hasFilter ? 'Try clearing the filters to see all records.' : 'No attendance has been logged yet.'} />)}
      </CardContent></Card>
      <Dialog open={noteView.open} onClose={closeNote} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 700, pr: 6 }}>
          Note from {noteView.employee}
          <Box sx={{ fontSize: 12, fontWeight: 400, opacity: 0.7, mt: 0.5 }}>
            {noteView.date ? dayjs(noteView.date).format('MMM D, YYYY') : ''}
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.6 }}>
            {noteView.note || 'No note provided.'}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeNote} variant="contained">Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
