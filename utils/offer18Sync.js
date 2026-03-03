const db = require('../config/db');
const https = require('https');

const OFFER18_API_URL = 'https://rupitask.xyz/api.php';
const OFFER18_AUTH_TOKEN = 'f173a927eec0abc4ed24f590e191ea9e';

/**
 * Fetch conversions from Offer18 API
 * report: 1=Today, 2=Yesterday, 3=Last7Days, 4=Last30Days, 5=ThisMonth
 */
async function fetchOffer18Conversions(report = 3) {
    return new Promise((resolve, reject) => {
        const url = `${OFFER18_API_URL}?auth-token=${OFFER18_AUTH_TOKEN}&report=${report}`;
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed);
                } catch (e) {
                    reject(new Error('Failed to parse Offer18 API response: ' + data));
                }
            });
        }).on('error', reject);
    });
}

/**
 * Sync Offer18 conversions to our DB.
 * Matches p1 (our click ID) → offer_clicks → credits wallet.
 * Returns a summary of what was processed.
 */
async function syncConversions(report = 1) {
    const results = {
        fetched: 0,
        alreadyProcessed: 0,
        newlyCredited: 0,
        skipped: 0,
        errors: [],
        conversions: []
    };

    try {
        const apiResponse = await fetchOffer18Conversions(report);

        if (!apiResponse.success) {
            throw new Error('Offer18 API returned error: ' + JSON.stringify(apiResponse));
        }

        const conversions = apiResponse.data || [];
        results.fetched = conversions.length;

        for (const conv of conversions) {
            try {
                // p1 = our click ID (passed as &p1={clickid} in the tracking URL)
                const ourClickId = conv.p1 || conv.clickid;
                const eventName = conv.event || 'default';
                const payout = parseFloat(conv.payout) || 0;
                const status = conv.status; // 'approved' or 'pending'

                if (!ourClickId) {
                    results.skipped++;
                    continue; // no p1 = not from our app
                }

                if (status !== 'approved') {
                    results.skipped++;
                    continue; // only process approved conversions
                }

                // Find the click in our DB
                const [clicks] = await db.query(
                    'SELECT * FROM offer_clicks WHERE click_id = ?',
                    [ourClickId]
                );

                if (clicks.length === 0) {
                    results.skipped++;
                    continue; // click not from our system
                }

                const click = clicks[0];

                // Check for duplicate (same click + event)
                const [existing] = await db.query(
                    'SELECT id FROM offer_events WHERE click_id = ? AND event_name = ?',
                    [ourClickId, eventName]
                );

                if (existing.length > 0) {
                    results.alreadyProcessed++;
                    continue;
                }

                // Get offer details for currency type
                const [offers] = await db.query(
                    'SELECT * FROM offers WHERE id = ?',
                    [click.offer_id]
                );
                const offer = offers[0];
                const currencyType = offer?.currency_type || 'cash';

                // Look up matching event step for correct payout
                const [steps] = await db.query(
                    `SELECT * FROM offer_event_steps
                     WHERE offer_id = ? AND (event_name = ? OR event_id = ?)
                     LIMIT 1`,
                    [click.offer_id, eventName, eventName]
                );

                let finalPayout = payout;
                let finalCurrency = currencyType;
                let eventStepId = null;

                if (steps.length > 0) {
                    const step = steps[0];
                    finalPayout = payout || parseFloat(step.points) || 0;
                    finalCurrency = step.currency_type || currencyType;
                    eventStepId = step.id;
                } else {
                    finalPayout = payout || parseFloat(offer?.amount) || 0;
                }

                // Record the event
                const [eventResult] = await db.query(
                    `INSERT INTO offer_events
                    (click_id, event_step_id, offer_id, user_id, event_name, payout, currency_type, status, postback_data, ip_address)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        ourClickId,
                        eventStepId,
                        click.offer_id,
                        click.user_id,
                        eventName,
                        finalPayout,
                        finalCurrency,
                        'approved',
                        JSON.stringify(conv),
                        conv.ip || '0.0.0.0'
                    ]
                );

                const eventId = eventResult.insertId;

                // Credit the wallet
                await creditUserWallet(click.user_id, finalPayout, finalCurrency, click.offer_id, eventId);

                // Update click status
                await db.query(
                    'UPDATE offer_clicks SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE click_id = ?',
                    ['completed', ourClickId]
                );

                // Log in postback_logs for traceability
                await db.query(
                    `INSERT INTO postback_logs (click_id, offer_id, raw_data, ip_address, status)
                     VALUES (?, ?, ?, ?, ?)`,
                    [ourClickId, click.offer_id, JSON.stringify(conv), conv.ip || '0.0.0.0', 'success']
                );

                results.newlyCredited++;
                results.conversions.push({
                    clickId: ourClickId,
                    userId: click.user_id,
                    offerId: click.offer_id,
                    event: eventName,
                    payout: finalPayout,
                    currency: finalCurrency
                });

                console.log(`✅ Synced: User ${click.user_id} earned ${finalCurrency} ${finalPayout} for event "${eventName}"`);

            } catch (convErr) {
                results.errors.push({ conversion: conv, error: convErr.message });
                console.error('Error processing conversion:', convErr.message, conv);
            }
        }

    } catch (err) {
        results.errors.push({ error: err.message });
        console.error('Sync error:', err.message);
    }

    return results;
}

/**
 * Credit user wallet (mirrors offer18Controller logic)
 */
async function creditUserWallet(userId, amount, currencyType = 'cash', offerId, eventId) {
    // Ensure wallet row exists
    await db.query(
        `INSERT INTO user_wallet_breakdown (user_id, cash)
         VALUES (?, 0)
         ON DUPLICATE KEY UPDATE user_id = user_id`,
        [userId]
    );

    const [wallets] = await db.query(
        'SELECT * FROM user_wallet_breakdown WHERE user_id = ?', [userId]
    );
    const wallet = wallets[0] || { cash: 0 };
    const balanceBefore = parseFloat(wallet[currencyType]) || 0;
    const balanceAfter = balanceBefore + parseFloat(amount);

    await db.query(
        `UPDATE user_wallet_breakdown SET ${currencyType} = ? WHERE user_id = ?`,
        [balanceAfter, userId]
    );

    if (currencyType === 'cash') {
        await db.query(
            'UPDATE users SET wallet_balance = wallet_balance + ?, total_earnings = total_earnings + ? WHERE id = ?',
            [amount, amount, userId]
        );
    }

    await db.query(
        `INSERT INTO wallet_transactions
        (user_id, transaction_type, currency_type, amount, balance_before, balance_after, offer_id, event_id, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, 'offer_reward', currencyType, amount, balanceBefore, balanceAfter, offerId, eventId, `Offer18 sync: ${currencyType} ${amount}`]
    );
}

module.exports = { syncConversions, fetchOffer18Conversions };
