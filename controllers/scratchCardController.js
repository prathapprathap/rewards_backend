const db = require('../config/db');

/**
 * Get random scratchable offer for user
 * Returns offers user hasn't scratched yet
 */
async function getScratchableOffer(req, res) {
    try {
        const { userId } = req.params;

        // Get offers user hasn't scratched yet
        const query = `
            SELECT o.* 
            FROM offers o
            WHERE o.id NOT IN (
                SELECT offer_id FROM scratched_offers WHERE user_id = ?
            )
            AND LOWER(o.status) = 'active'
            ORDER BY RAND()
            LIMIT 1
        `;

        const [offers] = await db.query(query, [userId]);

        if (offers.length === 0) {
            return res.json({
                success: false,
                message: 'No new offers available. Check back tomorrow!'
            });
        }

        res.json({ success: true, offer: offers[0] });

    } catch (error) {
        console.error('Error getting scratchable offer:', error);
        res.status(500).json({ error: 'Failed to get scratchable offer' });
    }
}

/**
 * Mark offer as scratched
 */
async function markOfferScratched(req, res) {
    try {
        const { userId, offerId } = req.body;

        await db.query(
            'INSERT IGNORE INTO scratched_offers (user_id, offer_id) VALUES (?, ?)',
            [userId, offerId]
        );

        res.json({ success: true, message: 'Offer marked as scratched' });

    } catch (error) {
        console.error('Error marking offer as scratched:', error);
        res.status(500).json({ error: 'Failed to mark offer as scratched' });
    }
}

/**
 * Get offer details with steps
 */
async function getOfferDetails(req, res) {
    try {
        const { offerId } = req.params;

        const [offers] = await db.query(
            'SELECT * FROM offers WHERE id = ?',
            [offerId]
        );

        if (offers.length === 0) {
            return res.status(404).json({ error: 'Offer not found' });
        }

        const offer = offers[0];

        // Add steps based on offer description or event_name
        const steps = generateOfferSteps(offer);

        res.json({
            success: true,
            offer: {
                ...offer,
                steps
            }
        });

    } catch (error) {
        console.error('Error getting offer details:', error);
        res.status(500).json({ error: 'Failed to get offer details' });
    }
}

/**
 * Generate steps for offer completion
 */
function generateOfferSteps(offer) {
    const baseSteps = [
        '📱 Click "Start Offer" button below',
        '🔗 You will be redirected to the advertiser',
        `✅ Complete: ${offer.event_name || 'the required task'}`,
        '⏱️ Wait 5-10 minutes for verification',
        `💰 Get ₹${offer.amount} credited to your wallet`
    ];

    // Customize based on event type
    if (offer.description) {
        const customSteps = [
            '📱 Click "Start Offer" button below',
            `📝 ${offer.description}`,
            `✅ Complete: ${offer.event_name || 'the task'}`,
            '⏱️ Rewards credited within 5-10 minutes',
            `💰 Earn ₹${offer.amount}`
        ];
        return customSteps;
    }

    return baseSteps;
}

module.exports = {
    getScratchableOffer,
    markOfferScratched,
    getOfferDetails
};
