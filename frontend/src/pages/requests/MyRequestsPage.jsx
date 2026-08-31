import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, CardContent, Typography, Stack, Button, Dialog, DialogTitle, DialogContent, TextField, DialogActions, Chip, Box, MenuItem, FormControl, InputLabel, Select, OutlinedInput
} from '@mui/material';
import PageHeader from '../../components/common/PageHeader';
import { requestService } from '../../services';
import { ROLES, ROLE_LABELS } from '../../lib/constants';
import { Empty, Loading } from '../../components/common/States';
import { toast } from 'react-toastify';

export default function MyRequestsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['my-requests'], queryFn: () => requestService.myRequests() });
  const items = data?.data || [];

  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [toRoles, setToRoles] = useState([]);

  const createMut = useMutation({
    mutationFn: (d) => requestService.create(d),
    onSuccess: () => {
      toast.success('Request submitted');
      setOpen(false); setSubject(''); setMessage(''); setToRoles([]);
      qc.invalidateQueries({ queryKey: ['my-requests'] });
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Failed to submit request'),
  });

  const handleSubmit = () => {
    if (!subject.trim()) return toast.error('Please enter subject');
    if (!toRoles.length) return toast.error('Select at least one recipient role');
    createMut.mutate({ subject: subject.trim(), message: message.trim(), toRoles });
  };

  return (
    <>
      <PageHeader title="My Requests" subtitle="Requests you have submitted and their status" />

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="h6">My Requests</Typography>
            <Button variant="contained" onClick={() => setOpen(true)}>New request</Button>
          </Stack>
        </CardContent>
      </Card>

      {isLoading && <Loading />}

      {!isLoading && !items.length && (
        <Card>
          <CardContent>
            <Empty title="No requests" subtitle="Submit a new request using the button above." />
          </CardContent>
        </Card>
      )}

      <Stack spacing={2}>
        {items.map((r) => (
          <Card key={r._id}>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={2}>
                <Box sx={{ flex: 1 }}>
                  <Typography fontWeight={800}>{r.subject}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>{r.message}</Typography>
                  <Box sx={{ mt: 1 }}>
                    {r.toRoles?.map((tr) => <Chip key={tr} label={ROLE_LABELS[tr] || tr} size="small" sx={{ mr: 0.5 }} />)}
                  </Box>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography variant="caption">{new Date(r.createdAt).toLocaleString()}</Typography>
                  <Box>
                    <Chip label={r.status || 'PENDING'} size="small" color={r.status === 'PENDING' ? 'warning' : 'default'} sx={{ mt: 1 }} />
                  </Box>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>New Request</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Subject" fullWidth value={subject} onChange={(e) => setSubject(e.target.value)} />
            <TextField label="Message" fullWidth multiline minRows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
            <FormControl fullWidth>
              <InputLabel id="to-roles-label">Send to roles</InputLabel>
              <Select
                labelId="to-roles-label"
                multiple
                value={toRoles}
                onChange={(e) => setToRoles(e.target.value)}
                input={<OutlinedInput label="Send to roles" />}
                renderValue={(selected) => (
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    {selected.map((s) => <Chip key={s} label={ROLE_LABELS[s] || s} />)}
                  </Box>
                )}
              >
                {Object.keys(ROLES).map((k) => (
                  <MenuItem key={k} value={ROLES[k]}>{ROLE_LABELS[ROLES[k]] || ROLES[k]}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={createMut.isPending}>{createMut.isPending ? 'Sending…' : 'Send'}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
