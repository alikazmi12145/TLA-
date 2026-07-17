import { useState } from 'react';
import {
  Card, CardContent, Stack, TextField, Button, MenuItem, Box, Chip, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, Typography, Grid,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import VisibilityIcon from '@mui/icons-material/Visibility';
import dayjs from 'dayjs';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'react-toastify';

import PageHeader from '../../components/common/PageHeader';
import { TableSkeleton, Empty } from '../../components/common/States';
import { accessoryService } from '../../services';
import { statusColor } from './constants';
import { RequestDetailsDialog } from './AccessoryRequestsPage';

export default function MyAccessoryRequestsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['my-accessory-requests'],
    queryFn: () => accessoryService.myRequests(),
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const items = data?.data || [];

  const { data: catalog } = useQuery({
    queryKey: ['accessories-available'],
    queryFn: () => accessoryService.available(),
    enabled: open,
    staleTime: 30_000,
  });
  const available = catalog?.data || [];

  const { register, handleSubmit, reset, watch, setValue, formState: { isSubmitting, errors } } = useForm({
    defaultValues: { accessory: '', quantity: 1, note: '' },
  });
  const selectedId = watch('accessory');
  const selected = available.find((a) => a._id === selectedId);
  const maxQty = selected?.availableQuantity || 0;

  const createMut = useMutation({
    mutationFn: (payload) => accessoryService.requestCreate(payload),
    onSuccess: () => {
      toast.success('Request submitted');
      qc.invalidateQueries({ queryKey: ['my-accessory-requests'] });
      qc.invalidateQueries({ queryKey: ['accessories-available'] });
      setOpen(false); reset();
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Submit failed'),
  });

  const onSubmit = (values) => {
    const qty = Number(values.quantity);
    if (!values.accessory) return toast.error('Select an accessory');
    if (!Number.isFinite(qty) || qty < 1) return toast.error('Quantity must be at least 1');
    if (selected && qty > selected.availableQuantity) return toast.error(`Only ${selected.availableQuantity} available`);
    createMut.mutate({ accessory: values.accessory, quantity: qty, note: values.note });
  };

  return (
    <>
      <PageHeader
        title="My Accessory Requests"
        subtitle="Request office accessories and track their status"
        actions={
          <Stack direction="row" spacing={1}>
            <Tooltip title="Refresh">
              <span>
                <IconButton onClick={() => refetch()} disabled={isFetching}>
                  <RefreshIcon sx={isFetching ? { animation: 'spin 1s linear infinite' } : {}} />
                </IconButton>
              </span>
            </Tooltip>
            <Button startIcon={<AddIcon />} variant="contained" onClick={() => setOpen(true)}>New request</Button>
          </Stack>
        }
      />

      <Card><CardContent>
        {isLoading ? <TableSkeleton /> : (items.length ? (
          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left' }}>
                {['Accessory', 'Qty', 'Requested', 'Status', 'Remarks', ''].map((h) => (
                  <th key={h} style={{ padding: '10px 8px', fontSize: 12, opacity: 0.7, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r._id} style={{ borderBottom: '1px dashed rgba(0,0,0,0.08)' }}>
                    <td style={{ padding: '10px 8px' }}>
                      <div style={{ fontWeight: 600 }}>{r.accessory?.name}</div>
                      <div style={{ fontSize: 11, opacity: 0.7 }}>{r.accessory?.code}</div>
                    </td>
                    <td style={{ padding: '10px 8px' }}>{r.quantity}</td>
                    <td style={{ padding: '10px 8px', fontSize: 12 }}>{dayjs(r.requestedAt || r.createdAt).format('MMM D, YYYY HH:mm')}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <Chip size="small" label={r.status} color={statusColor[r.status]} />
                    </td>
                    <td style={{ padding: '10px 8px', fontSize: 12, opacity: 0.8, maxWidth: 280, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.remarks || ''}>
                      {r.remarks || '—'}
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      <Tooltip title="Details"><IconButton size="small" onClick={() => setDetail(r)}><VisibilityIcon fontSize="small" /></IconButton></Tooltip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        ) : <Empty title="No requests yet" subtitle="Click ‘New request’ to request an accessory." />)}
      </CardContent></Card>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Request an accessory</DialogTitle>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField select label="Accessory" required fullWidth value={selectedId}
                onChange={(e) => { setValue('accessory', e.target.value); setValue('quantity', 1); }}
                error={!!errors.accessory}>
                {available.length === 0 && <MenuItem value="" disabled>No accessories available</MenuItem>}
                {available.map((a) => (
                  <MenuItem key={a._id} value={a._id}>
                    {a.name} ({a.code}) — {a.availableQuantity} available
                  </MenuItem>
                ))}
              </TextField>
              <TextField label="Quantity" type="number" required fullWidth
                inputProps={{ min: 1, max: maxQty || undefined, step: 1 }}
                {...register('quantity', { required: true, min: 1 })}
                helperText={selected ? `Max ${selected.availableQuantity} available` : ''}
              />
              <TextField label="Note / reason" multiline rows={3} fullWidth {...register('note')} />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setOpen(false)} disabled={isSubmitting}>Cancel</Button>
            <Button variant="contained" type="submit" disabled={isSubmitting || createMut.isPending}>
              {isSubmitting || createMut.isPending ? 'Submitting…' : 'Submit'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <RequestDetailsDialog open={!!detail} request={detail} onClose={() => setDetail(null)} />
    </>
  );
}
