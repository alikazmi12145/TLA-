const express = require('express');
const ctrl = require('../controllers/commission.controller');
const { protect, authorize } = require('../middleware/auth');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(protect);
// Commissions: Super Admin only for admin-level operations
const adminOnly = authorize(ROLES.SUPER_ADMIN);

router.get('/me', ctrl.mine);
router.get('/monthly-total', adminOnly, ctrl.monthlyTotal);
router.get('/', adminOnly, ctrl.list);
router.post('/', adminOnly, ctrl.create);
router.put('/:id', adminOnly, ctrl.update);
router.delete('/:id', adminOnly, ctrl.remove);

module.exports = router;
