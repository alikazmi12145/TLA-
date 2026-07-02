const express = require('express');
const ctrl = require('../controllers/device.controller');
const { protect, authorize } = require('../middleware/auth');
const { authorizeModule } = require('../middleware/permissions');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(protect);

const canRead = authorizeModule('devices', 'read');
const canManage = authorizeModule('devices', 'manage');
const adminOnly = authorize(ROLES.SUPER_ADMIN);

router.get('/', canRead, ctrl.list);
router.get('/:id', canRead, ctrl.getOne);

router.post('/', adminOnly, ctrl.create);
router.put('/:id', adminOnly, ctrl.update);
router.delete('/:id', adminOnly, ctrl.remove);

// Live operations — Super Admin or a role with manage-level access.
router.post('/:id/connect', canManage, ctrl.connect);
router.post('/:id/disconnect', canManage, ctrl.disconnect);
router.post('/:id/test', canRead, ctrl.test);
router.post('/:id/restart', adminOnly, ctrl.restart);
router.post('/:id/sync-all', canManage, ctrl.syncAll);
router.post('/:id/import-employees', canManage, ctrl.importEmployees);
router.post('/:id/import-attendance', canManage, ctrl.importAttendance);
router.post('/:id/refresh-fingerprints', canManage, ctrl.refreshFingerprints);
router.post('/:id/clear-attendance', adminOnly, ctrl.clearAttendance);

module.exports = router;
