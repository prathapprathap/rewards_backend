const db = require('../config/db');
const QUERIES = require('../constants/queries');

exports.loginWithGoogle = async (req, res) => {
    const { google_id, email, name, profile_pic, device_id } = req.body;

    if (!google_id || !email) {
        return res.status(400).json({ message: 'Google ID and Email are required' });
    }

    try {
        // Check if device is already registered with another account
        if (device_id) {
            const [deviceUsers] = await db.query(QUERIES.USER.CHECK_DEVICE_USAGE, [device_id, google_id]);
            if (deviceUsers.length > 0) {
                return res.status(403).json({ message: 'This device is already registered with another account. Multiple accounts are not allowed.' });
            }
        }

        // Check if user exists
        const [rows] = await db.query(QUERIES.USER.CHECK_EXISTING_BY_GOOGLE_ID, [google_id]);

        if (rows.length > 0) {
            // User exists, return user data
            // Optionally update device_id if it changed or if we want to track the latest device
            if (device_id && rows[0].device_id !== device_id) {
                await db.query(QUERIES.USER.UPDATE_DEVICE_ID, [device_id, rows[0].id]);
                rows[0].device_id = device_id;
            }
            return res.status(200).json({ message: 'Login successful', user: rows[0] });
        } else {
            // User does not exist, create new user
            const [result] = await db.query(
                QUERIES.USER.CREATE_USER,
                [google_id, email, name, profile_pic, device_id]
            );

            const userId = result.insertId;

            // Get new user bonus from settings
            const [bonusSettings] = await db.query(
                'SELECT setting_value FROM app_settings WHERE setting_key = ?',
                ['new_user_spin_bonus']
            );
            const bonusSpins = parseInt(bonusSettings[0]?.setting_value || '2');

            // Credit bonus spins to new user
            await db.query(
                `INSERT INTO user_spins (user_id, available_spins, total_spins_earned) 
                 VALUES (?, ?, ?)`,
                [userId, bonusSpins, bonusSpins]
            );

            const newUser = {
                id: userId,
                google_id,
                email,
                name,
                profile_pic,
                device_id,
                wallet_balance: 0.00,
                total_earnings: 0.00
            };

            return res.status(201).json({
                message: 'User registered successfully',
                user: newUser,
                bonus_spins: bonusSpins
            });
        }
    } catch (error) {
        console.error('Error in loginWithGoogle:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

exports.getUserProfile = async (req, res) => {
    const { id } = req.params;

    try {
        const [rows] = await db.query(QUERIES.USER.GET_PROFILE_BY_ID, [id]);

        if (rows.length > 0) {
            return res.status(200).json(rows[0]);
        } else {
            return res.status(404).json({ message: 'User not found' });
        }
    } catch (error) {
        console.error('Error in getUserProfile:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Get offers with scratch status for a specific user
exports.getUserOffers = async (req, res) => {
    const { userId } = req.params;

    try {
        // Get all offers
        const [offers] = await db.query('SELECT * FROM offers WHERE status = ? ORDER BY created_at DESC', ['active']);

        // Get scratched offers for this user
        const [scratched] = await db.query(
            'SELECT offer_id FROM scratched_offers WHERE user_id = ?',
            [userId]
        );

        const scratchedIds = new Set(scratched.map(s => s.offer_id));

        // Mark offers as scratched or not
        const offersWithStatus = offers.map(offer => ({
            ...offer,
            is_scratched: scratchedIds.has(offer.id)
        }));

        return res.status(200).json(offersWithStatus);
    } catch (error) {
        console.error('Error in getUserOffers:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Mark an offer as scratched
exports.scratchOffer = async (req, res) => {
    const { userId } = req.params;
    const { offer_id } = req.body;

    if (!offer_id) {
        return res.status(400).json({ message: 'Offer ID is required' });
    }

    try {
        // Check if already scratched
        const [existing] = await db.query(
            'SELECT * FROM scratched_offers WHERE user_id = ? AND offer_id = ?',
            [userId, offer_id]
        );

        if (existing.length > 0) {
            return res.status(200).json({ message: 'Already scratched', already_scratched: true });
        }

        // Mark as scratched
        await db.query(
            'INSERT INTO scratched_offers (user_id, offer_id) VALUES (?, ?)',
            [userId, offer_id]
        );

        // Get the offer details
        const [offer] = await db.query('SELECT * FROM offers WHERE id = ?', [offer_id]);

        return res.status(200).json({
            message: 'Offer scratched successfully',
            offer: offer[0],
            already_scratched: false
        });
    } catch (error) {
        console.error('Error in scratchOffer:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Get user's available spins
exports.getUserSpins = async (req, res) => {
    const { userId } = req.params;

    try {
        const [spins] = await db.query(
            'SELECT * FROM user_spins WHERE user_id = ?',
            [userId]
        );

        if (spins.length === 0) {
            // Create default spin record if doesn't exist
            await db.query(
                'INSERT INTO user_spins (user_id, available_spins) VALUES (?, ?)',
                [userId, 0]
            );
            return res.status(200).json({
                available_spins: 0,
                total_spins_earned: 0,
                total_spins_used: 0
            });
        }

        return res.status(200).json(spins[0]);
    } catch (error) {
        console.error('Error in getUserSpins:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Use a spin and get reward
exports.useSpin = async (req, res) => {
    const { userId } = req.params;

    try {
        // Check available spins
        const [spins] = await db.query(
            'SELECT * FROM user_spins WHERE user_id = ?',
            [userId]
        );

        if (spins.length === 0 || spins[0].available_spins <= 0) {
            return res.status(400).json({ message: 'No spins available' });
        }

        // Get spin reward values from settings
        const [settings] = await db.query(
            'SELECT setting_value FROM app_settings WHERE setting_key = ?',
            ['spin_reward_values']
        );

        const rewardValues = settings[0]?.setting_value.split(',').map(v => parseInt(v)) || [1, 2, 5, 10];
        const reward = rewardValues[Math.floor(Math.random() * rewardValues.length)];

        // Deduct spin and add reward to wallet
        await db.query(
            'UPDATE user_spins SET available_spins = available_spins - 1, total_spins_used = total_spins_used + 1 WHERE user_id = ?',
            [userId]
        );

        await db.query(
            'UPDATE users SET wallet_balance = wallet_balance + ?, total_earnings = total_earnings + ? WHERE id = ?',
            [reward, reward, userId]
        );

        // Record transaction
        await db.query(
            'INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
            [userId, 'CREDIT', reward, 'Spin & Win reward']
        );

        // Get updated data
        const [updatedSpins] = await db.query('SELECT * FROM user_spins WHERE user_id = ?', [userId]);
        const [updatedUser] = await db.query('SELECT wallet_balance, total_earnings FROM users WHERE id = ?', [userId]);

        return res.status(200).json({
            message: 'Spin successful',
            reward,
            available_spins: updatedSpins[0].available_spins,
            wallet_balance: parseFloat(updatedUser[0].wallet_balance),
            total_earnings: parseFloat(updatedUser[0].total_earnings)
        });
    } catch (error) {
        console.error('Error in useSpin:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Get app settings
exports.getAppSettings = async (req, res) => {
    try {
        const [settings] = await db.query('SELECT * FROM app_settings');
        const settingsObj = {};
        settings.forEach(s => {
            settingsObj[s.setting_key] = s.setting_value;
        });
        return res.status(200).json(settingsObj);
    } catch (error) {
        console.error('Error in getAppSettings:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};
