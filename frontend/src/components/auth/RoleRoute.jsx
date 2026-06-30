import { Navigate, Outlet } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { selectRole } from '../../features/auth/authSlice';
import useSettingsPermissions from '../../hooks/useSettingsPermissions';

export default function RoleRoute({ allow = [], module, minLevel = 'read' }) {
  const role = useSelector(selectRole);
  const { canAccess } = useSettingsPermissions();

  if (!role) return <Navigate to="/login" replace />;
  if (module && !canAccess(module, minLevel)) return <Navigate to="/" replace />;
  if (!allow.includes(role)) return <Navigate to="/" replace />;
  return <Outlet />;
}
