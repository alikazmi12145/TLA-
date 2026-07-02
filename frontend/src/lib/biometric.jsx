import { Chip } from '@mui/material';
import { SYNC_STATUS, FINGERPRINT_STATUS, DEVICE_CONN_STATUS } from './constants';

/**
 * Colour + label helpers for biometric badges used across employees / devices.
 * Kept in a single module so the entire UI stays consistent.
 */

export function syncChipProps(status) {
  switch (status) {
    case SYNC_STATUS.SYNCED:  return { color: 'success', label: 'Synced' };
    case SYNC_STATUS.FAILED:  return { color: 'error', label: 'Failed' };
    case SYNC_STATUS.DISABLED:return { color: 'default', label: 'Disabled' };
    case SYNC_STATUS.PENDING:
    default:                  return { color: 'warning', label: 'Pending' };
  }
}

export function fingerprintChipProps(status) {
  switch (status) {
    case FINGERPRINT_STATUS.ENROLLED:    return { color: 'success', label: 'Enrolled' };
    case FINGERPRINT_STATUS.DISABLED:    return { color: 'default', label: 'Disabled' };
    case FINGERPRINT_STATUS.NOT_ENROLLED:
    default:                             return { color: 'warning', label: 'Not enrolled' };
  }
}

export function deviceChipProps(status) {
  switch (status) {
    case DEVICE_CONN_STATUS.ONLINE:  return { color: 'success', label: 'Online' };
    case DEVICE_CONN_STATUS.OFFLINE: return { color: 'default', label: 'Offline' };
    case DEVICE_CONN_STATUS.ERROR:   return { color: 'error', label: 'Error' };
    case DEVICE_CONN_STATUS.UNKNOWN:
    default:                         return { color: 'warning', label: 'Unknown' };
  }
}

export function SyncChip({ status, size = 'small', ...rest }) {
  const p = syncChipProps(status);
  return <Chip size={size} color={p.color} label={p.label} variant="filled" {...rest} />;
}

export function FingerprintChip({ status, size = 'small', ...rest }) {
  const p = fingerprintChipProps(status);
  return <Chip size={size} color={p.color} label={p.label} variant="filled" {...rest} />;
}

export function DeviceStatusChip({ status, size = 'small', ...rest }) {
  const p = deviceChipProps(status);
  return <Chip size={size} color={p.color} label={p.label} variant="filled" {...rest} />;
}
