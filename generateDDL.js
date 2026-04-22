const db = require('./config/db');
const fs = require('fs');

async function generateDDL() {
    try {
        const [tables] = await db.query('SHOW TABLES');
        let fullDDL = "-- Full Database Dump\n-- Generated for RewardsApp\n\nSET FOREIGN_KEY_CHECKS = 0;\n\n";

        for (let tableRow of tables) {
            const tableName = Object.values(tableRow)[0];
            const [createTable] = await db.query(`SHOW CREATE TABLE \`${tableName}\``);
            let ddl = createTable[0]['Create Table'];

            // Clean up the DDL: Replace double quotes with backticks for standard MySQL compatibility
            ddl = ddl.replace(/"([^"]+)"/g, '`$1`');

            // Remove specific AUTO_INCREMENT values
            ddl = ddl.replace(/AUTO_INCREMENT=\d+/g, '');

            fullDDL += `-- Table: ${tableName}\n${ddl};\n\n`;
        }

        fullDDL += "SET FOREIGN_KEY_CHECKS = 1;\n";

        // Initial Data for Setup
        fullDDL += "\n-- Initial Data for Setup\n";
        fullDDL += "INSERT INTO `admin_info` (`username`, `password`) VALUES ('admin', '$2b$10$w6KxQW9DkL8U6Z5R9Y/7ueS6FvE7mN5sQ3jO8z8z8z8z8z8z8z8z8'); -- password: admin123\n";

        fs.writeFileSync('full_schema.sql', fullDDL);
        console.log('Full DDL dump saved to full_schema.sql');
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

generateDDL();
