const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const referralController = require('../controllers/referralController');

// ── Static / specific routes FIRST (before :param routes) ─────────────────────
router.get('/app/settings', userController.getAppSettings);
router.post('/google-login', userController.loginWithGoogle);
router.get('/spins/:userId', userController.getUserSpins);
router.post('/spins/:userId/use', userController.useSpin);
router.post('/promo/:userId/redeem', userController.redeemPromoCode);
router.get('/:userId/referral-stats', referralController.getReferralStats);
router.post('/:userId/scratch-offer', userController.scratchOffer);
router.get('/:userId/offers', userController.getUserOffers);

// ── Dynamic :id routes LAST ───────────────────────────────────────────────────
router.get('/:id', userController.getUserProfile);

module.exports = router;
