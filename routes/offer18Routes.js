const express = require('express');
const router = express.Router();
const offer18Controller = require('../controllers/offer18Controller');
const adminUtils = require('../utils/offer18AdminUtils');
const { syncConversions, fetchOffer18Conversions } = require('../utils/offer18Sync');

// User endpoints
router.post('/track-click', offer18Controller.trackClick);
router.get('/postback', offer18Controller.handlePostback);
router.post('/postback', offer18Controller.handlePostback);
router.get('/clicks/:userId', offer18Controller.getClickHistory);
router.get('/wallet/:userId', offer18Controller.getWalletBreakdown);
router.get('/transactions/:userId', offer18Controller.getTransactionHistory);

// Sync conversions FROM Offer18 API (pull-based, reliable alternative to postbacks)
// POST /offer18/sync-conversions?report=1  (1=Today,2=Yesterday,3=Last7Days,4=Last30Days,5=ThisMonth)
router.post('/sync-conversions', async (req, res) => {
    try {
        const report = parseInt(req.query.report || req.body.report || '1');
        console.log(`🔄 Manual sync triggered for report period: ${report}`);
        const results = await syncConversions(report);
        res.json({ success: true, results });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /offer18/fetch-conversions?report=3  (read-only preview from Offer18 API)
router.get('/fetch-conversions', async (req, res) => {
    try {
        const report = parseInt(req.query.report || '1');
        const data = await fetchOffer18Conversions(report);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin endpoints
router.get('/analytics/conversions', offer18Controller.getConversionAnalytics);
router.get('/admin/postback-logs', async (req, res) => {
    try {
        const logs = await adminUtils.getPostbackLogs(req.query);
        res.json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/admin/suspicious-activities', async (req, res) => {
    try {
        const activities = await adminUtils.getSuspiciousActivities();
        res.json({ success: true, activities });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/admin/adjust-wallet', async (req, res) => {
    try {
        const { userId, currencyType, amount, reason } = req.body;
        const result = await adminUtils.adjustWallet(userId, currencyType, amount, reason);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/admin/revenue-analytics', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const analytics = await adminUtils.getRevenueAnalytics(startDate, endDate);
        res.json({ success: true, analytics });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
