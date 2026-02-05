const db = require('../config/db');

/**
 * CRITICAL: Ensure wallet balance always matches transaction sum
 * Call this after any wallet operation
 */
async function syncWalletWithTransactions(userId) {
    try {
        const connection = await db.getConnection();
        await connection.beginTransaction();

        // Calculate totals from transactions
        const [totals] = await connection.query(`
            SELECT 
                COALESCE(SUM(CASE WHEN currency_type = 'coins' THEN amount ELSE 0 END), 0) as total_coins,
                COALESCE(SUM(CASE WHEN currency_type = 'gems' THEN amount ELSE 0 END), 0) as total_gems,
                COALESCE(SUM(CASE WHEN currency_type = 'cash' THEN amount ELSE 0 END), 0) as total_cash
            FROM wallet_transactions
            WHERE user_id = ?
        `, [userId]);

        const { total_coins, total_gems, total_cash } = totals[0];

        // Update wallet breakdown to match transactions
        await connection.query(`
            INSERT INTO user_wallet_breakdown (user_id, coins, gems, cash)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                coins = VALUES(coins),
                gems = VALUES(gems),
                cash = VALUES(cash)
        `, [userId, total_coins, total_gems, total_cash]);

        // Update users table balance (cash only)
        await connection.query(`
            UPDATE users 
            SET balance = ?,
                total_earnings = ?
            WHERE id = ?
        `, [total_cash, total_cash, userId]);

        await connection.commit();
        connection.release();

        return {
            coins: parseFloat(total_coins),
            gems: parseFloat(total_gems),
            cash: parseFloat(total_cash)
        };

    } catch (error) {
        console.error('Error syncing wallet:', error);
        throw error;
    }
}

/**
 * Get wallet balance (guaranteed to match transactions)
 */
async function getWalletBalance(userId) {
    // First sync to ensure accuracy
    await syncWalletWithTransactions(userId);

    const [wallet] = await db.query(`
        SELECT coins, gems, cash 
        FROM user_wallet_breakdown 
        WHERE user_id = ?
    `, [userId]);

    if (wallet.length === 0) {
        return { coins: 0, gems: 0, cash: 0 };
    }

    return {
        coins: parseFloat(wallet[0].coins),
        gems: parseFloat(wallet[0].gems),
        cash: parseFloat(wallet[0].cash)
    };
}

module.exports = {
    syncWalletWithTransactions,
    getWalletBalance
};
