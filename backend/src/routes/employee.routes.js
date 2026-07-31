const express = require('express');
const ctrl = require('../controllers/employee.controller');
const { protect, authorize } = require('../middleware/auth');
const { authorizeModule } = require('../middleware/permissions');
const { upload, withSubdir } = require('../middleware/upload');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(protect);

// Employee writes require manage-level access to the employees module.
// Reads remain open to admins/HR/TL because other admin pages need employee data.
const adminOnly = authorize(ROLES.SUPER_ADMIN);
const adminHrOrLead = authorize(ROLES.SUPER_ADMIN, ROLES.HR_MANAGER, ROLES.TEAM_LEADER);
const employeeManager = authorizeModule('employees', 'manage');

router.get('/', adminHrOrLead, ctrl.list);
router.get('/:id', ctrl.getOne);
router.post('/', employeeManager, withSubdir('profiles'), upload.single('profilePicture'), ctrl.create);
router.put('/:id', employeeManager, withSubdir('profiles'), upload.single('profilePicture'), ctrl.update);
router.delete('/:id', employeeManager, ctrl.remove);
router.patch('/:id/toggle', employeeManager, ctrl.toggleStatus);
router.post('/:id/reset-password', employeeManager, ctrl.resetEmployeePassword);

// -------- Biometric device operations for a single employee --------
router.post('/:id/sync', adminOnly, ctrl.syncToDevice);
router.post('/:id/delete-device', adminOnly, ctrl.deleteFromDevice);
router.post('/:id/refresh-fingerprint', adminOnly, ctrl.refreshFingerprint);
router.get('/:id/enrollment-status', adminHrOrLead, ctrl.enrollmentStatus);
router.post('/:id/enable-device', adminOnly, ctrl.enableOnDevice);
router.post('/:id/disable-device', adminOnly, ctrl.disableOnDevice);

module.exports = router;
