const express = require('express');
const ctrl = require('../controllers/attendance.controller');
const { protect, authorize } = require('../middleware/auth');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(protect);
// Read-only viewing of admin-level attendance
const readers = authorize(ROLES.SUPER_ADMIN, ROLES.HR_MANAGER, ROLES.TEAM_LEADER);
// Write/edit attendance (adjust, import biometric, mark holidays) — TL is read-only
const writers = authorize(ROLES.SUPER_ADMIN, ROLES.HR_MANAGER);

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
// Admin / HR — write
router.post('/adjust', writers, ctrl.adjust);
router.post('/import-biometric', writers, ctrl.importBiometric);
router.post('/mark-holidays', writers, ctrl.markHolidays);

module.exports = router;
