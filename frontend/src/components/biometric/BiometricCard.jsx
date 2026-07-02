import { useState } from 'react';
import { Card, CardContent, Typography, Stack, Grid, Box, Button, Divider, Chip } from '@mui/material';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import SyncIcon from '@mui/icons-material/Sync';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteIcon from '@mui/icons-material/Delete';
import ToggleOnIcon from '@mui/icons-material/ToggleOn';
import ToggleOffIcon from '@mui/icons-material/ToggleOff';
import DownloadIcon from '@mui/icons-material/Download';
import dayjs from 'dayjs';
import { toast } from 'react-toastify';
import { useQueryClient } from '@tanstack/react-query';

import { employeeService, deviceService } from '../../services';
import { SyncChip, FingerprintChip } from '../../lib/biometric.jsx';

const Field = ({ label, value }) => (
  <Box>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography variant="body2" fontWeight={600}>{value || '—'}</Typography>
  </Box>
);

const fmt = (d) => (d ? dayjs(d).format('MMM D, YYYY HH:mm') : '—');

/**
 * BiometricCard — shown on the Employee details page.
 * Encapsulates every biometric action available for a single employee.
 */
export default function BiometricCard({ employee }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(null);
  if (!employee) return null;

  const run = (label, fn) => async () => {
    setBusy(label);
    try {
      const res = await fn();
      toast.success(res?.message || label);
      qc.invalidateQueries({ queryKey: ['employee', employee._id] });
    } catch (e) {
      toast.error(e?.response?.data?.message || `${label} failed`);
    } finally {
      setBusy(null);
    }
  };

  const disabled = !!busy;
  const isSynced = employee.deviceSynced && employee.deviceId;

  const device = employee.deviceId && typeof employee.deviceId === 'object' ? employee.deviceId : null;
  const deviceName = device?.name || (typeof employee.deviceId === 'string' ? 'Configured device' : '—');

  return (
    <Card>
      <CardContent>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2 }}>
          <FingerprintIcon color="primary" />
          <Typography variant="h6" fontWeight={800}>Biometric</Typography>
          <Box sx={{ flex: 1 }} />
          <SyncChip status={employee.syncStatus} />
          <FingerprintChip status={employee.fingerprintStatus} />
        </Stack>

        <Grid container spacing={2}>
          <Grid item xs={6} md={4}><Field label="Device" value={deviceName} /></Grid>
          <Grid item xs={6} md={4}><Field label="Device User ID" value={employee.deviceUserId} /></Grid>
          <Grid item xs={6} md={4}>
            <Field
              label="Device Status"
              value={
                <Chip
                  size="small"
                  label={employee.deviceUserEnabled ? 'Enabled' : 'Disabled'}
                  color={employee.deviceUserEnabled ? 'success' : 'default'}
                />
              }
            />
          </Grid>
          <Grid item xs={6} md={4}><Field label="Fingerprints" value={`${employee.fingerCount || 0} template(s)`} /></Grid>
          <Grid item xs={6} md={4}><Field label="Face" value={employee.faceStatus?.replace('_', ' ')} /></Grid>
          <Grid item xs={6} md={4}><Field label="Last Sync" value={fmt(employee.lastSync)} /></Grid>
          <Grid item xs={6} md={4}><Field label="Last Attendance" value={fmt(employee.lastAttendance)} /></Grid>
        </Grid>

        {employee.syncError && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="caption" color="error">Last error: {employee.syncError}</Typography>
          </>
        )}

        <Divider sx={{ my: 2 }} />
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button variant="contained" color="primary" size="small" startIcon={<SyncIcon />} disabled={disabled}
                  onClick={run('Sync Employee', () => employeeService.syncToDevice(employee._id))}>
            {busy === 'Sync Employee' ? 'Syncing…' : 'Sync Employee'}
          </Button>
          <Button variant="outlined" color="error" size="small" startIcon={<DeleteIcon />} disabled={disabled || !isSynced}
                  onClick={run('Delete From Device', () => employeeService.deleteFromDevice(employee._id))}>
            Delete From Device
          </Button>
          <Button variant="outlined" color="success" size="small" startIcon={<ToggleOnIcon />} disabled={disabled || !isSynced}
                  onClick={run('Enable Device User', () => employeeService.enableOnDevice(employee._id))}>
            Enable
          </Button>
          <Button variant="outlined" color="warning" size="small" startIcon={<ToggleOffIcon />} disabled={disabled || !isSynced}
                  onClick={run('Disable Device User', () => employeeService.disableOnDevice(employee._id))}>
            Disable
          </Button>
          <Button variant="outlined" size="small" startIcon={<RefreshIcon />} disabled={disabled || !isSynced}
                  onClick={run('Refresh Fingerprint', () => employeeService.refreshFingerprint(employee._id))}>
            Refresh Fingerprint
          </Button>
          <Button variant="outlined" size="small" startIcon={<DownloadIcon />} disabled={disabled || !employee.deviceId}
                  onClick={run('Refresh Attendance', () => deviceService.importAttendance(
                    typeof employee.deviceId === 'object' ? employee.deviceId._id : employee.deviceId, false))}>
            Refresh Attendance
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
