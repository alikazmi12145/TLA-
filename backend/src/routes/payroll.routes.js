const express = require('express');
const ctrl = require('../controllers/payroll.controller');
const { protect } = require('../middleware/auth');
const { authorizeModule } = require('../middleware/permissions');

const router = express.Router();
router.use(protect);
const readers = authorizeModule('payroll', 'read');
const writers = authorizeModule('payroll', 'manage');

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
