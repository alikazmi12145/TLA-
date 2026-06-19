const express = require('express');
const ctrl = require('../controllers/leave.controller');
const { protect, authorize } = require('../middleware/auth');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(protect);
// Leaves: SUPER_ADMIN + HR have read+write; TL has no admin-level leave access
const adminOrHR = authorize(ROLES.SUPER_ADMIN, ROLES.HR_MANAGER);

router.post('/', ctrl.apply);
router.get('/me', ctrl.myLeaves);
router.get('/me/balance', ctrl.balance);
router.get('/balance/:id', adminOrHR, ctrl.balance);
router.get('/calendar', ctrl.calendar);

router.get('/', adminOrHR, ctrl.list);
router.get('/analytics', adminOrHR, ctrl.analytics);
router.patch('/:id/action', adminOrHR, ctrl.action);

module.exports = router;
