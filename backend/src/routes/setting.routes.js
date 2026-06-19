const express = require('express');
const ctrl = require('../controllers/setting.controller');
const { protect, authorize } = require('../middleware/auth');
const { upload, withSubdir } = require('../middleware/upload');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(protect);

router.get('/', ctrl.get);
router.put(
  '/',
  authorize(ROLES.SUPER_ADMIN),
  withSubdir('logo'),
  upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'ceoSignature', maxCount: 1 },
  ]),
  ctrl.update
);

module.exports = router;
