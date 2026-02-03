const db = require('../config/db');
const QUERIES = require('../constants/queries');

// Get all users
exports.getAllUsers = async (req, res) => {
    try {
        const [rows] = await db.query(QUERIES.ADMIN.GET_ALL_USERS);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get all tasks
exports.getAllTasks = async (req, res) => {
    try {
        const [rows] = await db.query(QUERIES.ADMIN.GET_ALL_TASKS);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching tasks:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Create a task
exports.createTask = async (req, res) => {
    const { title, description, reward_coins, icon_color, action_url } = req.body;

    try {
        const [result] = await db.query(
            QUERIES.ADMIN.CREATE_TASK,
            [title, description, reward_coins, icon_color, action_url]
        );

        res.status(201).json({
            message: 'Task created successfully',
            task: { id: result.insertId, title, description, reward_coins, icon_color, action_url }
        });
    } catch (error) {
        console.error('Error creating task:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Delete a task
exports.deleteTask = async (req, res) => {
    const { id } = req.params;

    try {
        await db.query(QUERIES.ADMIN.DELETE_TASK, [id]);
        res.status(200).json({ message: 'Task deleted successfully' });
    } catch (error) {
        console.error('Error deleting task:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Create an offer
exports.createOffer = async (req, res) => {
    const {
        offer_name, offer_id, heading, history_name, offer_url,
        amount, event_name, description, image_url, refer_payout, status
    } = req.body;

    try {
        const [result] = await db.query(
            QUERIES.ADMIN.CREATE_OFFER,
            [
                offer_name, offer_id, heading, history_name, offer_url,
                amount, event_name, description, image_url, refer_payout, status
            ]
        );

        res.status(201).json({
            message: 'Offer created successfully',
            offer: { id: result.insertId, ...req.body }
        });
    } catch (error) {
        console.error('Error creating offer:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get all offers
exports.getAllOffers = async (req, res) => {
    try {
        const [rows] = await db.query(QUERIES.ADMIN.GET_ALL_OFFERS);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching offers:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Delete an offer
exports.deleteOffer = async (req, res) => {
    const { id } = req.params;

    try {
        await db.query(QUERIES.ADMIN.DELETE_OFFER, [id]);
        res.status(200).json({ message: 'Offer deleted successfully' });
    } catch (error) {
        console.error('Error deleting offer:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Dashboard Stats
exports.getDashboardStats = async (req, res) => {
    try {
        const [userCount] = await db.query(QUERIES.ADMIN.COUNT_USERS);
        const [taskCount] = await db.query(QUERIES.ADMIN.COUNT_TASKS);
        const [offerCount] = await db.query(QUERIES.ADMIN.COUNT_OFFERS);

        res.status(200).json({
            totalUsers: userCount[0].count,
            totalTasks: taskCount[0].count,
            totalOffers: offerCount[0].count,
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Admin Login
exports.login = async (req, res) => {
    const { username, password } = req.body;
    const bcrypt = require('bcryptjs');

    try {
        const [rows] = await db.query(QUERIES.ADMIN.LOGIN, [username]);

        if (rows.length > 0) {
            const admin = rows[0];
            const isMatch = await bcrypt.compare(password, admin.password);

            if (isMatch) {
                // Don't send password back
                const { password, ...adminData } = admin;
                res.status(200).json({ message: 'Login successful', admin: adminData });
            } else {
                res.status(401).json({ message: 'Invalid credentials' });
            }
        } else {
            res.status(401).json({ message: 'Invalid credentials' });
        }
    } catch (error) {
        console.error('Error logging in:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get all withdrawals
exports.getWithdrawals = async (req, res) => {
    try {
        const [rows] = await db.query(QUERIES.ADMIN.GET_WITHDRAWALS);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching withdrawals:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Update withdrawal status
exports.updateWithdrawalStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // APPROVED or REJECTED

    try {
        await db.query(QUERIES.ADMIN.UPDATE_WITHDRAWAL_STATUS, [status, id]);

        // If rejected, refund the amount
        if (status === 'REJECTED') {
            const [withdrawal] = await db.query(QUERIES.ADMIN.GET_WITHDRAWAL_BY_ID, [id]);
            if (withdrawal.length > 0) {
                const { user_id, amount } = withdrawal[0];
                await db.query(QUERIES.USER.UPDATE_BALANCE_ADD, [amount, user_id]);
                await db.query(QUERIES.WALLET.CREATE_TRANSACTION,
                    [user_id, 'CREDIT', amount, 'Withdrawal Refund']);
            }
        }

        res.status(200).json({ message: 'Withdrawal status updated' });
    } catch (error) {
        console.error('Error updating withdrawal:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get all app settings
exports.getAppSettings = async (req, res) => {
    try {
        const [rows] = await db.query(QUERIES.ADMIN.GET_ALL_SETTINGS);
        // Convert array of settings to object key-value
        const settings = rows.reduce((acc, row) => {
            acc[row.setting_key] = row.setting_value;
            return acc;
        }, {});
        res.status(200).json(settings);
    } catch (error) {
        console.error('Error fetching settings:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Update app settings
exports.updateAppSettings = async (req, res) => {
    const settings = req.body; // Expecting { key: value, ... }

    try {
        // We will loop through provided settings and upsert them
        for (const [key, value] of Object.entries(settings)) {
            // For simplicity, we'll store null for description or handle it differently if needed.
            // Using placeholder description for now.
            await db.query(QUERIES.ADMIN.UPSERT_SETTING, [key, value, 'App Setting']);
        }

        res.status(200).json({ message: 'Settings updated successfully' });
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// --- Promo Codes ---

// Get all promocodes
exports.getAllPromoCodes = async (req, res) => {
    try {
        const [rows] = await db.query(QUERIES.ADMIN.GET_ALL_PROMOCODES);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching promocodes:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Create a promocode
exports.createPromoCode = async (req, res) => {
    let { code, amount, users_limit, for_whom, status } = req.body;

    try {
        // Ensure numeric types are handled correctly
        const parsedAmount = parseFloat(amount);
        const parsedLimit = parseInt(users_limit, 10);

        await db.query(
            QUERIES.ADMIN.CREATE_PROMOCODE,
            [code, parsedAmount, parsedLimit, for_whom, status]
        );
        res.status(201).json({ message: 'Promo code created successfully' });
    } catch (error) {
        console.error('Error creating promocode:', error);
        res.status(500).json({
            message: 'Server error: ' + (error.sqlMessage || error.message || 'Unknown error occurred')
        });
    }
};

// Delete a promocode
exports.deletePromoCode = async (req, res) => {
    const { id } = req.params;

    try {
        await db.query(QUERIES.ADMIN.DELETE_PROMOCODE, [id]);
        res.status(200).json({ message: 'Promo code deleted successfully' });
    } catch (error) {
        console.error('Error deleting promocode:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
