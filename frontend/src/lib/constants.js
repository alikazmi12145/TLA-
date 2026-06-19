export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  HR_MANAGER: 'HR_MANAGER',
  TEAM_LEADER: 'TEAM_LEADER',
  EMPLOYEE: 'EMPLOYEE',
};

export const LEAVE_TYPES = ['CASUAL', 'SICK', 'ANNUAL', 'EMERGENCY'];
export const LEAVE_STATUS = ['PENDING', 'APPROVED', 'REJECTED'];
export const ATTENDANCE_STATUS = ['PRESENT', 'ABSENT', 'LEAVE', 'HOLIDAY', 'LATE', 'HALF_DAY'];
export const TARGET_TYPES = ['DAILY', 'WEEKLY', 'MONTHLY'];

export const ASSET_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5000';
