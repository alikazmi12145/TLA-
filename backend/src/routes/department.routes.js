const express = require('express');
const ctrl = require('../controllers/department.controller');
const { protect, authorize } = require('../middleware/auth');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(protect);
// Departments: Super Admin only for writes (read open so other pages can populate filters)
const adminOnly = authorize(ROLES.SUPER_ADMIN);

router.get('/', ctrl.list);
router.post('/', adminOnly, ctrl.create);
router.put('/:id', adminOnly, ctrl.update);
router.delete('/:id', authorize(ROLES.SUPER_ADMIN), ctrl.remove);

module.exports = router;
