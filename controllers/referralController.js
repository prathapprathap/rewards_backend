// Process referral commission when user completes a task/offer
async function processReferralCommission(userId, earnedAmount) {
    try {
        // Check if this user was referred by someone
        const [referralData] = await db.query(QUERIES.USER.GET_REFERRER_BY_REFERRED_USER, [userId]);

        if (referralData.length === 0) {
            return; // No referrer
        }

        const referrerId = referralData[0].referrer_id;

        // Get commission percentage from settings
        const [commSettings] = await db.query(
            'SELECT setting_value FROM app_settings WHERE setting_key = ?',
            ['referral_commission_percent']
        );
        const commissionPercent = parseFloat(commSettings[0]?.setting_value || '10');
        const commissionAmount = (earnedAmount * commissionPercent) / 100;

        // Credit referrer with commission
        await db.query(QUERIES.USER.ADD_REFERRAL_EARNINGS, [
            commissionAmount,
            commissionAmount,
            commissionAmount,
            referrerId
        ]);

        // Mark referral as completed (first task completion)
        await db.query(QUERIES.USER.MARK_REFERRAL_COMPLETED, [commissionAmount, userId]);

        // Record transaction for referrer
        await db.query(
            'INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
            [referrerId, 'CREDIT', commissionAmount, `Referral commission (${commissionPercent}% from referred user)`]
        );

        console.log(`Referral commission processed: ${commissionAmount} coins to user ${referrerId}`);
    } catch (error) {
        console.error('Error processing referral commission:', error);
        // Don't throw - commission failure shouldn't break the main flow
    }
}

// Get referral stats for a user
exports.getReferralStats = async (req, res) => {
    const { userId } = req.params;

    try {
        const [stats] = await db.query(QUERIES.USER.GET_REFERRAL_STATS, [userId]);

        return res.status(200).json({
            total_referrals: stats[0]?.total_referrals || 0,
            successful_referrals: stats[0]?.successful_referrals || 0,
            total_commission: parseFloat(stats[0]?.total_commission || 0)
        });
    } catch (error) {
        console.error('Error in getReferralStats:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

module.exports.processReferralCommission = processReferralCommission;
