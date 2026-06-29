const express = require('express');
const ctrl = require('../controllers/target.controller');
const { protect, authorize } = require('../middleware/auth');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(protect);
// Targets: SUPER_ADMIN + Team Leader have read+write (HR has no targets access per matrix)
const adminOrTL = authorize(ROLES.SUPER_ADMIN, ROLES.TEAM_LEADER);

router.get('/me', ctrl.mine);
router.get('/ranking', ctrl.ranking);
// allow employees to mark their own target complete (before generic /:id routes)
router.patch('/:id/complete', ctrl.complete);
router.patch('/:id/employee-note', ctrl.addEmployeeNote);
router.get('/', adminOrTL, ctrl.list);
router.post('/', adminOrTL, ctrl.create);
router.put('/:id', adminOrTL, ctrl.update);
router.delete('/:id', adminOrTL, ctrl.remove);

module.exports = router;
