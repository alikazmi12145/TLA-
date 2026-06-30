const express = require('express');
const ctrl = require('../controllers/shift.controller');
const { protect } = require('../middleware/auth');
const { authorizeModule } = require('../middleware/permissions');

const router = express.Router();
router.use(protect);
const readers = authorizeModule('shifts', 'read');
const writers = authorizeModule('shifts', 'manage');

router.get('/', readers, ctrl.list);
router.post('/', writers, ctrl.create);
router.put('/:id', writers, ctrl.update);
router.delete('/:id', writers, ctrl.remove);

module.exports = router;
