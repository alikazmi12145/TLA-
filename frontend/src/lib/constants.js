export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  HR_MANAGER: 'HR_MANAGER',
  TEAM_LEADER: 'TEAM_LEADER',
  EMPLOYEE: 'EMPLOYEE',
};

export const LEAVE_TYPES = ['CASUAL', 'SICK', 'ANNUAL', 'EMERGENCY'];
export const LEAVE_STATUS = ['PENDING', 'APPROVED', 'REJECTED'];
export const ATTENDANCE_STATUS = ['PRESENT', 'ABSENT', 'LEAVE', 'HOLIDAY', 'LATE', 'HALF_DAY'];
export const TARGET_TYPES = ['ONCE', 'WEEKLY', 'MONTHLY'];

// Shared chart color palette — imported by dashboards and analytics
// widgets so the visual language stays consistent app-wide.
export const CHART_COLORS = ['#5b6ef5', '#a855f7', '#1aab50', '#f5a524', '#ef4444', '#06b6d4'];

// Fallback used only if the Settings API has not loaded yet — the real
// values are stored in the Setting document and edited from the
// Settings page (Setting.leaveAllotments / Setting.workingHoursPerDay).
export const DEFAULT_LEAVE_ALLOTMENTS = { CASUAL: 10, SICK: 8, ANNUAL: 14, EMERGENCY: 5 };
export const DEFAULT_WORK_HOURS_PER_DAY = 8;

export const SYNC_STATUS = {
  PENDING: 'PENDING',
  SYNCED: 'SYNCED',
  FAILED: 'FAILED',
  DISABLED: 'DISABLED',
};

export const FINGERPRINT_STATUS = {
  NOT_ENROLLED: 'NOT_ENROLLED',
  ENROLLED: 'ENROLLED',
  DISABLED: 'DISABLED',
};

export const DEVICE_CONN_STATUS = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  UNKNOWN: 'UNKNOWN',
  ERROR: 'ERROR',
};

export const DEVICE_CONN_TYPE = ['TCP', 'UDP'];

export const ASSET_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';
