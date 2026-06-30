const express = require('express');
const ctrl = require('../controllers/target.controller');
const { protect } = require('../middleware/auth');
const { authorizeModule } = require('../middleware/permissions');

const router = express.Router();
router.use(protect);
const readers = authorizeModule('targets', 'read');
const writers = authorizeModule('targets', 'manage');

router.get('/me', ctrl.mine);
router.get('/ranking', readers, ctrl.ranking);
// allow employees to mark their own target complete (before generic /:id routes)
router.patch('/:id/complete', ctrl.complete);
router.patch('/:id/employee-note', ctrl.addEmployeeNote);
router.get('/', readers, ctrl.list);
router.post('/', writers, ctrl.create);
router.put('/:id', writers, ctrl.update);
router.delete('/:id', writers, ctrl.remove);

module.exports = router;
