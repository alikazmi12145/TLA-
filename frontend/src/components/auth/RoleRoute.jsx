import { Navigate, Outlet } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { selectRole } from '../../features/auth/authSlice';

export default function RoleRoute({ allow = [] }) {
  const role = useSelector(selectRole);
  if (!role) return <Navigate to="/login" replace />;
  if (!allow.includes(role)) return <Navigate to="/" replace />;
  return <Outlet />;
}
