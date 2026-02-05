const express = require('express');
const router = express.Router();
const offer18Controller = require('../controllers/offer18Controller');
const adminUtils = require('../utils/offer18AdminUtils');

// User endpoints
router.post('/track-click', offer18Controller.trackClick);
router.get('/postback', offer18Controller.handlePostback);
router.post('/postback', offer18Controller.handlePostback);
router.get('/clicks/:userId', offer18Controller.getClickHistory);
router.get('/wallet/:userId', offer18Controller.getWalletBreakdown);
router.get('/transactions/:userId', offer18Controller.getTransactionHistory);

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
