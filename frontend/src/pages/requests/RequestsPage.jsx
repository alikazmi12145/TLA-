import { useState } from 'react';
import {
  Card, CardContent, Button, Stack, Box, Typography, Chip, IconButton, Dialog, DialogTitle, DialogContent, TextField, DialogActions
} from '@mui/material';
import PageHeader from '../../components/common/PageHeader';
import { requestService } from '../../services';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import VisibilityIcon from '@mui/icons-material/Visibility';

export default function RequestsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['requests-list'], queryFn: () => requestService.list({ limit: 50 }) });
  const items = data?.data || [];

  const [selected, setSelected] = useState(null);
  const [remarks, setRemarks] = useState('');
  const approveMut = useMutation({ mutationFn: (args) => requestService.approve(args.id, { remarks: args.remarks }), onSuccess: () => { toast.success('Approved'); qc.invalidateQueries(['requests-list']); } });
  const rejectMut = useMutation({ mutationFn: (args) => requestService.reject(args.id, { remarks: args.remarks }), onSuccess: () => { toast.success('Rejected'); qc.invalidateQueries(['requests-list']); } });

  return (
    <>
      <PageHeader title="Requests" subtitle="Manage employee requests" />

      <Stack spacing={2}>
        {isLoading && <Typography>Loading…</Typography>}
        {!isLoading && !items.length && <Card><CardContent><Typography>No requests found</Typography></CardContent></Card>}

        {items.map((r) => (
          <Card key={r._id}>
            <CardContent>
              <Stack direction="row" spacing={2} alignItems="center">
                <Box sx={{ flex: 1 }}>
                  <Typography fontWeight={800}>{r.subject}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>{r.message}</Typography>
                  <Box sx={{ mt: 1 }}>
                    {r.toRoles?.map((tr) => <Chip key={tr} label={tr} size="small" sx={{ mr: 0.5 }} />)}
                  </Box>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography variant="caption">{new Date(r.createdAt).toLocaleString()}</Typography>
                  <Box>
                    <Chip label={r.status || 'PENDING'} size="small" color={r.status === 'PENDING' ? 'warning' : 'default'} sx={{ mt: 1 }} />
                  </Box>
                  <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                    <IconButton size="small" onClick={() => setSelected(r)}><VisibilityIcon /></IconButton>
                    <Button size="small" variant="contained" color="success" onClick={() => { setRemarks(''); approveMut.mutate({ id: r._id, remarks: '' }); }}>Approve</Button>
                    <Button size="small" variant="outlined" color="error" onClick={() => { setRemarks(''); rejectMut.mutate({ id: r._id, remarks: '' }); }}>Reject</Button>
                  </Stack>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>

      <Dialog open={!!selected} onClose={() => setSelected(null)} fullWidth>
        <DialogTitle>Request details</DialogTitle>
        <DialogContent>
          {selected && (
            <>
              <Typography variant="subtitle1" fontWeight={800}>{selected.subject}</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mt: 1 }}>{selected.message}</Typography>
              <TextField fullWidth multiline minRows={3} label="Remarks (optional)" value={remarks} onChange={(e) => setRemarks(e.target.value)} sx={{ mt: 2 }} />
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelected(null)}>Close</Button>
          <Button variant="outlined" color="error" onClick={() => { rejectMut.mutate({ id: selected._id, remarks }); setSelected(null); }}>Reject</Button>
          <Button variant="contained" color="success" onClick={() => { approveMut.mutate({ id: selected._id, remarks }); setSelected(null); }}>Approve</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
