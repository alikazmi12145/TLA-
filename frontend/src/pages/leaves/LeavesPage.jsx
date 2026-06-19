import { useState } from 'react';
import { Card, CardContent, Stack, TextField, Button, Chip, MenuItem, IconButton, Tooltip, Box, Dialog, DialogTitle, DialogContent, DialogActions, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import dayjs from 'dayjs';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';

import PageHeader from '../../components/common/PageHeader';
import { TableSkeleton, Empty } from '../../components/common/States';
import { leaveService } from '../../services';
import { LEAVE_STATUS } from '../../lib/constants';

const statusColor = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'error' };

export default function LeavesPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ status: '', type: '' });
  const [actioning, setActioning] = useState(null); // { id, status }
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['leaves', filters],
    queryFn: () => leaveService.list(filters),
    staleTime: 0,
  });

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await leaveService.action(actioning.id, { status: actioning.status, remarks });
      toast.success(`Leave ${actioning.status.toLowerCase()}`);
      setActioning(null);
      setRemarks('');
      await qc.invalidateQueries({ queryKey: ['leaves'] });
    } catch {
      // error toast handled by axios interceptor; refresh list so stale rows disappear
      await qc.invalidateQueries({ queryKey: ['leaves'] });
      setActioning(null);
      setRemarks('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader title="Leave Requests" subtitle="Approve or reject leave applications" />
      <Card sx={{ mb: 2 }}><CardContent>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
          <TextField select size="small" label="Status" sx={{ minWidth: 180 }} value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <MenuItem value="">All</MenuItem>
            {LEAVE_STATUS.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Type" sx={{ minWidth: 180 }} value={filters.type}
            onChange={(e) => setFilters({ ...filters, type: e.target.value })}>
            <MenuItem value="">All</MenuItem>
            {['CASUAL', 'SICK', 'ANNUAL', 'EMERGENCY'].map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
          </TextField>
        </Stack>
      </CardContent></Card>

      <Card><CardContent>
        {isLoading ? <TableSkeleton /> : (data?.data?.length ? (
          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left' }}>
                {['Employee', 'Type', 'From', 'To', 'Days', 'Reason', 'Status', 'Actions'].map((h) => (
                  <th key={h} style={{ padding: '10px 8px', fontSize: 12, opacity: 0.7, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {data.data.map((l) => (
                  <tr key={l._id} style={{ borderBottom: '1px dashed rgba(0,0,0,0.08)' }}>
                    <td style={{ padding: '10px 8px' }}>{l.employee?.fullName}</td>
                    <td style={{ padding: '10px 8px' }}>{l.type}</td>
                    <td style={{ padding: '10px 8px' }}>{dayjs(l.fromDate).format('MMM D, YYYY')}</td>
                    <td style={{ padding: '10px 8px' }}>{dayjs(l.toDate).format('MMM D, YYYY')}</td>
                    <td style={{ padding: '10px 8px' }}>{l.days}</td>
                    <td style={{ padding: '10px 8px', maxWidth: 280, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={l.reason}>{l.reason}</td>
                    <td style={{ padding: '10px 8px' }}><Chip size="small" label={l.status} color={statusColor[l.status]} /></td>
                    <td style={{ padding: '10px 8px' }}>
                      {l.status === 'PENDING' ? (
                        <>
                          <Tooltip title="Approve"><IconButton size="small" color="success" onClick={() => setActioning({ id: l._id, status: 'APPROVED' })}><CheckIcon /></IconButton></Tooltip>
                          <Tooltip title="Reject"><IconButton size="small" color="error" onClick={() => setActioning({ id: l._id, status: 'REJECTED' })}><CloseIcon /></IconButton></Tooltip>
                        </>
                      ) : <Typography variant="caption" color="text.secondary">{l.remarks || '—'}</Typography>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        ) : <Empty title="No leave requests" />)}
      </CardContent></Card>

      <Dialog open={!!actioning} onClose={() => setActioning(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{actioning?.status === 'APPROVED' ? 'Approve' : 'Reject'} Leave</DialogTitle>
        <DialogContent>
          <TextField label="Remarks (optional)" fullWidth multiline rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setActioning(null)} disabled={submitting}>Cancel</Button>
          <Button variant="contained" disabled={submitting} color={actioning?.status === 'APPROVED' ? 'success' : 'error'} onClick={submit}>
            {submitting ? 'Saving…' : `Confirm ${actioning?.status === 'APPROVED' ? 'Approve' : 'Reject'}`}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
