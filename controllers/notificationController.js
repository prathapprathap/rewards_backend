const db = require('../config/db');
const fcmService = require('../services/fcmService');

// ── Admin endpoints ──────────────────────────────────────────────────────────

// GET /api/admin/notifications
exports.listAdminNotifications = async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT n.*, u.email AS target_email, u.name AS target_name
             FROM notifications n
             LEFT JOIN users u ON n.target_user_id = u.id
             ORDER BY n.created_at DESC
             LIMIT 500`
        );
        res.status(200).json(rows);
    } catch (err) {
        console.error('listAdminNotifications:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/notifications
// body: { title, body, image_url?, action_url?, target ('all'|'user'), target_user_id? }
exports.createNotification = async (req, res) => {
    const {
        title,
        body,
        image_url = null,
        action_url = null,
        target = 'all',
        target_user_id = null,
    } = req.body || {};

    if (!title || !body) {
        return res.status(400).json({ message: 'title and body are required' });
    }
    if (target === 'user' && !target_user_id) {
        return res.status(400).json({ message: 'target_user_id is required when target is "user"' });
    }

    try {
        // Collect FCM tokens
        let tokens = [];
        if (target === 'user') {
            const [rows] = await db.query(
                "SELECT fcm_token FROM users WHERE id = ? AND fcm_token IS NOT NULL AND fcm_token != ''",
                [target_user_id]
            );
            tokens = rows.map(r => r.fcm_token);
        } else {
            const [rows] = await db.query(
                "SELECT fcm_token FROM users WHERE fcm_token IS NOT NULL AND fcm_token != ''"
            );
            tokens = rows.map(r => r.fcm_token);
        }

        // Insert DB record first so the in-app inbox always has it
        const [insertResult] = await db.query(
            `INSERT INTO notifications (title, body, image_url, action_url, target, target_user_id, sent_count)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [title, body, image_url, action_url, target, target === 'user' ? target_user_id : null, 0]
        );
        const notificationId = insertResult.insertId;

        // Push via FCM (best-effort)
        const pushResult = await fcmService.sendPush(tokens, {
            title,
            body,
            imageUrl: image_url,
            data: { notification_id: notificationId, action_url: action_url || '' },
        });

        // Clean up invalid tokens
        if (pushResult.invalidTokens && pushResult.invalidTokens.length > 0) {
            await db.query(
                `UPDATE users SET fcm_token = NULL WHERE fcm_token IN (?)`,
                [pushResult.invalidTokens]
            );
        }

        await db.query(
            'UPDATE notifications SET sent_count = ? WHERE id = ?',
            [pushResult.successCount || 0, notificationId]
        );

        res.status(201).json({
            message: 'Notification created',
            id: notificationId,
            push: pushResult,
            recipients: tokens.length,
        });
    } catch (err) {
        console.error('createNotification:', err);
        res.status(500).json({ message: 'Server error: ' + err.message });
    }
};

// DELETE /api/admin/notifications/:id
exports.deleteNotification = async (req, res) => {
    try {
        await db.query('DELETE FROM notifications WHERE id = ?', [req.params.id]);
        res.status(200).json({ message: 'Deleted' });
    } catch (err) {
        console.error('deleteNotification:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ── User endpoints ───────────────────────────────────────────────────────────

// POST /api/users/:userId/fcm-token  { token }
exports.registerFcmToken = async (req, res) => {
    const { userId } = req.params;
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ message: 'token is required' });
    try {
        await db.query('UPDATE users SET fcm_token = ? WHERE id = ?', [token, userId]);
        res.status(200).json({ message: 'Token registered' });
    } catch (err) {
        console.error('registerFcmToken:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/users/:userId/notifications
exports.getUserNotifications = async (req, res) => {
    const { userId } = req.params;
    try {
        const [rows] = await db.query(
            `SELECT n.*,
                    CASE WHEN unr.id IS NULL THEN 0 ELSE 1 END AS is_read,
                    unr.read_at
             FROM notifications n
             LEFT JOIN user_notification_reads unr
                    ON unr.notification_id = n.id AND unr.user_id = ?
             WHERE n.target = 'all' OR (n.target = 'user' AND n.target_user_id = ?)
             ORDER BY n.created_at DESC
             LIMIT 200`,
            [userId, userId]
        );
        res.status(200).json(rows);
    } catch (err) {
        console.error('getUserNotifications:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/users/:userId/notifications/:id/read
exports.markNotificationRead = async (req, res) => {
    const { userId, id } = req.params;
    try {
        await db.query(
            `INSERT IGNORE INTO user_notification_reads (user_id, notification_id) VALUES (?, ?)`,
            [userId, id]
        );
        res.status(200).json({ message: 'Marked read' });
    } catch (err) {
        console.error('markNotificationRead:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/users/app/version-check?version=1.2.0
// Returns: { maintenance_mode, maintenance_message, latest_version,
//           min_supported_version, update_required (force), update_available (optional),
//           update_message, update_url }
exports.versionCheck = async (req, res) => {
    const current = (req.query.version || '0.0.0').toString().trim();
    try {
        const keys = [
            'maintenance_mode',
            'maintenance_message',
            'latest_version',
            'min_supported_version',
            'update_message',
            'update_url',
            'apk_download_url',
        ];
        const [rows] = await db.query(
            `SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (?)`,
            [keys]
        );
        const s = rows.reduce((acc, r) => {
            acc[r.setting_key] = r.setting_value;
            return acc;
        }, {});

        const latest = s.latest_version || '0.0.0';
        const min = s.min_supported_version || '0.0.0';

        res.status(200).json({
            maintenance_mode: (s.maintenance_mode || 'Off') === 'On',
            maintenance_message: s.maintenance_message || '',
            latest_version: latest,
            min_supported_version: min,
            current_version: current,
            update_required: semverLt(current, min),
            update_available: semverLt(current, latest),
            update_message: s.update_message || '',
            update_url: s.update_url || s.apk_download_url || '',
        });
    } catch (err) {
        console.error('versionCheck:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// Compare semver strings — returns true if a < b
function semverLt(a, b) {
    const pa = a.split('.').map(n => parseInt(n, 10) || 0);
    const pb = b.split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < 3; i++) {
        const ai = pa[i] || 0;
        const bi = pb[i] || 0;
        if (ai < bi) return true;
        if (ai > bi) return false;
    }
    return false;
}
