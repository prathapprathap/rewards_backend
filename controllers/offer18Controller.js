const db = require('../config/db');
const crypto = require('crypto');
const { processReferralCommission } = require('./referralController');
const { sendOfferApprovedNotification } = require('../services/telegramService');

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
            'SELECT * FROM offers WHERE id = ? AND LOWER(status) = ?',
            [offerId, 'active']
        );

        console.log(`Checking offer ${offerId} - Found ${offers.length} active offers`);

        if (offers.length === 0) {
            // Check if offer exists at all
            const [allOffers] = await db.query('SELECT id, status FROM offers WHERE id = ?', [offerId]);
            if (allOffers.length === 0) {
                return res.status(404).json({ error: 'Offer not found' });
            } else {
                return res.status(404).json({
                    error: 'Offer is not active',
                    offerStatus: allOffers[0].status
                });
            }
        }

        const offer = offers[0];

        // Check if user has already completed this offer
        const [completedCheck] = await db.query(
            "SELECT id FROM offer_clicks WHERE user_id = ? AND offer_id = ? AND status = 'completed'",
            [userId, offerId]
        );

        if (completedCheck.length > 0) {
            return res.status(400).json({ error: 'You have already completed this offer' });
        }

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

        // Priority: tracking_link (Offer18 URL with {clickid}) > offer18_tracking_url > offer_url
        let trackingUrl = offer.tracking_link || offer.offer18_tracking_url || offer.offer_url || offer.tracking_url;

        if (!trackingUrl) {
            console.log('No tracking URL found for offer:', offer.id);
            return res.status(400).json({ error: 'No tracking URL configured for this offer', trackingUrl: null });
        }

        // --- URL SANITIZATION & AUTO-APPENDING (Matching reference project needs) ---
        // 1. Ensure protocol exists
        if (!trackingUrl.startsWith('http')) {
            trackingUrl = 'https://' + trackingUrl;
        }

        // 2. Replacements
        let finalUrl = trackingUrl
            .replace('{clickid}', clickId)
            .replace('{click_id}', clickId)
            .replace('{cid}', clickId)           // Offer18 click ID macro
            .replace('{p1}', clickId)             // Offer18 Affiliate Click ID macro
            .replace('{user_id}', userId)
            .replace('{offer_id}', offerId);

        // 3. Auto-append click_id if no replacement happened (Important for legacy redirect scripts)
        // If the URL is just a generic link without macros, we MUST append the tracking param
        if (finalUrl === trackingUrl) {
            const separator = finalUrl.includes('?') ? '&' : '?';
            // Use 'p1' as the primary tracking parameter (compatible with Offer18 and custom scripts)
            finalUrl += `${separator}p1=${clickId}&p2=${userId}&offerId=${offerId}`;
        }

        console.log('🚀 Navigating to Tracking URL:', finalUrl);

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

// Handle postback from Offer18 / any 3rd-party provider
// Supports multi-event offers: the incoming `event` param is matched against
// offer_event_steps to determine the per-step reward.
async function handlePostback(req, res) {
    try {
        // Accept click ID from multiple parameter names:
        //   - {p1}      → Our click ID passed in tracking URL (p1={clickid}) ← PRIMARY
        //   - {clickid} → explicit clickid param
        //   - {click_id}→ alternative format
        // NOTE: cid = campaign ID in this Offer18 setup, NOT click ID
        const clickid = req.query.p1 || req.query.clickid || req.query.click_id;
        const payout = req.query.payout;
        const status = req.query.status;
        const event = req.query.event;
        const offerid = req.query.offerid || req.query.offerId || req.query.oid; // Support both cases and oid
        const ipAddress = req.ip || req.connection.remoteAddress;

        console.log('📥 Postback received:', { clickid, payout, status, event, offerid, raw: req.query });

        // Initial log will be updated or replaced by error log
        const [logResult] = await db.query(
            `INSERT INTO postback_logs (click_id, offer_id, raw_data, ip_address, status) 
            VALUES (?, ?, ?, ?, ?)`,
            [clickid || null, offerid || null, JSON.stringify(req.query), ipAddress, 'pending']
        );
        const logId = logResult.insertId;

        // Validate required parameters
        if (!clickid) {
            await logPostbackError(null, offerid, req.query, ipAddress, 'Missing click_id (checked p1, clickid, click_id)', logId);
            return res.status(400).send('ERROR: Missing click_id');
        }

        // Find the click record
        const [clicks] = await db.query(
            'SELECT * FROM offer_clicks WHERE click_id = ?',
            [clickid]
        );

        if (clicks.length === 0) {
            await logPostbackError(clickid, offerid, req.query, ipAddress, 'Click ID not found', logId);
            return res.status(404).send('ERROR: Click not found');
        }

        const click = clicks[0];
        const eventNameFromQuery = event || 'default';

        // 1. First, try to match the event step
        const [allSteps] = await db.query(
            'SELECT * FROM offer_event_steps WHERE offer_id = ? ORDER BY step_order ASC',
            [click.offer_id]
        );

        let stepPayout = 0;
        let stepCurrency = 'cash';
        let eventStepId = null;
        let normalizedEventName = eventNameFromQuery;

        const queryValClean = eventNameFromQuery.trim().toLowerCase();

        const matchedStep = allSteps.find(s => {
            const nameMatch = (s.event_name || '').trim().toLowerCase() === queryValClean;
            const idMatch = (s.event_id || '').trim().toLowerCase() === queryValClean;
            return nameMatch || idMatch;
        });

        if (matchedStep) {
            stepPayout = parseFloat(matchedStep.points) || 0;
            stepCurrency = matchedStep.currency_type || 'cash';
            eventStepId = matchedStep.id;
            normalizedEventName = matchedStep.event_name;
            console.log(`   ↳ Matched event step: "${matchedStep.event_name}" → ${stepCurrency} ${stepPayout}`);
        } else if (allSteps.length > 0) {
            // Offer HAS multiple steps, but this postback didn't match any.
            if (eventNameFromQuery === 'default') {
                // If it's a default/install postback with no event name, award the FIRST step (Order 0)
                const firstStep = allSteps[0];
                stepPayout = parseFloat(firstStep.points) || 0;
                stepCurrency = firstStep.currency_type || 'cash';
                eventStepId = firstStep.id;
                normalizedEventName = firstStep.event_name;
                console.log(`   ↳ No event name in query; defaulting to first step: "${firstStep.event_name}" → ${stepCurrency} ${stepPayout}`);
            } else {
                // Unknown event name for a multi-step offer — don't credit total amount!
                console.log(`   ⚠️ Unknown event "${eventNameFromQuery}" for multi-step offer ${click.offer_id}. Skipping payout.`);
                await logPostbackError(clickid, offerid, req.query, ipAddress, 'Unknown event for multi-step offer', logId);
                return res.status(200).send('OK: Event not matched, skipping payout');
            }
        } else {
            // Fallback: Legacy offer with NO steps in offer_event_steps table
            const [offers] = await db.query('SELECT * FROM offers WHERE id = ?', [click.offer_id]);
            const offer = offers[0] || {};
            stepPayout = parseFloat(offer.amount) || parseFloat(payout) || 0;
            stepCurrency = offer.currency_type || 'cash';
            normalizedEventName = eventNameFromQuery;
            console.log(`   ↳ Legacy offer (no steps); using fallback payout: ${stepCurrency} ${stepPayout}`);
        }

        // 2. CHECK FOR DUPLICATES (Global User+Offer+NormalizedEvent check)
        // This prevents double pay even if they click again and get a new clickid
        const [existingApproved] = await db.query(
            `SELECT id FROM offer_events 
             WHERE user_id = ? AND offer_id = ? 
             AND (event_step_id = ? OR (event_step_id IS NULL AND event_name = ?))
             AND status = 'approved' 
             LIMIT 1`,
            [click.user_id, click.offer_id, eventStepId, normalizedEventName]
        );

        if (existingApproved.length > 0) {
            console.log(`   ⚠️ Skipping: User ${click.user_id} already rewarded for offer ${click.offer_id} event ${normalizedEventName}`);
            await db.query('UPDATE postback_logs SET status = ?, click_id = ? WHERE id = ?', ['success', clickid, logId]);
            return res.status(200).send('OK: Already processed and rewarded');
        }

        // 3. Check if THIS specific click has already processed THIS specific postback
        const [existingPostback] = await db.query(
            'SELECT * FROM offer_events WHERE click_id = ? AND event_name = ?',
            [clickid, eventNameFromQuery]
        );

        if (existingPostback.length > 0) {
            console.log(`   ⚠️ Skipping: Duplicate postback for clickID ${clickid} event ${eventNameFromQuery}`);
            await db.query('UPDATE postback_logs SET status = ?, click_id = ? WHERE id = ?', ['success', clickid, logId]);
            return res.status(200).send('OK: Already processed for this click');
        }

        // Handle Offer18 / generic postback status. Treat any value that isn't
        // explicitly a rejection as approved — networks send wildly inconsistent
        // values ("1", "success", "confirmed", "paid", etc) and we don't want
        // money to silently sit in 'pending'.
        const cleanStatus = (status || '').toString().trim().toLowerCase();
        const rejectedSet = new Set([
            'rejected', 'reject', 'failed', 'fail', 'declined',
            'reversed', 'chargeback', 'fraud', '0', 'false', 'no',
        ]);
        const isApproved = !rejectedSet.has(cleanStatus);

        const eventStatus = isApproved ? 'approved' : 'pending';
        console.log(`   ↳ Status: raw="${status}" → ${eventStatus}`);

        // Record the event
        const [eventResult] = await db.query(
            `INSERT INTO offer_events 
            (click_id, event_step_id, offer_id, user_id, event_name, payout, currency_type, status, postback_data, ip_address) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                clickid,
                eventStepId,
                click.offer_id,
                click.user_id,
                normalizedEventName,
                stepPayout,
                stepCurrency,
                eventStatus,
                JSON.stringify(req.query),
                ipAddress
            ]
        );

        const eventId = eventResult.insertId;

        // If approved, credit the user's wallet
        if (eventStatus === 'approved') {
            await creditUserWallet(click.user_id, stepPayout, stepCurrency, click.offer_id, eventId);

            // Credit referrer commission (if this user was referred)
            if (stepCurrency === 'cash' && stepPayout > 0) {
                await processReferralCommission(click.user_id, stepPayout);
            }

            // Check if ALL event steps for this offer are now completed
            const [totalSteps] = await db.query(
                'SELECT COUNT(*) as cnt FROM offer_event_steps WHERE offer_id = ?',
                [click.offer_id]
            );
            const [completedSteps] = await db.query(
                `SELECT COUNT(DISTINCT oe.event_step_id) as cnt
                 FROM offer_events oe
                 WHERE oe.click_id = ? AND oe.status = 'approved' AND oe.event_step_id IS NOT NULL`,
                [clickid]
            );

            const allDone = totalSteps[0].cnt === 0 || completedSteps[0].cnt >= totalSteps[0].cnt;

            await db.query(
                'UPDATE offer_clicks SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE click_id = ?',
                [allDone ? 'completed' : 'pending', clickid]
            );

            // Telegram admin notification (ports PHP CallBack-Data-PostBack.php behavior)
            try {
                const [offerRows] = await db.query(
                    'SELECT offer_name FROM offers WHERE id = ?',
                    [click.offer_id]
                );
                const [userRows] = await db.query(
                    'SELECT email, device_id FROM users WHERE id = ?',
                    [click.user_id]
                );
                const offerTitle = offerRows[0]?.offer_name || `Offer #${click.offer_id}`;
                const phoneNumber = userRows[0]?.email || '';
                const deviceId = userRows[0]?.device_id || '';

                sendOfferApprovedNotification({
                    offerName: `${offerTitle} (${normalizedEventName})`,
                    coin: `${stepPayout} ${stepCurrency}`,
                    phoneNumber,
                    deviceId,
                }).catch(e => console.error('Telegram notify failed:', e.message));
            } catch (e) {
                console.error('Telegram notify prep failed:', e.message);
            }
        }

        console.log('✅ Postback processed successfully for user:', click.user_id,
            `(event: ${normalizedEventName}, payout: ${stepCurrency} ${stepPayout})`);

        // Update initial log to success
        await db.query(
            'UPDATE postback_logs SET status = ?, click_id = ? WHERE id = ?',
            ['success', clickid, logId]
        );

        res.status(200).send('OK');

    } catch (error) {
        console.error('❌ Error handling postback:', error);
        await logPostbackError(
            req.query.p1 || req.query.clickid || req.query.click_id,
            req.query.offerid,
            req.query,
            req.ip,
            error.sqlMessage || error.message,
            logId
        );
        res.status(500).json({
            error: 'Internal server error',
            message: error.message,
            sqlMessage: error.sqlMessage
        });
    }
}

// Credit user wallet with multiple currency support
async function creditUserWallet(userId, amount, currencyType, offerId, eventId) {
    try {
        const normalizedCurrency = ['cash', 'coins', 'gems'].includes(currencyType)
            ? currencyType
            : 'cash';

        // 1. Fetch coin rate from settings
        const [settings] = await db.query(
            'SELECT setting_value FROM app_settings WHERE setting_key = ?',
            ['coin_rate']
        );
        const coinRate = parseFloat(settings[0]?.setting_value || '100');

        // 2. Determine cash value
        let cashAmount = parseFloat(amount);
        if (normalizedCurrency === 'coins') {
            cashAmount = cashAmount / coinRate;
        } else if (normalizedCurrency === 'gems') {
            // Assume gems are 1:1 for now or add a gem rate later
            cashAmount = cashAmount;
        }

        // Check if user exists
        const [user] = await db.query('SELECT wallet_balance FROM users WHERE id = ?', [userId]);
        if (user.length === 0) return;

        const balanceBefore = parseFloat(user[0].wallet_balance);
        const balanceAfter = balanceBefore + cashAmount;

        // 3. Update main wallet (Always Rupees/Cash)
        await db.query(
            'UPDATE users SET wallet_balance = ?, total_earnings = total_earnings + ? WHERE id = ?',
            [balanceAfter, cashAmount, userId]
        );

        // 4. Update breakdown in the reward's native currency.
        await db.query(
            `INSERT INTO user_wallet_breakdown (user_id, ${normalizedCurrency})
             VALUES (?, ?)
             ON DUPLICATE KEY UPDATE ${normalizedCurrency} = ${normalizedCurrency} + VALUES(${normalizedCurrency})`,
            [userId, parseFloat(amount)]
        );

        // 5. Record transaction
        await db.query(
            `INSERT INTO wallet_transactions 
            (user_id, transaction_type, currency_type, amount, balance_before, balance_after, offer_id, event_id, description, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                'offer_reward',
                normalizedCurrency,
                parseFloat(amount),
                balanceBefore,
                balanceAfter,
                offerId,
                eventId,
                `Offer compensation: ${amount} ${normalizedCurrency} (₹${cashAmount.toFixed(2)})`,
                'success'
            ]
        );

        console.log(`💰 Credited ₹${cashAmount.toFixed(2)} (${amount} ${normalizedCurrency}) to user ${userId}`);

    } catch (error) {
        console.error('Error crediting wallet:', error);
        throw error;
    }
}

// Log postback errors
async function logPostbackError(clickId, offerId, rawData, ipAddress, errorMessage, logId = null) {
    try {
        if (logId) {
            await db.query(
                `UPDATE postback_logs SET click_id = ?, offer_id = ?, status = ?, error_message = ? WHERE id = ?`,
                [clickId, offerId, 'failed', errorMessage, logId]
            );
        } else {
            await db.query(
                `INSERT INTO postback_logs (click_id, offer_id, raw_data, ip_address, status, error_message) 
                VALUES (?, ?, ?, ?, ?, ?)`,
                [clickId, offerId, JSON.stringify(rawData), ipAddress, 'failed', errorMessage]
            );
        }
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
            GROUP BY oc.id, o.offer_name, o.heading, o.image_url
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
        const { limit = 50, offset = 0 } = req.query;

        const [transactions] = await db.query(
            `SELECT 
                wt.*,
                o.offer_name,
                o.heading as offer_heading,
                o.image_url as offer_image
            FROM wallet_transactions wt
            LEFT JOIN offers o ON wt.offer_id = o.id
            WHERE wt.user_id = ?
            ORDER BY wt.created_at DESC
            LIMIT ? OFFSET ?`,
            [userId, parseInt(limit), parseInt(offset)]
        );

        res.json({ success: true, transactions });

    } catch (error) {
        console.error('Error fetching transaction history:', error);
        res.status(500).json({ error: 'Failed to fetch transaction history' });
    }
}

// Banners
async function getBanners(req, res) {
    try {
        const [banners] = await db.query(
            'SELECT * FROM banners WHERE status = ? ORDER BY id DESC',
            ['Active']
        );
        res.json({
            success: true,
            banners: banners.map((banner) => ({
                ...banner,
                click_url: banner.action_value || '',
            })),
        });
    } catch (error) {
        console.error('Error fetching banners:', error);
        res.status(500).json({ error: 'Failed to fetch banners' });
    }
}

module.exports = {
    trackClick,
    handlePostback,
    getClickHistory,
    getWalletBreakdown,
    getTransactionHistory,
    getBanners,
    creditUserWallet
};
