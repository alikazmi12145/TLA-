const express = require('express');
const ctrl = require('../controllers/report.controller');
const { protect, authorize } = require('../middleware/auth');
const { ROLES } = require('../config/constants');

const router = express.Router();
// Reports are Super Admin only per role matrix
router.use(protect, authorize(ROLES.SUPER_ADMIN));

router.get('/attendance', ctrl.attendance);
router.get('/leave', ctrl.leave);
router.get('/salary', ctrl.salary);
router.get('/commission', ctrl.commission);
router.get('/performance', ctrl.performance);

module.exports = router;
