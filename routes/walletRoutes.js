const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');

router.get('/:userId', walletController.getWalletInfo);
router.post('/withdraw', walletController.requestWithdrawal);
router.post('/spin', walletController.spinWheel);
router.post('/checkin', walletController.dailyCheckIn);
router.get('/leaderboard', walletController.getLeaderboard);

module.exports = router;
