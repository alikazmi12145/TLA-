import api from '../lib/api';

export const authService = {
  login: (data) => api.post('/auth/login', data).then((r) => r.data),
  logout: (refreshToken) => api.post('/auth/logout', { refreshToken }).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
  updateProfile: (form) => api.patch('/auth/me', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  changePassword: (data) => api.post('/auth/change-password', data).then((r) => r.data),
  forgotPassword: (data) => api.post('/auth/forgot-password', data).then((r) => r.data),
  resetPassword: (data) => api.post('/auth/reset-password', data).then((r) => r.data),
};

export const dashboardService = {
  admin: () => api.get('/dashboard/admin').then((r) => r.data),
  employee: () => api.get('/dashboard/employee').then((r) => r.data),
  recent: () => api.get('/dashboard/recent-activity').then((r) => r.data),
  deptPerformance: () => api.get('/dashboard/department-performance').then((r) => r.data),
  enrollment: () => api.get('/dashboard/enrollment').then((r) => r.data),
};

export const employeeService = {
  list: (params) => api.get('/employees', { params }).then((r) => r.data),
  get: (id) => api.get(`/employees/${id}`).then((r) => r.data),
  create: (form) => api.post('/employees', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  update: (id, form) => api.put(`/employees/${id}`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  remove: (id) => api.delete(`/employees/${id}`).then((r) => r.data),
  toggle: (id) => api.patch(`/employees/${id}/toggle`).then((r) => r.data),
  // Biometric
  syncToDevice: (id, deviceId) => api.post(`/employees/${id}/sync`, { deviceId }).then((r) => r.data),
  deleteFromDevice: (id) => api.post(`/employees/${id}/delete-device`).then((r) => r.data),
  refreshFingerprint: (id) => api.post(`/employees/${id}/refresh-fingerprint`).then((r) => r.data),
  enrollmentStatus: (id) => api.get(`/employees/${id}/enrollment-status`).then((r) => r.data),
  enableOnDevice: (id) => api.post(`/employees/${id}/enable-device`).then((r) => r.data),
  disableOnDevice: (id) => api.post(`/employees/${id}/disable-device`).then((r) => r.data),
};

export const deviceService = {
  list: () => api.get('/devices').then((r) => r.data),
  get: (id) => api.get(`/devices/${id}`).then((r) => r.data),
  create: (data) => api.post('/devices', data).then((r) => r.data),
  update: (id, data) => api.put(`/devices/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/devices/${id}`).then((r) => r.data),
  connect: (id) => api.post(`/devices/${id}/connect`).then((r) => r.data),
  disconnect: (id) => api.post(`/devices/${id}/disconnect`).then((r) => r.data),
  test: (id) => api.post(`/devices/${id}/test`).then((r) => r.data),
  restart: (id) => api.post(`/devices/${id}/restart`).then((r) => r.data),
  syncAll: (id) => api.post(`/devices/${id}/sync-all`).then((r) => r.data),
  importEmployees: (id) => api.post(`/devices/${id}/import-employees`).then((r) => r.data),
  importAttendance: (id, clearAfter = false) =>
    api.post(`/devices/${id}/import-attendance`, { clearAfter }).then((r) => r.data),
  refreshFingerprints: (id) => api.post(`/devices/${id}/refresh-fingerprints`).then((r) => r.data),
  clearAttendance: (id) => api.post(`/devices/${id}/clear-attendance`).then((r) => r.data),
};

export const departmentService = {
  list: () => api.get('/departments').then((r) => r.data),
  create: (data) => api.post('/departments', data).then((r) => r.data),
  update: (id, data) => api.put(`/departments/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/departments/${id}`).then((r) => r.data),
};

export const shiftService = {
  list: () => api.get('/shifts').then((r) => r.data),
  create: (data) => api.post('/shifts', data).then((r) => r.data),
  update: (id, data) => api.put(`/shifts/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/shifts/${id}`).then((r) => r.data),
};

export const holidayService = {
  list: (params) => api.get('/holidays', { params }).then((r) => r.data),
  upcoming: () => api.get('/holidays/upcoming').then((r) => r.data),
  create: (data) => api.post('/holidays', data).then((r) => r.data),
  update: (id, data) => api.put(`/holidays/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/holidays/${id}`).then((r) => r.data),
};

export const attendanceService = {
  today: () => api.get('/attendance/today').then((r) => r.data),
  myMonth: (month) => api.get('/attendance/me/month', { params: { month } }).then((r) => r.data),
  list: (params) => api.get('/attendance', { params }).then((r) => r.data),
  daily: (date) => api.get('/attendance/summary/daily', { params: { date } }).then((r) => r.data),
  trend: (days = 30) => api.get('/attendance/summary/trend', { params: { days } }).then((r) => r.data),
  clockIn: (note) => api.post('/attendance/clock-in', { note }).then((r) => r.data),
  clockOut: (note) => api.post('/attendance/clock-out', { note }).then((r) => r.data),
  adjust: (data) => api.post('/attendance/adjust', data).then((r) => r.data),
};

export const leaveService = {
  apply: (data) => api.post('/leaves', data).then((r) => r.data),
  mine: () => api.get('/leaves/me').then((r) => r.data),
  list: (params) => api.get('/leaves', { params }).then((r) => r.data),
  action: (id, data) => api.patch(`/leaves/${id}/action`, data).then((r) => r.data),
  myBalance: () => api.get('/leaves/me/balance').then((r) => r.data),
  calendar: (params) => api.get('/leaves/calendar', { params }).then((r) => r.data),
  analytics: () => api.get('/leaves/analytics').then((r) => r.data),
};

export const targetService = {
  list: (params) => api.get('/targets', { params }).then((r) => r.data),
  mine: () => api.get('/targets/me').then((r) => r.data),
  ranking: () => api.get('/targets/ranking').then((r) => r.data),
  create: (data) => api.post('/targets', data).then((r) => r.data),
  update: (id, data) => api.put(`/targets/${id}`, data).then((r) => r.data),
  complete: (id) => api.patch(`/targets/${id}/complete`).then((r) => r.data),
  addEmployeeNote: (id, employeeNote) =>
    api.patch(`/targets/${id}/employee-note`, { employeeNote }).then((r) => r.data),
  remove: (id) => api.delete(`/targets/${id}`).then((r) => r.data),
};

export const commissionService = {
  list: (params) => api.get('/commissions', { params }).then((r) => r.data),
  mine: () => api.get('/commissions/me').then((r) => r.data),
  monthlyTotal: (params) => api.get('/commissions/monthly-total', { params }).then((r) => r.data),
  create: (data) => api.post('/commissions', data).then((r) => r.data),
  update: (id, data) => api.put(`/commissions/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/commissions/${id}`).then((r) => r.data),
};

export const payrollService = {
  list: (params) => api.get('/payroll', { params }).then((r) => r.data),
  mine: () => api.get('/payroll/me').then((r) => r.data),
  trend: () => api.get('/payroll/trend').then((r) => r.data),
  preview: (data) => api.post('/payroll/preview', data).then((r) => r.data),
  generate: (data) => api.post('/payroll/generate', data).then((r) => r.data),
  generateBulk: (data) => api.post('/payroll/generate-bulk', data).then((r) => r.data),
  markPaid: (id) => api.patch(`/payroll/${id}/paid`).then((r) => r.data),
  payslipUrl: (id) => `${import.meta.env.VITE_API_URL || '/api/v1'}/payroll/${id}/payslip`,
};

export const notificationService = {
  list: () => api.get('/notifications').then((r) => r.data),
  markRead: (id) => api.patch(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => api.patch('/notifications/read-all').then((r) => r.data),
  remove: (id) => api.delete(`/notifications/${id}`).then((r) => r.data),
};

export const announcementService = {
  feed: (limit) => api.get('/announcements/feed', { params: limit ? { limit } : {} }).then((r) => r.data),
  list: (params) => api.get('/announcements', { params }).then((r) => r.data),
  get: (id) => api.get(`/announcements/${id}`).then((r) => r.data),
  create: (data) => api.post('/announcements', data).then((r) => r.data),
  update: (id, data) => api.put(`/announcements/${id}`, data).then((r) => r.data),
  remove: (id) => api.delete(`/announcements/${id}`).then((r) => r.data),
  togglePin: (id) => api.patch(`/announcements/${id}/pin`).then((r) => r.data),
  toggleActive: (id) => api.patch(`/announcements/${id}/active`).then((r) => r.data),
};

export const settingService = {
  get: () => api.get('/settings').then((r) => r.data),
  update: (form) =>
    api.put('/settings', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
};

export const reportService = {
  url: (type, params) => {
    const qs = new URLSearchParams(params || {}).toString();
    return `${import.meta.env.VITE_API_URL || '/api/v1'}/reports/${type}?${qs}`;
  },
  fetch: (type, params) => api.get(`/reports/${type}`, { params }).then((r) => r.data),
};
