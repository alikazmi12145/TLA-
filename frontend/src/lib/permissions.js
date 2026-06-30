import { ROLES } from './constants';

export const ACCESS_LEVELS = ['none', 'read', 'manage'];

export const PERMISSION_MODULES = [
  { key: 'departments', label: 'Departments' },
  { key: 'holidays', label: 'Holidays' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'leaves', label: 'Leave Requests' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'shifts', label: 'Shifts' },
  { key: 'targets', label: 'Tasks' },
  { key: 'commissions', label: 'Commissions' },
  { key: 'reports', label: 'Reports' },
];

export const DEFAULT_ROLE_PERMISSIONS = {
  [ROLES.HR_MANAGER]: {
    departments: 'none',
    holidays: 'none',
    attendance: 'manage',
    leaves: 'manage',
    payroll: 'read',
    shifts: 'none',
    targets: 'none',
    commissions: 'none',
    reports: 'none',
  },
  [ROLES.TEAM_LEADER]: {
    departments: 'none',
    holidays: 'none',
    attendance: 'read',
    leaves: 'none',
    payroll: 'none',
    shifts: 'manage',
    targets: 'manage',
    commissions: 'none',
    reports: 'none',
  },
};

export const getDefaultPermissions = () => JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS));

export function normalizeRolePermissions(input = {}) {
  const normalized = getDefaultPermissions();

  Object.keys(normalized).forEach((role) => {
    Object.keys(normalized[role]).forEach((moduleKey) => {
      const candidate = input?.[role]?.[moduleKey];
      if (ACCESS_LEVELS.includes(candidate)) normalized[role][moduleKey] = candidate;
    });
  });

  return normalized;
}

export function getAccessLevel(permissions, role, moduleKey) {
  if (role === ROLES.SUPER_ADMIN) return 'manage';
  if (!role || !moduleKey) return 'none';

  const normalized = normalizeRolePermissions(permissions);
  return normalized?.[role]?.[moduleKey] || 'none';
}

export function hasModuleAccess(permissions, role, moduleKey, minLevel = 'read') {
  const level = getAccessLevel(permissions, role, moduleKey);
  return ACCESS_LEVELS.indexOf(level) >= ACCESS_LEVELS.indexOf(minLevel);
}