// Run this to add the scratched_offers table
require('dotenv').config();
const db = require('./config/db');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    try {
        const sql = fs.readFileSync(
            path.join(__dirname, 'migrations', 'add_scratched_offers.sql'),
            'utf8'
        );

        await db.query(sql);
        console.log('✅ Migration completed: scratched_offers table created');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

runMigration();
