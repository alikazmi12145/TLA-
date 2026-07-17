export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  HR_MANAGER: 'HR_MANAGER',
  TEAM_LEADER: 'TEAM_LEADER',
  ADMINISTRATION: 'ADMINISTRATION',
  EMPLOYEE: 'EMPLOYEE',
};

// Human-friendly labels for roles — used in dropdowns, badges, and chips.
export const ROLE_LABELS = {
  SUPER_ADMIN: 'Super Admin',
  HR_MANAGER: 'HR Manager',
  TEAM_LEADER: 'Team Leader',
  ADMINISTRATION: 'Administration',
  EMPLOYEE: 'Employee',
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

// Base origin for uploaded assets (profile pictures, payslip PDFs, etc.).
//
// In production the SPA is served by nginx on the SAME origin as the API,
// so an empty base makes `asset('/uploads/x.jpg')` resolve to a relative
// URL that nginx forwards to the Node backend via the `/uploads/` proxy.
// A hard-coded `http://localhost:5000` fallback would ship in a
// production build if `VITE_API_BASE` was forgotten at build-time and
// break every image / payslip link in the browser.
//
// Dev override: set `VITE_API_BASE=http://localhost:5000` in
// `frontend/.env.local` so Vite's proxy can forward the assets.
export const ASSET_BASE = import.meta.env.VITE_API_BASE || '';
