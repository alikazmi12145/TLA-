const express = require('express');
const ctrl = require('../controllers/shift.controller');
const { protect, authorize } = require('../middleware/auth');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(protect);
// Shifts: SUPER_ADMIN + Team Leader have read+write
const adminOrTL = authorize(ROLES.SUPER_ADMIN, ROLES.TEAM_LEADER);

router.get('/', ctrl.list);
router.post('/', adminOrTL, ctrl.create);
router.put('/:id', adminOrTL, ctrl.update);
router.delete('/:id', authorize(ROLES.SUPER_ADMIN), ctrl.remove);

module.exports = router;
