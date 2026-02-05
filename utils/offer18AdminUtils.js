// Offer18 Admin Utilities
// Helper functions for managing Offer18 integration

const db = require('../db/connection');

/**
 * Get all postback logs with filters
 */
async function getPostbackLogs(filters = {}) {
    const { limit = 100, status, offerId, startDate, endDate } = filters;

    let query = 'SELECT * FROM postback_logs WHERE 1=1';
    const params = [];

    if (status) {
        query += ' AND status = ?';
        params.push(status);
    }

    if (offerId) {
        query += ' AND offer_id = ?';
        params.push(offerId);
    }

    if (startDate) {
        query += ' AND created_at >= ?';
        params.push(startDate);
    }

    if (endDate) {
        query += ' AND created_at <= ?';
        params.push(endDate);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    const [logs] = await db.query(query, params);
    return logs;
}

/**
 * Get click conversion rate by offer
 */
async function getClickConversionRate(offerId) {
    const query = `
    SELECT 
      o.id,
      o.offer_name,
      COUNT(DISTINCT c.id) as total_clicks,
      COUNT(DISTINCT CASE WHEN c.status = 'completed' THEN c.id END) as conversions,
      ROUND(
        (COUNT(DISTINCT CASE WHEN c.status = 'completed' THEN c.id END) * 100.0) / 
        NULLIF(COUNT(DISTINCT c.id), 0), 
        2
      ) as conversion_rate
    FROM offers o
    LEFT JOIN offer_clicks c ON o.id = c.offer_id
    WHERE o.id = ?
    GROUP BY o.id
  `;

    const [results] = await db.query(query, [offerId]);
    return results[0] || null;
}

/**
 * Get user earning breakdown by currency
 */
async function getUserEarnings(userId) {
    const query = `
    SELECT 
      user_id,
      coins,
      gems,
      cash,
      (SELECT COUNT(*) FROM wallet_transactions WHERE user_id = ? AND transaction_type = 'offer_reward') as total_offers_completed,
      (SELECT SUM(amount) FROM wallet_transactions WHERE user_id = ? AND currency_type = 'cash' AND transaction_type = 'offer_reward') as total_cash_earned
    FROM user_wallet_breakdown
    WHERE user_id = ?
  `;

    const [results] = await db.query(query, [userId, userId, userId]);
    return results[0] || {
        coins: 0,
        gems: 0,
        cash: 0,
        total_offers_completed: 0,
        total_cash_earned: 0
    };
}

/**
 * Manually adjust user wallet (admin only)
 */
async function adjustWallet(userId, currencyType, amount, reason) {
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // Get current balance
        const [wallet] = await connection.query(
            'SELECT * FROM user_wallet_breakdown WHERE user_id = ? FOR UPDATE',
            [userId]
        );

        let currentWallet = wallet[0];
        if (!currentWallet) {
            // Create wallet if doesn't exist
            await connection.query(
                'INSERT INTO user_wallet_breakdown (user_id, coins, gems, cash) VALUES (?, 0, 0, 0)',
                [userId]
            );
            currentWallet = { coins: 0, gems: 0, cash: 0 };
        }

        const balanceBefore = parseFloat(currentWallet[currencyType] || 0);
        const balanceAfter = balanceBefore + parseFloat(amount);

        // Update wallet
        await connection.query(
            `UPDATE user_wallet_breakdown SET ${currencyType} = ? WHERE user_id = ?`,
            [balanceAfter, userId]
        );

        // Log transaction
        await connection.query(
            `INSERT INTO wallet_transactions 
       (user_id, transaction_type, currency_type, amount, balance_before, balance_after, description) 
       VALUES (?, 'admin_adjustment', ?, ?, ?, ?, ?)`,
            [userId, currencyType, amount, balanceBefore, balanceAfter, reason]
        );

        await connection.commit();

        return {
            success: true,
            previousBalance: balanceBefore,
            newBalance: balanceAfter,
            adjustment: amount
        };

    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

/**
 * Get suspicious activities (potential fraud)
 */
async function getSuspiciousActivities() {
    const query = `
    SELECT 
      u.id as user_id,
      u.email,
      COUNT(DISTINCT df.device_id) as device_count,
      COUNT(DISTINCT oc.ip_address) as ip_count,
      COUNT(*) as total_clicks,
      COUNT(CASE WHEN oc.status = 'completed' THEN 1 END) as conversions,
      MAX(oc.created_at) as last_click
    FROM users u
    LEFT JOIN device_fingerprints df ON u.id = df.user_id
    LEFT JOIN offer_clicks oc ON u.id = oc.user_id
    GROUP BY u.id
    HAVING device_count > 3 OR ip_count > 5
    ORDER BY device_count DESC, ip_count DESC
    LIMIT 50
  `;

    const [results] = await db.query(query);
    return results;
}

/**
 * Mark device as suspicious
 */
async function markDeviceAsSuspicious(deviceId, notes) {
    const query = `
    UPDATE device_fingerprints 
    SET is_suspicious = TRUE, notes = ? 
    WHERE device_id = ?
  `;

    await db.query(query, [notes, deviceId]);
    return { success: true };
}

/**
 * Get revenue analytics by date range
 */
async function getRevenueAnalytics(startDate, endDate) {
    const query = `
    SELECT 
      DATE(created_at) as date,
      currency_type,
      COUNT(*) as transaction_count,
      SUM(amount) as total_amount,
      COUNT(DISTINCT user_id) as unique_users
    FROM wallet_transactions
    WHERE transaction_type = 'offer_reward'
      AND created_at BETWEEN ? AND ?
    GROUP BY DATE(created_at), currency_type
    ORDER BY date DESC, currency_type
  `;

    const [results] = await db.query(query, [startDate, endDate]);
    return results;
}

/**
 * Retry failed postbacks
 */
async function retryFailedPostback(logId) {
    const [logs] = await db.query(
        'SELECT * FROM postback_logs WHERE id = ? AND status = "failed"',
        [logId]
    );

    if (logs.length === 0) {
        throw new Error('Postback log not found or not in failed status');
    }

    const log = logs[0];
    // Here you would re-process the postback
    // This is a placeholder - actual implementation would call handlePostback

    return {
        success: true,
        message: 'Postback queued for retry',
        logId: logId
    };
}

module.exports = {
    getPostbackLogs,
    getClickConversionRate,
    getUserEarnings,
    adjustWallet,
    getSuspiciousActivities,
    markDeviceAsSuspicious,
    getRevenueAnalytics,
    retryFailedPostback
};
