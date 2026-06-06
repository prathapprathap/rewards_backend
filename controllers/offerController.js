const db = require('../config/db');

function parseDemoScreenshots(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter(s => typeof s === 'string' && s.trim());
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return [];
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return parsed.filter(s => typeof s === 'string' && s.trim());
        } catch (_) {}
        // Fallback: comma-separated string
        return trimmed.split(',').map(s => s.trim()).filter(Boolean);
    }
    return [];
}

function serializeDemoScreenshots(raw) {
    const list = parseDemoScreenshots(raw);
    return list.length > 0 ? JSON.stringify(list) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /offers/offerwall
// Returns all active offers with their associated events. Each offer includes a
// `events` array so that the Flutter app can render the full milestone timeline.
// ─────────────────────────────────────────────────────────────────────────────
async function getOfferwallOffers(req, res) {
    try {
        // Optional: when a userId is supplied, the response hides offers the user
        // has already completed (or has a pending/approved submission for) and
        // marks per-event completion — mirroring GET /users/:userId/offers so the
        // offerwall stays consistent with the home screen.
        const userId = req.query.userId ? parseInt(req.query.userId, 10) : null;

        // Fetch all active offers
        const [offers] = await db.query(
            `SELECT id, offer_id, offer_name, side_label, side_label_color, heading, history_name,
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
            `SELECT id, offer_id, event_id, event_name, description, points,
                    currency_type, step_order
             FROM offer_event_steps
             WHERE offer_id IN (${placeholders})
             ORDER BY offer_id, step_order ASC`,
            offerIds
        );

        // ── Per-user completion data (only when userId is provided) ──────────
        // completedEventNames: offerId -> Set of approved event_name
        // approvedSubmissionOfferIds / submittedOfferIds: manual screenshot flow
        const completedEventNames = {};
        const submittedOfferIds = new Set();
        const approvedSubmissionOfferIds = new Set();

        if (userId && !Number.isNaN(userId)) {
            try {
                const [completedEvents] = await db.query(
                    `SELECT offer_id, event_name
                     FROM offer_events
                     WHERE user_id = ?
                       AND offer_id IN (${placeholders})
                       AND status = 'approved'
                     GROUP BY offer_id, event_name`,
                    [userId, ...offerIds]
                );
                for (const ev of completedEvents) {
                    if (!completedEventNames[ev.offer_id]) {
                        completedEventNames[ev.offer_id] = new Set();
                    }
                    completedEventNames[ev.offer_id].add(
                        (ev.event_name || '').trim().toLowerCase()
                    );
                }
            } catch (e) {
                console.error('Error fetching offerwall completion data (table may not exist):', e.message);
            }

            try {
                const [submissions] = await db.query(
                    `SELECT offer_id, status FROM task_submissions
                     WHERE user_id = ? AND status IN ('pending','approved')`,
                    [userId]
                );
                for (const s of submissions) {
                    submittedOfferIds.add(s.offer_id);
                    if (s.status === 'approved') approvedSubmissionOfferIds.add(s.offer_id);
                }
            } catch (e) {
                console.error('Error fetching offerwall submissions (table may not exist):', e.message);
            }
        }

        // Group events by offer_id, marking completion when we know the user.
        const eventMap = {};
        for (const event of events) {
            if (!eventMap[event.offer_id]) eventMap[event.offer_id] = [];
            const doneSet = completedEventNames[event.offer_id];
            const isCompleted = doneSet
                ? doneSet.has((event.event_name || '').trim().toLowerCase())
                : false;
            eventMap[event.offer_id].push({
                event_id: event.event_id,
                event_name: event.event_name,
                description: event.description || '',
                points: parseFloat(event.points) || 0,
                currency_type: event.currency_type || 'cash',
                is_completed: isCompleted,
            });
        }

        // Merge events into offers
        let result = offers.map(offer => ({
            ...offer,
            amount: parseFloat(offer.amount) || 0,
            events: eventMap[offer.id] || [],
        }));

        // When we know the user, drop offers that are fully completed or have an
        // active (pending/approved) manual submission.
        if (userId && !Number.isNaN(userId)) {
            result = result.filter(offer => {
                const offerEvents = offer.events;
                const totalSteps = offerEvents.length;
                const completedSteps = offerEvents.filter(e => e.is_completed).length;
                // Steps configured → all must be done. No steps (single-event
                // postback flow) → any approved event counts as completion.
                const eventsCompleted = totalSteps > 0
                    ? completedSteps >= totalSteps
                    : (completedEventNames[offer.id]?.size || 0) > 0;
                const isAllCompleted = eventsCompleted || approvedSubmissionOfferIds.has(offer.id);
                return !isAllCompleted && !submittedOfferIds.has(offer.id);
            });
        }

        res.json(result);
    } catch (error) {
        console.error('Error fetching offerwall offers:', error);
        res.status(500).json({ error: 'Failed to fetch offerwall offers' });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /offers/:offerId
// Returns a single offer with events. Used by OfferDetailScreen.
// ─────────────────────────────────────────────────────────────────────────────
async function getOfferById(req, res) {
    try {
        const { offerId } = req.params;

        const [offers] = await db.query(
            `SELECT id, offer_id, offer_name, side_label, side_label_color, heading, history_name,
                    offer_url, tracking_link, amount, currency_type,
                    event_name, description, image_url, refer_payout, status,
                    requires_screenshot, required_screenshot_count, demo_screenshots
             FROM offers WHERE id = ? LIMIT 1`,
            [offerId]
        );

        if (offers.length === 0) {
            return res.status(404).json({ success: false, message: 'Offer not found' });
        }

        const offer = offers[0];

        const [events] = await db.query(
            `SELECT event_id, event_name, description, points, currency_type, step_order
             FROM offer_event_steps WHERE offer_id = ? ORDER BY step_order ASC`,
            [offerId]
        );

        res.json({
            success: true,
            offer: {
                ...offer,
                amount: parseFloat(offer.amount) || 0,
                requires_screenshot: !!offer.requires_screenshot,
                required_screenshot_count: Math.max(1, parseInt(offer.required_screenshot_count, 10) || 1),
                demo_screenshots: parseDemoScreenshots(offer.demo_screenshots),
                events: events.map(e => ({
                    event_id: e.event_id,
                    event_name: e.event_name,
                    description: e.description || '',
                    points: parseFloat(e.points) || 0,
                    currency_type: e.currency_type || 'cash',
                    is_completed: false,
                })),
            }
        });
    } catch (error) {
        console.error('Error fetching offer by id:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch offer' });
    }
}


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
            offer_name, offer_id, side_label = '', side_label_color = '', heading, history_name = '',
            offer_url, tracking_link = '', amount,
            currency_type = 'cash', event_name = '',
            description = '', image_url = '',
            refer_payout = '1st Event', status = 'Active',
            requires_screenshot = 0,
            required_screenshot_count = 1,
            demo_screenshots = null,
            events = []  // array of { event_id, event_name, description, points, currency_type }
        } = req.body;

        if (!offer_name || !offer_url || !amount) {
            await connection.rollback();
            return res.status(400).json({ error: 'offer_name, offer_url, and amount are required.' });
        }

        // Insert offer
        const [offerResult] = await connection.query(
            `INSERT INTO offers
             (offer_name, offer_id, side_label, side_label_color, heading, history_name, offer_url,
              tracking_link, amount, currency_type, event_name,
              description, image_url, refer_payout, status,
              requires_screenshot, required_screenshot_count, demo_screenshots)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [offer_name, offer_id, side_label, side_label_color, heading, history_name, offer_url,
                tracking_link, amount, currency_type, event_name,
                description, image_url, refer_payout, status,
                requires_screenshot ? 1 : 0,
                Math.max(1, parseInt(required_screenshot_count, 10) || 1),
                serializeDemoScreenshots(demo_screenshots)]
        );

        const newOfferId = offerResult.insertId;

        // Insert event steps (if provided)
        if (Array.isArray(events) && events.length > 0) {
            for (let i = 0; i < events.length; i++) {
                const ev = events[i];
                await connection.query(
                    `INSERT INTO offer_event_steps
                     (offer_id, event_id, event_name, description, points, currency_type, step_order)
                     VALUES (?, ?, ?, ?, ?, ?, ?)` ,
                    [newOfferId, ev.event_id || `evt${i}`, ev.event_name, ev.description || '',
                        ev.points || 0, ev.currency_type || currency_type, i]
                );
            }
        } else if (event_name) {
            // Backwards-compat: single event_name → create one step
            await connection.query(
                `INSERT INTO offer_event_steps
                 (offer_id, event_id, event_name, points, currency_type, step_order)
                 VALUES (?, ?, ?, ?, ?, ?)` ,
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
            offer_name, offer_id, side_label = '', side_label_color = '', heading, history_name,
            offer_url, tracking_link, amount,
            currency_type, event_name, description,
            image_url, refer_payout, status,
            requires_screenshot = 0,
            required_screenshot_count = 1,
            demo_screenshots = null,
            events = []
        } = req.body;

        await connection.query(
            `UPDATE offers SET
             offer_name = ?, offer_id = ?, side_label = ?, side_label_color = ?, heading = ?, history_name = ?,
             offer_url = ?, tracking_link = ?, amount = ?,
             currency_type = ?, event_name = ?, description = ?,
             image_url = ?, refer_payout = ?, status = ?,
             requires_screenshot = ?, required_screenshot_count = ?, demo_screenshots = ?
             WHERE id = ?`,
            [offer_name, offer_id, side_label, side_label_color, heading, history_name,
                offer_url, tracking_link, amount,
                currency_type, event_name, description,
                image_url, refer_payout, status,
                requires_screenshot ? 1 : 0,
                Math.max(1, parseInt(required_screenshot_count, 10) || 1),
                serializeDemoScreenshots(demo_screenshots),
                id]
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
                     (offer_id, event_id, event_name, description, points, currency_type, step_order)
                     VALUES (?, ?, ?, ?, ?, ?, ?)` ,
                    [id, ev.event_id || `evt${i}`, ev.event_name, ev.description || '',
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
    getOfferById,
    getOfferEvents,
    createOfferWithEvents,
    updateOfferWithEvents,
    deleteOffer,
    getAllOffers,
};
