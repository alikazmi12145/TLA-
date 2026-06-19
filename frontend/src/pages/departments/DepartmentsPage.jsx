import { useState } from 'react';
import { Card, CardContent, Stack, TextField, Button, IconButton, Tooltip, Box, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';

import PageHeader from '../../components/common/PageHeader';
import { TableSkeleton, Empty } from '../../components/common/States';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import { departmentService } from '../../services';

export default function DepartmentsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const { data, isLoading } = useQuery({ queryKey: ['departments'], queryFn: departmentService.list });
  const { register, handleSubmit, reset } = useForm();

  const startEdit = (d) => { setEditing(d); reset(d); setOpen(true); };
  const startNew = () => { setEditing(null); reset({ name: '', code: '', description: '' }); setOpen(true); };

  const onSubmit = async (values) => {
    try {
      if (editing) await departmentService.update(editing._id, values);
      else await departmentService.create(values);
      toast.success('Saved'); qc.invalidateQueries({ queryKey: ['departments'] }); setOpen(false);
    } catch {}
  };
  const onDelete = async () => {
    try { await departmentService.remove(confirm._id); toast.success('Deleted'); qc.invalidateQueries({ queryKey: ['departments'] }); }
    catch {} finally { setConfirm(null); }
  };

  return (
    <>
      <PageHeader title="Departments" actions={<Button startIcon={<AddIcon />} variant="contained" onClick={startNew}>Add department</Button>} />
      <Card><CardContent>
        {isLoading ? <TableSkeleton /> : (data?.data?.length ? (
          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left' }}>{['Name', 'Code', 'Description', 'Actions'].map((h) => (
                <th key={h} style={{ padding: '10px 8px', fontSize: 12, opacity: 0.7, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>{h}</th>
              ))}</tr></thead>
              <tbody>
                {data.data.map((d) => (
                  <tr key={d._id} style={{ borderBottom: '1px dashed rgba(0,0,0,0.08)' }}>
                    <td style={{ padding: '10px 8px', fontWeight: 600 }}>{d.name}</td>
                    <td style={{ padding: '10px 8px' }}>{d.code || '—'}</td>
                    <td style={{ padding: '10px 8px' }}>{d.description || '—'}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <Tooltip title="Edit"><IconButton size="small" onClick={() => startEdit(d)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => setConfirm(d)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        ) : <Empty title="No departments" />)}
      </CardContent></Card>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Edit Department' : 'Add Department'}</DialogTitle>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField label="Name" required fullWidth {...register('name', { required: true })} />
              <TextField label="Code" fullWidth {...register('code')} />
              <TextField label="Description" multiline rows={2} fullWidth {...register('description')} />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained">Save</Button>
          </DialogActions>
        </form>
      </Dialog>

      <ConfirmDialog open={!!confirm} title="Delete department" message={`Delete "${confirm?.name}"?`} onClose={() => setConfirm(null)} onConfirm={onDelete} confirmText="Delete" danger />
    </>
  );
}
