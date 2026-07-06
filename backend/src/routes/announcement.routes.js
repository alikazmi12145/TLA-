const express = require('express');
const ctrl = require('../controllers/announcement.controller');
const { protect, authorize } = require('../middleware/auth');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(protect);

const canManage = authorize(ROLES.SUPER_ADMIN, ROLES.HR_MANAGER);

// Everyone reads their own feed
router.get('/feed', ctrl.feed);

// Admin/HR management surface
router.get('/', canManage, ctrl.listAll);
router.post('/', canManage, ctrl.create);
router.get('/:id', canManage, ctrl.getOne);
router.put('/:id', canManage, ctrl.update);
router.delete('/:id', canManage, ctrl.remove);
router.patch('/:id/pin', canManage, ctrl.togglePin);
router.patch('/:id/active', canManage, ctrl.toggleActive);

module.exports = router;
