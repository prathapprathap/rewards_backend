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
            `SELECT r.id, r.referrer_id, r.status, r.commission_earned
             FROM referrals r 
             WHERE r.referred_user_id = ? 
             LIMIT 1`,
            [userId]
        );

        if (referralData.length === 0) {
            return; // This user was not referred
        }

        const referral = referralData[0];
        const referrerId = referral.referrer_id;

        // 2. Get settings from admin_settings
        const [settings] = await db.query(
            'SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (?, ?, ?, ?, ?, ?)',
            [
                'referral_commission_percent',
                'referral_fixed_reward',
                'referral_reward_type',
                'referral_reward_target',
                'referral_referred_user_bonus',
                'referral_min_offer_count'
            ]
        );

        const settingsMap = settings.reduce((acc, s) => {
            acc[s.setting_key] = s.setting_value;
            return acc;
        }, {
            referral_commission_percent: '10',
            referral_fixed_reward: '0',
            referral_reward_type: 'both',
            referral_reward_target: 'referrer',
            referral_referred_user_bonus: '0',
            referral_min_offer_count: '1',
        });

        const commissionPercent = parseFloat(settingsMap.referral_commission_percent);
        const fixedRewardAmount = parseFloat(settingsMap.referral_fixed_reward);
        const rewardType = settingsMap.referral_reward_type; // 'fixed', 'percent', or 'both'
        const rewardTarget = (settingsMap.referral_reward_target || 'referrer').toLowerCase();
        const referredUserBonus = parseFloat(settingsMap.referral_referred_user_bonus || '0');
        const minOfferCount = Math.max(1, parseInt(settingsMap.referral_min_offer_count || '1'));

        // Count how many approved offers the referred user has completed.
        const [offerCount] = await db.query(
            "SELECT COUNT(DISTINCT offer_id) as count FROM offer_events WHERE user_id = ? AND status = 'approved'",
            [userId]
        );

        const completedOfferCount = parseInt(offerCount[0]?.count || 0);
        if (completedOfferCount < minOfferCount) {
            return;
        }

        const milestoneReachedNow = referral.status !== 'COMPLETED';
        const rewardReferrer = rewardTarget === 'referrer' || rewardTarget === 'both';
        const rewardReferredUser = rewardTarget === 'referred_user' || rewardTarget === 'both';

        // --- FIXED REWARD LOGIC (referrer one-time bonus after required offers) ---
        if (
            milestoneReachedNow &&
            rewardReferrer &&
            (rewardType === 'fixed' || rewardType === 'both') &&
            fixedRewardAmount > 0
        ) {
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
                    `INSERT INTO user_wallet_breakdown (user_id, cash) VALUES (?, ?)
                     ON DUPLICATE KEY UPDATE cash = cash + ?`,
                    [referrerId, fixedRewardAmount, fixedRewardAmount]
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
                        `Fixed reward for friend (#${userId}) completing ${minOfferCount} required offer(s)`
                    ]
                );
                console.log(`🎁 Fixed referral reward: ₹${fixedRewardAmount} -> referrer user #${referrerId}`);
            }
        }

        // --- REFERRED USER ONE-TIME BONUS ---
        if (milestoneReachedNow && rewardReferredUser && referredUserBonus > 0) {
            const [referredRows] = await db.query(
                'SELECT wallet_balance FROM users WHERE id = ?',
                [userId]
            );

            if (referredRows.length > 0) {
                const balanceBefore = parseFloat(referredRows[0].wallet_balance) || 0;
                const balanceAfter = balanceBefore + referredUserBonus;

                await db.query(
                    `UPDATE users SET 
                     wallet_balance = wallet_balance + ?, 
                     total_earnings = total_earnings + ? 
                     WHERE id = ?`,
                    [referredUserBonus, referredUserBonus, userId]
                );

                await db.query(
                    `INSERT INTO user_wallet_breakdown (user_id, cash) VALUES (?, ?)
                     ON DUPLICATE KEY UPDATE cash = cash + ?`,
                    [userId, referredUserBonus, referredUserBonus]
                );

                await db.query(
                    `INSERT INTO wallet_transactions
                     (user_id, transaction_type, currency_type, amount, balance_before, balance_after, description)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        userId,
                        'referral',
                        'cash',
                        referredUserBonus,
                        balanceBefore,
                        balanceAfter,
                        `Referral bonus after completing ${minOfferCount} required offer(s)`
                    ]
                );
            }
        }

        // --- PERCENTAGE COMMISSION LOGIC ---
        const commissionAmount = parseFloat(((earnedAmount * commissionPercent) / 100).toFixed(2));

        if (
            rewardReferrer &&
            commissionAmount > 0 &&
            (rewardType === 'percent' || rewardType === 'both')
        ) {
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
                     SET status = 'COMPLETED', commission_earned = commission_earned + ?,
                         completed_at = COALESCE(completed_at, NOW())
                     WHERE id = ?`,
                    [commissionAmount, referral.id]
                );

                console.log(`💸 Referral commission: ₹${commissionAmount} (${commissionPercent}%) → referrer user #${referrerId}`);
            }
        }

        if (milestoneReachedNow) {
            await db.query(
                `UPDATE referrals
                 SET status = 'COMPLETED', completed_at = COALESCE(completed_at, NOW())
                 WHERE id = ?`,
                [referral.id]
            );
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
