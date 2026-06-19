const express = require('express');
const ctrl = require('../controllers/holiday.controller');
const { protect, authorize } = require('../middleware/auth');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(protect);
// Holidays: Super Admin only for writes (read is open to any authenticated user)
const adminOnly = authorize(ROLES.SUPER_ADMIN);

router.get('/', ctrl.list);
router.get('/upcoming', ctrl.upcoming);
router.post('/', adminOnly, ctrl.create);
router.put('/:id', adminOnly, ctrl.update);
router.delete('/:id', adminOnly, ctrl.remove);

module.exports = router;
