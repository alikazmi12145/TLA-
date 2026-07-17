import { useState } from 'react';
import { Card, CardContent, Stack, TextField, Button, IconButton, Tooltip, Box, Dialog, DialogTitle, DialogContent, DialogActions, Divider, MenuItem, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';

import PageHeader from '../../components/common/PageHeader';
import { TableSkeleton, Empty } from '../../components/common/States';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import useSettingsPermissions from '../../hooks/useSettingsPermissions';
import { ROLES } from '../../lib/constants';
import { PERMISSION_MODULES, normalizeRolePermissions } from '../../lib/permissions';
import { departmentService, settingService } from '../../services';

const ACCESS_OPTIONS = [
  { value: 'none', label: 'No access' },
  { value: 'read', label: 'View only' },
  { value: 'manage', label: 'Manage' },
];

const DUTY_ROLES = [
  { key: ROLES.HR_MANAGER, label: 'HR' },
  { key: ROLES.TEAM_LEADER, label: 'Team Leader' },
  { key: ROLES.ADMINISTRATION, label: 'Administration' },
];

export default function DepartmentsPage() {
  const { canAccess, role, permissions } = useSettingsPermissions();
  const canManage = canAccess('departments', 'manage');
  const isAdmin = role === ROLES.SUPER_ADMIN;
  const qc = useQueryClient();
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [dutiesOpen, setDutiesOpen] = useState(false);
  const [dutyRole, setDutyRole] = useState(ROLES.HR_MANAGER);
  const [duties, setDuties] = useState(() => normalizeRolePermissions(permissions));
  const [savingDuties, setSavingDuties] = useState(false);

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

  const onSaveDuties = async () => {
    setSavingDuties(true);
    try {
      const fd = new FormData();
      fd.append('permissions', JSON.stringify(normalizeRolePermissions(duties)));
      await settingService.update(fd);
      toast.success('Duties updated');
      qc.invalidateQueries({ queryKey: ['settings'] });
      setDutiesOpen(false);
    } catch {
      /* handled globally */
    } finally {
      setSavingDuties(false);
    }
  };

  const openDuties = () => {
    setDuties(normalizeRolePermissions(permissions));
    setDutyRole(ROLES.HR_MANAGER);
    setDutiesOpen(true);
  };

  const setModuleAccess = (roleKey, moduleKey, value) => {
    setDuties((prev) => ({
      ...prev,
      [roleKey]: { ...(prev[roleKey] || {}), [moduleKey]: value },
    }));
  };

  const setAllForRole = (roleKey, value) => {
    setDuties((prev) => {
      const next = { ...(prev[roleKey] || {}) };
      PERMISSION_MODULES.forEach((m) => { next[m.key] = value; });
      return { ...prev, [roleKey]: next };
    });
  };

  const headerActions = isAdmin || canManage ? (
    <Stack direction="row" spacing={1}>
      {isAdmin ? <Button variant="outlined" onClick={openDuties}>Assign duties</Button> : null}
      {canManage ? <Button startIcon={<AddIcon />} variant="contained" onClick={startNew}>Add department</Button> : null}
    </Stack>
  ) : null;

  return (
    <>
      <PageHeader title="Departments" subtitle={canManage ? 'Create and update department records' : 'View department records'} actions={headerActions} />
      <Card><CardContent>
        {isLoading ? <TableSkeleton /> : (data?.data?.length ? (
          <Box sx={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ textAlign: 'left' }}>{['Name', 'Code', 'Description', ...(canManage ? ['Actions'] : [])].map((h) => (
                <th key={h} style={{ padding: '10px 8px', fontSize: 12, opacity: 0.7, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>{h}</th>
              ))}</tr></thead>
              <tbody>
                {data.data.map((d) => (
                  <tr key={d._id} style={{ borderBottom: '1px dashed rgba(0,0,0,0.08)' }}>
                    <td style={{ padding: '10px 8px', fontWeight: 600 }}>{d.name}</td>
                    <td style={{ padding: '10px 8px' }}>{d.code || '—'}</td>
                    <td style={{ padding: '10px 8px' }}>{d.description || '—'}</td>
                    {canManage && (
                      <td style={{ padding: '10px 8px' }}>
                        <Tooltip title="Edit"><IconButton size="small" onClick={() => startEdit(d)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title="Delete"><IconButton size="small" color="error" onClick={() => setConfirm(d)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Box>
        ) : <Empty title="No departments" />)}
      </CardContent></Card>

      <Dialog open={open && canManage} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
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

      <Dialog open={dutiesOpen && isAdmin} onClose={() => setDutiesOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Assign Duties</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Only the Super Admin can decide which duties HR, Team Leaders, and Administration can open, view, or manage.
            </Typography>
            <TextField
              select
              fullWidth
              label="Assign to"
              value={dutyRole}
              onChange={(e) => setDutyRole(e.target.value)}
            >
              {DUTY_ROLES.map((r) => (
                <MenuItem key={r.key} value={r.key}>{r.label}</MenuItem>
              ))}
            </TextField>
            <Stack direction="row" spacing={1}>
              <Button size="small" onClick={() => setAllForRole(dutyRole, 'none')}>Clear all</Button>
              <Button size="small" onClick={() => setAllForRole(dutyRole, 'read')}>All view</Button>
              <Button size="small" onClick={() => setAllForRole(dutyRole, 'manage')}>All manage</Button>
            </Stack>
            <Divider />
            <Stack spacing={1.5}>
              {PERMISSION_MODULES.map((module) => (
                <Stack
                  key={module.key}
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1.5}
                  alignItems={{ sm: 'center' }}
                  justifyContent="space-between"
                >
                  <Typography sx={{ flex: 1, fontWeight: 500 }}>{module.label}</Typography>
                  <TextField
                    select
                    size="small"
                    sx={{ minWidth: 200 }}
                    value={duties?.[dutyRole]?.[module.key] || 'none'}
                    onChange={(e) => setModuleAccess(dutyRole, module.key, e.target.value)}
                  >
                    {ACCESS_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                    ))}
                  </TextField>
                </Stack>
              ))}
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDutiesOpen(false)} disabled={savingDuties}>Cancel</Button>
          <Button onClick={onSaveDuties} variant="contained" disabled={savingDuties}>
            {savingDuties ? 'Saving…' : 'Save duties'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog open={!!confirm && canManage} title="Delete department" message={`Delete "${confirm?.name}"?`} onClose={() => setConfirm(null)} onConfirm={onDelete} confirmText="Delete" danger />
    </>
  );
}
