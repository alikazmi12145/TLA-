const express = require('express');
const ctrl = require('../controllers/request.controller');
const { protect } = require('../middleware/auth');
const { authorizeModule } = require('../middleware/permissions');


const router = express.Router();
router.use(protect);

// Employees can create requests for review.
router.post('/', ctrl.create);
router.get('/me', ctrl.myRequests);
router.delete('/:id', ctrl.remove);
router.patch('/:id/reply', ctrl.reply);

// Managers with relevant role OR module permission can list all requests.
const { authorize } = require('../middleware/auth');
const { ROLES } = require('../config/constants');
const canManageRequests = (req, res, next) => {
	// quick role-based allow for common admin roles
	const allowed = [ROLES.SUPER_ADMIN, ROLES.HR_MANAGER, ROLES.TEAM_LEADER];
	if (req.user && allowed.includes(req.user.role)) return next();
	// fallback to module permission check
	return authorizeModule('requests', 'manage')(req, res, next);
};

router.get('/', canManageRequests, ctrl.list);
router.get('/:id', canManageRequests, ctrl.get);
router.patch('/:id/approve', canManageRequests, ctrl.approve);
router.patch('/:id/reject', canManageRequests, ctrl.reject);

module.exports = router;
