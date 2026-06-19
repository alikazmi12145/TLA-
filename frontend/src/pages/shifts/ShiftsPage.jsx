import { useState } from 'react';
import { Card, CardContent, Stack, TextField, Button, IconButton, Tooltip, Box, Dialog, DialogTitle, DialogContent, DialogActions, MenuItem } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';

import PageHeader from '../../components/common/PageHeader';
import { TableSkeleton, Empty } from '../../components/common/States';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import { shiftService } from '../../services';

export default function ShiftsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const { data, isLoading } = useQuery({ queryKey: ['shifts'], queryFn: shiftService.list });
  const { register, handleSubmit, reset } = useForm();

  const startEdit = (s) => { setEditing(s); reset(s); setOpen(true); };
  const startNew = () => { setEditing(null); reset({ name: '', startTime: '09:00', endTime: '18:00', graceMinutes: 10, type: 'CUSTOM' }); setOpen(true); };

  const onSubmit = async (values) => {
    try {
      if (editing) await shiftService.update(editing._id, values);
      else await shiftService.create(values);
      toast.success('Saved'); qc.invalidateQueries({ queryKey: ['shifts'] }); setOpen(false);
    } catch {}
  };
  const onDelete = async () => {
    try { await shiftService.remove(confirm._id); toast.success('Deleted'); qc.invalidateQueries({ queryKey: ['shifts'] }); }
    catch {} finally { setConfirm(null); }
  };

  return (
    <>
      <PageHeader title="Shifts" actions={<Button startIcon={<AddIcon />} variant="contained" onClick={startNew}>Add shift</Button>} />
      <Card><CardContent>
        {isLoading ? <TableSkeleton /> : (data?.data?.length ? (
          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left' }}>
                {['Name', 'Type', 'Start', 'End', 'Grace (m)', 'Actions'].map((h) => (
                  <th key={h} style={{ padding: '10px 8px', fontSize: 12, opacity: 0.7, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {data.data.map((s) => (
                  <tr key={s._id} style={{ borderBottom: '1px dashed rgba(0,0,0,0.08)' }}>
                    <td style={{ padding: '10px 8px', fontWeight: 600 }}>{s.name}</td>
                    <td style={{ padding: '10px 8px' }}>{s.type}</td>
                    <td style={{ padding: '10px 8px' }}>{s.startTime}</td>
                    <td style={{ padding: '10px 8px' }}>{s.endTime}</td>
                    <td style={{ padding: '10px 8px' }}>{s.graceMinutes}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <Tooltip title="Edit"><IconButton size="small" onClick={() => startEdit(s)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => setConfirm(s)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        ) : <Empty title="No shifts" />)}
      </CardContent></Card>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Shift' : 'Add Shift'}</DialogTitle>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField label="Name" required fullWidth {...register('name', { required: true })} />
              <TextField select label="Type" defaultValue="CUSTOM" fullWidth {...register('type')}>
                {['MORNING', 'EVENING', 'NIGHT', 'CUSTOM'].map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </TextField>
              <Stack direction="row" spacing={2}>
                <TextField type="time" label="Start time" InputLabelProps={{ shrink: true }} required fullWidth {...register('startTime', { required: true })} />
                <TextField type="time" label="End time" InputLabelProps={{ shrink: true }} required fullWidth {...register('endTime', { required: true })} />
              </Stack>
              <TextField type="number" label="Grace minutes" fullWidth {...register('graceMinutes', { valueAsNumber: true })} />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained">Save</Button>
          </DialogActions>
        </form>
      </Dialog>

      <ConfirmDialog open={!!confirm} title="Delete shift" message={`Delete "${confirm?.name}"?`} onClose={() => setConfirm(null)} onConfirm={onDelete} confirmText="Delete" danger />
    </>
  );
}
