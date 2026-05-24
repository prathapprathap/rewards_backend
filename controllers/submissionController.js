const db = require('../config/db');
const fs = require('fs/promises');
const path = require('path');

function getPublicBaseUrl(req) {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const protocol = (forwardedProto || req.protocol || 'http').split(',')[0].trim();
    return `${protocol}://${req.get('host')}`;
}

const UPLOAD_SUBDIR = 'submissions';

function getSubmissionPathFromUrl(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') return null;
    const marker = `/uploads/${UPLOAD_SUBDIR}/`;
    const idx = imageUrl.indexOf(marker);
    if (idx === -1) return null;
    const fileName = imageUrl.slice(idx + marker.length);
    if (!fileName) return null;
    return path.join(__dirname, '..', 'uploads', UPLOAD_SUBDIR, fileName);
}

async function persistSubmissionImage(imagePayload, req, seedName) {
    if (!imagePayload) return null;

    let dataUrl = '';
    if (typeof imagePayload === 'string') {
        dataUrl = imagePayload;
    } else {
        dataUrl =
            imagePayload.dataUrl ||
            imagePayload.data ||
            imagePayload.base64 ||
            '';
    }

    if (!dataUrl.startsWith('data:image/') || !dataUrl.includes('base64,')) {
        return null;
    }

    const mimeMatch = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/i);
    const mimeType = mimeMatch ? mimeMatch[1].toLowerCase() : 'image/png';
    const extMap = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
    };
    const ext = extMap[mimeType] || 'png';
    const safeSeed = (seedName || 'submission').toString().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'submission';
    const fileName = `${Date.now()}-${safeSeed}.${ext}`;
    const uploadDir = path.join(__dirname, '..', 'uploads', UPLOAD_SUBDIR);
    const base64Data = dataUrl.split('base64,')[1];

    await fs.mkdir(uploadDir, { recursive: true });
    await fs.writeFile(path.join(uploadDir, fileName), Buffer.from(base64Data, 'base64'));

    return `${getPublicBaseUrl(req)}/uploads/${UPLOAD_SUBDIR}/${fileName}`;
}

async function removeSubmissionImage(imageUrl) {
    const filePath = getSubmissionPathFromUrl(imageUrl);
    if (!filePath) return;
    try { await fs.unlink(filePath); } catch (_) {}
}

function parseScreenshotUrls(row) {
    if (!row) return [];
    if (row.screenshot_urls) {
        try {
            const parsed = JSON.parse(row.screenshot_urls);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        } catch (_) {}
    }
    return row.screenshot_url ? [row.screenshot_url] : [];
}

// ── USER: create a submission for an offer ───────────────────────────────────
// POST /api/users/:userId/offers/:offerId/submissions
// Body: { image_file: dataUrl|{dataUrl|base64} }
exports.createSubmission = async (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        const offerId = parseInt(req.params.offerId, 10);
        const { image_file, image_files, contact_info } = req.body || {};

        if (!userId || !offerId) {
            return res.status(400).json({ message: 'userId and offerId are required' });
        }

        const contact = typeof contact_info === 'string' ? contact_info.trim() : '';
        if (!contact) {
            return res.status(400).json({ message: 'WhatsApp number or email is required' });
        }
        const isPhone = /^\+?\d[\d\s-]{7,18}$/.test(contact);
        const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact);
        if (!isPhone && !isEmail) {
            return res.status(400).json({ message: 'Enter a valid WhatsApp number or email' });
        }
        if (contact.length > 120) {
            return res.status(400).json({ message: 'Contact info is too long' });
        }

        // Verify offer requires a screenshot
        const [offers] = await db.query(
            'SELECT id, requires_screenshot, required_screenshot_count FROM offers WHERE id = ? LIMIT 1',
            [offerId]
        );
        if (offers.length === 0) {
            return res.status(404).json({ message: 'Offer not found' });
        }
        if (!offers[0].requires_screenshot) {
            return res.status(400).json({ message: 'This offer does not require a screenshot' });
        }
        const requiredCount = Math.max(1, parseInt(offers[0].required_screenshot_count, 10) || 1);

        // Block duplicate active submission (pending or approved)
        const [active] = await db.query(
            `SELECT id, status FROM task_submissions
             WHERE user_id = ? AND offer_id = ? AND status IN ('pending','approved')
             ORDER BY id DESC LIMIT 1`,
            [userId, offerId]
        );
        if (active.length > 0) {
            return res.status(409).json({
                message: active[0].status === 'approved'
                    ? 'You have already been approved for this offer'
                    : 'A submission is already pending review',
                status: active[0].status,
            });
        }

        // Collect image payloads — prefer image_files (array), fall back to image_file (single)
        let payloads = [];
        if (Array.isArray(image_files) && image_files.length > 0) {
            payloads = image_files;
        } else if (image_file) {
            payloads = [image_file];
        }

        if (payloads.length < requiredCount) {
            return res.status(400).json({
                message: `Please upload ${requiredCount} screenshot${requiredCount > 1 ? 's' : ''}`,
            });
        }
        // Cap at requiredCount to keep storage bounded
        payloads = payloads.slice(0, requiredCount);

        const urls = [];
        for (let i = 0; i < payloads.length; i++) {
            const url = await persistSubmissionImage(payloads[i], req, `u${userId}o${offerId}_${i}`);
            if (!url) {
                // rollback already-saved files
                for (const u of urls) await removeSubmissionImage(u);
                return res.status(400).json({ message: 'Invalid image payload' });
            }
            urls.push(url);
        }

        const [result] = await db.query(
            `INSERT INTO task_submissions (user_id, offer_id, screenshot_url, screenshot_urls, contact_info, status)
             VALUES (?, ?, ?, ?, ?, 'pending')`,
            [userId, offerId, urls[0], JSON.stringify(urls), contact]
        );

        res.status(201).json({
            message: 'Submission created',
            submission: {
                id: result.insertId,
                user_id: userId,
                offer_id: offerId,
                screenshot_url: urls[0],
                screenshot_urls: urls,
                contact_info: contact,
                status: 'pending',
            },
        });
    } catch (error) {
        console.error('Error creating submission:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// ── USER: latest submission for a user+offer ─────────────────────────────────
// GET /api/users/:userId/offers/:offerId/submission
exports.getSubmissionStatus = async (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        const offerId = parseInt(req.params.offerId, 10);

        const [rows] = await db.query(
            `SELECT id, status, screenshot_url, screenshot_urls, contact_info, admin_note, created_at, reviewed_at
             FROM task_submissions
             WHERE user_id = ? AND offer_id = ?
             ORDER BY id DESC LIMIT 1`,
            [userId, offerId]
        );

        const row = rows[0];
        if (!row) return res.json({ submission: null });
        const urls = parseScreenshotUrls(row);
        res.json({
            submission: {
                id: row.id,
                status: row.status,
                screenshot_url: row.screenshot_url,
                screenshot_urls: urls,
                contact_info: row.contact_info,
                admin_note: row.admin_note,
                created_at: row.created_at,
                reviewed_at: row.reviewed_at,
            },
        });
    } catch (error) {
        console.error('Error fetching submission:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// ── ADMIN: list all submissions ──────────────────────────────────────────────
// GET /api/admin/submissions?status=pending
exports.listSubmissions = async (req, res) => {
    try {
        const { status } = req.query;
        const params = [];
        let where = '';
        if (status && ['pending', 'approved', 'rejected'].includes(status)) {
            where = 'WHERE ts.status = ?';
            params.push(status);
        }
        const [rows] = await db.query(
            `SELECT ts.id, ts.user_id, ts.offer_id, ts.screenshot_url, ts.screenshot_urls,
                    ts.contact_info, ts.status,
                    ts.admin_note, ts.created_at, ts.reviewed_at,
                    u.name AS user_name, u.email AS user_email,
                    o.offer_name, o.amount, o.image_url AS offer_image
             FROM task_submissions ts
             LEFT JOIN users u ON u.id = ts.user_id
             LEFT JOIN offers o ON o.id = ts.offer_id
             ${where}
             ORDER BY ts.created_at DESC`,
            params
        );
        res.json(rows.map(r => ({ ...r, screenshot_urls: parseScreenshotUrls(r) })));
    } catch (error) {
        console.error('Error listing submissions:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// ── ADMIN: approve / reject a submission ─────────────────────────────────────
// PUT /api/admin/submissions/:id  Body: { status: 'approved'|'rejected', admin_note?: string }
exports.reviewSubmission = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const { id } = req.params;
        const { status, admin_note = null } = req.body || {};

        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ message: 'status must be approved or rejected' });
        }

        await connection.beginTransaction();

        const [rows] = await connection.query(
            'SELECT id, user_id, offer_id, status FROM task_submissions WHERE id = ? FOR UPDATE',
            [id]
        );
        if (rows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Submission not found' });
        }
        const submission = rows[0];
        if (submission.status !== 'pending') {
            await connection.rollback();
            return res.status(400).json({ message: `Submission already ${submission.status}` });
        }

        await connection.query(
            `UPDATE task_submissions
             SET status = ?, admin_note = ?, reviewed_at = NOW()
             WHERE id = ?`,
            [status, admin_note, id]
        );

        // On approval, credit the offer reward to the user wallet
        if (status === 'approved') {
            const [[offer]] = await connection.query(
                'SELECT amount FROM offers WHERE id = ? LIMIT 1',
                [submission.offer_id]
            );
            const reward = parseFloat(offer?.amount) || 0;
            if (reward > 0) {
                await connection.query(
                    `UPDATE users
                     SET wallet_balance = wallet_balance + ?, total_earnings = total_earnings + ?
                     WHERE id = ?`,
                    [reward, reward, submission.user_id]
                );
                // Optional: log a wallet transaction if the table exists in this env
                try {
                    const [[balRow]] = await connection.query(
                        'SELECT wallet_balance FROM users WHERE id = ?',
                        [submission.user_id]
                    );
                    const balanceAfter = parseFloat(balRow?.wallet_balance) || 0;
                    const balanceBefore = balanceAfter - reward;
                    await connection.query(
                        `INSERT INTO wallet_transactions
                         (user_id, transaction_type, currency_type, amount, balance_before, balance_after, description, offer_id)
                         VALUES (?, 'offer', 'cash', ?, ?, ?, ?, ?)`,
                        [submission.user_id, reward, balanceBefore, balanceAfter,
                         `Task submission approved (#${id})`, submission.offer_id]
                    );
                } catch (_) {
                    // wallet_transactions schema may not include offer_id column on older envs — ignore
                }
            }
        }

        await connection.commit();
        res.json({ message: `Submission ${status}` });
    } catch (error) {
        await connection.rollback();
        console.error('Error reviewing submission:', error);
        res.status(500).json({ message: 'Server error' });
    } finally {
        connection.release();
    }
};

// ── ADMIN: delete a submission (cleans up file) ──────────────────────────────
exports.deleteSubmission = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await db.query('SELECT screenshot_url, screenshot_urls FROM task_submissions WHERE id = ?', [id]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Submission not found' });
        }
        const urls = parseScreenshotUrls(rows[0]);
        for (const u of urls) await removeSubmissionImage(u);
        await db.query('DELETE FROM task_submissions WHERE id = ?', [id]);
        res.json({ message: 'Submission deleted' });
    } catch (error) {
        console.error('Error deleting submission:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
