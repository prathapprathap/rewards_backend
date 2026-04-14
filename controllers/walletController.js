const db = require('../config/db');
const QUERIES = require('../constants/queries');

// Get User Wallet Info (Balance + Transactions)
exports.getWalletInfo = async (req, res) => {
    const { userId } = req.params;
    try {
        const [user] = await db.query(QUERIES.USER.GET_WALLET_INFO, [userId]);
        const [transactions] = await db.query(QUERIES.WALLET.GET_TRANSACTIONS, [userId]);

        if (user.length === 0) return res.status(404).json({ message: 'User not found' });

        res.status(200).json({
            balance: user[0].wallet_balance,
            totalEarnings: user[0].total_earnings,
            transactions
        });
    } catch (error) {
        console.error('Error fetching wallet info:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Request Withdrawal
exports.requestWithdrawal = async (req, res) => {
    const { userId, amount, method, details } = req.body;

    try {
        // Check balance
        const [user] = await db.query(QUERIES.USER.GET_WALLET_BALANCE, [userId]);
        if (user.length === 0) return res.status(404).json({ message: 'User not found' });

        const currentBalance = parseFloat(user[0].wallet_balance);
        const withdrawAmount = parseFloat(amount);

        if (currentBalance < withdrawAmount) {
            return res.status(400).json({ message: 'Insufficient balance' });
        }

        const balanceBefore = currentBalance;
        const balanceAfter = currentBalance - withdrawAmount;

        // Deduct balance
        await db.query(QUERIES.USER.UPDATE_BALANCE_DEDUCT, [withdrawAmount, userId]);

        // Record in wallet_transactions (this is what the app reads)
        await db.query(
            `INSERT INTO wallet_transactions 
            (user_id, transaction_type, currency_type, amount, balance_before, balance_after, description) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, 'withdrawal', 'cash', -withdrawAmount, balanceBefore, balanceAfter, `Withdrawal via ${method}: ${details}`]
        );

        // Create Withdrawal Request record
        await db.query(QUERIES.WALLET.CREATE_WITHDRAWAL,
            [userId, withdrawAmount, method, details]);

        res.status(200).json({ message: 'Withdrawal request submitted successfully' });
    } catch (error) {
        console.error('Error requesting withdrawal:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Spin Wheel Logic
exports.spinWheel = async (req, res) => {
    const { userId } = req.body;
    const SPIN_COST = 0; // Free for now, or set a cost

    try {
        // Random reward logic (simple version)
        const rewards = [1, 5, 10, 0.5, 2, 0, 50, 100];
        const randomReward = rewards[Math.floor(Math.random() * rewards.length)];

        // Update Balance
        await db.query(QUERIES.USER.UPDATE_BALANCE_AND_EARNINGS,
            [randomReward, randomReward, userId]);

        // Record Transaction
        await db.query(QUERIES.WALLET.CREATE_TRANSACTION,
            [userId, 'CREDIT', randomReward, 'Spin Wheel Reward']);

        res.status(200).json({
            message: 'Spin successful',
            reward: randomReward,
            newBalance: (await db.query(QUERIES.USER.GET_WALLET_BALANCE, [userId]))[0][0].wallet_balance
        });
    } catch (error) {
        console.error('Error spinning wheel:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Daily Check-in
exports.dailyCheckIn = async (req, res) => {
    const { userId } = req.body;
    const CHECKIN_REWARD = 10; // 10 coins for daily check-in

    try {
        const [user] = await db.query(QUERIES.USER.GET_LAST_CHECKIN, [userId]);
        if (user.length === 0) return res.status(404).json({ message: 'User not found' });

        const lastCheckIn = user[0].last_checkin_date;
        const today = new Date().toISOString().split('T')[0];
        const lastCheckInDate = lastCheckIn ? new Date(lastCheckIn).toISOString().split('T')[0] : null;

        if (lastCheckInDate === today) {
            return res.status(400).json({ message: 'Already checked in today' });
        }

        // Update Check-in and Balance
        await db.query(QUERIES.USER.UPDATE_CHECKIN, [CHECKIN_REWARD, CHECKIN_REWARD, userId]);

        // Record Transaction
        await db.query(QUERIES.WALLET.CREATE_TRANSACTION,
            [userId, 'CREDIT', CHECKIN_REWARD, 'Daily Check-in Reward']);

        res.status(200).json({
            message: 'Check-in successful',
            reward: CHECKIN_REWARD,
            newBalance: (await db.query(QUERIES.USER.GET_WALLET_BALANCE, [userId]))[0][0].wallet_balance
        });
    } catch (error) {
        console.error('Error daily check-in:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get Leaderboard
exports.getLeaderboard = async (req, res) => {
    try {
        const [rows] = await db.query(QUERIES.USER.GET_LEADERBOARD);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
// Get Daily Check-in History (last 30 days)
exports.getCheckInHistory = async (req, res) => {
    const { userId } = req.params;
    try {
        const [rows] = await db.query(
            `SELECT DATE(created_at) as date 
             FROM wallet_transactions 
             WHERE user_id = ? AND description = 'Daily Check-in Reward'
             AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             ORDER BY created_at DESC`,
            [userId]
        );

        // Convert to a simple array of dates or just indicate which of last 30 days are done
        res.status(200).json(rows.map(r => r.date));
    } catch (error) {
        console.error('Error fetching check-in history:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
