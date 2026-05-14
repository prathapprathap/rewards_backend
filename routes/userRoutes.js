const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const referralController = require('../controllers/referralController');
const notificationController = require('../controllers/notificationController');
const submissionController = require('../controllers/submissionController');

// ── Static / specific routes FIRST (before :param routes) ─────────────────────
router.get('/app/settings', userController.getAppSettings);
router.get('/app/version-check', notificationController.versionCheck);

// Notifications & FCM
router.post('/:userId/fcm-token', notificationController.registerFcmToken);
router.get('/:userId/notifications', notificationController.getUserNotifications);
router.post('/:userId/notifications/:id/read', notificationController.markNotificationRead);
router.post('/google-login', userController.loginWithGoogle);
router.get('/spins/:userId', userController.getUserSpins);
router.post('/spins/:userId/use', userController.useSpin);
router.post('/promo/:userId/redeem', userController.redeemPromoCode);
router.post('/:userId/apply-referral', userController.applyReferralCode);
router.get('/:userId/referral-stats', referralController.getReferralStats);
router.post('/:userId/scratch-offer', userController.scratchOffer);
router.post('/:userId/request-deactivation', userController.requestAccountDelete);

router.get('/:userId/offers', userController.getUserOffers);

// Task submission (screenshot upload + status)
router.post('/:userId/offers/:offerId/submissions', submissionController.createSubmission);
router.get('/:userId/offers/:offerId/submission', submissionController.getSubmissionStatus);
router.put('/:userId/payout', userController.updatePayoutDetails);

// ── Dynamic :id routes LAST ───────────────────────────────────────────────────
router.get('/:id', userController.getUserProfile);

module.exports = router;
