const db = require('../config/db');

// Get list of all tables
exports.getTables = async (req, res) => {
    try {
        const [tables] = await db.query('SHOW TABLES');
        const tableNames = tables.map(table => Object.values(table)[0]);
        res.status(200).json(tableNames);
    } catch (error) {
        console.error('Error fetching tables:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get table structure (columns)
exports.getTableStructure = async (req, res) => {
    const { tableName } = req.params;
    try {
        const [columns] = await db.query(`DESCRIBE ${tableName}`);
        res.status(200).json(columns);
    } catch (error) {
        console.error('Error fetching table structure:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get table data with pagination
exports.getTableData = async (req, res) => {
    const { tableName } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    try {
        // Get total count
        const [countResult] = await db.query(`SELECT COUNT(*) as total FROM ${tableName}`);
        const total = countResult[0].total;

        // Get data with pagination
        const [rows] = await db.query(`SELECT * FROM ${tableName} LIMIT ? OFFSET ?`, [parseInt(limit), offset]);

        res.status(200).json({
            data: rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching table data:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Create a record
exports.createRecord = async (req, res) => {
    const { tableName } = req.params;
    const data = req.body;

    try {
        const columns = Object.keys(data).join(', ');
        const placeholders = Object.keys(data).map(() => '?').join(', ');
        const values = Object.values(data);

        const [result] = await db.query(
            `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`,
            values
        );

        res.status(201).json({ message: 'Record created successfully', id: result.insertId });
    } catch (error) {
        console.error('Error creating record:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Update a record
exports.updateRecord = async (req, res) => {
    const { tableName, id } = req.params;
    const data = req.body;

    try {
        const setClause = Object.keys(data).map(key => `${key} = ?`).join(', ');
        const values = [...Object.values(data), id];

        await db.query(
            `UPDATE ${tableName} SET ${setClause} WHERE id = ?`,
            values
        );

        res.status(200).json({ message: 'Record updated successfully' });
    } catch (error) {
        console.error('Error updating record:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Delete a record
exports.deleteRecord = async (req, res) => {
    const { tableName, id } = req.params;

    try {
        await db.query(`DELETE FROM ${tableName} WHERE id = ?`, [id]);
        res.status(200).json({ message: 'Record deleted successfully' });
    } catch (error) {
        console.error('Error deleting record:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};
