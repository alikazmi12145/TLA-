import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { selectIsAuthed, selectRole, setUser } from './features/auth/authSlice';
import { authService } from './services';

import LoginPage from './pages/auth/LoginPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import ChangePasswordPage from './pages/auth/ChangePasswordPage';
import ProfilePage from './pages/profile/ProfilePage';

import DashboardLayout from './components/layout/DashboardLayout';
import AdminDashboard from './pages/dashboard/AdminDashboard';
import EmployeeDashboard from './pages/dashboard/EmployeeDashboard';

import EmployeesPage from './pages/employees/EmployeesPage';
import EmployeeFormPage from './pages/employees/EmployeeFormPage';
import EmployeeViewPage from './pages/employees/EmployeeViewPage';

import AttendancePage from './pages/attendance/AttendancePage';
import MyAttendancePage from './pages/attendance/MyAttendancePage';

import LeavesPage from './pages/leaves/LeavesPage';
import MyLeavesPage from './pages/leaves/MyLeavesPage';

import HolidaysPage from './pages/holidays/HolidaysPage';
import ShiftsPage from './pages/shifts/ShiftsPage';
import DepartmentsPage from './pages/departments/DepartmentsPage';

import TargetsPage from './pages/targets/TargetsPage';
import MyTargetsPage from './pages/targets/MyTargetsPage';
import CommissionsPage from './pages/commissions/CommissionsPage';

import PayrollPage from './pages/payroll/PayrollPage';
import MyPayrollPage from './pages/payroll/MyPayrollPage';

import ReportsPage from './pages/reports/ReportsPage';
import SettingsPage from './pages/settings/SettingsPage';
import NotificationsPage from './pages/notifications/NotificationsPage';
import NotFoundPage from './pages/NotFoundPage';

import ProtectedRoute from './components/auth/ProtectedRoute';
import RoleRoute from './components/auth/RoleRoute';
import { ROLES } from './lib/constants';

export default function App() {
  const isAuthed = useSelector(selectIsAuthed);
  const role = useSelector(selectRole);
  const dispatch = useDispatch();

  useEffect(() => {
    if (!isAuthed) return;
    let cancelled = false;
    authService
      .me()
      .then((res) => {
        const fresh = res?.data?.user;
        if (!cancelled && fresh) dispatch(setUser(fresh));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isAuthed, dispatch]);

  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={isAuthed ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* Private */}
      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route
            path="/"
            element={
              role === ROLES.SUPER_ADMIN || role === ROLES.HR_MANAGER || role === ROLES.TEAM_LEADER
                ? <AdminDashboard />
                : <EmployeeDashboard />
            }
          />
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/notifications" element={<NotificationsPage />} />

          {/* SUPER_ADMIN-only modules: Employees CRUD, Departments, Holidays, Commissions, Reports */}
          <Route element={<RoleRoute allow={[ROLES.SUPER_ADMIN]} />}>
            <Route path="/employees" element={<EmployeesPage />} />
            <Route path="/employees/new" element={<EmployeeFormPage />} />
            <Route path="/employees/:id/edit" element={<EmployeeFormPage />} />
            <Route path="/employees/:id" element={<EmployeeViewPage />} />
            <Route path="/departments" element={<DepartmentsPage />} />
            <Route path="/holidays" element={<HolidaysPage />} />
            <Route path="/commissions" element={<CommissionsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>

          {/* Attendance: SUPER_ADMIN + HR (R+W) + TL (read) */}
          <Route element={<RoleRoute allow={[ROLES.SUPER_ADMIN, ROLES.HR_MANAGER, ROLES.TEAM_LEADER]} />}>
            <Route path="/attendance" element={<AttendancePage />} />
          </Route>

          {/* Leaves: SUPER_ADMIN + HR */}
          <Route element={<RoleRoute allow={[ROLES.SUPER_ADMIN, ROLES.HR_MANAGER]} />}>
            <Route path="/leaves" element={<LeavesPage />} />
          </Route>

          {/* Payroll: SUPER_ADMIN + HR (HR is read-only inside the page) */}
          <Route element={<RoleRoute allow={[ROLES.SUPER_ADMIN, ROLES.HR_MANAGER]} />}>
            <Route path="/payroll" element={<PayrollPage />} />
          </Route>

          {/* Shifts & Targets: SUPER_ADMIN + Team Leader */}
          <Route element={<RoleRoute allow={[ROLES.SUPER_ADMIN, ROLES.TEAM_LEADER]} />}>
            <Route path="/shifts" element={<ShiftsPage />} />
            <Route path="/targets" element={<TargetsPage />} />
          </Route>

          {/* Self */}
          <Route path="/my/attendance" element={<MyAttendancePage />} />
          <Route path="/my/leaves" element={<MyLeavesPage />} />
          <Route path="/my/targets" element={<MyTargetsPage />} />
          <Route path="/my/payroll" element={<MyPayrollPage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
