import { useState } from 'react';
import {
  Card, CardContent, Stack, Button, Chip, IconButton, Tooltip, Box, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CableIcon from '@mui/icons-material/Cable';
import WifiTetheringIcon from '@mui/icons-material/WifiTethering';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SyncIcon from '@mui/icons-material/Sync';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import dayjs from 'dayjs';

import PageHeader from '../../components/common/PageHeader';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import { TableSkeleton, Empty } from '../../components/common/States';
import { deviceService } from '../../services';
import { DeviceStatusChip } from '../../lib/biometric.jsx';

const fmt = (d) => (d ? dayjs(d).format('MMM D, HH:mm') : '—');

export default function DevicesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['devices'],
    queryFn: deviceService.list,
    refetchInterval: 20_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['devices'] });

  const mk = (fn, label) =>
    async (id) => {
      setBusyId(id);
      try {
        const res = await fn(id);
        toast.success(res?.message || label);
        invalidate();
      } catch (e) {
        toast.error(e?.response?.data?.message || `${label} failed`);
      } finally {
        setBusyId(null);
      }
    };

  const onConnect       = mk(deviceService.connect,           'Connected');
  const onDisconnect    = mk(deviceService.disconnect,        'Disconnected');
  const onTest          = mk(deviceService.test,              'Test complete');
  const onRestart       = mk(deviceService.restart,           'Restart requested');
  const onSyncAll       = mk(deviceService.syncAll,           'Employees synchronized');
  const onImportEmps    = mk(deviceService.importEmployees,   'Users imported');
  const onImportAtt     = mk((id) => deviceService.importAttendance(id, false), 'Attendance imported');
  const onRefreshFp     = mk(deviceService.refreshFingerprints, 'Fingerprint statuses refreshed');
  const onClearLogs     = mk(deviceService.clearAttendance,   'Device logs cleared');

  const removeMut = useMutation({
    mutationFn: (id) => deviceService.remove(id),
    onSuccess: () => { toast.success('Device deleted'); invalidate(); setConfirm(null); },
    onError: (e) => toast.error(e?.response?.data?.message || 'Delete failed'),
  });

  return (
    <>
      <PageHeader
        title="Biometric Devices"
        subtitle="Manage ZKTeco K40 terminals and sync employee/attendance data"
        actions={
          <Button component={Link} to="/devices/new" variant="contained" startIcon={<AddIcon />}>
            Add Device
          </Button>
        }
      />

      <Card>
        <CardContent>
          {isLoading ? (
            <TableSkeleton />
          ) : (data?.data?.length ? (
            <Box sx={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    {['Device', 'IP:Port', 'Serial / Firmware', 'Location', 'Status', 'Last Ping', 'Last Sync', 'Enabled', 'Actions'].map((h) => (
                      <th key={h} style={{ padding: '10px 8px', fontSize: 12, opacity: 0.7, borderBottom: '1px solid rgba(0,0,0,0.08)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((d) => (
                    <tr key={d._id} style={{ borderBottom: '1px dashed rgba(0,0,0,0.08)' }}>
                      <td style={{ padding: '12px 8px' }}>
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <Typography fontWeight={700}>{d.name}</Typography>
                          {d.isPrimary && <Chip size="small" color="primary" label="Primary" />}
                        </Stack>
                        <Typography variant="caption" color="text.secondary">{d.model}</Typography>
                      </td>
                      <td style={{ padding: '12px 8px' }}>{d.ip}:{d.port} <Typography variant="caption" color="text.secondary">({d.connectionType})</Typography></td>
                      <td style={{ padding: '12px 8px', fontSize: 12 }}>
                        <div>{d.serialNumber || '—'}</div>
                        <div style={{ opacity: 0.6 }}>{d.firmware || '—'}</div>
                      </td>
                      <td style={{ padding: '12px 8px' }}>{d.location || '—'}</td>
                      <td style={{ padding: '12px 8px' }}><DeviceStatusChip status={d.connectionStatus} /></td>
                      <td style={{ padding: '12px 8px', fontSize: 12 }}>{fmt(d.lastPing)}</td>
                      <td style={{ padding: '12px 8px', fontSize: 12 }}>{fmt(d.lastSync)}</td>
                      <td style={{ padding: '12px 8px' }}>
                        <Chip size="small" label={d.enabled ? 'Enabled' : 'Disabled'} color={d.enabled ? 'success' : 'default'} />
                      </td>
                      <td style={{ padding: '12px 8px', whiteSpace: 'nowrap' }}>
                        <Tooltip title="View"><IconButton size="small" onClick={() => navigate(`/devices/${d._id}`)}><VisibilityIcon fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title="Edit"><IconButton size="small" onClick={() => navigate(`/devices/${d._id}/edit`)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                        <Tooltip title="Test connection"><span><IconButton size="small" disabled={busyId === d._id} onClick={() => onTest(d._id)}><WifiTetheringIcon fontSize="small" /></IconButton></span></Tooltip>
                        <Tooltip title="Connect"><span><IconButton size="small" disabled={busyId === d._id} onClick={() => onConnect(d._id)}><CableIcon fontSize="small" color="success" /></IconButton></span></Tooltip>
                        <Tooltip title="Disconnect"><span><IconButton size="small" disabled={busyId === d._id} onClick={() => onDisconnect(d._id)}><CableIcon fontSize="small" color="warning" /></IconButton></span></Tooltip>
                        <Tooltip title="Restart"><span><IconButton size="small" disabled={busyId === d._id} onClick={() => onRestart(d._id)}><RestartAltIcon fontSize="small" /></IconButton></span></Tooltip>
                        <Tooltip title="Sync all employees"><span><IconButton size="small" disabled={busyId === d._id} onClick={() => onSyncAll(d._id)}><SyncIcon fontSize="small" color="primary" /></IconButton></span></Tooltip>
                        <Tooltip title="Import employees"><span><IconButton size="small" disabled={busyId === d._id} onClick={() => onImportEmps(d._id)}><CloudDownloadIcon fontSize="small" /></IconButton></span></Tooltip>
                        <Tooltip title="Import attendance"><span><IconButton size="small" disabled={busyId === d._id} onClick={() => onImportAtt(d._id)}><CloudDownloadIcon fontSize="small" color="primary" /></IconButton></span></Tooltip>
                        <Tooltip title="Refresh fingerprint statuses"><span><IconButton size="small" disabled={busyId === d._id} onClick={() => onRefreshFp(d._id)}><FingerprintIcon fontSize="small" /></IconButton></span></Tooltip>
                        <Tooltip title="Clear device logs"><span><IconButton size="small" disabled={busyId === d._id} onClick={() => onClearLogs(d._id)}><DeleteSweepIcon fontSize="small" color="warning" /></IconButton></span></Tooltip>
                        <Tooltip title="Delete"><IconButton size="small" onClick={() => setConfirm({ id: d._id, name: d.name })}><DeleteIcon fontSize="small" color="error" /></IconButton></Tooltip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
          ) : (
            <Empty
              title="No biometric devices"
              subtitle="Add your first ZKTeco K40 to start syncing employees and attendance."
            />
          ))}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!confirm}
        title="Delete device"
        message={`Remove ${confirm?.name}? Historical attendance is preserved, but employees linked to this device will need re-syncing.`}
        onClose={() => setConfirm(null)}
        onConfirm={() => removeMut.mutate(confirm.id)}
        confirmText="Delete"
        danger
      />
    </>
  );
}
