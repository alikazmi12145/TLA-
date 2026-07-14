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
router.post('/', adminOnly, withSubdir('profiles'), upload.single('profilePicture'), ctrl.create);
router.put('/:id', adminOnly, withSubdir('profiles'), upload.single('profilePicture'), ctrl.update);
router.delete('/:id', adminOnly, ctrl.remove);
router.patch('/:id/toggle', adminOnly, ctrl.toggleStatus);
router.post('/:id/reset-password', adminOnly, ctrl.resetEmployeePassword);

// -------- Biometric device operations for a single employee --------
router.post('/:id/sync', adminOnly, ctrl.syncToDevice);
router.post('/:id/delete-device', adminOnly, ctrl.deleteFromDevice);
router.post('/:id/refresh-fingerprint', adminOnly, ctrl.refreshFingerprint);
router.get('/:id/enrollment-status', adminHrOrLead, ctrl.enrollmentStatus);
router.post('/:id/enable-device', adminOnly, ctrl.enableOnDevice);
router.post('/:id/disable-device', adminOnly, ctrl.disableOnDevice);

module.exports = router;
