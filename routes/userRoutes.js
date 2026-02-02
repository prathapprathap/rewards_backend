const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const referralController = require('../controllers/referralController');

router.post('/google-login', userController.loginWithGoogle);
router.get('/:id', userController.getUserProfile);
router.get('/:userId/offers', userController.getUserOffers);
router.post('/:userId/scratch-offer', userController.scratchOffer);
router.get('/:userId/spins', userController.getUserSpins);
router.post('/:userId/use-spin', userController.useSpin);
router.get('/:userId/referral-stats', referralController.getReferralStats);
router.get('/app/settings', userController.getAppSettings);

module.exports = router;
