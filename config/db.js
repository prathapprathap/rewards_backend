const mysql = require('mysql2');
const dotenv = require('dotenv');

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'hot_reward_db',
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
    // Check if database exists, if not create it (requires root connection without db selected usually, but here we assume db might exist or we handle it)
    // For simplicity in this environment, we'll assume the DB is created or we can try to create it.
    // Actually, standard mysql2 connection fails if DB doesn't exist. 
    // Let's try to connect without DB first to create it.

    const connectionConfig = {
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      port: process.env.DB_PORT || 3306,
    };

    if (process.env.DB_SSL === 'true') {
      connectionConfig.ssl = { rejectUnauthorized: false };
    }

    const connection = await mysql.createConnection(connectionConfig).promise();

    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || 'hot_reward_db'}\``);
    await connection.end();

    console.log('Database checked/created successfully.');

    // Now create tables
    const createUsersTable = `
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
    `;

    await promisePool.query(createUsersTable);
    console.log('Users table checked/created successfully.');

    const createTasksTable = `
      CREATE TABLE IF NOT EXISTS tasks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        reward_coins DECIMAL(10, 2) DEFAULT 0.00,
        icon_color VARCHAR(50),
        action_url VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await promisePool.query(createTasksTable);
    console.log('Tasks table checked/created successfully.');

    const createOffersTable = `
      CREATE TABLE IF NOT EXISTS offers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        offer_name VARCHAR(255) NOT NULL,
        offer_id VARCHAR(255),
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
    `;

    await promisePool.query(createOffersTable);
    console.log('Offers table checked/created successfully.');

    const createAdminTable = `
      CREATE TABLE IF NOT EXISTS admin_info (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await promisePool.query(createAdminTable);
    console.log('Admin table checked/created successfully.');

    // Create default admin if not exists
    const [admins] = await promisePool.query('SELECT * FROM admin_info WHERE username = ?', ['admin']);
    if (admins.length === 0) {
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await promisePool.query('INSERT INTO admin_info (username, password) VALUES (?, ?)', ['admin', hashedPassword]);
      console.log('Default admin created.');
    } else {
      // Optional: Update plain text password to hashed if it matches 'admin123' (for migration)
      const admin = admins[0];
      if (admin.password === 'admin123') {
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash('admin123', 10);
        await promisePool.query('UPDATE admin_info SET password = ? WHERE id = ?', [hashedPassword, admin.id]);
        console.log('Updated default admin password to hash.');
      }
    }

    // Update Users Table for Referrals
    try {
      await promisePool.query(`ALTER TABLE users ADD COLUMN referral_code VARCHAR(10) UNIQUE`);
      await promisePool.query(`ALTER TABLE users ADD COLUMN referred_by VARCHAR(10)`);
      await promisePool.query(`ALTER TABLE users ADD COLUMN total_earnings DECIMAL(10, 2) DEFAULT 0.00`);
      await promisePool.query(`ALTER TABLE users ADD COLUMN referral_earnings DECIMAL(10, 2) DEFAULT 0.00`);
      await promisePool.query(`ALTER TABLE users ADD COLUMN last_checkin_date DATE`);
      console.log('Users table updated with referral and checkin columns.');
    } catch (e) {
      // Ignore if columns already exist
    }

    // Create Referrals Tracking Table
    const createReferralsTable = `
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
    `;
    await promisePool.query(createReferralsTable);
    console.log('Referrals table checked/created successfully.');

    const createTransactionsTable = `
      CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        type ENUM('CREDIT', 'DEBIT') NOT NULL,
        amount DECIMAL(10, 2) NOT NULL,
        description VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `;
    await promisePool.query(createTransactionsTable);
    console.log('Transactions table checked/created successfully.');

    const createWithdrawalsTable = `
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
    `;
    await promisePool.query(createWithdrawalsTable);
    console.log('Withdrawals table checked/created successfully.');

    const createScratchedOffersTable = `
      CREATE TABLE IF NOT EXISTS scratched_offers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        offer_id INT NOT NULL,
        scratched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
        UNIQUE KEY unique_user_offer (user_id, offer_id)
      )
    `;
    await promisePool.query(createScratchedOffersTable);
    console.log('Scratched offers table checked/created successfully.');

    const createAppSettingsTable = `
      CREATE TABLE IF NOT EXISTS app_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        setting_key VARCHAR(100) UNIQUE NOT NULL,
        setting_value TEXT NOT NULL,
        description VARCHAR(255),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `;
    await promisePool.query(createAppSettingsTable);
    console.log('App settings table checked/created successfully.');

    // Insert default settings if not exists
    const defaultSettings = [
      ['new_user_spin_bonus', '2', 'Number of free spins for new users'],
      ['new_user_coin_bonus', '0', 'Bonus coins for new users'],
      ['referral_reward', '10', 'Coins earned when someone uses your referral code'],
      ['referral_commission_percent', '10', 'Commission percentage earned when referred users complete tasks'],
      ['min_withdrawal', '100', 'Minimum amount for withdrawal'],
      ['spin_reward_values', '1,2,5,10,25,50,100', 'Possible spin wheel reward values (comma-separated)'],
    ];

    for (const [key, value, description] of defaultSettings) {
      await promisePool.query(
        'INSERT IGNORE INTO app_settings (setting_key, setting_value, description) VALUES (?, ?, ?)',
        [key, value, description]
      );
    }
    console.log('Default app settings initialized.');

    const createUserSpinsTable = `
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
    `;
    await promisePool.query(createUserSpinsTable);
    console.log('User spins table checked/created successfully.');

  } catch (error) {
    console.error('Error initializing database:', error);
  }
};

initDB();

module.exports = promisePool;
