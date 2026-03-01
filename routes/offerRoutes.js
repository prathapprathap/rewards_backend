const express = require('express');
const router = express.Router();
const offerController = require('../controllers/offerController');

// ── Public / user-facing routes ──────────────────────────────────────────────

// GET  /offers/offerwall   – active offers with event milestones
router.get('/offerwall', offerController.getOfferwallOffers);

// GET  /offers/:offerId/events?userId=<id>  – per-offer events with completion
router.get('/:offerId/events', offerController.getOfferEvents);

// ── Admin routes ─────────────────────────────────────────────────────────────

// GET  /offers             – all offers (admin view)
router.get('/', offerController.getAllOffers);

// POST /offers             – create offer + optional multi-event steps
router.post('/', offerController.createOfferWithEvents);

// PUT  /offers/:id         – update offer + optional multi-event steps
router.put('/:id', offerController.updateOfferWithEvents);

// DELETE /offers/:id
router.delete('/:id', offerController.deleteOffer);

module.exports = router;
