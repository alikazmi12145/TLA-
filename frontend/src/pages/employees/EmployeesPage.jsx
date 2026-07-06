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
  const { data, isLoading } = useQuery({
    queryKey: ['employees', page, filters],
    queryFn: () => employeeService.list({ page, limit: 10, ...filters }),
    refetchInterval: 15000,          // live-update fingerprint / sync status
    refetchOnWindowFocus: true,
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
            <Box sx={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    {['Employee', 'ID', 'Role', 'Department', 'Designation', 'Status', 'Device', 'Device Status', 'Fingerprint', 'Last Sync', 'Actions'].map((h) => (
                      <th key={h} style={{ padding: '10px 8px', fontSize: 12, opacity: 0.7, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((u) => (
                    <tr key={u._id} style={{ borderBottom: '1px dashed rgba(0,0,0,0.08)' }}>
                      <td style={{ padding: '12px 8px' }}>
                        <Stack direction="row" spacing={1.5} alignItems="center">
                          <Avatar src={asset(u.profilePicture)}>{initials(u.fullName)}</Avatar>
                          <Box>
                            <Box sx={{ fontWeight: 600 }}>{u.fullName}</Box>
                            <Box sx={{ fontSize: 12, opacity: 0.6 }}>{u.email}</Box>
                          </Box>
                        </Stack>
                      </td>
                      <td style={{ padding: '12px 8px' }}>{u.employeeId || '-'}</td>
                      <td style={{ padding: '12px 8px' }}>
                        <Chip size="small" label={u.role.replace('_', ' ')} />
                      </td>
                      <td style={{ padding: '12px 8px' }}>{u.department?.name || '-'}</td>
                      <td style={{ padding: '12px 8px' }}>{u.designation || '-'}</td>
                      <td style={{ padding: '12px 8px' }}>
                        <Chip size="small" label={u.status} color={u.isActive ? 'success' : 'default'} />
                      </td>
                      <td style={{ padding: '12px 8px', fontSize: 12 }}>
                        {u.deviceId ? (
                          <>
                            <div style={{ fontWeight: 600 }}>{u.deviceId?.name || 'Device'}</div>
                            <div style={{ opacity: 0.6 }}>UID {u.deviceUserId || '—'}</div>
                          </>
                        ) : (
                          <span style={{ opacity: 0.5 }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 8px' }}><SyncChip status={u.syncStatus} /></td>
                      <td style={{ padding: '12px 8px' }}><FingerprintChip status={u.fingerprintStatus} /></td>
                      <td style={{ padding: '12px 8px', fontSize: 12 }}>
                        {u.lastSync ? dayjs(u.lastSync).format('MMM D, HH:mm') : '—'}
                      </td>
                      <td style={{ padding: '12px 8px' }}>
                        <Tooltip title="View"><IconButton size="small" onClick={() => navigate(`/employees/${u._id}`)}><VisibilityIcon fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title="Edit"><IconButton size="small" onClick={() => navigate(`/employees/${u._id}/edit`)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title="Toggle status"><IconButton size="small" onClick={() => onToggle(u._id)}>{u.isActive ? <ToggleOnIcon color="success" /> : <ToggleOffIcon />}</IconButton></Tooltip>
                        <Tooltip title="Delete"><IconButton size="small" onClick={() => setConfirm({ id: u._id, name: u.fullName })}><DeleteIcon fontSize="small" color="error" /></IconButton></Tooltip>
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
