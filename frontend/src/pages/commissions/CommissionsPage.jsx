import { useState } from 'react';
import { Card, CardContent, Stack, TextField, Button, MenuItem, IconButton, Tooltip, Box, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import dayjs from 'dayjs';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';

import PageHeader from '../../components/common/PageHeader';
import { TableSkeleton, Empty } from '../../components/common/States';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import useSettingsPermissions from '../../hooks/useSettingsPermissions';
import { commissionService, employeeService } from '../../services';
import { formatCurrency } from '../../lib/format';

export default function CommissionsPage() {
  const { canAccess } = useSettingsPermissions();
  const canManage = canAccess('commissions', 'manage');
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const { data, isLoading } = useQuery({ queryKey: ['commissions'], queryFn: () => commissionService.list({}) });
  const { data: emps } = useQuery({ queryKey: ['emps-all'], queryFn: () => employeeService.list({ limit: 100 }) });
  const { register, handleSubmit, reset } = useForm();

  const startNew = () => {
    setEditing(null);
    reset({ employee: '', period: 'MONTHLY', periodStart: dayjs().startOf('month').format('YYYY-MM-DD'), periodEnd: dayjs().endOf('month').format('YYYY-MM-DD'), achievedSales: 0, commissionRate: 5 });
    setOpen(true);
  };
  const startEdit = (c) => {
    setEditing(c);
    reset({
      employee: c.employee?._id || c.employee,
      period: c.period,
      periodStart: c.periodStart?.substring(0, 10),
      periodEnd: c.periodEnd?.substring(0, 10),
      achievedSales: c.achievedSales,
      commissionRate: c.commissionRate,
      note: c.note || '',
    });
    setOpen(true);
  };

  const onSubmit = async (values) => {
    try {
      if (editing) await commissionService.update(editing._id, values);
      else await commissionService.create(values);
      toast.success('Saved'); qc.invalidateQueries({ queryKey: ['commissions'] }); setOpen(false);
    } catch {}
  };
  const onDelete = async () => {
    try { await commissionService.remove(confirm._id); toast.success('Deleted'); qc.invalidateQueries({ queryKey: ['commissions'] }); }
    catch {} finally { setConfirm(null); }
  };

  return (
    <>
      <PageHeader title="Commissions" subtitle={canManage ? 'Manage commission records and payouts' : 'View commission records'} actions={canManage ? <Button startIcon={<AddIcon />} variant="contained" onClick={startNew}>Record commission</Button> : null} />
      <Card><CardContent>
        {isLoading ? <TableSkeleton /> : (data?.data?.length ? (
          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left' }}>{['Employee', 'Period', 'From', 'To', 'Sales', 'Rate %', 'Amount', ...(canManage ? ['Actions'] : [])].map((h) => (
                <th key={h} style={{ padding: '10px 8px', fontSize: 12, opacity: 0.7, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>{h}</th>
              ))}</tr></thead>
              <tbody>
                {data.data.map((c) => (
                  <tr key={c._id} style={{ borderBottom: '1px dashed rgba(0,0,0,0.08)' }}>
                    <td style={{ padding: '10px 8px' }}>{c.employee?.fullName}</td>
                    <td style={{ padding: '10px 8px' }}>{c.period}</td>
                    <td style={{ padding: '10px 8px' }}>{dayjs(c.periodStart).format('MMM D')}</td>
                    <td style={{ padding: '10px 8px' }}>{dayjs(c.periodEnd).format('MMM D')}</td>
                    <td style={{ padding: '10px 8px' }}>{formatCurrency(c.achievedSales)}</td>
                    <td style={{ padding: '10px 8px' }}>{c.commissionRate}%</td>
                    <td style={{ padding: '10px 8px', fontWeight: 700, color: '#1aab50' }}>{formatCurrency(c.commissionAmount)}</td>
                    {canManage && (
                      <td style={{ padding: '10px 8px' }}>
                        <Tooltip title="Edit"><IconButton size="small" onClick={() => startEdit(c)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => setConfirm(c)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        ) : <Empty title="No commission records" />)}
      </CardContent></Card>

      <Dialog open={open && canManage} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Commission' : 'Record Commission'}</DialogTitle>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField select label="Employee" required fullWidth defaultValue="" {...register('employee', { required: true })}>
                {(emps?.data || []).map((e) => <MenuItem key={e._id} value={e._id}>{e.fullName}</MenuItem>)}
              </TextField>
              <TextField select label="Period" required fullWidth defaultValue="MONTHLY" {...register('period', { required: true })}>
                {['DAILY', 'WEEKLY', 'MONTHLY'].map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
              </TextField>
              <Stack direction="row" spacing={2}>
                <TextField type="date" label="From" InputLabelProps={{ shrink: true }} required fullWidth {...register('periodStart', { required: true })} />
                <TextField type="date" label="To" InputLabelProps={{ shrink: true }} required fullWidth {...register('periodEnd', { required: true })} />
              </Stack>
              <Stack direction="row" spacing={2}>
                <TextField type="number" label="Achieved sales" required fullWidth {...register('achievedSales', { valueAsNumber: true })} />
                <TextField type="number" label="Rate %" required fullWidth {...register('commissionRate', { valueAsNumber: true })} />
              </Stack>
              <TextField label="Note" fullWidth {...register('note')} />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained">Save</Button>
          </DialogActions>
        </form>
      </Dialog>

      <ConfirmDialog open={!!confirm && canManage} title="Delete commission" message="Are you sure?" onClose={() => setConfirm(null)} onConfirm={onDelete} confirmText="Delete" danger />
    </>
  );
}
