const express = require('express');
const router = express.Router();
const scratchCardController = require('../controllers/scratchCardController');

// Get random scratchable offer for user
router.get('/scratchable/:userId', scratchCardController.getScratchableOffer);

// Mark offer as scratched
router.post('/scratched', scratchCardController.markOfferScratched);

// Get offer details with steps
router.get('/details/:offerId', scratchCardController.getOfferDetails);

module.exports = router;
