const db = require('../config/db');
const QUERIES = require('../constants/queries');

/**
 * Called every time User B (referred user) earns cash from an offer.
 * Automatically credits User A (referrer) a % commission (from app_settings).
 * Commission is ALWAYS cash (₹).
 */
async function processReferralCommission(userId, earnedAmount) {
    try {
        // 1. Find who referred this user
        const [referralData] = await db.query(
            `SELECT r.referrer_id 
             FROM referrals r 
             WHERE r.referred_user_id = ? 
             LIMIT 1`,
            [userId]
        );

        if (referralData.length === 0) {
            return; // This user was not referred
        }

        const referrerId = referralData[0].referrer_id;

        // 2. Get settings from admin_settings
        const [settings] = await db.query(
            'SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (?, ?, ?)',
            ['referral_commission_percent', 'referral_fixed_reward', 'referral_reward_type']
        );

        const settingsMap = settings.reduce((acc, s) => {
            acc[s.setting_key] = s.setting_value;
            return acc;
        }, { referral_commission_percent: '10', referral_fixed_reward: '0', referral_reward_type: 'both' });

        const commissionPercent = parseFloat(settingsMap.referral_commission_percent);
        const fixedRewardAmount = parseFloat(settingsMap.referral_fixed_reward);
        const rewardType = settingsMap.referral_reward_type; // 'fixed', 'percent', or 'both'

        // --- FIXED REWARD LOGIC (First Offer Completion) ---
        // Check if this is the user's first approved offer
        const [offerCount] = await db.query(
            "SELECT COUNT(DISTINCT offer_id) as count FROM offer_events WHERE user_id = ? AND status = 'approved'",
            [userId]
        );

        if (offerCount[0].count === 1 && (rewardType === 'fixed' || rewardType === 'both') && fixedRewardAmount > 0) {
            const [referrerRows] = await db.query(
                'SELECT wallet_balance FROM users WHERE id = ?',
                [referrerId]
            );
            if (referrerRows.length > 0) {
                const balanceBefore = parseFloat(referrerRows[0].wallet_balance) || 0;
                const balanceAfter = balanceBefore + fixedRewardAmount;

                await db.query(
                    `UPDATE users SET 
                     wallet_balance = wallet_balance + ?, 
                     total_earnings = total_earnings + ?, 
                     referral_earnings = referral_earnings + ? 
                     WHERE id = ?`,
                    [fixedRewardAmount, fixedRewardAmount, fixedRewardAmount, referrerId]
                );

                await db.query(
                    `INSERT INTO wallet_transactions 
                     (user_id, transaction_type, currency_type, amount, balance_before, balance_after, description)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        referrerId,
                        'referral',
                        'cash',
                        fixedRewardAmount,
                        balanceBefore,
                        balanceAfter,
                        `Fixed reward for friend (#${userId}) completing their first offer`
                    ]
                );
                console.log(`🎁 Fixed referral reward: ₹${fixedRewardAmount} -> referrer user #${referrerId}`);
            }
        }

        // --- PERCENTAGE COMMISSION LOGIC ---
        const commissionAmount = parseFloat(((earnedAmount * commissionPercent) / 100).toFixed(2));

        if (commissionAmount > 0 && (rewardType === 'percent' || rewardType === 'both')) {
            const [referrerRows] = await db.query(
                'SELECT wallet_balance FROM users WHERE id = ?',
                [referrerId]
            );
            if (referrerRows.length > 0) {
                const balanceBefore = parseFloat(referrerRows[0].wallet_balance) || 0;
                const balanceAfter = balanceBefore + commissionAmount;

                await db.query(
                    'UPDATE users SET wallet_balance = wallet_balance + ?, total_earnings = total_earnings + ?, referral_earnings = referral_earnings + ? WHERE id = ?',
                    [commissionAmount, commissionAmount, commissionAmount, referrerId]
                );

                await db.query(
                    `INSERT INTO wallet_transactions 
                     (user_id, transaction_type, currency_type, amount, balance_before, balance_after, description)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        referrerId,
                        'referral',
                        'cash',
                        commissionAmount,
                        balanceBefore,
                        balanceAfter,
                        `Referral commission ${commissionPercent}% from referred user #${userId}`
                    ]
                );

                await db.query(
                    `INSERT INTO user_wallet_breakdown (user_id, cash) VALUES (?, ?)
                     ON DUPLICATE KEY UPDATE cash = cash + ?`,
                    [referrerId, commissionAmount, commissionAmount]
                );

                await db.query(
                    `UPDATE referrals 
                     SET status = 'COMPLETED', commission_earned = commission_earned + ?, completed_at = NOW() 
                     WHERE referred_user_id = ?`,
                    [commissionAmount, userId]
                );

                console.log(`💸 Referral commission: ₹${commissionAmount} (${commissionPercent}%) → referrer user #${referrerId}`);
            }
        }
    } catch (error) {
        console.error('❌ Error processing referral commission:', error.message);
    }
}

// GET /api/users/:userId/referral-stats
exports.getReferralStats = async (req, res) => {
    const { userId } = req.params;
    try {
        const [stats] = await db.query(
            `SELECT 
               COUNT(*) as total_referrals,
               SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as successful_referrals,
               COALESCE(SUM(commission_earned), 0) as total_commission
             FROM referrals WHERE referrer_id = ?`,
            [userId]
        );
        return res.status(200).json({
            total_referrals: parseInt(stats[0]?.total_referrals || 0),
            successful_referrals: parseInt(stats[0]?.successful_referrals || 0),
            total_commission: parseFloat(stats[0]?.total_commission || 0)
        });
    } catch (error) {
        console.error('Error in getReferralStats:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

module.exports.processReferralCommission = processReferralCommission;
