const db = require('./config/db');

async function migrate() {
    try {
        console.log('Starting migration...');

        // 1. Check if column exists before adding
        const [columns] = await db.query("SHOW COLUMNS FROM users LIKE 'last_login_at'");
        if (columns.length === 0) {
            await db.query(`
                ALTER TABLE users 
                ADD COLUMN last_login_at TIMESTAMP NULL DEFAULT NULL
            `);
            console.log('Added last_login_at to users table.');
        } else {
            console.log('last_login_at column already exists in users table.');
        }

        // 2. Create account_delete_requests table
        await db.query(`
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
        console.log('Created account_delete_requests table.');

        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
