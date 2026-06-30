import { useQuery } from '@tanstack/react-query';
import { useSelector } from 'react-redux';

import { selectIsAuthed, selectRole } from '../features/auth/authSlice';
import { getAccessLevel, hasModuleAccess, normalizeRolePermissions } from '../lib/permissions';
import { settingService } from '../services';

export default function useSettingsPermissions() {
  const isAuthed = useSelector(selectIsAuthed);
  const role = useSelector(selectRole);

  const query = useQuery({
    queryKey: ['settings'],
    queryFn: settingService.get,
    enabled: isAuthed,
    staleTime: 60_000,
  });

  const permissions = normalizeRolePermissions(query.data?.data?.permissions);

  return {
    ...query,
    role,
    permissions,
    accessFor: (moduleKey, targetRole = role) => getAccessLevel(permissions, targetRole, moduleKey),
    canAccess: (moduleKey, minLevel = 'read', targetRole = role) => hasModuleAccess(permissions, targetRole, moduleKey, minLevel),
  };
}