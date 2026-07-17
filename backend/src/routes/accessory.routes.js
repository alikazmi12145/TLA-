const express = require('express');
const ctrl = require('../controllers/accessory.controller');
const { protect, authorize } = require('../middleware/auth');
const { authorizeModule } = require('../middleware/permissions');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(protect);

// Super Admin and Administration users can edit the catalog. Reading
// the catalog is open to any authenticated user so employees can browse
// when creating requests.
const catalogAdmin = authorize(ROLES.SUPER_ADMIN, ROLES.ADMINISTRATION);

// Administration users manage requests via the `accessories` permission
// module (`manage`). Read access lets them view the queue.
const requestManagers = authorizeModule('accessories', 'manage');
const flagManage = (req, _res, next) => { req._accessoryManage = true; next(); };

// ---------- Requests ----------
// IMPORTANT: request routes MUST be declared before the catalog `/:id`
// routes below, otherwise Express matches `/requests` as an accessory id
// and the controller responds with a 400 CastError.
router.post('/requests', ctrl.createRequest);
router.get('/requests/me', ctrl.myRequests);
router.get('/requests', requestManagers, flagManage, ctrl.listRequests);
router.get('/requests/:id', ctrl.getRequest);
router.patch('/requests/:id/approve', requestManagers, ctrl.approveRequest);
router.patch('/requests/:id/reject', requestManagers, ctrl.rejectRequest);
router.patch('/requests/:id/issue', requestManagers, ctrl.issueRequest);
router.patch('/requests/:id/complete', requestManagers, ctrl.completeRequest);
router.patch('/requests/:id/remarks', requestManagers, ctrl.updateRemarks);

// ---------- Catalog ----------
router.get('/', ctrl.list);
router.get('/available', ctrl.available);
router.post('/', catalogAdmin, ctrl.create);
router.get('/:id', ctrl.get);
router.put('/:id', catalogAdmin, ctrl.update);
router.delete('/:id', catalogAdmin, ctrl.remove);

module.exports = router;
