const db = require('../config/db');

// POST /api/webhook/rupiyax
// Receives real-time payout status updates from RupiyaX.
// Must respond 200 within 10s or RupiyaX will retry.
exports.rupiyaXWebhook = async (req, res) => {
    try {
        const { event, data } = req.body || {};
        const trxId = data?.trx_id;

        if (!event || !trxId) {
            return res.status(400).json({ message: 'event and data.trx_id are required' });
        }

        const [[payout]] = await db.query('SELECT id, withdrawal_id FROM payouts WHERE rupiyax_trx_id = ?', [trxId]);
        if (!payout) {
            // Acknowledge anyway so RupiyaX doesn't keep retrying for a payout we don't recognize.
            console.error('RupiyaX webhook: unknown trx_id', trxId);
            return res.status(200).json({ message: 'Unknown transaction, ignored' });
        }

        await db.query(
            'UPDATE payouts SET status = ?, utr = ?, fee = COALESCE(?, fee), raw_response = ?, updated_at = NOW() WHERE id = ?',
            [data.status || null, data.utr || null, data.fee ?? null, JSON.stringify(req.body), payout.id]
        );

        await db.query('UPDATE withdrawals SET gateway_status = ? WHERE id = ?', [data.status || null, payout.withdrawal_id]);

        if (data.status === 'success') {
            await db.query(
                `UPDATE withdrawals SET status = 'PAID', paid_at = NOW() WHERE id = ? AND status != 'REJECTED'`,
                [payout.withdrawal_id]
            );
            await db.query("UPDATE wallet_transactions SET status = 'success' WHERE withdrawal_id = ?", [payout.withdrawal_id]);
        } else if (data.status === 'failed') {
            await db.query("UPDATE wallet_transactions SET status = 'failed' WHERE withdrawal_id = ?", [payout.withdrawal_id]);
        }

        res.status(200).json({ message: 'ok' });
    } catch (error) {
        console.error('RupiyaX webhook error:', error);
        // Still 200 so RupiyaX doesn't hammer retries on our bug; the raw event is lost only for this delivery.
        res.status(200).json({ message: 'error logged' });
    }
};
