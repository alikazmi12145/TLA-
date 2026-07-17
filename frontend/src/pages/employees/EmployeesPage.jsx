import { useState } from 'react';
import {
  Card, CardContent, Stack, TextField, MenuItem, Button, Chip, Avatar, Box, IconButton, Tooltip,
  Pagination, Select, InputLabel, FormControl,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ToggleOnIcon from '@mui/icons-material/ToggleOn';
import ToggleOffIcon from '@mui/icons-material/ToggleOff';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';

import PageHeader from '../../components/common/PageHeader';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import { TableSkeleton, Empty } from '../../components/common/States';
import { employeeService, departmentService } from '../../services';
import { ROLES } from '../../lib/constants';
import { asset, initials } from '../../lib/format';
import { SyncChip, FingerprintChip } from '../../lib/biometric.jsx';
import dayjs from 'dayjs';

export default function EmployeesPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ search: '', role: '', department: '', status: '' });
  const [confirm, setConfirm] = useState(null);

  const { data: deps } = useQuery({ queryKey: ['departments'], queryFn: departmentService.list });
  // Employee list refreshes only every 60 s (fingerprint / sync status
  // changes are low-frequency events). Focus-refetch removed to avoid
  // firing a full page fetch every time the user Alt-Tabs.
  const { data, isLoading } = useQuery({
    queryKey: ['employees', page, filters],
    queryFn: () => employeeService.list({ page, limit: 10, ...filters }),
    refetchInterval: 60_000,
  });

  const onDelete = async () => {
    try {
      await employeeService.remove(confirm.id);
      toast.success('Employee deleted');
      qc.invalidateQueries({ queryKey: ['employees'] });
    } catch {} finally { setConfirm(null); }
  };

  const onToggle = async (id) => {
    try {
      await employeeService.toggle(id);
      qc.invalidateQueries({ queryKey: ['employees'] });
    } catch {}
  };

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle="Manage your workforce"
        actions={
          <Button component={Link} to="/employees/new" variant="contained" startIcon={<AddIcon />}>
            Add Employee
          </Button>
        }
      />

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
            <TextField label="Search by name, ID, email, CNIC" size="small" sx={{ minWidth: 280 }}
              value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Role</InputLabel>
              <Select label="Role" value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })}>
                <MenuItem value="">All</MenuItem>
                {Object.values(ROLES).map((r) => <MenuItem key={r} value={r}>{r.replace('_', ' ')}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel>Department</InputLabel>
              <Select label="Department" value={filters.department} onChange={(e) => setFilters({ ...filters, department: e.target.value })}>
                <MenuItem value="">All</MenuItem>
                {(deps?.data || []).map((d) => <MenuItem key={d._id} value={d._id}>{d.name}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel>Status</InputLabel>
              <Select label="Status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                <MenuItem value="">All</MenuItem>
                {['ACTIVE', 'INACTIVE', 'TERMINATED', 'ON_LEAVE'].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </FormControl>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          {isLoading ? (
            <TableSkeleton />
          ) : (data?.data?.length ? (
            <Box sx={{ width: '100%' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'auto' }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    {['Employee', 'Role', 'Department', 'Status', 'Device', 'Last Sync', 'Actions'].map((h) => (
                      <th key={h} style={{ padding: '10px 8px', fontSize: 12, opacity: 0.7, borderBottom: '1px solid rgba(0,0,0,0.08)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((u) => (
                    <tr key={u._id} style={{ borderBottom: '1px dashed rgba(0,0,0,0.08)' }}>
                      <td style={{ padding: '12px 8px', minWidth: 220 }}>
                        <Stack direction="row" spacing={1.5} alignItems="center">
                          <Avatar src={asset(u.profilePicture)}>{initials(u.fullName)}</Avatar>
                          <Box sx={{ minWidth: 0 }}>
                            <Box sx={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>{u.fullName}</Box>
                            <Box sx={{ fontSize: 12, opacity: 0.6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>{u.email}</Box>
                            {u.employeeId && (
                              <Box sx={{ fontSize: 11, opacity: 0.55, mt: 0.25 }}>ID: {u.employeeId}</Box>
                            )}
                          </Box>
                        </Stack>
                      </td>
                      <td style={{ padding: '12px 8px', whiteSpace: 'nowrap' }}>
                        <Chip size="small" label={u.role.replace('_', ' ')} />
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        <Box sx={{ fontWeight: 500 }}>{u.department?.name || '—'}</Box>
                        {u.designation && (
                          <Box sx={{ fontSize: 11, opacity: 0.6 }}>{u.designation}</Box>
                        )}
                      </td>
                      <td style={{ padding: '12px 8px', whiteSpace: 'nowrap' }}>
                        <Chip size="small" label={u.status} color={u.isActive ? 'success' : 'default'} />
                      </td>
                      <td style={{ padding: '12px 8px', fontSize: 12, minWidth: 180 }}>
                        {u.deviceId ? (
                          <Stack spacing={0.75}>
                            <Box>
                              <Box sx={{ fontWeight: 600, fontSize: 13, lineHeight: 1.2 }}>
                                {u.deviceId?.name || 'Device'}
                              </Box>
                              <Box sx={{ opacity: 0.55, fontSize: 11, mt: 0.25 }}>
                                UID {u.deviceUserId || '—'}
                              </Box>
                            </Box>
                            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                              <SyncChip status={u.syncStatus} sx={{ height: 20, fontSize: 10, fontWeight: 600 }} />
                              <FingerprintChip status={u.fingerprintStatus} sx={{ height: 20, fontSize: 10, fontWeight: 600 }} />
                            </Stack>
                          </Stack>
                        ) : (
                          <Chip size="small" label="Not enrolled" variant="outlined" sx={{ height: 22, fontSize: 11, opacity: 0.7 }} />
                        )}
                      </td>
                      <td style={{ padding: '12px 8px', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {u.lastSync ? dayjs(u.lastSync).format('MMM D, HH:mm') : '—'}
                      </td>
                      <td style={{ padding: '12px 8px', whiteSpace: 'nowrap' }}>
                        <Stack direction="row" spacing={0.25}>
                          <Tooltip title="View"><IconButton size="small" onClick={() => navigate(`/employees/${u._id}`)}><VisibilityIcon fontSize="small" /></IconButton></Tooltip>
                          <Tooltip title="Edit"><IconButton size="small" onClick={() => navigate(`/employees/${u._id}/edit`)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                          <Tooltip title="Toggle status"><IconButton size="small" onClick={() => onToggle(u._id)}>{u.isActive ? <ToggleOnIcon fontSize="small" color="success" /> : <ToggleOffIcon fontSize="small" />}</IconButton></Tooltip>
                          <Tooltip title="Delete"><IconButton size="small" onClick={() => setConfirm({ id: u._id, name: u.fullName })}><DeleteIcon fontSize="small" color="error" /></IconButton></Tooltip>
                        </Stack>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
          ) : <Empty title="No employees found" subtitle="Try adjusting filters or add a new employee." />)}
          {(data?.meta?.pages || 0) > 1 && (
            <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
              <Pagination page={page} count={data.meta.pages} onChange={(_, v) => setPage(v)} />
            </Stack>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!confirm}
        title="Delete employee"
        message={`Are you sure you want to delete ${confirm?.name}? This cannot be undone.`}
        onClose={() => setConfirm(null)}
        onConfirm={onDelete}
        confirmText="Delete"
        danger
      />
    </>
  );
}
