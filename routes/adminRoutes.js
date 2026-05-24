const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const notificationController = require('../controllers/notificationController');
const submissionController = require('../controllers/submissionController');

router.post('/login', adminController.login);
router.get('/users', adminController.getAllUsers);
router.get('/tasks', adminController.getAllTasks);
router.post('/tasks', adminController.createTask);
router.delete('/tasks/:id', adminController.deleteTask);
router.get('/offers', adminController.getAllOffers);
router.get('/offers/:id/steps', adminController.getOfferSteps);
router.post('/offers', adminController.createOffer);
router.put('/offers/:id', adminController.updateOffer);
router.delete('/offers/:id', adminController.deleteOffer);
router.get('/withdrawals', adminController.getWithdrawals);
router.put('/withdrawals/:id', adminController.updateWithdrawalStatus);
router.get('/stats', adminController.getDashboardStats);
router.get('/settings', adminController.getAppSettings);
router.put('/settings', adminController.updateAppSettings);

// Telegram notification test
const { sendOfferApprovedNotification } = require('../services/telegramService');
router.post('/telegram/test', async (req, res) => {
    try {
        const ok = await sendOfferApprovedNotification({
            offerName: 'Test Notification',
            coin: '0',
            phoneNumber: 'admin@test',
            deviceId: 'admin-panel-test',
        });
        if (ok) return res.json({ success: true, message: 'Test message sent to Telegram.' });
        return res.status(400).json({ success: false, message: 'Send failed. Verify bot token & chat id.' });
    } catch (e) {
        return res.status(500).json({ success: false, message: e.message });
    }
});

router.get('/promocodes', adminController.getAllPromoCodes);
router.post('/promocodes', adminController.createPromoCode);
router.put('/promocodes/:id', adminController.updatePromoCode);
router.delete('/promocodes/:id', adminController.deletePromoCode);
router.put('/users/:id/balance', adminController.updateUserBalance);
router.put('/users/:id/referral-count', adminController.updateReferralCount);
router.put('/users/:id', adminController.updateUser);
router.delete('/users/:id', adminController.deleteUser);
router.get('/users/:id', adminController.getUserDetails);
router.get('/users/:id/transactions', adminController.getUserTransactions);
router.get('/users/:id/withdrawals', adminController.getUserWithdrawals);
router.get('/top-referrers', adminController.getTopReferrers);
router.put('/profile/password', adminController.updatePassword);
router.get('/profile', adminController.getProfile);

// Dashboard & Stats
router.get('/stats', adminController.getDashboardStats);
router.get('/transactions', adminController.getRecentTransactions);

// Banner Routes
router.get('/banners', adminController.getAllBanners);
router.post('/banners/upload', adminController.uploadBannerImage);
router.post('/banners', adminController.createBanner);
router.put('/banners/:id', adminController.updateBanner);
router.delete('/banners/:id', adminController.deleteBanner);

// Task Submissions (screenshot review)
router.get('/submissions', submissionController.listSubmissions);
router.put('/submissions/:id', submissionController.reviewSubmission);
router.delete('/submissions/:id', submissionController.deleteSubmission);

// Account Deactivation Requests
router.get('/delete-requests', adminController.getAccountDeleteRequests);
router.put('/delete-requests/:id', adminController.updateDeleteRequestStatus);

// Notifications (Push + In-app)
router.get('/notifications', notificationController.listAdminNotifications);
router.post('/notifications', notificationController.createNotification);
router.delete('/notifications/:id', notificationController.deleteNotification);

// Payment Accounts (Bank / UPI)
router.get('/users/:id/payment-accounts',  adminController.getUserPaymentAccounts);
router.post('/users/:id/payment-accounts', adminController.createPaymentAccount);
router.put('/payment-accounts/:accountId',    adminController.updatePaymentAccount);
router.delete('/payment-accounts/:accountId', adminController.deletePaymentAccount);

module.exports = router;

