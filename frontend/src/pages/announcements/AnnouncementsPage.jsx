import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import {
  Card, CardContent, Grid, Stack, Typography, Button, IconButton, Chip, Box,
  Table, TableHead, TableRow, TableCell, TableBody, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, MenuItem, Checkbox, ListItemText,
  Select, InputLabel, FormControl, OutlinedInput, Tooltip, Divider,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import CampaignIcon from '@mui/icons-material/Campaign';
import dayjs from 'dayjs';

import PageHeader from '../../components/common/PageHeader';
import { announcementService, departmentService } from '../../services';
import { ROLES } from '../../lib/constants';

const PRIORITIES = ['INFO', 'SUCCESS', 'WARNING', 'URGENT'];
const AUDIENCE_TYPES = [
  { value: 'ALL', label: 'All employees' },
  { value: 'ROLES', label: 'Specific roles' },
  { value: 'DEPARTMENTS', label: 'Specific departments' },
];
const PRIORITY_COLOR = { INFO: 'info', SUCCESS: 'success', WARNING: 'warning', URGENT: 'error' };

const emptyForm = {
  title: '',
  message: '',
  priority: 'INFO',
  audience: 'ALL',
  roles: [],
  departments: [],
  publishAt: '',
  expiresAt: '',
  pinned: false,
  active: true,
};

const toDateTimeInput = (d) => (d ? dayjs(d).format('YYYY-MM-DDTHH:mm') : '');

export default function AnnouncementsPage() {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState({ open: false, form: { ...emptyForm }, editingId: null });

  const { data, isLoading } = useQuery({
    queryKey: ['announcements-admin'],
    queryFn: () => announcementService.list({ limit: 100 }),
  });
  const { data: deps } = useQuery({ queryKey: ['departments'], queryFn: departmentService.list });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['announcements-admin'] });
    qc.invalidateQueries({ queryKey: ['announcements-feed'] });
  };

  const saveMut = useMutation({
    mutationFn: (payload) => (payload._id
      ? announcementService.update(payload._id, payload)
      : announcementService.create(payload)),
    onSuccess: () => {
      toast.success('Announcement saved');
      setDialog({ open: false, form: { ...emptyForm }, editingId: null });
      invalidate();
    },
    onError: (e) => toast.error(e?.response?.data?.message || 'Save failed'),
  });

  const removeMut = useMutation({
    mutationFn: (id) => announcementService.remove(id),
    onSuccess: () => { toast.success('Announcement deleted'); invalidate(); },
    onError: (e) => toast.error(e?.response?.data?.message || 'Delete failed'),
  });

  const pinMut = useMutation({
    mutationFn: (id) => announcementService.togglePin(id),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e?.response?.data?.message || 'Update failed'),
  });

  const activeMut = useMutation({
    mutationFn: (id) => announcementService.toggleActive(id),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e?.response?.data?.message || 'Update failed'),
  });

  const openNew = () => setDialog({ open: true, editingId: null, form: { ...emptyForm } });
  const openEdit = (row) => setDialog({
    open: true,
    editingId: row._id,
    form: {
      title: row.title || '',
      message: row.message || '',
      priority: row.priority || 'INFO',
      audience: row.audience || 'ALL',
      roles: row.roles || [],
      departments: (row.departments || []).map((d) => d?._id || d),
      publishAt: toDateTimeInput(row.publishAt),
      expiresAt: toDateTimeInput(row.expiresAt),
      pinned: !!row.pinned,
      active: row.active !== false,
    },
  });
  const closeDialog = () => setDialog((s) => ({ ...s, open: false }));

  const submit = () => {
    const f = dialog.form;
    if (!f.title.trim() || !f.message.trim()) {
      toast.warn('Title and message are required');
      return;
    }
    const payload = {
      _id: dialog.editingId || undefined,
      title: f.title.trim(),
      message: f.message.trim(),
      priority: f.priority,
      audience: f.audience,
      roles: f.audience === 'ROLES' ? f.roles : [],
      departments: f.audience === 'DEPARTMENTS' ? f.departments : [],
      publishAt: f.publishAt || undefined,
      expiresAt: f.expiresAt || null,
      pinned: !!f.pinned,
      active: !!f.active,
    };
    saveMut.mutate(payload);
  };

  const rows = data?.data || [];

  return (
    <>
      <PageHeader
        title="Announcements"
        subtitle="Broadcast updates to employee dashboards"
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>
            New Announcement
          </Button>
        }
      />

      <Card>
        <CardContent sx={{ p: 0 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell width={40} />
                <TableCell>Title</TableCell>
                <TableCell>Audience</TableCell>
                <TableCell>Priority</TableCell>
                <TableCell>Published</TableCell>
                <TableCell>Expires</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={8} align="center">Loading…</TableCell></TableRow>
              )}
              {!isLoading && !rows.length && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 6 }}>
                    <Stack alignItems="center" spacing={1}>
                      <CampaignIcon color="disabled" sx={{ fontSize: 48 }} />
                      <Typography color="text.secondary">No announcements yet. Create one to broadcast it.</Typography>
                    </Stack>
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r._id} hover>
                  <TableCell>
                    <Tooltip title={r.pinned ? 'Unpin' : 'Pin to top'}>
                      <IconButton size="small" onClick={() => pinMut.mutate(r._id)}>
                        {r.pinned ? <PushPinIcon color="primary" fontSize="small" /> : <PushPinOutlinedIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={700}>{r.title}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                      overflow: 'hidden', maxWidth: { xs: '100%', sm: 380 },
                    }}>
                      {r.message}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {r.audience === 'ALL' && <Chip size="small" label="Everyone" />}
                    {r.audience === 'ROLES' && (
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {(r.roles || []).map((role) => (
                          <Chip key={role} size="small" variant="outlined" label={role.replace('_', ' ')} />
                        ))}
                      </Stack>
                    )}
                    {r.audience === 'DEPARTMENTS' && (
                      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {(r.departments || []).map((d) => (
                          <Chip key={d?._id || d} size="small" variant="outlined" label={d?.name || 'Dept'} />
                        ))}
                      </Stack>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" color={PRIORITY_COLOR[r.priority] || 'default'} label={r.priority} />
                  </TableCell>
                  <TableCell>{r.publishAt ? dayjs(r.publishAt).format('MMM D, YYYY HH:mm') : '—'}</TableCell>
                  <TableCell>{r.expiresAt ? dayjs(r.expiresAt).format('MMM D, YYYY') : '—'}</TableCell>
                  <TableCell>
                    <Chip size="small" color={r.active ? 'success' : 'default'} label={r.active ? 'Active' : 'Inactive'} />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title={r.active ? 'Deactivate' : 'Activate'}>
                      <IconButton size="small" onClick={() => activeMut.mutate(r._id)}>
                        {r.active ? <VisibilityIcon fontSize="small" /> : <VisibilityOffIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Edit">
                      <IconButton size="small" onClick={() => openEdit(r)}><EditIcon fontSize="small" /></IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton size="small" color="error" onClick={() => {
                        if (window.confirm('Delete this announcement?')) removeMut.mutate(r._id);
                      }}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialog.open} onClose={closeDialog} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 800 }}>
          {dialog.editingId ? 'Edit announcement' : 'New announcement'}
        </DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid item xs={12}>
              <TextField
                label="Title" fullWidth required
                value={dialog.form.title}
                onChange={(e) => setDialog((s) => ({ ...s, form: { ...s.form, title: e.target.value } }))}
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Message" fullWidth multiline minRows={4} required
                value={dialog.form.message}
                onChange={(e) => setDialog((s) => ({ ...s, form: { ...s.form, message: e.target.value } }))}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={6}>
              <TextField
                select label="Priority" fullWidth
                value={dialog.form.priority}
                onChange={(e) => setDialog((s) => ({ ...s, form: { ...s.form, priority: e.target.value } }))}
              >
                {PRIORITIES.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid item xs={12} sm={6} md={6}>
              <TextField
                select label="Audience" fullWidth
                value={dialog.form.audience}
                onChange={(e) => setDialog((s) => ({ ...s, form: { ...s.form, audience: e.target.value } }))}
              >
                {AUDIENCE_TYPES.map((a) => <MenuItem key={a.value} value={a.value}>{a.label}</MenuItem>)}
              </TextField>
            </Grid>

            {dialog.form.audience === 'ROLES' && (
              <Grid item xs={12}>
                <FormControl fullWidth>
                  <InputLabel id="roles-lbl">Roles</InputLabel>
                  <Select
                    multiple labelId="roles-lbl"
                    input={<OutlinedInput label="Roles" />}
                    value={dialog.form.roles}
                    onChange={(e) => setDialog((s) => ({ ...s, form: { ...s.form, roles: e.target.value } }))}
                    renderValue={(sel) => sel.map((r) => r.replace('_', ' ')).join(', ')}
                  >
                    {Object.values(ROLES).map((r) => (
                      <MenuItem key={r} value={r}>
                        <Checkbox checked={dialog.form.roles.indexOf(r) > -1} />
                        <ListItemText primary={r.replace('_', ' ')} />
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            )}

            {dialog.form.audience === 'DEPARTMENTS' && (
              <Grid item xs={12}>
                <FormControl fullWidth>
                  <InputLabel id="deps-lbl">Departments</InputLabel>
                  <Select
                    multiple labelId="deps-lbl"
                    input={<OutlinedInput label="Departments" />}
                    value={dialog.form.departments}
                    onChange={(e) => setDialog((s) => ({ ...s, form: { ...s.form, departments: e.target.value } }))}
                    renderValue={(sel) => (deps?.data || [])
                      .filter((d) => sel.includes(d._id))
                      .map((d) => d.name)
                      .join(', ')}
                  >
                    {(deps?.data || []).map((d) => (
                      <MenuItem key={d._id} value={d._id}>
                        <Checkbox checked={dialog.form.departments.indexOf(d._id) > -1} />
                        <ListItemText primary={d.name} />
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            )}

            <Grid item xs={12} sm={6} md={6}>
              <TextField
                type="datetime-local" label="Publish at" fullWidth InputLabelProps={{ shrink: true }}
                helperText="Leave blank to publish immediately"
                value={dialog.form.publishAt}
                onChange={(e) => setDialog((s) => ({ ...s, form: { ...s.form, publishAt: e.target.value } }))}
              />
            </Grid>
            <Grid item xs={12} sm={6} md={6}>
              <TextField
                type="datetime-local" label="Expires at" fullWidth InputLabelProps={{ shrink: true }}
                helperText="Optional"
                value={dialog.form.expiresAt}
                onChange={(e) => setDialog((s) => ({ ...s, form: { ...s.form, expiresAt: e.target.value } }))}
              />
            </Grid>

            <Grid item xs={12}>
              <Divider sx={{ mb: 1 }} />
              <Stack direction="row" spacing={2} alignItems="center">
                <Box>
                  <Checkbox
                    checked={dialog.form.pinned}
                    onChange={(e) => setDialog((s) => ({ ...s, form: { ...s.form, pinned: e.target.checked } }))}
                  />
                  Pin to top
                </Box>
                <Box>
                  <Checkbox
                    checked={dialog.form.active}
                    onChange={(e) => setDialog((s) => ({ ...s, form: { ...s.form, active: e.target.checked } }))}
                  />
                  Active
                </Box>
              </Stack>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="contained" onClick={submit} disabled={saveMut.isPending}>
            {saveMut.isPending ? 'Saving…' : (dialog.editingId ? 'Save changes' : 'Publish')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
