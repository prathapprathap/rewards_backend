const db = require('./config/db');

async function checkSchema() {
    try {
        const [tables] = await db.query('SHOW TABLES');
        for (let tableRow of tables) {
            const tableName = Object.values(tableRow)[0];
            console.log(`\nTable: ${tableName}`);
            const [columns] = await db.query(`DESCRIBE ${tableName}`);
            console.table(columns);
        }
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkSchema();
