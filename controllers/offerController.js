const db = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// GET /offers/offerwall
// Returns all active offers with their associated events. Each offer includes a
// `events` array so that the Flutter app can render the full milestone timeline.
// ─────────────────────────────────────────────────────────────────────────────
async function getOfferwallOffers(req, res) {
    try {
        // Fetch all active offers
        const [offers] = await db.query(
            `SELECT id, offer_id, offer_name, heading, history_name,
                    offer_url, tracking_link, amount, currency_type,
                    event_name, description, image_url, status
             FROM offers
             WHERE LOWER(status) = 'active'
             ORDER BY created_at DESC`
        );

        if (offers.length === 0) {
            return res.json([]);
        }

        // Fetch all events for returned offer IDs
        const offerIds = offers.map(o => o.id);
        const placeholders = offerIds.map(() => '?').join(',');
        const [events] = await db.query(
            `SELECT id, offer_id, event_id, event_name, points,
                    currency_type, step_order
             FROM offer_event_steps
             WHERE offer_id IN (${placeholders})
             ORDER BY offer_id, step_order ASC`,
            offerIds
        );

        // Group events by offer_id
        const eventMap = {};
        for (const event of events) {
            if (!eventMap[event.offer_id]) eventMap[event.offer_id] = [];
            eventMap[event.offer_id].push({
                event_id: event.event_id,
                event_name: event.event_name,
                points: parseFloat(event.points) || 0,
                currency_type: event.currency_type || 'cash',
                is_completed: false,
            });
        }

        // Merge events into offers
        const result = offers.map(offer => ({
            ...offer,
            amount: parseFloat(offer.amount) || 0,
            events: eventMap[offer.id] || [],
        }));

        res.json(result);
    } catch (error) {
        console.error('Error fetching offerwall offers:', error);
        res.status(500).json({ error: 'Failed to fetch offerwall offers' });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /offers/:offerId/events?userId=<id>
// Returns the event steps for a single offer. If userId is provided, marks
// which events the user has already completed.
// ─────────────────────────────────────────────────────────────────────────────
async function getOfferEvents(req, res) {
    try {
        const { offerId } = req.params;
        const { userId } = req.query;

        // Fetch steps
        const [steps] = await db.query(
            `SELECT id, event_id, event_name, points, currency_type, step_order
             FROM offer_event_steps
             WHERE offer_id = ?
             ORDER BY step_order ASC`,
            [offerId]
        );

        if (!userId) {
            return res.json({
                success: true,
                events: steps.map(s => ({
                    event_id: s.event_id,
                    event_name: s.event_name,
                    points: parseFloat(s.points) || 0,
                    currency_type: s.currency_type || 'cash',
                    is_completed: false,
                    completed_at: null,
                })),
            });
        }

        // Fetch completion history for this user + offer
        const [completedEvents] = await db.query(
            `SELECT event_name, MAX(created_at) as completed_at
             FROM offer_events
             WHERE user_id = ? AND offer_id = ? AND status = 'approved'
             GROUP BY event_name`,
            [userId, offerId]
        );

        const completedMap = {};
        for (const ev of completedEvents) {
            completedMap[ev.event_name] = ev.completed_at;
        }

        const events = steps.map(s => ({
            event_id: s.event_id,
            event_name: s.event_name,
            points: parseFloat(s.points) || 0,
            currency_type: s.currency_type || 'cash',
            is_completed: !!completedMap[s.event_name],
            completed_at: completedMap[s.event_name] || null,
        }));

        res.json({ success: true, events });
    } catch (error) {
        console.error('Error fetching offer events:', error);
        res.status(500).json({ error: 'Failed to fetch offer events' });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /offers  (admin: create offer with multiple events)
// Body: { offer_name, offer_id, heading, offer_url, tracking_link, amount,
//         currency_type, description, image_url, status, events: [] }
// ─────────────────────────────────────────────────────────────────────────────
async function createOfferWithEvents(req, res) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const {
            offer_name, offer_id, heading, history_name = '',
            offer_url, tracking_link = '', amount,
            currency_type = 'cash', event_name = '',
            description = '', image_url = '',
            refer_payout = '1st Event', status = 'Active',
            events = []  // array of { event_id, event_name, points, currency_type }
        } = req.body;

        if (!offer_name || !offer_url || !amount) {
            await connection.rollback();
            return res.status(400).json({ error: 'offer_name, offer_url, and amount are required.' });
        }

        // Insert offer
        const [offerResult] = await connection.query(
            `INSERT INTO offers
             (offer_name, offer_id, heading, history_name, offer_url,
              tracking_link, amount, currency_type, event_name,
              description, image_url, refer_payout, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [offer_name, offer_id, heading, history_name, offer_url,
                tracking_link, amount, currency_type, event_name,
                description, image_url, refer_payout, status]
        );

        const newOfferId = offerResult.insertId;

        // Insert event steps (if provided)
        if (Array.isArray(events) && events.length > 0) {
            for (let i = 0; i < events.length; i++) {
                const ev = events[i];
                await connection.query(
                    `INSERT INTO offer_event_steps
                     (offer_id, event_id, event_name, points, currency_type, step_order)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [newOfferId, ev.event_id || `evt${i}`, ev.event_name,
                        ev.points || 0, ev.currency_type || currency_type, i]
                );
            }
        } else if (event_name) {
            // Backwards-compat: single event_name → create one step
            await connection.query(
                `INSERT INTO offer_event_steps
                 (offer_id, event_id, event_name, points, currency_type, step_order)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [newOfferId, `evt0`, event_name, amount, currency_type, 0]
            );
        }

        await connection.commit();
        res.status(201).json({
            success: true,
            message: 'Offer created successfully',
            offerId: newOfferId,
        });
    } catch (error) {
        await connection.rollback();
        console.error('Error creating offer:', error);
        res.status(500).json({ error: 'Failed to create offer' });
    } finally {
        connection.release();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /offers/:id  (admin: update offer + events)
// ─────────────────────────────────────────────────────────────────────────────
async function updateOfferWithEvents(req, res) {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const { id } = req.params;
        const {
            offer_name, offer_id, heading, history_name,
            offer_url, tracking_link, amount,
            currency_type, event_name, description,
            image_url, refer_payout, status,
            events = []
        } = req.body;

        await connection.query(
            `UPDATE offers SET
             offer_name = ?, offer_id = ?, heading = ?, history_name = ?,
             offer_url = ?, tracking_link = ?, amount = ?,
             currency_type = ?, event_name = ?, description = ?,
             image_url = ?, refer_payout = ?, status = ?
             WHERE id = ?`,
            [offer_name, offer_id, heading, history_name,
                offer_url, tracking_link, amount,
                currency_type, event_name, description,
                image_url, refer_payout, status, id]
        );

        // Replace events if an array was provided
        if (Array.isArray(events) && events.length > 0) {
            await connection.query(
                'DELETE FROM offer_event_steps WHERE offer_id = ?', [id]
            );
            for (let i = 0; i < events.length; i++) {
                const ev = events[i];
                await connection.query(
                    `INSERT INTO offer_event_steps
                     (offer_id, event_id, event_name, points, currency_type, step_order)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [id, ev.event_id || `evt${i}`, ev.event_name,
                        ev.points || 0, ev.currency_type || currency_type, i]
                );
            }
        }

        await connection.commit();
        res.json({ success: true, message: 'Offer updated successfully' });
    } catch (error) {
        await connection.rollback();
        console.error('Error updating offer:', error);
        res.status(500).json({ error: 'Failed to update offer' });
    } finally {
        connection.release();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /offers/:id
// ─────────────────────────────────────────────────────────────────────────────
async function deleteOffer(req, res) {
    try {
        const { id } = req.params;
        await db.query('DELETE FROM offers WHERE id = ?', [id]);
        res.json({ success: true, message: 'Offer deleted' });
    } catch (error) {
        console.error('Error deleting offer:', error);
        res.status(500).json({ error: 'Failed to delete offer' });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /offers  (admin: list all offers with event counts)
// ─────────────────────────────────────────────────────────────────────────────
async function getAllOffers(req, res) {
    try {
        const [offers] = await db.query(
            `SELECT o.*,
                    COUNT(oes.id) as event_count,
                    GROUP_CONCAT(oes.event_name ORDER BY oes.step_order SEPARATOR '|') as event_names
             FROM offers o
             LEFT JOIN offer_event_steps oes ON o.id = oes.offer_id
             GROUP BY o.id
             ORDER BY o.created_at DESC`
        );
        res.json(offers);
    } catch (error) {
        console.error('Error fetching offers:', error);
        res.status(500).json({ error: 'Failed to fetch offers' });
    }
}

module.exports = {
    getOfferwallOffers,
    getOfferEvents,
    createOfferWithEvents,
    updateOfferWithEvents,
    deleteOffer,
    getAllOffers,
};
