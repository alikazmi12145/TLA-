import { useState } from 'react';
import { Card, CardContent, Stack, TextField, Button, MenuItem, Grid, Chip, Box, Dialog, DialogTitle, DialogContent, DialogActions, IconButton, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import dayjs from 'dayjs';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSelector } from 'react-redux';
import { toast } from 'react-toastify';

import PageHeader from '../../components/common/PageHeader';
import { TableSkeleton, Empty } from '../../components/common/States';
import { leaveService } from '../../services';
import { LEAVE_TYPES } from '../../lib/constants';

const statusColor = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'error' };

export default function MyLeavesPage() {
  const qc = useQueryClient();
  const me = useSelector((s) => s.auth.user);
  const [open, setOpen] = useState(false);
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['my-leaves', me?._id],
    queryFn: leaveService.mine,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
  const { data: balance } = useQuery({
    queryKey: ['my-balance', me?._id],
    queryFn: leaveService.myBalance,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const items = data?.data || [];

  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm();
  const onSubmit = async (values) => {
    await leaveService.apply(values);
    toast.success('Leave applied');
    qc.invalidateQueries({ queryKey: ['my-leaves'] });
    qc.invalidateQueries({ queryKey: ['my-balance'] });
    setOpen(false);
    reset();
  };

  const handleRefresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['my-leaves'] }),
      qc.invalidateQueries({ queryKey: ['my-balance'] }),
    ]);
    refetch();
    toast.info('Refreshed');
  };

  return (
    <>
      <PageHeader
        title="My Leaves"
        subtitle={me ? `Showing leaves for ${me.fullName} (${me.employeeId || me.email})` : ''}
        actions={
          <Stack direction="row" spacing={1}>
            <Tooltip title="Refresh">
              <span>
                <IconButton onClick={handleRefresh} disabled={isFetching}>
                  <RefreshIcon sx={isFetching ? { animation: 'spin 1s linear infinite' } : {}} />
                </IconButton>
              </span>
            </Tooltip>
            <Button startIcon={<AddIcon />} variant="contained" onClick={() => setOpen(true)}>Apply for leave</Button>
          </Stack>
        }
      />

      <Grid container spacing={2} sx={{ mb: 2 }}>
        {(balance?.data || []).map((b) => (
          <Grid item xs={12} sm={6} md={3} key={b.type}>
            <Card><CardContent>
              <Box sx={{ fontSize: 12, opacity: 0.7 }}>{b.type}</Box>
              <Box sx={{ fontSize: 24, fontWeight: 800 }}>{b.remaining}<span style={{ fontSize: 12, opacity: 0.6 }}> / {b.allotment}</span></Box>
              <Box sx={{ fontSize: 11, opacity: 0.6 }}>Used: {b.used}</Box>
            </CardContent></Card>
          </Grid>
        ))}
      </Grid>

      <Card><CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="subtitle2" sx={{ opacity: 0.75 }}>
            {items.length} leave{items.length === 1 ? '' : 's'} on file
          </Typography>
          {isFetching && <Typography variant="caption" sx={{ opacity: 0.6 }}>Refreshing…</Typography>}
        </Stack>
        {isLoading ? <TableSkeleton /> : (items.length ? (
          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left' }}>
                {['Type', 'From', 'To', 'Days', 'Reason', 'Status', 'Remarks', 'Actioned'].map((h) => (
                  <th key={h} style={{ padding: '10px 8px', fontSize: 12, opacity: 0.7, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {items.map((l) => (
                  <tr key={l._id} style={{ borderBottom: '1px dashed rgba(0,0,0,0.08)' }}>
                    <td style={{ padding: '10px 8px' }}>{l.type}</td>
                    <td style={{ padding: '10px 8px' }}>{dayjs(l.fromDate).format('MMM D, YYYY')}</td>
                    <td style={{ padding: '10px 8px' }}>{dayjs(l.toDate).format('MMM D, YYYY')}</td>
                    <td style={{ padding: '10px 8px' }}>{l.days}</td>
                    <td style={{ padding: '10px 8px' }}>{l.reason}</td>
                    <td style={{ padding: '10px 8px' }}><Chip size="small" label={l.status} color={statusColor[l.status]} /></td>
                    <td style={{ padding: '10px 8px' }}>{l.remarks || '—'}</td>
                    <td style={{ padding: '10px 8px', fontSize: 12, opacity: 0.7 }}>
                      {l.actionedAt ? dayjs(l.actionedAt).format('MMM D, HH:mm') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        ) : <Empty title="No leaves yet" subtitle="Click ‘Apply for leave’ to submit your first request." />)}
      </CardContent></Card>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Apply for leave</DialogTitle>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField select label="Type" required fullWidth defaultValue="" {...register('type', { required: true })}>
                {LEAVE_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </TextField>
              <TextField type="date" label="From" InputLabelProps={{ shrink: true }} required fullWidth {...register('fromDate', { required: true })} />
              <TextField type="date" label="To" InputLabelProps={{ shrink: true }} required fullWidth {...register('toDate', { required: true })} />
              <TextField label="Reason" multiline rows={3} required fullWidth {...register('reason', { required: true })} />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="contained" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Applying…' : 'Apply'}</Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  );
}
