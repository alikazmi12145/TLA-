const express = require('express');
const ctrl = require('../controllers/employee.controller');
const { protect, authorize } = require('../middleware/auth');
const { upload, withSubdir } = require('../middleware/upload');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(protect);

// Employee writes are restricted to Super Admin per role matrix.
// Reads remain open to admins/HR/TL because other admin pages need to populate
// employee dropdowns (e.g. Attendance / Leave / Target filters).
const adminOnly = authorize(ROLES.SUPER_ADMIN);
const adminHrOrLead = authorize(ROLES.SUPER_ADMIN, ROLES.HR_MANAGER, ROLES.TEAM_LEADER);

router.get('/', adminHrOrLead, ctrl.list);
router.get('/:id', ctrl.getOne);
router.post('/', adminOnly, withSubdir('profile'), upload.single('profilePicture'), ctrl.create);
router.put('/:id', adminOnly, withSubdir('profile'), upload.single('profilePicture'), ctrl.update);
router.delete('/:id', adminOnly, ctrl.remove);
router.patch('/:id/toggle', adminOnly, ctrl.toggleStatus);
router.post('/:id/reset-password', adminOnly, ctrl.resetEmployeePassword);

module.exports = router;
