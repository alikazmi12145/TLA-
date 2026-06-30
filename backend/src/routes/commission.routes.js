const express = require('express');
const ctrl = require('../controllers/commission.controller');
const { protect } = require('../middleware/auth');
const { authorizeModule } = require('../middleware/permissions');

const router = express.Router();
router.use(protect);
const readers = authorizeModule('commissions', 'read');
const writers = authorizeModule('commissions', 'manage');

router.get('/me', ctrl.mine);
router.get('/monthly-total', readers, ctrl.monthlyTotal);
router.get('/', readers, ctrl.list);
router.post('/', writers, ctrl.create);
router.put('/:id', writers, ctrl.update);
router.delete('/:id', writers, ctrl.remove);

module.exports = router;
