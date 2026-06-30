import { useState } from 'react';
import { Card, CardContent, Stack, TextField, Button, IconButton, Tooltip, Box, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
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
import { holidayService } from '../../services';

export default function HolidaysPage() {
  const { canAccess } = useSettingsPermissions();
  const canManage = canAccess('holidays', 'manage');
  const qc = useQueryClient();
  const [year, setYear] = useState(dayjs().year());
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const { data, isLoading } = useQuery({ queryKey: ['holidays', year], queryFn: () => holidayService.list({ year }) });
  const { register, handleSubmit, reset } = useForm();

  const startEdit = (h) => {
    setEditing(h);
    reset({ title: h.title, date: h.date.substring(0, 10), description: h.description || '' });
    setOpen(true);
  };
  const startNew = () => {
    setEditing(null);
    reset({ title: '', date: '', description: '' });
    setOpen(true);
  };

  const onSubmit = async (values) => {
    try {
      if (editing) await holidayService.update(editing._id, values);
      else await holidayService.create(values);
      toast.success('Saved');
      qc.invalidateQueries({ queryKey: ['holidays'] });
      setOpen(false);
    } catch {}
  };

  const onDelete = async () => {
    try { await holidayService.remove(confirm._id); toast.success('Deleted'); qc.invalidateQueries({ queryKey: ['holidays'] }); }
    catch {} finally { setConfirm(null); }
  };

  return (
    <>
      <PageHeader title="Holidays" subtitle={canManage ? 'Manage public holidays and closures' : 'View the holiday calendar'} actions={canManage ? <Button startIcon={<AddIcon />} variant="contained" onClick={startNew}>Add holiday</Button> : null} />
      <Card sx={{ mb: 2 }}><CardContent>
        <TextField type="number" label="Year" size="small" value={year} onChange={(e) => setYear(Number(e.target.value))} />
      </CardContent></Card>
      <Card><CardContent>
        {isLoading ? <TableSkeleton /> : (data?.data?.length ? (
          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left' }}>
                {['Title', 'Date', 'Description', ...(canManage ? ['Actions'] : [])].map((h) => (
                  <th key={h} style={{ padding: '10px 8px', fontSize: 12, opacity: 0.7, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {data.data.map((h) => (
                  <tr key={h._id} style={{ borderBottom: '1px dashed rgba(0,0,0,0.08)' }}>
                    <td style={{ padding: '10px 8px', fontWeight: 600 }}>{h.title}</td>
                    <td style={{ padding: '10px 8px' }}>{dayjs(h.date).format('ddd, MMM D, YYYY')}</td>
                    <td style={{ padding: '10px 8px' }}>{h.description || '—'}</td>
                    {canManage && (
                      <td style={{ padding: '10px 8px' }}>
                        <Tooltip title="Edit"><IconButton size="small" onClick={() => startEdit(h)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => setConfirm(h)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        ) : <Empty title="No holidays for this year" />)}
      </CardContent></Card>

      <Dialog open={open && canManage} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Holiday' : 'Add Holiday'}</DialogTitle>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField label="Title" required fullWidth {...register('title', { required: true })} />
              <TextField type="date" label="Date" InputLabelProps={{ shrink: true }} required fullWidth {...register('date', { required: true })} />
              <TextField label="Description" multiline rows={2} fullWidth {...register('description')} />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained">Save</Button>
          </DialogActions>
        </form>
      </Dialog>

      <ConfirmDialog open={!!confirm && canManage} title="Delete holiday" message={`Delete "${confirm?.title}"?`} onClose={() => setConfirm(null)} onConfirm={onDelete} confirmText="Delete" danger />
    </>
  );
}
