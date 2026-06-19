const express = require('express');
const ctrl = require('../controllers/payroll.controller');
const { protect, authorize } = require('../middleware/auth');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(protect);
// Payroll read access (HR is read-only per matrix)
const readers = authorize(ROLES.SUPER_ADMIN, ROLES.HR_MANAGER);
// Payroll write access (generate, mark paid) — Super Admin only
const writers = authorize(ROLES.SUPER_ADMIN);

router.get('/me', ctrl.mine);
router.get('/monthly-total', readers, ctrl.monthlyTotal);
router.get('/trend', readers, ctrl.trend);
router.get('/', readers, ctrl.list);
router.post('/preview', writers, ctrl.preview);
router.post('/generate', writers, ctrl.generate);
router.post('/generate-bulk', writers, ctrl.generateBulk);
router.patch('/:id/paid', writers, ctrl.markPaid);
router.get('/:id/payslip', ctrl.payslip);

module.exports = router;
