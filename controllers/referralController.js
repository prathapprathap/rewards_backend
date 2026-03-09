const db = require('../config/db');
const QUERIES = require('../constants/queries');

/**
 * Called every time User B (referred user) earns cash from an offer.
 * Automatically credits User A (referrer) a % commission (from app_settings).
 * Commission is ALWAYS cash (₹).
 */
async function processReferralCommission(userId, earnedAmount) {
    try {
        // 1. Find who referred this user (look up referred_by referral_code → referrer id)
        const [referralData] = await db.query(
            `SELECT r.referrer_id 
             FROM referrals r 
             WHERE r.referred_user_id = ? 
             LIMIT 1`,
            [userId]
        );

        if (referralData.length === 0) {
            return; // This user was not referred — nothing to do
        }

        const referrerId = referralData[0].referrer_id;

        // 2. Get commission % from admin settings (default 10%)
        const [commSettings] = await db.query(
            'SELECT setting_value FROM app_settings WHERE setting_key = ?',
            ['referral_commission_percent']
        );
        const commissionPercent = parseFloat(commSettings[0]?.setting_value || '10');
        const commissionAmount = parseFloat(((earnedAmount * commissionPercent) / 100).toFixed(2));

        if (commissionAmount <= 0) return;

        // 3. Get referrer's current balance
        const [referrerRows] = await db.query(
            'SELECT wallet_balance, total_earnings, referral_earnings FROM users WHERE id = ?',
            [referrerId]
        );
        if (referrerRows.length === 0) return;

        const balanceBefore = parseFloat(referrerRows[0].wallet_balance) || 0;
        const balanceAfter = balanceBefore + commissionAmount;

        // 4. Credit referrer's cash wallet
        await db.query(
            'UPDATE users SET wallet_balance = wallet_balance + ?, total_earnings = total_earnings + ?, referral_earnings = referral_earnings + ? WHERE id = ?',
            [commissionAmount, commissionAmount, commissionAmount, referrerId]
        );

        // 5. Record in wallet_transactions (same table as offer rewards)
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

        // 6. Also update user_wallet_breakdown cash column
        await db.query(
            `INSERT INTO user_wallet_breakdown (user_id, cash) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE cash = cash + ?`,
            [referrerId, commissionAmount, commissionAmount]
        );

        // 7. Mark referral row as COMPLETED (only first time)
        await db.query(
            `UPDATE referrals 
             SET status = 'COMPLETED', commission_earned = commission_earned + ?, completed_at = NOW() 
             WHERE referred_user_id = ?`,
            [commissionAmount, userId]
        );

        console.log(`💸 Referral commission: ₹${commissionAmount} (${commissionPercent}%) → referrer user #${referrerId}`);

    } catch (error) {
        console.error('❌ Error processing referral commission:', error.message);
        // Don't throw — commission failure must NOT break the main payout flow
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
