import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, CardContent, Typography, Stack, Button, Dialog, DialogTitle, DialogContent, TextField, DialogActions, Chip, Box, MenuItem, FormControl, InputLabel, Select, OutlinedInput, Autocomplete
} from '@mui/material';
import PageHeader from '../../components/common/PageHeader';
import { employeeService, requestService } from '../../services';
import { ROLES, ROLE_LABELS } from '../../lib/constants';
import { Empty, Loading } from '../../components/common/States';
import { toast } from 'react-toastify';

export default function MyRequestsPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['my-requests'], queryFn: () => requestService.myRequests() });
  const { data: employeeData } = useQuery({
    queryKey: ['request-recipient-employees'],
    queryFn: () => employeeService.list({ page: 1, limit: 1000 }),
  });
  const items = data?.data || {};
  const employees = employeeData?.data || [];
  const sentItems = (items.sent || []).filter((item, index, arr) => arr.findIndex((x) => x._id === item._id) === index);
  const receivedItems = (items.received || []).filter((item, index, arr) => arr.findIndex((x) => x._id === item._id) === index);
  const uniqueReceivedItems = receivedItems.filter((item) => !sentItems.some((sentItem) => sentItem._id === item._id));

  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [toRoles, setToRoles] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [replyDialog, setReplyDialog] = useState(null);
  const [replyMessage, setReplyMessage] = useState('');

  const createMut = useMutation({
    mutationFn: (d) => requestService.create(d),
    onSuccess: () => {
      toast.success('Request submitted');
      setOpen(false); setSubject(''); setMessage(''); setToRoles([]); setSelectedEmployee('');
      qc.invalidateQueries({ queryKey: ['my-requests'] });
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Failed to submit request'),
  });

  const handleSubmit = () => {
    if (!subject.trim()) return toast.error('Please enter subject');
    if (!toRoles.length && !selectedEmployee) return toast.error('Select at least one recipient role or employee');
    createMut.mutate({
      subject: subject.trim(),
      message: message.trim(),
      toRoles,
      toEmployees: selectedEmployee ? [selectedEmployee] : [],
    });
  };

  const deleteMut = useMutation({
    mutationFn: (id) => requestService.remove(id),
    onSuccess: () => {
      toast.success('Request deleted');
      qc.invalidateQueries({ queryKey: ['my-requests'] });
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Failed to delete request'),
  });

  const replyMut = useMutation({
    mutationFn: ({ id, message }) => requestService.reply(id, { message }),
    onSuccess: () => {
      toast.success('Reply sent');
      setReplyDialog(null);
      setReplyMessage('');
      qc.invalidateQueries({ queryKey: ['my-requests'] });
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Failed to send reply'),
  });

  const handleReply = () => {
    if (!replyMessage.trim()) return toast.error('Please enter a reply message');
    if (!replyDialog) return;
    replyMut.mutate({ id: replyDialog._id, message: replyMessage.trim() });
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
        {sentItems.map((r) => (
          <Card key={r._id}>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={2}>
                <Box sx={{ flex: 1 }}>
                  <Typography fontWeight={800}>{r.subject}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>{r.message}</Typography>
                  {r.replyMessage && (
                    <Box sx={{ mt: 1, p: 1.5, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.04)' }}>
                      <Typography variant="caption" sx={{ display: 'block', mb: 0.5 }}>Reply</Typography>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{r.replyMessage}</Typography>
                    </Box>
                  )}
                  <Box sx={{ mt: 1 }}>
                    {r.toRoles?.map((tr) => <Chip key={tr} label={ROLE_LABELS[tr] || tr} size="small" sx={{ mr: 0.5 }} />)}
                  </Box>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography variant="caption">{new Date(r.createdAt).toLocaleString()}</Typography>
                  <Box>
                    <Chip label={r.status || 'PENDING'} size="small" color={r.status === 'PENDING' ? 'warning' : 'default'} sx={{ mt: 1 }} />
                  </Box>
                  <Button variant="text" color="error" size="small" sx={{ mt: 1 }} onClick={() => deleteMut.mutate(r._id)} disabled={deleteMut.isPending}>Delete</Button>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        ))}

        {uniqueReceivedItems.map((r) => (
          <Card key={r._id}>
            <CardContent>
              <Stack direction="row" alignItems="center" spacing={2}>
                <Box sx={{ flex: 1 }}>
                  <Typography fontWeight={800}>{r.subject}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>{r.message}</Typography>
                  {r.replyMessage && (
                    <Box sx={{ mt: 1, p: 1.5, borderRadius: 1, bgcolor: 'rgba(255,255,255,0.04)' }}>
                      <Typography variant="caption" sx={{ display: 'block', mb: 0.5 }}>Latest reply</Typography>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{r.replyMessage}</Typography>
                    </Box>
                  )}
                  <Box sx={{ mt: 1 }}>
                    {r.toRoles?.map((tr) => <Chip key={tr} label={ROLE_LABELS[tr] || tr} size="small" sx={{ mr: 0.5 }} />)}
                  </Box>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography variant="caption">{new Date(r.createdAt).toLocaleString()}</Typography>
                  <Box>
                    <Chip label={r.status || 'PENDING'} size="small" color={r.status === 'PENDING' ? 'warning' : 'default'} sx={{ mt: 1 }} />
                  </Box>
                  <Button variant="outlined" size="small" sx={{ mt: 1 }} onClick={() => { setReplyDialog(r); setReplyMessage(''); }}>Reply</Button>
                  <Button variant="text" color="error" size="small" sx={{ mt: 1, ml: 1 }} onClick={() => deleteMut.mutate(r._id)} disabled={deleteMut.isPending}>Delete</Button>
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

            <Autocomplete
              fullWidth
              options={employees}
              value={employees.find((employee) => employee._id === selectedEmployee) || null}
              onChange={(_, newValue) => setSelectedEmployee(newValue?._id || '')}
              getOptionLabel={(option) => (
                option && typeof option === 'object'
                  ? `${option.fullName}${option.employeeId ? ` (${option.employeeId})` : ''}`
                  : ''
              )}
              isOptionEqualToValue={(option, value) => option?._id === value?._id}
              noOptionsText="No employees found"
              renderInput={(params) => (
                <TextField {...params} label="Send to employee" placeholder="Select employee" />
              )}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={createMut.isPending}>{createMut.isPending ? 'Sending…' : 'Send'}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!replyDialog} onClose={() => setReplyDialog(null)} fullWidth maxWidth="sm">
        <DialogTitle>Reply to request</DialogTitle>
        <DialogContent>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>{replyDialog?.subject}</Typography>
          <TextField
            fullWidth
            multiline
            minRows={4}
            label="Your reply"
            value={replyMessage}
            onChange={(e) => setReplyMessage(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReplyDialog(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleReply} disabled={replyMut.isPending}>{replyMut.isPending ? 'Sending…' : 'Send reply'}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
