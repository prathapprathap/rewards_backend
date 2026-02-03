module.exports = {
    USER: {
        CHECK_EXISTING_BY_GOOGLE_ID: 'SELECT * FROM users WHERE google_id = ?',
        CHECK_DEVICE_USAGE: 'SELECT * FROM users WHERE device_id = ? AND google_id != ?',
        UPDATE_DEVICE_ID: 'UPDATE users SET device_id = ? WHERE id = ?',
        CREATE_USER: 'INSERT INTO users (google_id, email, name, profile_pic, device_id) VALUES (?, ?, ?, ?, ?)',
        GET_PROFILE_BY_ID: 'SELECT * FROM users WHERE id = ?',
        GET_WALLET_BALANCE: 'SELECT wallet_balance FROM users WHERE id = ?',
        GET_WALLET_INFO: 'SELECT wallet_balance, total_earnings FROM users WHERE id = ?',
        UPDATE_BALANCE_DEDUCT: 'UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?',
        UPDATE_BALANCE_ADD: 'UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?',
        UPDATE_BALANCE_AND_EARNINGS: 'UPDATE users SET wallet_balance = wallet_balance + ?, total_earnings = total_earnings + ? WHERE id = ?',
        GET_LAST_CHECKIN: 'SELECT last_checkin_date FROM users WHERE id = ?',
        UPDATE_CHECKIN: 'UPDATE users SET last_checkin_date = CURDATE(), wallet_balance = wallet_balance + ?, total_earnings = total_earnings + ? WHERE id = ?',
        GET_LEADERBOARD: 'SELECT name, profile_pic, total_earnings FROM users ORDER BY total_earnings DESC LIMIT 10',
        GENERATE_REFERRAL_CODE: 'UPDATE users SET referral_code = ? WHERE id = ?',
        GET_USER_BY_REFERRAL_CODE: 'SELECT id FROM users WHERE referral_code = ?',
        SET_REFERRED_BY: 'UPDATE users SET referred_by = ? WHERE id = ?',
        ADD_REFERRAL_EARNINGS: 'UPDATE users SET wallet_balance = wallet_balance + ?, referral_earnings = referral_earnings + ?, total_earnings = total_earnings + ? WHERE id = ?',
        GET_REFERRAL_STATS: 'SELECT COUNT(*) as total_referrals, SUM(CASE WHEN status = "COMPLETED" THEN 1 ELSE 0 END) as successful_referrals, SUM(commission_earned) as total_commission FROM referrals WHERE referrer_id = ?',
        CREATE_REFERRAL: 'INSERT INTO referrals (referrer_id, referred_user_id) VALUES (?, ?)',
        MARK_REFERRAL_COMPLETED: 'UPDATE referrals SET status = "COMPLETED", commission_earned = ?, completed_at = NOW() WHERE referred_user_id = ? AND status = "PENDING"',
        GET_REFERRER_BY_REFERRED_USER: 'SELECT r.referrer_id, u.referral_code FROM referrals r JOIN users u ON r.referrer_id = u.id WHERE r.referred_user_id = ? AND r.status = "PENDING"',
    },
    ADMIN: {
        GET_ALL_USERS: 'SELECT * FROM users ORDER BY created_at DESC',
        GET_ALL_TASKS: 'SELECT * FROM tasks ORDER BY created_at DESC',
        CREATE_TASK: 'INSERT INTO tasks (title, description, reward_coins, icon_color, action_url) VALUES (?, ?, ?, ?, ?)',
        DELETE_TASK: 'DELETE FROM tasks WHERE id = ?',
        CREATE_OFFER: `INSERT INTO offers (
        offer_name, offer_id, heading, history_name, offer_url, 
        amount, event_name, description, image_url, refer_payout, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        GET_ALL_OFFERS: 'SELECT * FROM offers ORDER BY created_at DESC',
        COUNT_USERS: 'SELECT COUNT(*) as count FROM users',
        COUNT_TASKS: 'SELECT COUNT(*) as count FROM tasks',
        COUNT_OFFERS: 'SELECT COUNT(*) as count FROM offers',
        LOGIN: 'SELECT * FROM admin_info WHERE username = ?',
        GET_WITHDRAWALS: `
      SELECT w.*, u.name, u.email 
      FROM withdrawals w 
      JOIN users u ON w.user_id = u.id 
      ORDER BY w.created_at DESC
    `,
        UPDATE_WITHDRAWAL_STATUS: 'UPDATE withdrawals SET status = ? WHERE id = ?',
        GET_WITHDRAWAL_BY_ID: 'SELECT user_id, amount FROM withdrawals WHERE id = ?',
        GET_ALL_SETTINGS: 'SELECT * FROM app_settings',
        UPSERT_SETTING: `
            INSERT INTO app_settings (setting_key, setting_value, description) 
            VALUES (?, ?, ?) 
            ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), description = VALUES(description)
        `,
        GET_ALL_PROMOCODES: 'SELECT * FROM promocodes ORDER BY created_at DESC',
        CREATE_PROMOCODE: 'INSERT INTO promocodes (code, amount, users_limit, for_whom, status) VALUES (?, ?, ?, ?, ?)',
        DELETE_PROMOCODE: 'DELETE FROM promocodes WHERE id = ?',
        DELETE_OFFER: 'DELETE FROM offers WHERE id = ?',
    },
    WALLET: {
        GET_TRANSACTIONS: 'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC',
        CREATE_TRANSACTION: 'INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
        CREATE_WITHDRAWAL: 'INSERT INTO withdrawals (user_id, amount, method, details) VALUES (?, ?, ?, ?)',
    }
};
