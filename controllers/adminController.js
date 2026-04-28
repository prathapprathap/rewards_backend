const db = require('../config/db');
const QUERIES = require('../constants/queries');
const fs = require('fs/promises');
const path = require('path');

function getPublicBaseUrl(req) {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = (forwardedProto || req.protocol || 'http').split(',')[0].trim();
    return `${protocol}://${req.get('host')}`;
}

function normalizeBannerLink(value) {
    const trimmed = (value || '').toString().trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
}

function getBannerUploadPathFromUrl(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') return null;
    const marker = '/uploads/banners/';
    const index = imageUrl.indexOf(marker);
    if (index === -1) return null;
    const fileName = imageUrl.slice(index + marker.length);
    if (!fileName) return null;
    return path.join(__dirname, '..', 'uploads', 'banners', fileName);
}

async function persistBannerImage(imagePayload, req) {
    if (!imagePayload) return null;

    let dataUrl = '';
    let fileNameSeed = 'banner';

    if (typeof imagePayload === 'string') {
        dataUrl = imagePayload;
    } else {
        dataUrl =
            imagePayload.dataUrl ||
            imagePayload.data ||
            imagePayload.base64 ||
            '';
        fileNameSeed = imagePayload.name || fileNameSeed;
    }

    if (!dataUrl.startsWith('data:image/') || !dataUrl.includes('base64,')) {
        return null;
    }

    const mimeMatch = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/i);
    const mimeType = mimeMatch ? mimeMatch[1].toLowerCase() : 'image/png';
    const extensionMap = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
    };
    const extension = extensionMap[mimeType] || 'png';
    const safeSeed = fileNameSeed.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'banner';
    const fileName = `${Date.now()}-${safeSeed}.${extension}`;
    const uploadDir = path.join(__dirname, '..', 'uploads', 'banners');
    const base64Data = dataUrl.split('base64,')[1];

    await fs.mkdir(uploadDir, { recursive: true });
    await fs.writeFile(path.join(uploadDir, fileName), Buffer.from(base64Data, 'base64'));

    return `${getPublicBaseUrl(req)}/uploads/banners/${fileName}`;
}

async function removeLocalBannerImage(imageUrl) {
    const filePath = getBannerUploadPathFromUrl(imageUrl);
    if (!filePath) return;
    try {
        await fs.unlink(filePath);
    } catch (_) {
        // Ignore missing files
    }
}

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

// Create an offer (with optional multi-event steps)
exports.createOffer = async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const {
            offer_name, offer_id, side_label = '', heading, history_name = '',
            offer_url, tracking_link = '', amount,
            currency_type = 'cash', event_name = '',
            description = '', image_url = '',
            refer_payout = '1st Event', status = 'Active',
            side_label_color = '',
            events = []  // array of { event_id, event_name, points, currency_type }
        } = req.body;

        const [result] = await connection.query(
            QUERIES.ADMIN.CREATE_OFFER,
            [offer_name, offer_id, side_label, side_label_color, heading, history_name, offer_url,
                tracking_link, amount, currency_type, event_name,
                description, image_url, refer_payout, status]
        );

        const newOfferId = result.insertId;
        let totalAmount = 0;

        // Insert event steps if provided
        if (Array.isArray(events) && events.length > 0) {
            for (let i = 0; i < events.length; i++) {
                const ev = events[i];
                const points = parseFloat(ev.points) || 0;
                totalAmount += points;
                await connection.query(
                    `INSERT INTO offer_event_steps
                     (offer_id, event_id, event_name, description, points, currency_type, \`step_order\`)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [newOfferId, ev.event_id || `evt${i}`, ev.event_name, ev.description || '',
                        points, ev.currency_type || currency_type, i]
                );
            }
            // Update offer total amount based on steps
            await connection.query('UPDATE offers SET amount = ? WHERE id = ?', [totalAmount, newOfferId]);
        } else if (event_name) {
            // Backward-compat: single event_name → one step
            await connection.query(
                `INSERT INTO offer_event_steps
                 (offer_id, event_id, event_name, points, currency_type, \`step_order\`)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [newOfferId, 'evt0', event_name, amount, currency_type, 0]
            );
        }

        await connection.commit();
        res.status(201).json({
            message: 'Offer created successfully',
            offer: { id: newOfferId, ...req.body }
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error creating offer:', error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        connection.release();
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

// Get steps for a specific offer
exports.getOfferSteps = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query(QUERIES.ADMIN.GET_OFFER_STEPS, [id]);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching offer steps:', error);
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

// Update an offer (with optional multi-event steps)
exports.updateOffer = async (req, res) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const { id } = req.params;
        const {
            offer_name, offer_id, side_label = '', side_label_color = '', heading, history_name = '',
            offer_url, tracking_link = '', amount,
            currency_type = 'cash', event_name = '',
            description = '', image_url = '',
            refer_payout = '1st Event', status = 'Active',
            events = []
        } = req.body;

        await connection.query(
            QUERIES.ADMIN.UPDATE_OFFER,
            [offer_name, offer_id, side_label, side_label_color, heading, history_name,
                offer_url, tracking_link, amount,
                currency_type, event_name, description,
                image_url, refer_payout, status, id]
        );

        // Replace event steps if provided
        if (Array.isArray(events) && events.length > 0) {
            await connection.query(
                'DELETE FROM offer_event_steps WHERE offer_id = ?', [id]
            );
            let totalAmount = 0;
            for (let i = 0; i < events.length; i++) {
                const ev = events[i];
                const points = parseFloat(ev.points) || 0;
                totalAmount += points;
                await connection.query(
                    `INSERT INTO offer_event_steps
                     (offer_id, event_id, event_name, description, points, currency_type, \`step_order\`)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [id, ev.event_id || `evt${i}`, ev.event_name, ev.description || '',
                        points, ev.currency_type || currency_type, i]
                );
            }
            // Sync the main offer amount with the steps total
            await connection.query('UPDATE offers SET amount = ? WHERE id = ?', [totalAmount, id]);
        }

        await connection.commit();
        res.status(200).json({
            message: 'Offer updated successfully',
            offer: { id, ...req.body }
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error updating offer:', error);
        res.status(500).json({
            message: 'Server error: ' + (error.sqlMessage || error.message || 'Unknown error occurred'),
            db_error: error.sqlMessage,
            query: error.sql
        });
    } finally {
        connection.release();
    }
};

// Dashboard Stats
exports.getDashboardStats = async (req, res) => {
    try {
        const [[userCount]] = await db.query(QUERIES.ADMIN.COUNT_USERS);
        const [[todayLogin]] = await db.query(QUERIES.ADMIN.COUNT_TODAY_LOGIN);
        const [[newJoinedToday]] = await db.query(QUERIES.ADMIN.COUNT_NEW_USERS_TODAY);
        const [[todayLeads]] = await db.query(QUERIES.ADMIN.COUNT_TODAY_LEADS);
        const [[activeOffers]] = await db.query(QUERIES.ADMIN.COUNT_ACTIVE_OFFERS);
        const [[pendingPayouts]] = await db.query(QUERIES.ADMIN.COUNT_PENDING_WITHDRAWALS);
        const [[todayWithdrawals]] = await db.query(QUERIES.ADMIN.COUNT_TODAY_WITHDRAWALS);
        const [[todayPayouts]] = await db.query(QUERIES.ADMIN.SUM_TODAY_PAYOUTS);

        res.status(200).json({
            totalUsers: userCount.count,
            todayLogin: todayLogin.count,
            newJoinedToday: newJoinedToday.count,
            todayLeads: todayLeads.count,
            activeOffer: activeOffers.count,
            pendingPayouts: pendingPayouts.count,
            todayWithdrawals: todayWithdrawals.count,
            todayPayouts: todayPayouts.sum || 0,
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Recent Transactions
exports.getRecentTransactions = async (req, res) => {
    try {
        const [rows] = await db.query(QUERIES.ADMIN.GET_RECENT_TRANSACTIONS);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching recent transactions:', error);
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

exports.getProfile = async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT id, username, name, email, created_at FROM admin_info ORDER BY id ASC LIMIT 1'
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Admin profile not found' });
        }

        const admin = rows[0];
        res.status(200).json({
            id: admin.id,
            username: admin.username,
            name: admin.name || admin.username,
            email: admin.email || 'admin@rewardmobi.xyz',
            created_at: admin.created_at,
        });
    } catch (error) {
        console.error('Error fetching admin profile:', error);
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

        // Update the status in wallet_transactions table too
        const wtStatus = status === 'APPROVED' || status === 'PAID' ? 'success' : (status === 'REJECTED' ? 'rejected' : 'pending');
        await db.query('UPDATE wallet_transactions SET status = ? WHERE withdrawal_id = ?', [wtStatus, id]);

        // If rejected, refund the amount
        if (status === 'REJECTED') {
            const [withdrawalRows] = await db.query(QUERIES.ADMIN.GET_WITHDRAWAL_BY_ID, [id]);
            if (withdrawalRows.length > 0) {
                const { user_id, amount } = withdrawalRows[0];
                const refundAmount = parseFloat(amount);

                // Fetch current balance for accurate transaction logging
                const [userRows] = await db.query(QUERIES.USER.GET_WALLET_BALANCE, [user_id]);
                const balanceBefore = parseFloat(userRows[0]?.wallet_balance || 0);
                const balanceAfter = balanceBefore + refundAmount;

                // Refund to main balance
                await db.query(QUERIES.USER.UPDATE_BALANCE_ADD, [refundAmount, user_id]);

                // Record Refund transaction
                await db.query(
                    `INSERT INTO wallet_transactions 
                    (user_id, transaction_type, currency_type, amount, balance_before, balance_after, description, status) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [user_id, 'refund', 'cash', refundAmount, balanceBefore, balanceAfter, `Refund: Withdrawal Request #${id} Rejected`, 'success']
                );

                // Refund to breakdown ledger
                await db.query(
                    'UPDATE user_wallet_breakdown SET cash = cash + ? WHERE user_id = ?',
                    [refundAmount, user_id]
                );
            }
        }

        res.status(200).json({ message: 'Withdrawal status updated' });
    } catch (error) {
        console.error('Error updating withdrawal:', error);
        res.status(500).json({ message: 'Server error: ' + error.message });
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
    let { code, amount, users_limit, min_offers, min_referrals, for_whom, status } = req.body;

    try {
        // Ensure numeric types are handled correctly
        const parsedAmount = parseFloat(amount);
        const parsedLimit = parseInt(users_limit, 10);
        const parsedMinOffers = parseInt(min_offers || 0, 10);
        const parsedMinReferrals = parseInt(min_referrals || 0, 10);

        await db.query(
            QUERIES.ADMIN.CREATE_PROMOCODE,
            [code, parsedAmount, parsedLimit, parsedMinOffers, parsedMinReferrals, for_whom, status]
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

// Update a promocode
exports.updatePromoCode = async (req, res) => {
    const { id } = req.params;
    const { code, amount, users_limit, min_offers, min_referrals, for_whom, status } = req.body;

    try {
        // Ensure numeric types are handled correctly
        const parsedAmount = parseFloat(amount);
        const parsedLimit = parseInt(users_limit, 10);
        const parsedMinOffers = parseInt(min_offers || 0, 10);
        const parsedMinReferrals = parseInt(min_referrals || 0, 10);

        if (isNaN(parsedAmount) || isNaN(parsedLimit)) {
            return res.status(400).json({ message: 'Invalid amount or limit value' });
        }

        await db.query(
            QUERIES.ADMIN.UPDATE_PROMOCODE,
            [code, parsedAmount, parsedLimit, parsedMinOffers, parsedMinReferrals, for_whom, status, id]
        );
        res.status(200).json({ message: 'Promo code updated successfully' });
    } catch (error) {
        console.error('Error updating promocode:', error);
        res.status(500).json({
            message: 'Server error: ' + (error.sqlMessage || error.message || 'Unknown error occurred')
        });
    }
};

// Update user balance
exports.updateUserBalance = async (req, res) => {
    const { id } = req.params;
    let { wallet_balance } = req.body;

    try {
        // Ensure balance is a valid number
        const balanceNum = parseFloat(wallet_balance);
        if (isNaN(balanceNum)) {
            return res.status(400).json({ message: 'Invalid balance value' });
        }

        await db.query(QUERIES.ADMIN.UPDATE_USER_BALANCE, [balanceNum, id]);
        res.status(200).json({ message: 'User balance updated successfully' });
    } catch (error) {
        console.error('Error updating user balance:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

exports.getUserDetails = async (req, res) => {
    const { id } = req.params;

    try {
        const [[user]] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const [[withdrawalStats]] = await db.query(
            `SELECT
                COUNT(*) AS total_withdrawals,
                COALESCE(SUM(amount), 0) AS total_withdraw_amount,
                COALESCE(SUM(CASE WHEN DATE(created_at) = CURDATE() THEN amount ELSE 0 END), 0) AS today_withdraw_amount
             FROM withdrawals
             WHERE user_id = ? AND status IN ('APPROVED', 'PAID')`,
            [id]
        );

        const [[offerStats]] = await db.query(
            `SELECT
                COUNT(*) AS total_tasks
             FROM offer_events
             WHERE user_id = ? AND status = 'approved'`,
            [id]
        );

        res.status(200).json({
            ...user,
            total_withdrawals: withdrawalStats.total_withdrawals || 0,
            total_withdraw_amount: parseFloat(withdrawalStats.total_withdraw_amount) || 0,
            today_withdraw_amount: parseFloat(withdrawalStats.today_withdraw_amount) || 0,
            total_tasks: offerStats.total_tasks || 0,
        });
    } catch (error) {
        console.error('Error fetching user details:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.getUserTransactions = async (req, res) => {
    const { id } = req.params;

    try {
        const [rows] = await db.query(
            `SELECT *
             FROM wallet_transactions
             WHERE user_id = ?
             ORDER BY created_at DESC`,
            [id]
        );
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching user transactions:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.getUserWithdrawals = async (req, res) => {
    const { id } = req.params;

    try {
        const [rows] = await db.query(
            `SELECT *
             FROM withdrawals
             WHERE user_id = ?
             ORDER BY created_at DESC`,
            [id]
        );
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching user withdrawals:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.getTopReferrers = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT
                u.id,
                u.name,
                u.email,
                u.device_id,
                u.wallet_balance,
                u.created_at,
                u.referral_code,
                u.referred_by,
                COUNT(r.id) AS total_referrals
            FROM users u
            LEFT JOIN referrals r
                ON r.referrer_id = u.id
               AND r.status IN ('PENDING', 'COMPLETED')
            GROUP BY
                u.id, u.name, u.email, u.device_id, u.wallet_balance,
                u.created_at, u.referral_code, u.referred_by
            HAVING total_referrals > 0
            ORDER BY total_referrals DESC, u.wallet_balance DESC
            LIMIT 50
        `);

        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching top referrers:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Delete user
exports.deleteUser = async (req, res) => {
    const { id } = req.params;
    try {
        await db.query(QUERIES.ADMIN.DELETE_USER, [id]);
        res.status(200).json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Update user details (admin)
exports.updateUser = async (req, res) => {
    const { id } = req.params;
    const { name, email, phone, upi_id, status } = req.body;

    try {
        const [[existing]] = await db.query('SELECT id FROM users WHERE id = ?', [id]);
        if (!existing) {
            return res.status(404).json({ message: 'User not found' });
        }

        const fields = [];
        const values = [];

        if (name !== undefined)   { fields.push('name = ?');   values.push(name); }
        if (email !== undefined)  { fields.push('email = ?');  values.push(email); }
        if (phone !== undefined)  { fields.push('phone = ?');  values.push(phone); }
        if (upi_id !== undefined) { fields.push('upi_id = ?'); values.push(upi_id); }
        if (status !== undefined) { fields.push('status = ?'); values.push(status); }

        if (fields.length === 0) {
            return res.status(400).json({ message: 'No fields to update' });
        }

        values.push(id);
        await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);

        res.status(200).json({ message: 'User updated successfully' });
    } catch (error) {
        console.error('Error updating user:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Update Password
exports.updatePassword = async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const bcrypt = require('bcryptjs');

    try {
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ message: 'Current password and new password are required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ message: 'New password must be at least 6 characters long' });
        }

        const [rows] = await db.query(
            'SELECT * FROM admin_info ORDER BY id ASC LIMIT 1'
        );
        if (rows.length === 0) return res.status(404).json({ message: 'Admin not found' });

        const admin = rows[0];
        const isMatch = await bcrypt.compare(currentPassword, admin.password);
        if (!isMatch) return res.status(401).json({ message: 'Incorrect current password' });

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await db.query('UPDATE admin_info SET password = ? WHERE id = ?', [hashedPassword, admin.id]);

        res.status(200).json({ message: 'Password updated successfully' });
    } catch (error) {
        console.error('Error updating password:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// --- Banners ---
exports.getAllBanners = async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM banners ORDER BY id DESC');
        res.status(200).json(
            rows.map((row) => ({
                ...row,
                click_url: row.action_value || '',
            }))
        );
    } catch (error) {
        console.error('Error fetching banners:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.uploadBannerImage = async (req, res) => {
    try {
        const imageUrl = await persistBannerImage(req.body.image_file, req);
        if (!imageUrl) {
            return res.status(400).json({ message: 'Valid image file is required' });
        }

        res.status(201).json({
            message: 'Banner image uploaded successfully',
            image_url: imageUrl,
        });
    } catch (error) {
        console.error('Error uploading banner image:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.createBanner = async (req, res) => {
    const { title, subtitle, image_url, image_file, action_value, click_url, link, status } = req.body;
    try {
        const resolvedImageUrl = (await persistBannerImage(image_file, req)) || image_url || '';
        const resolvedLink = normalizeBannerLink(click_url || link || action_value);

        await db.query(
            'INSERT INTO banners (title, subtitle, image_url, action_type, action_value, status) VALUES (?, ?, ?, ?, ?, ?)',
            [
                title || '',
                subtitle || '',
                resolvedImageUrl,
                'url',
                resolvedLink,
                status || 'Active'
            ]
        );
        res.status(201).json({ message: 'Banner created successfully' });
    } catch (error) {
        console.error('Error creating banner:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.updateBanner = async (req, res) => {
    const { id } = req.params;
    const { title, subtitle, image_url, image_file, action_value, click_url, link, status } = req.body;
    try {
        const [existingRows] = await db.query('SELECT * FROM banners WHERE id = ?', [id]);
        if (existingRows.length === 0) {
            return res.status(404).json({ message: 'Banner not found' });
        }

        const existingBanner = existingRows[0];
        const uploadedImageUrl = await persistBannerImage(image_file, req);
        const resolvedImageUrl = uploadedImageUrl || image_url || existingBanner.image_url || '';
        const resolvedLink = normalizeBannerLink(
            click_url || link || action_value || existingBanner.action_value
        );

        if (uploadedImageUrl && existingBanner.image_url && uploadedImageUrl !== existingBanner.image_url) {
            await removeLocalBannerImage(existingBanner.image_url);
        }

        await db.query(
            'UPDATE banners SET title = ?, subtitle = ?, image_url = ?, action_type = ?, action_value = ?, status = ? WHERE id = ?',
            [
                title ?? existingBanner.title ?? '',
                subtitle ?? existingBanner.subtitle ?? '',
                resolvedImageUrl,
                'url',
                resolvedLink,
                status || existingBanner.status || 'Active',
                id
            ]
        );
        res.status(200).json({ message: 'Banner updated successfully' });
    } catch (error) {
        console.error('Error updating banner:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.deleteBanner = async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.query('SELECT image_url FROM banners WHERE id = ?', [id]);
        await db.query('DELETE FROM banners WHERE id = ?', [id]);
        if (rows.length > 0) {
            await removeLocalBannerImage(rows[0].image_url);
        }
        res.status(200).json({ message: 'Banner deleted successfully' });
    } catch (error) {
        console.error('Error deleting banner:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
// Account Delete Requests
exports.getAccountDeleteRequests = async (req, res) => {
    try {
        const [rows] = await db.query(QUERIES.ADMIN.GET_ACCOUNT_DELETE_REQUESTS);
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error fetching deactivation requests:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.updateDeleteRequestStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body; // CANCELLED or DELETED

    try {
        if (status === 'DELETED') {
            const [request] = await db.query('SELECT user_id FROM account_delete_requests WHERE id = ?', [id]);
            if (request.length > 0) {
                // Delete the user first
                await db.query(QUERIES.ADMIN.DELETE_USER, [request[0].user_id]);
                // Then update request status
                await db.query(QUERIES.ADMIN.UPDATE_DELETE_REQUEST_STATUS, [status, id]);
                return res.status(200).json({ message: 'Account deleted and request updated.' });
            } else {
                return res.status(404).json({ message: 'Request not found.' });
            }
        } else {
            await db.query(QUERIES.ADMIN.UPDATE_DELETE_REQUEST_STATUS, [status, id]);
            res.status(200).json({ message: 'Request status updated.' });
        }
    } catch (error) {
        console.error('Error updating deactivation request:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
