const express = require('express');
const ctrl = require('../controllers/leave.controller');
const { protect } = require('../middleware/auth');
const { authorizeModule } = require('../middleware/permissions');

const router = express.Router();
router.use(protect);
const readers = authorizeModule('leaves', 'read');
const writers = authorizeModule('leaves', 'manage');

router.post('/', ctrl.apply);
router.get('/me', ctrl.myLeaves);
router.get('/me/balance', ctrl.balance);
router.get('/balance/:id', readers, ctrl.balance);
router.get('/calendar', ctrl.calendar);

router.get('/', readers, ctrl.list);
router.get('/analytics', readers, ctrl.analytics);
router.patch('/:id/action', writers, ctrl.action);

module.exports = router;
