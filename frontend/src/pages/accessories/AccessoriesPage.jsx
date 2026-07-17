import { useMemo, useState } from 'react';
import {
  Card, CardContent, Stack, TextField, Button, MenuItem, IconButton, Tooltip,
  Box, Dialog, DialogTitle, DialogContent, DialogActions, Chip, Typography,
  FormControlLabel, Switch, TablePagination,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';

import PageHeader from '../../components/common/PageHeader';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import { TableSkeleton, Empty } from '../../components/common/States';
import { accessoryService } from '../../services';

const emptyValues = { name: '', code: '', category: '', totalQuantity: 0, description: '', isActive: true };

export default function AccessoriesPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ q: '', status: '', category: '' });
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(25);
  const [editing, setEditing] = useState(null); // null | 'new' | accessory
  const [toDelete, setToDelete] = useState(null);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['accessories', filters, page, limit],
    queryFn: () => accessoryService.list({ ...filters, page: page + 1, limit }),
    keepPreviousData: true,
  });

  const items = data?.data || [];
  const total = data?.meta?.total ?? items.length;

  const categories = useMemo(() => {
    const set = new Set(items.map((i) => i.category).filter(Boolean));
    return Array.from(set);
  }, [items]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['accessories'] });

  const removeMut = useMutation({
    mutationFn: (id) => accessoryService.remove(id),
    onSuccess: () => { toast.success('Accessory deleted'); invalidate(); setToDelete(null); },
    onError: (e) => toast.error(e?.response?.data?.message || 'Delete failed'),
  });

  return (
    <>
      <PageHeader
        title="Accessories"
        subtitle="Manage office accessories catalog and inventory"
        actions={
          <Stack direction="row" spacing={1}>
            <Tooltip title="Refresh">
              <span>
                <IconButton onClick={() => refetch()} disabled={isFetching}>
                  <RefreshIcon sx={isFetching ? { animation: 'spin 1s linear infinite' } : {}} />
                </IconButton>
              </span>
            </Tooltip>
            <Button startIcon={<AddIcon />} variant="contained" onClick={() => setEditing('new')}>Add accessory</Button>
          </Stack>
        }
      />

      <Card sx={{ mb: 2 }}><CardContent>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
          <TextField size="small" label="Search" sx={{ minWidth: 220 }} value={filters.q}
            onChange={(e) => { setPage(0); setFilters({ ...filters, q: e.target.value }); }} />
          <TextField select size="small" label="Category" sx={{ minWidth: 180 }} value={filters.category}
            onChange={(e) => { setPage(0); setFilters({ ...filters, category: e.target.value }); }}>
            <MenuItem value="">All</MenuItem>
            {categories.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Status" sx={{ minWidth: 180 }} value={filters.status}
            onChange={(e) => { setPage(0); setFilters({ ...filters, status: e.target.value }); }}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="inactive">Inactive</MenuItem>
          </TextField>
        </Stack>
      </CardContent></Card>

      <Card><CardContent>
        {isLoading ? <TableSkeleton /> : (items.length ? (
          <>
          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left' }}>
                {['Code', 'Name', 'Category', 'Available', 'Total', 'Status', 'Actions'].map((h) => (
                  <th key={h} style={{ padding: '10px 8px', fontSize: 12, opacity: 0.7, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a._id} style={{ borderBottom: '1px dashed rgba(0,0,0,0.08)' }}>
                    <td style={{ padding: '10px 8px', fontWeight: 700 }}>{a.code}</td>
                    <td style={{ padding: '10px 8px' }}>{a.name}</td>
                    <td style={{ padding: '10px 8px' }}>{a.category || '—'}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <Chip size="small" label={a.availableQuantity}
                        color={a.availableQuantity === 0 ? 'error' : a.availableQuantity < 5 ? 'warning' : 'success'} />
                    </td>
                    <td style={{ padding: '10px 8px' }}>{a.totalQuantity}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <Chip size="small" label={a.isActive ? 'Active' : 'Inactive'} color={a.isActive ? 'success' : 'default'} />
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      <Tooltip title="Edit"><IconButton size="small" onClick={() => setEditing(a)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => setToDelete(a)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
          <TablePagination
            component="div"
            count={total}
            page={page}
            onPageChange={(_e, p) => setPage(p)}
            rowsPerPage={limit}
            onRowsPerPageChange={(e) => { setLimit(Number(e.target.value)); setPage(0); }}
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
          </>
        ) : <Empty title="No accessories yet" subtitle="Click ‘Add accessory’ to create your first item." />)}
      </CardContent></Card>

      <AccessoryFormDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        initial={editing === 'new' ? null : editing}
        onSaved={() => { setEditing(null); invalidate(); }}
      />

      <ConfirmDialog
        open={!!toDelete}
        title="Delete accessory?"
        message={`This will remove “${toDelete?.name}” from the catalog. This cannot be undone.`}
        onClose={() => setToDelete(null)}
        onConfirm={() => removeMut.mutate(toDelete._id)}
        confirmText={removeMut.isPending ? 'Deleting…' : 'Delete'}
        danger
      />
    </>
  );
}

function AccessoryFormDialog({ open, initial, onClose, onSaved }) {
  const isEdit = !!initial;
  const { register, handleSubmit, reset, formState: { isSubmitting, errors } } = useForm({
    values: isEdit
      ? {
          name: initial.name || '',
          code: initial.code || '',
          category: initial.category || '',
          totalQuantity: initial.totalQuantity ?? 0,
          description: initial.description || '',
          isActive: !!initial.isActive,
        }
      : emptyValues,
  });

  const onSubmit = async (values) => {
    try {
      const payload = {
        ...values,
        totalQuantity: Number(values.totalQuantity),
        code: String(values.code).trim().toUpperCase(),
      };
      if (isEdit) await accessoryService.update(initial._id, payload);
      else await accessoryService.create(payload);
      toast.success(isEdit ? 'Accessory updated' : 'Accessory created');
      reset(emptyValues);
      onSaved?.();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Save failed');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? 'Edit accessory' : 'Add accessory'}</DialogTitle>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Name" required fullWidth error={!!errors.name}
              {...register('name', { required: 'Required' })} helperText={errors.name?.message} />
            <TextField label="Code" required fullWidth error={!!errors.code}
              {...register('code', { required: 'Required' })} helperText={errors.code?.message || 'Unique — auto uppercased'} />
            <TextField label="Category" fullWidth {...register('category')} />
            <TextField label="Total quantity" type="number" required fullWidth inputProps={{ min: 0, step: 1 }}
              error={!!errors.totalQuantity}
              {...register('totalQuantity', { required: 'Required', min: { value: 0, message: 'Must be >= 0' } })}
              helperText={errors.totalQuantity?.message || (isEdit ? 'Changing total adjusts available quantity by the same delta.' : '')}
            />
            <TextField label="Description" multiline rows={3} fullWidth {...register('description')} />
            <FormControlLabel control={<Switch defaultChecked={isEdit ? !!initial.isActive : true} {...register('isActive')} />} label="Active" />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button variant="contained" type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : (isEdit ? 'Save' : 'Create')}</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
