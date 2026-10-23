const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const passwordResetController = require('../controllers/passwordResetController');
const { authenticateToken } = require('../middleware/auth');
const { avatarUpload } = require('../middleware/upload');
const { authRateLimiter } = require('../middleware/rateLimiter');

// Public Routes
router.post('/send-otp', authController.sendOtp);
router.post('/verify-otp', authController.verifyOtp);
router.post('/register', authController.register);
router.post('/login', authRateLimiter, authController.login);

/**
 * Self-service password reset.
 *
 * Rate limited like any other credential entry point - otherwise this becomes a
 * free way to spam reset mail at an address, or to brute-force tokens.
 */
router.post(
  '/forgot-password',
  authRateLimiter,
  passwordResetController.requestPasswordReset
);

router.get(
  '/reset-password/verify',
  passwordResetController.verifyResetToken
);

router.post(
  '/reset-password',
  authRateLimiter,
  passwordResetController.resetPassword
);

/**
 * Google sign-in. Rate limited like any other credential check, because this
 * endpoint accepts an externally issued token and must not be a free oracle.
 */
router.post(
  '/google',
  authRateLimiter,
  authController.googleSignIn
);

// Protected Routes (JWT Token Required)
router.get('/me', authenticateToken, authController.getMe);
router.put('/me', authenticateToken, authController.updateProfile);
router.post('/me/email/request-change', authenticateToken, authController.requestEmailChange);
router.post('/me/email/verify-change', authenticateToken, authController.verifyEmailChange);

/**
 * Profile picture.
 * avatarUpload enforces images-only and a 2MB cap, and its fileFilter runs
 * before anything touches disk.
 */
router.post(
  '/avatar',
  authenticateToken,
  avatarUpload.single('avatar'),
  authController.uploadAvatar
);

router.delete('/avatar', authenticateToken, authController.deleteAvatar);

module.exports = router;
