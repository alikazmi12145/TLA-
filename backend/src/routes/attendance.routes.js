const express = require('express');
const ctrl = require('../controllers/attendance.controller');
const { protect } = require('../middleware/auth');
const { authorizeModule } = require('../middleware/permissions');

const router = express.Router();
router.use(protect);
const readers = authorizeModule('attendance', 'read');
const writers = authorizeModule('attendance', 'manage');

// Self
router.post('/clock-in', ctrl.clockIn);
router.post('/clock-out', ctrl.clockOut);
router.post('/break/start', ctrl.breakStart);
router.post('/break/end', ctrl.breakEnd);
router.post('/lunch/start', ctrl.lunchStart);
router.post('/lunch/end', ctrl.lunchEnd);
router.get('/today', ctrl.today);
router.get('/me/month', ctrl.myMonth);

// Admin / HR / TL — read
router.get('/', readers, ctrl.list);
router.get('/summary/daily', readers, ctrl.dailySummary);
router.get('/summary/trend', readers, ctrl.trend);
router.post('/adjust', writers, ctrl.adjust);
router.post('/import-biometric', writers, ctrl.importBiometric);
router.post('/mark-holidays', writers, ctrl.markHolidays);

module.exports = router;
