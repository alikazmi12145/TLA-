const express = require('express');
const ctrl = require('../controllers/dashboard.controller');
const { protect, authorize } = require('../middleware/auth');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(protect);
const adminOrHR = authorize(ROLES.SUPER_ADMIN, ROLES.HR_MANAGER, ROLES.TEAM_LEADER);

router.get('/admin', adminOrHR, ctrl.adminSummary);
router.get('/employee', ctrl.employeeSummary);
router.get('/recent-activity', adminOrHR, ctrl.recentActivity);
router.get('/department-performance', adminOrHR, ctrl.departmentPerformance);

module.exports = router;
