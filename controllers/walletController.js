const db = require('../config/db');
const QUERIES = require('../constants/queries');

// Get User Wallet Info (Balance + Transactions)
exports.getWalletInfo = async (req, res) => {
    const { userId } = req.params;
    try {
        const [user] = await db.query(QUERIES.USER.GET_WALLET_INFO, [userId]);
        const [transactions] = await db.query(QUERIES.WALLET.GET_TRANSACTIONS, [userId]);
        const [breakdown] = await db.query('SELECT cash FROM user_wallet_breakdown WHERE user_id = ?', [userId]);

        if (user.length === 0) return res.status(404).json({ message: 'User not found' });

        res.status(200).json({
            balance: user[0].wallet_balance,
            totalEarnings: user[0].total_earnings,
            cash: breakdown[0]?.cash || 0.00,
            transactions
        });
    } catch (error) {
        console.error('Error fetching wallet info:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Request Withdrawal (Enhanced with Reference Project requirements)
exports.requestWithdrawal = async (req, res) => {
    const { userId, amount, method, details } = req.body;

    try {
        // 1. Get App Settings
        const [settings] = await db.query(
            'SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (?, ?)',
            ['min_withdrawal', 'withdrawal_daily_limit']
        );
        const settingsMap = settings.reduce((acc, s) => {
            acc[s.setting_key] = s.setting_value;
            return acc;
        }, { min_withdrawal: '100', withdrawal_daily_limit: '2' });

        const minWithdrawal = parseFloat(settingsMap.min_withdrawal);
        const dailyLimit = parseInt(settingsMap.withdrawal_daily_limit);

        // 2. Security Check: Must have completed at least 1 unique offer (Legacy parity)
        const [offerCompletions] = await db.query(
            "SELECT COUNT(DISTINCT offer_id) as count FROM offer_events WHERE user_id = ? AND status = 'approved'",
            [userId]
        );
        if (offerCompletions[0].count === 0) {
            return res.status(403).json({ message: 'Please complete at least 1 offer before withdrawing.' });
        }

        // 3. Daily Limit Check
        const [todayWithdrawals] = await db.query(
            "SELECT COUNT(*) as count FROM withdrawals WHERE user_id = ? AND DATE(created_at) = CURDATE()",
            [userId]
        );
        if (todayWithdrawals[0].count >= dailyLimit) {
            return res.status(403).json({ message: `Daily withdrawal limit reached (${dailyLimit}).` });
        }

        // 4. Pending Check (Prevent multiple pending requests)
        const [pendingWithdrawals] = await db.query(
            "SELECT id FROM withdrawals WHERE user_id = ? AND status = 'PENDING'",
            [userId]
        );
        if (pendingWithdrawals.length > 0) {
            return res.status(400).json({ message: 'You already have a pending withdrawal request.' });
        }

        // 5. Balance Check
        const [user] = await db.query(QUERIES.USER.GET_WALLET_BALANCE, [userId]);
        if (user.length === 0) return res.status(404).json({ message: 'User not found' });

        const currentBalance = parseFloat(user[0].wallet_balance);
        const withdrawAmount = parseFloat(amount);

        if (withdrawAmount < minWithdrawal) {
            return res.status(400).json({ message: `Minimum withdrawal amount is ₹${minWithdrawal}` });
        }

        if (currentBalance < withdrawAmount) {
            return res.status(400).json({ message: 'Insufficient balance' });
        }

        const balanceBefore = currentBalance;
        const balanceAfter = currentBalance - withdrawAmount;

        // 6. TRUNCATED TRANSACTIONAL ATTEMPT (Using direct queries for safety)

        // Create Withdrawal Request record first to get ID
        const [withdrawalResult] = await db.query(QUERIES.WALLET.CREATE_WITHDRAWAL,
            [userId, withdrawAmount, method, details]);
        const withdrawalId = withdrawalResult.insertId;

        // Deduct balance
        await db.query(QUERIES.USER.UPDATE_BALANCE_DEDUCT, [withdrawAmount, userId]);

        // Record in wallet_transactions linked to withdrawalId
        await db.query(
            `INSERT INTO wallet_transactions 
            (user_id, transaction_type, currency_type, amount, balance_before, balance_after, description, status, withdrawal_id) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, 'withdrawal', 'cash', -withdrawAmount, balanceBefore, balanceAfter, `Withdrawal via ${method}: ${details}`, 'pending', withdrawalId]
        );

        // Update user_wallet_breakdown (Deduct cash)
        await db.query(
            'UPDATE user_wallet_breakdown SET cash = cash - ? WHERE user_id = ? AND cash >= ?',
            [withdrawAmount, userId, withdrawAmount]
        );

        res.status(200).json({
            message: 'Withdrawal request submitted successfully! It will be processed within 24 hours.',
            newBalance: balanceAfter,
            withdrawalId: withdrawalId
        });
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
        // Get spin reward values from settings
        const [settings] = await db.query(
            'SELECT setting_value FROM app_settings WHERE setting_key = ?',
            ['spin_reward_values']
        );

        const rewardValues = settings[0]?.setting_value.split(',').map(v => parseFloat(v.trim())) || [1, 2, 5, 10];
        const randomReward = rewardValues[Math.floor(Math.random() * rewardValues.length)];

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
            'SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (?, ?, ?, ?)',
            ['daily_checkin_reward', 'daily_checkin_rewards_list', 'checkin_target_days', 'checkin_target_reward']
        );
        const settingsMap = settings.reduce((acc, s) => {
            acc[s.setting_key] = s.setting_value;
            return acc;
        }, {});

        const targetDays = parseInt(settingsMap['checkin_target_days'] || '30');
        const targetReward = parseFloat(settingsMap['checkin_target_reward'] || '50');
        const rewardList = settingsMap['daily_checkin_rewards_list']
            ? settingsMap['daily_checkin_rewards_list'].split(',').map(v => parseFloat(v.trim()))
            : [];
        const baseReward = parseFloat(settingsMap['daily_checkin_reward'] || '0');

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

        // Determine reward
        let reward = 0;
        let finalStreak = newStreak;
        let milestoneReached = false;

        if (newStreak >= targetDays) {
            reward = targetReward;
            milestoneReached = true;
            finalStreak = 0; // Reset for next cycle
        } else {
            reward = 0; // Each day does NOT have rewards per user request
        }

        // Update Check-in, Balance and Streak
        await db.query(
            `UPDATE users 
             SET wallet_balance = wallet_balance + ?, 
                 total_earnings = total_earnings + ?, 
                 last_checkin_date = ?, 
                 checkin_streak = ? 
             WHERE id = ?`,
            [reward, reward, todayStr, finalStreak, userId]
        );

        // Record Check-in Entry (ALWAYS, even if reward is 0)
        await db.query(
            `INSERT IGNORE INTO checkins (user_id, checkin_date, reward_amount, streak_count)
             VALUES (?, ?, ?, ?)`,
            [userId, todayStr, reward, finalStreak === 0 ? targetDays : finalStreak]
        );

        if (reward > 0) {
            // Record Transaction (Only if money earned)
            await db.query(
                `INSERT INTO wallet_transactions 
                 (user_id, transaction_type, currency_type, amount, balance_before, balance_after, description) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [userId, milestoneReached ? 'milestone' : 'checkin', 'cash', reward, 0, 0, milestoneReached ? `Check-in Milestone (${targetDays} Days)` : 'Daily Check-in Reward']
            );
        }

        res.status(200).json({
            message: milestoneReached ? `CONGRATULATIONS! You completed ${targetDays} days streak!` : 'Check-in successful',
            reward: reward,
            streak: finalStreak,
            milestoneReached: milestoneReached
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
            `SELECT checkin_date as date 
             FROM checkins 
             WHERE user_id = ?
             AND checkin_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
             ORDER BY checkin_date DESC`,
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
