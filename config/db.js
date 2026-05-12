const mysql = require('mysql2');
const dotenv = require('dotenv');

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'defaultdb',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

if (process.env.DB_SSL === 'true') {
  dbConfig.ssl = { rejectUnauthorized: false };
}

const pool = mysql.createPool(dbConfig);
const promisePool = pool.promise();

const initDB = async () => {
  try {
    console.log('Verifying tables in database:', dbConfig.database);

    // Helper for safe migrations
    const runSafeQuery = async (query, label) => {
      try {
        await promisePool.query(query);
        if (label) console.log(`${label} checked/updated.`);
      } catch (e) {
        if (label) console.log(`Skipping ${label}:`, e.message);
      }
    };

    // ─── Core Tables ───

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        google_id VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        profile_pic VARCHAR(255),
        wallet_balance DECIMAL(10, 2) DEFAULT 0.00,
        device_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // User Column Migrations
    const userMigrations = [
      "ALTER TABLE users ADD COLUMN telegram_id VARCHAR(50) DEFAULT NULL",
      "ALTER TABLE users ADD COLUMN referral_code VARCHAR(10) UNIQUE",
      "ALTER TABLE users ADD COLUMN referred_by VARCHAR(10)",
      "ALTER TABLE users ADD COLUMN total_earnings DECIMAL(10,2) DEFAULT 0.00",
      "ALTER TABLE users ADD COLUMN referral_earnings DECIMAL(10,2) DEFAULT 0.00",
      "ALTER TABLE users ADD COLUMN last_checkin_date DATE",
      "ALTER TABLE users ADD COLUMN checkin_streak INT DEFAULT 0",
      "ALTER TABLE users ADD COLUMN upi_id VARCHAR(255)",
      "ALTER TABLE users ADD COLUMN is_blocked TINYINT(1) DEFAULT 0",
      "ALTER TABLE users ADD COLUMN fcm_token VARCHAR(512) DEFAULT NULL",
      "ALTER TABLE users ADD COLUMN referral_count_adjustment INT DEFAULT 0",
    ];

    for (const sql of userMigrations) {
      await runSafeQuery(sql);
    }

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        reward_coins DECIMAL(10, 2) DEFAULT 0.00,
        icon_color VARCHAR(50),
        action_url VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS offers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        offer_name VARCHAR(255) NOT NULL,
        offer_id VARCHAR(255),
        side_label VARCHAR(100),
        heading VARCHAR(255),
        history_name VARCHAR(255),
        offer_url VARCHAR(255),
        amount DECIMAL(10, 2) DEFAULT 0.00,
        event_name VARCHAR(255),
        description TEXT,
        image_url VARCHAR(255),
        refer_payout VARCHAR(255),
        status VARCHAR(50) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Offer Column Migrations
    const offerMigrations = [
      "ALTER TABLE offers ADD COLUMN tracking_link VARCHAR(255)",
      "ALTER TABLE offers ADD COLUMN refer_payout VARCHAR(255)",
      "ALTER TABLE offers ADD COLUMN currency_type VARCHAR(20) DEFAULT 'cash'",
      "ALTER TABLE offers ADD COLUMN side_label_color VARCHAR(20)"
    ];
    for (const sql of offerMigrations) {
      await runSafeQuery(sql);
    }

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS admin_info (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) DEFAULT NULL,
        email VARCHAR(255) DEFAULT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const adminMigrations = [
      "ALTER TABLE admin_info ADD COLUMN name VARCHAR(255) DEFAULT NULL AFTER username",
      "ALTER TABLE admin_info ADD COLUMN email VARCHAR(255) DEFAULT NULL AFTER name"
    ];
    for (const sql of adminMigrations) {
      await runSafeQuery(sql);
    }

    // Create default admin if not exists
    const [admins] = await promisePool.query('SELECT * FROM admin_info WHERE username = ?', ['admin']);
    if (admins.length === 0) {
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await promisePool.query(
        'INSERT INTO admin_info (username, name, email, password) VALUES (?, ?, ?, ?)',
        ['admin', 'Admin', 'admin@rewardmobi.xyz', hashedPassword]
      );
      console.log('Default admin created.');
    } else {
      await promisePool.query(
        `UPDATE admin_info
         SET name = COALESCE(NULLIF(name, ''), 'Admin'),
             email = COALESCE(NULLIF(email, ''), 'admin@rewardmobi.xyz')
         WHERE username = ?`,
        ['admin']
      );
    }

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        referrer_id INT NOT NULL,
        referred_user_id INT NOT NULL,
        status ENUM('PENDING', 'COMPLETED') DEFAULT 'PENDING',
        commission_earned DECIMAL(10, 2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (referred_user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_referral (referrer_id, referred_user_id)
      )
    `);

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        type ENUM('CREDIT', 'DEBIT') NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        description VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        method VARCHAR(50) NOT NULL,
        details TEXT,
        status ENUM('PENDING', 'APPROVED', 'REJECTED') DEFAULT 'PENDING',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS scratched_offers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        offer_id INT NOT NULL,
        scratched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
        UNIQUE KEY unique_user_offer (user_id, offer_id)
      )
    `);

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS checkins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        checkin_date DATE NOT NULL,
        reward_amount DECIMAL(10, 2) DEFAULT 0,
        streak_count INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_user_date (user_id, checkin_date)
      )
    `);

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        setting_key VARCHAR(100) UNIQUE NOT NULL,
        setting_value TEXT NOT NULL,
        description VARCHAR(255),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS promocodes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        users_limit INT NOT NULL,
        claimed_count INT DEFAULT 0,
        min_offers INT DEFAULT 0,
        min_referrals INT DEFAULT 0,
        for_whom ENUM('All', 'New', 'Old') DEFAULT 'All',
        status ENUM('Active', 'Inactive') DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Promocode Migrations
    await runSafeQuery("ALTER TABLE promocodes ADD COLUMN min_offers INT DEFAULT 0");
    await runSafeQuery("ALTER TABLE promocodes ADD COLUMN min_referrals INT DEFAULT 0");

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS account_delete_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        email VARCHAR(255) NOT NULL,
        balance DECIMAL(10, 2) DEFAULT 0.00,
        note TEXT,
        status ENUM('PENDING', 'CANCELLED', 'DELETED') DEFAULT 'PENDING',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS user_payment_accounts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        account_type ENUM('upi', 'bank') NOT NULL,
        upi_id VARCHAR(255),
        bank_name VARCHAR(255),
        account_holder VARCHAR(255),
        account_number VARCHAR(255),
        ifsc_code VARCHAR(100),
        is_primary TINYINT(1) DEFAULT 0,
        verified TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS used_promo_codes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        promo_id INT NOT NULL,
        claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (promo_id) REFERENCES promocodes(id) ON DELETE CASCADE,
        UNIQUE KEY unique_user_promo (user_id, promo_id)
      )
    `);

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS banners (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255),
        subtitle VARCHAR(255),
        image_url VARCHAR(255),
        action_type VARCHAR(50), -- refer, offers, telegram, url
        action_value VARCHAR(255), -- link or id
        status VARCHAR(20) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed default banners
    const [existingBanners] = await promisePool.query('SELECT COUNT(*) as count FROM banners');
    if (existingBanners[0].count === 0) {
      const defaultBanners = [
        ['REFER AND EARN', 'Invite Friends\\nEarn ₹10+', '', 'refer', 'refer'],
        ['TASK AND EARN', 'Complete Offers\\nEarn Real Cash', '', 'offers', 'offers'],
        ['JOIN TELEGRAM', 'Join Our Channel\\nGet Promo Codes', '', 'telegram', 'https://t.me/rewardmobi']
      ];
      for (const [title, subtitle, image_url, action_type, action_value] of defaultBanners) {
        await promisePool.query(
          'INSERT INTO banners (title, subtitle, image_url, action_type, action_value) VALUES (?, ?, ?, ?, ?)',
          [title, subtitle, image_url, action_type, action_value]
        );
      }
      console.log('Default banners seeded.');
    }

    // Insert default settings
    const defaultSettings = [
      ['new_user_spin_bonus', '2', 'Number of free spins for new users'],
      ['signup_bonus_cash', '5', 'Initial bonus cash (₹) for signing up'],
      ['signup_bonus_coins', '500', 'Initial bonus coins for signing up'],
      ['referral_fixed_reward', '10', 'Fixed reward credited to referrer after friend completes 1st offer'],
      ['referral_commission_percent', '10', 'Commission percentage earned from referred user tasks'],
      ['referral_reward_type', 'both', 'Referral reward model (fixed, percent, or both)'],
      ['referral_reward_target', 'referrer', 'Who receives referral bonuses: referrer, referred_user, or both'],
      ['referral_referred_user_bonus', '0', 'One-time bonus credited to the referred user after meeting referral conditions'],
      ['referral_min_offer_count', '1', 'Minimum approved offers the referred user must complete before referral rewards unlock'],
      ['min_withdrawal', '100', 'Minimum amount for withdrawal'],
      ['coin_rate', '100', 'Conversion rate (e.g. 100 coins = ₹1)'],
      ['spin_reward_values', '1,2,5,10,25,50,100', 'Possible spin wheel reward values (comma-separated)'],
      ['site_name', 'Rewardmobi', 'Name of the application'],
      ['site_url', 'https://rewardmobi.xyz/', 'Website URL'],
      ['telegram_link', 'https://t.me/rewardmobi', 'Telegram channel link'],
      ['whatsapp_link', 'https://whatsapp.com/channel/...', 'WhatsApp channel link'],
      ['support_email', 'support@rewardmobi.xyz', 'Admin support contact email'],
      ['primary_color', '#6DC000', 'Primary theme color'],
      ['wallet_symbol_image_url', '', 'Global wallet symbol image URL used across the app'],
      ['checkin_target_days', '30', 'Days needed for the big reward'],
      ['checkin_target_reward', '50', 'Reward for completing the target streak'],
      ['payment_mode', 'Manual', 'Withdrawal payment mode (Manual/Automatic)'],
      ['update_mode', 'Off', 'App update mode'],
      ['maintenance_mode', 'Off', 'System maintenance mode status'],
      ['refer_text', 'When your referred friends signup they will get a bonus!', 'Text shown for referral invites'],
      ['app_package_name', '', 'Android package name for Play Store Rate Us link'],
      ['privacy_policy_url', '', 'Privacy policy page URL'],
      ['help_support_url', '', 'Help & support page URL'],
      ['currency_symbol', '₹', 'Currency symbol used across the app'],
      ['apk_download_url', '', 'Direct APK download URL for referral sharing'],
      ['telegram_reward_amount', '1', 'Reward amount for joining Telegram channel'],
      ['show_telegram_card', 'On', 'Show or hide the featured Telegram reward card'],
      ['telegram_bot_token', '', 'Telegram Bot API Token (from @BotFather)'],
      ['telegram_chat_id', '', 'Telegram Channel/Group ID (e.g. @yourchannel)'],
      ['maintenance_message', 'We are performing scheduled maintenance. Please check back soon.', 'Message shown when maintenance_mode is On'],
      ['latest_version', '1.2.0', 'Latest published app version (semver)'],
      ['min_supported_version', '1.0.0', 'Minimum app version allowed to use the app (below this is force update)'],
      ['update_message', 'A new version of the app is available. Please update to enjoy new features.', 'Message shown in update prompt'],
      ['update_url', '', 'Play Store / APK URL opened on update tap'],
    ];

    for (const [key, value, description] of defaultSettings) {
      await promisePool.query(
        'INSERT IGNORE INTO app_settings (setting_key, setting_value, description) VALUES (?, ?, ?)',
        [key, value, description]
      );
    }

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS user_spins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        available_spins INT DEFAULT 0,
        total_spins_earned INT DEFAULT 0,
        total_spins_used INT DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_user (user_id)
      )
    `);

    // --- Offer18 Tracking Tables ---

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS offer_clicks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        click_id VARCHAR(64) UNIQUE NOT NULL,
        user_id INT NOT NULL,
        offer_id INT NOT NULL,
        device_id VARCHAR(255),
        ip_address VARCHAR(45),
        user_agent TEXT,
        status VARCHAR(50) DEFAULT 'clicked',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
      )
    `);

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS offer_event_steps (
        id INT AUTO_INCREMENT PRIMARY KEY,
        offer_id INT NOT NULL,
        event_name VARCHAR(100) NOT NULL,
        event_id VARCHAR(100),
        points DECIMAL(10, 2) DEFAULT 0.00,
        currency_type VARCHAR(20) DEFAULT 'cash',
        step_order INT DEFAULT 0,
        is_first_step TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
      )
    `);

    // Multi-event columns
    await runSafeQuery("ALTER TABLE offer_event_steps ADD COLUMN step_order INT DEFAULT 0 AFTER currency_type");
    await runSafeQuery("ALTER TABLE offer_event_steps ADD COLUMN description TEXT AFTER event_id");

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS offer_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        click_id VARCHAR(64) NOT NULL,
        event_step_id INT,
        offer_id INT NOT NULL,
        user_id INT NOT NULL,
        event_name VARCHAR(100),
        event_value DECIMAL(10, 2) DEFAULT 0.00,
        payout DECIMAL(10, 2) NOT NULL,
        currency_type VARCHAR(20) DEFAULT 'cash',
        status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
        postback_data JSON,
        ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
      )
    `);

    await runSafeQuery("ALTER TABLE offer_events ADD COLUMN event_step_id INT AFTER click_id");

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS postback_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        click_id VARCHAR(64),
        offer_id INT,
        raw_data JSON,
        ip_address VARCHAR(45),
        status ENUM('success', 'failed', 'pending') DEFAULT 'pending',
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await runSafeQuery("ALTER TABLE postback_logs MODIFY COLUMN status ENUM('success', 'failed', 'pending') DEFAULT 'pending'");

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS user_wallet_breakdown (
        user_id INT PRIMARY KEY,
        cash DECIMAL(10, 2) DEFAULT 0.00,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        transaction_type VARCHAR(100) NOT NULL,
        currency_type VARCHAR(20) DEFAULT 'cash',
        amount DECIMAL(10, 2) NOT NULL,
        balance_before DECIMAL(10, 2) NOT NULL,
        balance_after DECIMAL(10, 2) NOT NULL,
        offer_id INT,
        event_id INT,
        description TEXT,
        status VARCHAR(50) DEFAULT 'success',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await runSafeQuery("ALTER TABLE wallet_transactions ADD COLUMN status VARCHAR(50) DEFAULT 'success' AFTER description");
    await runSafeQuery("ALTER TABLE wallet_transactions ADD COLUMN withdrawal_id INT AFTER event_id");
    await runSafeQuery("ALTER TABLE wallet_transactions MODIFY COLUMN transaction_type VARCHAR(100) NOT NULL");
    await runSafeQuery("ALTER TABLE wallet_transactions MODIFY COLUMN currency_type VARCHAR(20) DEFAULT 'cash'");

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS referral_downloads (
        id INT AUTO_INCREMENT PRIMARY KEY,
        referral_code VARCHAR(10),
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS referral_attributions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ip_address VARCHAR(45) NOT NULL,
        user_agent TEXT NOT NULL,
        referral_code VARCHAR(10) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_attribution (ip_address, created_at)
      )
    `);

    // Notifications
    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        image_url VARCHAR(512) DEFAULT NULL,
        action_url VARCHAR(512) DEFAULT NULL,
        target ENUM('all', 'user') DEFAULT 'all',
        target_user_id INT DEFAULT NULL,
        sent_count INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS user_notification_reads (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        notification_id INT NOT NULL,
        read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
        UNIQUE KEY uniq_user_notif (user_id, notification_id)
      )
    `);

    // Fraud prevention
    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS device_fingerprints (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        device_id VARCHAR(255) NOT NULL,
        ip_address VARCHAR(45),
        user_agent TEXT,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY idx_device_user (device_id, user_id)
      )
    `);

    console.log('✅ Database initialization complete.');
  } catch (error) {
    console.error('❌ Error during database initialization:', error);
  }
};

initDB();

module.exports = promisePool;
