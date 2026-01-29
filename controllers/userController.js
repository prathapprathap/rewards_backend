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

            const newUser = {
                id: result.insertId,
                google_id,
                email,
                name,
                profile_pic,
                device_id,
                wallet_balance: 0.00
            };

            return res.status(201).json({ message: 'User registered successfully', user: newUser });
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
