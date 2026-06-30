const { ROLES } = require('./constants');

const ACCESS_LEVELS = ['none', 'read', 'manage'];

const PERMISSION_MODULES = {
  departments: 'Departments',
  holidays: 'Holidays',
  attendance: 'Attendance',
  leaves: 'Leave Requests',
  payroll: 'Payroll',
  shifts: 'Shifts',
  targets: 'Tasks',
  commissions: 'Commissions',
  reports: 'Reports',
};

const DEFAULT_ROLE_PERMISSIONS = {
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

const getDefaultPermissions = () => JSON.parse(JSON.stringify(DEFAULT_ROLE_PERMISSIONS));

const normalizeRolePermissions = (input = {}) => {
  const normalized = getDefaultPermissions();

  Object.keys(normalized).forEach((role) => {
    Object.keys(normalized[role]).forEach((moduleKey) => {
      const candidate = input?.[role]?.[moduleKey];
      if (ACCESS_LEVELS.includes(candidate)) normalized[role][moduleKey] = candidate;
    });
  });

  return normalized;
};

const hasModuleAccess = (permissions, role, moduleKey, minLevel = 'read') => {
  if (role === ROLES.SUPER_ADMIN) return true;
  if (!role || !moduleKey) return false;

  const normalized = normalizeRolePermissions(permissions);
  const currentLevel = normalized?.[role]?.[moduleKey] || 'none';

  return ACCESS_LEVELS.indexOf(currentLevel) >= ACCESS_LEVELS.indexOf(minLevel);
};

module.exports = {
  ACCESS_LEVELS,
  PERMISSION_MODULES,
  DEFAULT_ROLE_PERMISSIONS,
  getDefaultPermissions,
  normalizeRolePermissions,
  hasModuleAccess,
};