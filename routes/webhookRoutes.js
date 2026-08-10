const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

// Public — called by RupiyaX, not by the admin panel.
router.post('/rupiyax', webhookController.rupiyaXWebhook);

module.exports = router;
