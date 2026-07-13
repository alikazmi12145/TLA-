import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import {
  Card, CardContent, Typography, Stack, Grid, Box, Chip, Button, LinearProgress,
  List, ListItem, ListItemAvatar, Avatar, ListItemText, Tooltip,
} from '@mui/material';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import RefreshIcon from '@mui/icons-material/Refresh';

import { dashboardService, employeeService } from '../../services';
import { Empty } from '../common/States';
import { initials } from '../../lib/format';

const Metric = ({ icon, label, value, color = 'primary' }) => (
  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ p: 1.5, borderRadius: 2, bgcolor: 'action.hover' }}>
    <Avatar variant="rounded" sx={{ bgcolor: `${color}.main`, width: 40, height: 40 }}>{icon}</Avatar>
    <Box>
      <Typography variant="h6" fontWeight={800} lineHeight={1.1}>{value ?? '—'}</Typography>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Box>
  </Stack>
);

/**
 * EnrollmentCard — admin dashboard widget.
 * Shows fingerprint enrollment progress and the queue of employees who still
 * need to enroll on the biometric device.
 */
export default function EnrollmentCard() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Enrollment progress polls once a minute — new enrollments are a
  // manual action, not a stream, so 15 s was pure waste.
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['dash-enrollment'],
    queryFn: dashboardService.enrollment,
    refetchInterval: 60_000,
  });

  const d = data?.data || {};
  const total = d.totalEmployees || 0;
  const enrolled = d.enrolled || 0;
  const pending = d.pendingEnrollment || 0;
  const notSynced = d.notSynced || 0;
  const failed = d.syncFailed || 0;
  const pct = total > 0 ? Math.round((enrolled / total) * 100) : 0;

  const refreshOne = async (id) => {
    try {
      await employeeService.refreshFingerprint(id);
      toast.success('Fingerprint status refreshed');
      qc.invalidateQueries({ queryKey: ['dash-enrollment'] });
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Refresh failed');
    }
  };

  return (
    <Card>
      <CardContent>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
          <FingerprintIcon color="primary" />
          <Typography variant="h6" fontWeight={800}>Fingerprint Enrollment</Typography>
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Refresh now">
            <span>
              <Button size="small" startIcon={<RefreshIcon />} onClick={() => refetch()} disabled={isFetching}>
                {isFetching ? 'Checking…' : 'Refresh'}
              </Button>
            </span>
          </Tooltip>
        </Stack>

        <Grid container spacing={1.5} sx={{ mb: 2 }}>
          <Grid item xs={6} md={3}>
            <Metric icon={<CheckCircleIcon />} label="Enrolled" value={enrolled} color="success" />
          </Grid>
          <Grid item xs={6} md={3}>
            <Metric icon={<HourglassEmptyIcon />} label="Awaiting punch" value={pending} color="warning" />
          </Grid>
          <Grid item xs={6} md={3}>
            <Metric icon={<FingerprintIcon />} label="Not synced" value={notSynced} color="info" />
          </Grid>
          <Grid item xs={6} md={3}>
            <Metric icon={<ErrorOutlineIcon />} label="Sync failed" value={failed} color="error" />
          </Grid>
        </Grid>

        <Box sx={{ mb: 2 }}>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              {enrolled} of {total} employees enrolled
            </Typography>
            <Typography variant="caption" fontWeight={700}>{pct}%</Typography>
          </Stack>
          <LinearProgress
            variant={isLoading ? 'indeterminate' : 'determinate'}
            value={pct}
            sx={{ height: 8, borderRadius: 5 }}
          />
        </Box>

        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
          Awaiting fingerprint on device
        </Typography>
        {(d.pending || []).length ? (
          <List dense disablePadding>
            {(d.pending || []).map((emp) => (
              <ListItem
                key={emp._id}
                sx={{ px: 1, borderRadius: 1.5, '&:hover': { bgcolor: 'action.hover' } }}
                secondaryAction={
                  <Stack direction="row" spacing={0.5}>
                    <Tooltip title="Refresh from device">
                      <Button size="small" onClick={() => refreshOne(emp._id)}>Check</Button>
                    </Tooltip>
                    <Button size="small" variant="outlined" onClick={() => navigate(`/employees/${emp._id}`)}>
                      Open
                    </Button>
                  </Stack>
                }
              >
                <ListItemAvatar>
                  <Avatar>{initials(emp.fullName)}</Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography variant="body2" fontWeight={700}>{emp.fullName}</Typography>
                      {emp.employeeId && (
                        <Chip size="small" variant="outlined" label={emp.employeeId} />
                      )}
                    </Stack>
                  }
                  secondary={
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.25 }}>
                      {emp.device?.name && (
                        <Chip size="small" color="primary" variant="outlined" label={emp.device.name} />
                      )}
                      {emp.deviceUserId && (
                        <Chip size="small" label={`User ID ${emp.deviceUserId}`} />
                      )}
                      <Chip size="small" color="warning" label="Not enrolled" />
                    </Stack>
                  }
                />
              </ListItem>
            ))}
          </List>
        ) : (
          <Empty title="All synced employees are enrolled" />
        )}
      </CardContent>
    </Card>
  );
}
