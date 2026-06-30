const express = require('express');
const ctrl = require('../controllers/report.controller');
const { protect } = require('../middleware/auth');
const { authorizeModule } = require('../middleware/permissions');

const router = express.Router();
router.use(protect, authorizeModule('reports', 'read'));

router.get('/attendance', ctrl.attendance);
router.get('/leave', ctrl.leave);
router.get('/salary', ctrl.salary);
router.get('/commission', ctrl.commission);
router.get('/performance', ctrl.performance);

module.exports = router;
