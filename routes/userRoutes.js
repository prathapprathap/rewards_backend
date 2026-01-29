const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

router.post('/google-login', userController.loginWithGoogle);
router.get('/:id', userController.getUserProfile);
router.get('/:userId/offers', userController.getUserOffers);
router.post('/:userId/scratch-offer', userController.scratchOffer);
router.get('/:userId/spins', userController.getUserSpins);
router.post('/:userId/use-spin', userController.useSpin);
router.get('/app/settings', userController.getAppSettings);

module.exports = router;
