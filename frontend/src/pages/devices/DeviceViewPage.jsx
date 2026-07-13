import { useState } from 'react';
import { Card, CardContent, Grid, Stack, Button, Typography, Divider, Box, Chip } from '@mui/material';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import dayjs from 'dayjs';

import PageHeader from '../../components/common/PageHeader';
import { Loading } from '../../components/common/States';
import { deviceService } from '../../services';
import { DeviceStatusChip } from '../../lib/biometric.jsx';

const Field = ({ label, value }) => (
  <Box>
    <Typography variant="caption" color="text.secondary">{label}</Typography>
    <Typography variant="body2" fontWeight={600}>{value ?? '—'}</Typography>
  </Box>
);

const fmt = (d) => (d ? dayjs(d).format('MMM D, YYYY HH:mm') : '—');

export default function DeviceViewPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(null);
  // Single-device view invalidated by socket events; 30 s poll fallback.
  const { data, isLoading } = useQuery({
    queryKey: ['device', id],
    queryFn: () => deviceService.get(id),
    refetchInterval: 30_000,
  });

  if (isLoading) return <Loading />;
  const d = data?.data;
  if (!d) return null;

  const run = (label, fn) => async () => {
    setBusy(label);
    try {
      const res = await fn(id);
      toast.success(res?.message || label);
      qc.invalidateQueries({ queryKey: ['device', id] });
      qc.invalidateQueries({ queryKey: ['devices'] });
    } catch (e) {
      toast.error(e?.response?.data?.message || `${label} failed`);
    } finally {
      setBusy(null);
    }
  };

  const B = ({ label, color = 'primary', variant = 'outlined', fn, icon }) => (
    <Button
      color={color}
      variant={variant}
      size="small"
      startIcon={icon}
      disabled={!!busy}
      onClick={run(label, fn)}
    >
      {busy === label ? 'Working…' : label}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={d.name}
        subtitle={`${d.model} · ${d.ip}:${d.port} (${d.connectionType})`}
        actions={<Button component={Link} to={`/devices/${id}/edit`} variant="contained">Edit</Button>}
      />

      <Grid container spacing={2}>
        <Grid item xs={12} md={5}>
          <Card>
            <CardContent>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                <Typography variant="h6" fontWeight={800}>Connection</Typography>
                <DeviceStatusChip status={d.connectionStatus} />
                {d.isPrimary && <Chip size="small" color="primary" label="Primary" />}
                <Chip size="small" label={d.enabled ? 'Enabled' : 'Disabled'} color={d.enabled ? 'success' : 'default'} />
              </Stack>
              <Grid container spacing={2}>
                <Grid item xs={6}><Field label="IP" value={d.ip} /></Grid>
                <Grid item xs={6}><Field label="Port" value={d.port} /></Grid>
                <Grid item xs={6}><Field label="Type" value={d.connectionType} /></Grid>
                <Grid item xs={6}><Field label="UDP inport" value={d.inport} /></Grid>
                <Grid item xs={6}><Field label="Serial" value={d.serialNumber} /></Grid>
                <Grid item xs={6}><Field label="Firmware" value={d.firmware} /></Grid>
                <Grid item xs={6}><Field label="Location" value={d.location} /></Grid>
                <Grid item xs={6}><Field label="Comm Key" value={d.commKey} /></Grid>
                <Grid item xs={6}><Field label="Last ping" value={fmt(d.lastPing)} /></Grid>
                <Grid item xs={6}><Field label="Last sync" value={fmt(d.lastSync)} /></Grid>
                <Grid item xs={4}><Field label="Users" value={d.userCount} /></Grid>
                <Grid item xs={4}><Field label="Fingers" value={d.fingerCount} /></Grid>
                <Grid item xs={4}><Field label="Records" value={d.recordCount} /></Grid>
              </Grid>
              {d.lastError && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="caption" color="error">Last error: {d.lastError}</Typography>
                </>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={7}>
          <Card>
            <CardContent>
              <Typography variant="h6" fontWeight={800} sx={{ mb: 2 }}>Operations</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <B label="Test Connection"       color="info"    fn={deviceService.test} />
                <B label="Connect Device"        color="success" fn={deviceService.connect} />
                <B label="Disconnect Device"     color="warning" fn={deviceService.disconnect} />
                <B label="Restart Device"        color="warning" fn={deviceService.restart} />
                <B label="Sync All Employees"    color="primary" variant="contained" fn={deviceService.syncAll} />
                <B label="Import Employees"                     fn={deviceService.importEmployees} />
                <B label="Import Attendance"     color="primary" fn={(x) => deviceService.importAttendance(x, false)} />
                <B label="Refresh Fingerprints"                 fn={deviceService.refreshFingerprints} />
                <B label="Clear Attendance Logs" color="error"   fn={deviceService.clearAttendance} />
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </>
  );
}
