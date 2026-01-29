const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

router.post('/google-login', userController.loginWithGoogle);
router.get('/:id', userController.getUserProfile);
router.get('/:userId/offers', userController.getUserOffers);
router.post('/:userId/scratch-offer', userController.scratchOffer);

module.exports = router;
