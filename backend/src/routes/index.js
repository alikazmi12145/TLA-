const express = require('express');
const router = express.Router();

router.use('/auth', require('./auth.routes'));
router.use('/employees', require('./employee.routes'));
router.use('/departments', require('./department.routes'));
router.use('/shifts', require('./shift.routes'));
router.use('/holidays', require('./holiday.routes'));
router.use('/attendance', require('./attendance.routes'));
router.use('/leaves', require('./leave.routes'));
router.use('/targets', require('./target.routes'));
router.use('/commissions', require('./commission.routes'));
router.use('/payroll', require('./payroll.routes'));
router.use('/notifications', require('./notification.routes'));
router.use('/announcements', require('./announcement.routes'));
router.use('/settings', require('./setting.routes'));
router.use('/dashboard', require('./dashboard.routes'));
router.use('/reports', require('./report.routes'));
router.use('/devices', require('./device.routes'));

module.exports = router;
