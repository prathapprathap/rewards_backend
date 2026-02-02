const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

router.post('/login', adminController.login);
router.get('/users', adminController.getAllUsers);
router.get('/tasks', adminController.getAllTasks);
router.post('/tasks', adminController.createTask);
router.delete('/tasks/:id', adminController.deleteTask);
router.get('/offers', adminController.getAllOffers);
router.post('/offers', adminController.createOffer);
router.get('/withdrawals', adminController.getWithdrawals);
router.put('/withdrawals/:id', adminController.updateWithdrawalStatus);
router.get('/stats', adminController.getDashboardStats);
router.get('/settings', adminController.getAppSettings);
router.put('/settings', adminController.updateAppSettings);

router.get('/promocodes', adminController.getAllPromoCodes);
router.post('/promocodes', adminController.createPromoCode);
router.delete('/promocodes/:id', adminController.deletePromoCode);

module.exports = router;
