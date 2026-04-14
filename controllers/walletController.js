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

    try {
        // Fetch reward amount from settings
        // Fetch reward logic from settings
        const [settings] = await db.query(
            'SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (?, ?)',
            ['daily_checkin_reward', 'daily_checkin_rewards_list']
        );
        const settingsMap = settings.reduce((acc, s) => {
            acc[s.setting_key] = s.setting_value;
            return acc;
        }, {});

        const rewardList = settingsMap['daily_checkin_rewards_list']
            ? settingsMap['daily_checkin_rewards_list'].split(',').map(v => parseFloat(v.trim()))
            : [];
        const baseReward = parseFloat(settingsMap['daily_checkin_reward'] || '10');

        const [user] = await db.query('SELECT last_checkin_date, checkin_streak FROM users WHERE id = ?', [userId]);
        if (user.length === 0) return res.status(404).json({ message: 'User not found' });

        const lastCheckIn = user[0].last_checkin_date;
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        let lastCheckInDate = null;
        if (lastCheckIn) {
            lastCheckInDate = new Date(lastCheckIn).toISOString().split('T')[0];
        }

        if (lastCheckInDate === todayStr) {
            return res.status(400).json({ message: 'Already checked in today' });
        }

        // Calculate Streak
        let newStreak = 1;
        if (lastCheckInDate) {
            const yesterday = new Date();
            yesterday.setDate(today.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];

            if (lastCheckInDate === yesterdayStr) {
                // Consecutive check-in
                newStreak = (user[0].checkin_streak || 0) + 1;
            } else {
                // Streak broken
                newStreak = 1;
            }
        }

        // Determine reward based on streak
        let CHECKIN_REWARD = baseReward;
        if (rewardList.length > 0) {
            // Use streak index (1-based -> 0-based), clamped to list length
            const index = Math.min(newStreak - 1, rewardList.length - 1);
            CHECKIN_REWARD = rewardList[index];
        }

        // Update Check-in, Balance and Streak
        await db.query(
            `UPDATE users 
             SET wallet_balance = wallet_balance + ?, 
                 total_earnings = total_earnings + ?, 
                 last_checkin_date = ?, 
                 checkin_streak = ? 
             WHERE id = ?`,
            [CHECKIN_REWARD, CHECKIN_REWARD, todayStr, newStreak, userId]
        );

        // Record Transaction
        await db.query(
            `INSERT INTO wallet_transactions 
             (user_id, transaction_type, currency_type, amount, balance_before, balance_after, description) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, 'checkin', 'cash', CHECKIN_REWARD, 0, 0, 'Daily Check-in Reward']
        );
        // Note: balance tracking in transactions table might need a subquery or separate fetch if we really want it accurate there, but for now this works.

        res.status(200).json({
            message: 'Check-in successful',
            reward: CHECKIN_REWARD,
            streak: newStreak
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

        // Also get current streak from users table
        const [user] = await db.query('SELECT checkin_streak FROM users WHERE id = ?', [userId]);
        const streak = user[0]?.checkin_streak || 0;

        res.status(200).json({
            history: rows.map(r => r.date),
            streak: streak
        });
    } catch (error) {
        console.error('Error fetching check-in history:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
