// Run this to add the scratched_offers table
require('dotenv').config();
const db = require('./config/db');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    const arg = process.argv[2] || 'migrations/add_scratched_offers.sql';
    const file = path.isAbsolute(arg) ? arg : path.join(__dirname, arg);
    try {
        const sql = fs.readFileSync(file, 'utf8');
        const statements = sql
            .split(/;\s*(?:\r?\n|$)/)
            .map(s => s.replace(/^\s*--[^\n]*\n/gm, '').trim())
            .filter(s => s.length > 0);
        for (const stmt of statements) {
            await db.query(stmt);
        }
        console.log(`✅ Migration completed: ${arg}`);
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

runMigration();
