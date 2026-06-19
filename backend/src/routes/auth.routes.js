const express = require('express');
const ctrl = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth');
const { upload, withSubdir } = require('../middleware/upload');

const router = express.Router();

router.post('/login', ctrl.login);
router.post('/refresh', ctrl.refresh);
router.post('/forgot-password', ctrl.forgotPassword);
router.post('/reset-password', ctrl.resetPassword);

router.post('/logout', protect, ctrl.logout);
router.get('/me', protect, ctrl.me);
router.patch('/me', protect, withSubdir('profiles'), upload.single('profilePicture'), ctrl.updateProfile);
router.post('/change-password', protect, ctrl.changePassword);

module.exports = router;
