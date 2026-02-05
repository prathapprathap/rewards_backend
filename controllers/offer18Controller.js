const db = require('../config/db');
const crypto = require('crypto');

// Generate unique click ID
function generateClickId() {
    return crypto.randomBytes(32).toString('hex');
}

// Track offer click and generate tracking URL
async function trackClick(req, res) {
    try {
        const { userId, offerId, deviceId } = req.body;
        const ipAddress = req.ip || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'];

        if (!userId || !offerId) {
            return res.status(400).json({ error: 'userId and offerId are required' });
        }

        // Check if offer exists and is active
        const [offers] = await db.query(
            'SELECT * FROM offers WHERE id = ? AND status = ?',
            [offerId, 'active']
        );

        if (offers.length === 0) {
            return res.status(404).json({ error: 'Offer not found or inactive' });
        }

        const offer = offers[0];

        // Generate unique click ID
        const clickId = generateClickId();

        // Save click to database
        await db.query(
            `INSERT INTO offer_clicks 
            (click_id, user_id, offer_id, device_id, ip_address, user_agent, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [clickId, userId, offerId, deviceId, ipAddress, userAgent, 'clicked']
        );

        // Track device fingerprint
        await trackDeviceFingerprint(userId, deviceId, ipAddress, userAgent);

        // Generate tracking URL with macros
        const trackingUrl = offer.offer_url || offer.tracking_link;
        const finalUrl = trackingUrl
            .replace('{clickid}', clickId)
            .replace('{user_id}', userId)
            .replace('{offer_id}', offerId);

        res.json({
            success: true,
            clickId,
            trackingUrl: finalUrl,
            offerId: offer.id,
            offerName: offer.offer_name,
            reward: offer.amount,
            currencyType: offer.currency_type || 'cash'
        });

    } catch (error) {
        console.error('Error tracking click:', error);
        res.status(500).json({ error: 'Failed to track click' });
    }
}

// Track device fingerprint for fraud prevention
async function trackDeviceFingerprint(userId, deviceId, ipAddress, userAgent) {
    try {
        if (!deviceId) return;

        await db.query(
            `INSERT INTO device_fingerprints (user_id, device_id, ip_address, user_agent) 
            VALUES (?, ?, ?, ?) 
            ON DUPLICATE KEY UPDATE 
            ip_address = VALUES(ip_address), 
            user_agent = VALUES(user_agent), 
            last_seen = CURRENT_TIMESTAMP`,
            [userId, deviceId, ipAddress, userAgent]
        );
    } catch (error) {
        console.error('Error tracking device fingerprint:', error);
    }
}

// Handle postback from Offer18
async function handlePostback(req, res) {
    try {
        const { clickid, payout, status, event, offerid } = req.query;
        const ipAddress = req.ip || req.connection.remoteAddress;

        console.log('📥 Postback received:', { clickid, payout, status, event, offerid });

        // Log the postback
        await db.query(
            `INSERT INTO postback_logs (click_id, offer_id, raw_data, ip_address, status) 
            VALUES (?, ?, ?, ?, ?)`,
            [clickid, offerid, JSON.stringify(req.query), ipAddress, 'success']
        );

        // Validate required parameters
        if (!clickid) {
            await logPostbackError(clickid, offerid, req.query, ipAddress, 'Missing click_id');
            return res.status(400).send('ERROR: Missing click_id');
        }

        // Find the click record
        const [clicks] = await db.query(
            'SELECT * FROM offer_clicks WHERE click_id = ?',
            [clickid]
        );

        if (clicks.length === 0) {
            await logPostbackError(clickid, offerid, req.query, ipAddress, 'Click ID not found');
            return res.status(404).send('ERROR: Click not found');
        }

        const click = clicks[0];

        // Check for duplicate postback
        const [existingEvents] = await db.query(
            'SELECT * FROM offer_events WHERE click_id = ? AND event_name = ?',
            [clickid, event || 'default']
        );

        if (existingEvents.length > 0) {
            await logPostbackError(clickid, offerid, req.query, ipAddress, 'Duplicate postback');
            return res.status(200).send('OK: Already processed');
        }

        // Get offer details
        const [offers] = await db.query('SELECT * FROM offers WHERE id = ?', [click.offer_id]);
        if (offers.length === 0) {
            await logPostbackError(clickid, offerid, req.query, ipAddress, 'Offer not found');
            return res.status(404).send('ERROR: Offer not found');
        }

        const offer = offers[0];
        const finalPayout = parseFloat(payout) || parseFloat(offer.amount) || 0;
        const currencyType = offer.currency_type || 'cash';
        const eventStatus = status === 'approved' || status === 'completed' ? 'approved' : 'pending';

        // Record the event
        const [eventResult] = await db.query(
            `INSERT INTO offer_events 
            (click_id, offer_id, user_id, event_name, payout, currency_type, status, postback_data, ip_address) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                clickid,
                click.offer_id,
                click.user_id,
                event || 'default',
                finalPayout,
                currencyType,
                eventStatus,
                JSON.stringify(req.query),
                ipAddress
            ]
        );

        const eventId = eventResult.insertId;

        // If approved, credit the user's wallet
        if (eventStatus === 'approved') {
            await creditUserWallet(click.user_id, finalPayout, currencyType, click.offer_id, eventId);

            // Update click status
            await db.query(
                'UPDATE offer_clicks SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE click_id = ?',
                ['completed', clickid]
            );
        }

        console.log('✅ Postback processed successfully for user:', click.user_id);
        res.status(200).send('OK');

    } catch (error) {
        console.error('❌ Error handling postback:', error);
        await logPostbackError(
            req.query.clickid,
            req.query.offerid,
            req.query,
            req.ip,
            error.message
        );
        res.status(500).send('ERROR: Internal server error');
    }
}

// Credit user wallet with multiple currency support
async function creditUserWallet(userId, amount, currencyType = 'cash', offerId, eventId) {
    try {
        // Initialize wallet breakdown if not exists
        await db.query(
            `INSERT INTO user_wallet_breakdown (user_id, coins, gems, cash) 
            VALUES (?, 0, 0, 0) 
            ON DUPLICATE KEY UPDATE user_id = user_id`,
            [userId]
        );

        // Get current balance
        const [wallets] = await db.query(
            'SELECT * FROM user_wallet_breakdown WHERE user_id = ?',
            [userId]
        );
        const wallet = wallets[0] || { coins: 0, gems: 0, cash: 0 };
        const balanceBefore = parseFloat(wallet[currencyType]) || 0;
        const balanceAfter = balanceBefore + parseFloat(amount);

        // Update wallet breakdown
        await db.query(
            `UPDATE user_wallet_breakdown SET ${currencyType} = ? WHERE user_id = ?`,
            [balanceAfter, userId]
        );

        // Update main wallet (cash only)
        if (currencyType === 'cash') {
            await db.query(
                'UPDATE users SET wallet_balance = wallet_balance + ?, total_earnings = total_earnings + ? WHERE id = ?',
                [amount, amount, userId]
            );
        }

        // Record transaction
        await db.query(
            `INSERT INTO wallet_transactions 
            (user_id, transaction_type, currency_type, amount, balance_before, balance_after, offer_id, event_id, description) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                'offer_reward',
                currencyType,
                amount,
                balanceBefore,
                balanceAfter,
                offerId,
                eventId,
                `Offer reward: ${currencyType} ${amount}`
            ]
        );

        console.log(`💰 Credited ${amount} ${currencyType} to user ${userId}`);

    } catch (error) {
        console.error('Error crediting wallet:', error);
        throw error;
    }
}

// Log postback errors
async function logPostbackError(clickId, offerId, rawData, ipAddress, errorMessage) {
    try {
        await db.query(
            `INSERT INTO postback_logs (click_id, offer_id, raw_data, ip_address, status, error_message) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [clickId, offerId, JSON.stringify(rawData), ipAddress, 'failed', errorMessage]
        );
    } catch (error) {
        console.error('Error logging postback error:', error);
    }
}

// Get click history for a user
async function getClickHistory(req, res) {
    try {
        const { userId } = req.params;

        const [clicks] = await db.query(
            `SELECT 
                oc.*, 
                o.offer_name, 
                o.heading, 
                o.image_url,
                GROUP_CONCAT(oe.event_name) as events,
                SUM(oe.payout) as total_earned
            FROM offer_clicks oc
            LEFT JOIN offers o ON oc.offer_id = o.id
            LEFT JOIN offer_events oe ON oc.click_id = oe.click_id AND oe.status = 'approved'
            WHERE oc.user_id = ?
            GROUP BY oc.id
            ORDER BY oc.created_at DESC
            LIMIT 50`,
            [userId]
        );

        res.json({ success: true, clicks });

    } catch (error) {
        console.error('Error fetching click history:', error);
        res.status(500).json({ error: 'Failed to fetch click history' });
    }
}

// Get conversion analytics for admin
async function getConversionAnalytics(req, res) {
    try {
        const [analytics] = await db.query(`
            SELECT 
                o.id,
                o.offer_name,
                COUNT(DISTINCT oc.click_id) as total_clicks,
                COUNT(DISTINCT CASE WHEN oe.status = 'approved' THEN oe.click_id END) as conversions,
                ROUND(COUNT(DISTINCT CASE WHEN oe.status = 'approved' THEN oe.click_id END) * 100.0 / NULLIF(COUNT(DISTINCT oc.click_id), 0), 2) as conversion_rate,
                SUM(CASE WHEN oe.status = 'approved' THEN oe.payout ELSE 0 END) as total_payout
            FROM offers o
            LEFT JOIN offer_clicks oc ON o.id = oc.offer_id
            LEFT JOIN offer_events oe ON oc.click_id = oe.click_id
            GROUP BY o.id
            ORDER BY total_clicks DESC
        `);

        res.json({ success: true, analytics });

    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
}

// Get wallet breakdown for user
async function getWalletBreakdown(req, res) {
    try {
        const { userId } = req.params;

        const [wallets] = await db.query(
            'SELECT * FROM user_wallet_breakdown WHERE user_id = ?',
            [userId]
        );

        if (wallets.length === 0) {
            return res.json({
                success: true,
                wallet: { coins: 0, gems: 0, cash: 0 }
            });
        }

        res.json({
            success: true,
            wallet: {
                coins: parseFloat(wallets[0].coins) || 0,
                gems: parseFloat(wallets[0].gems) || 0,
                cash: parseFloat(wallets[0].cash) || 0
            }
        });

    } catch (error) {
        console.error('Error fetching wallet breakdown:', error);
        res.status(500).json({ error: 'Failed to fetch wallet breakdown' });
    }
}

// Get transaction history
async function getTransactionHistory(req, res) {
    try {
        const { userId } = req.params;
        const { limit = 50 } = req.query;

        const [transactions] = await db.query(
            `SELECT 
                wt.*,
                o.offer_name,
                o.heading as offer_heading
            FROM wallet_transactions wt
            LEFT JOIN offers o ON wt.offer_id = o.id
            WHERE wt.user_id = ?
            ORDER BY wt.created_at DESC
            LIMIT ?`,
            [userId, parseInt(limit)]
        );

        res.json({ success: true, transactions });

    } catch (error) {
        console.error('Error fetching transaction history:', error);
        res.status(500).json({ error: 'Failed to fetch transaction history' });
    }
}

module.exports = {
    trackClick,
    handlePostback,
    getClickHistory,
    getConversionAnalytics,
    getWalletBreakdown,
    getTransactionHistory,
    creditUserWallet
};
