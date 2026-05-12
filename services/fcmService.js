// Firebase Cloud Messaging helper.
// Loads service account from env FIREBASE_SERVICE_ACCOUNT (raw JSON) or
// FIREBASE_SERVICE_ACCOUNT_PATH (file path). If neither is set, sendPush()
// becomes a no-op so the rest of the app keeps working.

let admin = null;
let initialized = false;
let initError = null;

function init() {
    if (initialized) return admin;
    initialized = true;
    try {
        admin = require('firebase-admin');
        let credential;
        if (process.env.FIREBASE_SERVICE_ACCOUNT) {
            const json = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
            credential = admin.credential.cert(json);
        } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
            const json = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
            credential = admin.credential.cert(json);
        } else {
            initError = 'FIREBASE_SERVICE_ACCOUNT env not set';
            admin = null;
            return null;
        }
        if (!admin.apps.length) {
            admin.initializeApp({ credential });
        }
        return admin;
    } catch (e) {
        initError = e.message;
        admin = null;
        return null;
    }
}

/**
 * Sends a push notification to a list of FCM tokens.
 * Returns { successCount, failureCount, invalidTokens[] }.
 */
async function sendPush(tokens, { title, body, imageUrl, data }) {
    const validTokens = (tokens || []).filter(Boolean);
    if (validTokens.length === 0) {
        return { successCount: 0, failureCount: 0, invalidTokens: [], skipped: true };
    }
    const a = init();
    if (!a) {
        console.warn('[fcm] Skipping push — Firebase Admin not configured:', initError);
        return { successCount: 0, failureCount: 0, invalidTokens: [], skipped: true };
    }

    const message = {
        notification: { title, body, ...(imageUrl ? { imageUrl } : {}) },
        data: Object.fromEntries(
            Object.entries(data || {}).map(([k, v]) => [k, String(v)])
        ),
        android: {
            notification: { sound: 'default', channelId: 'default_channel' },
            priority: 'high',
        },
    };

    const invalidTokens = [];
    let successCount = 0;
    let failureCount = 0;

    // FCM sendEachForMulticast supports up to 500 tokens per call.
    const chunkSize = 500;
    for (let i = 0; i < validTokens.length; i += chunkSize) {
        const chunk = validTokens.slice(i, i + chunkSize);
        try {
            const resp = await a.messaging().sendEachForMulticast({ tokens: chunk, ...message });
            successCount += resp.successCount;
            failureCount += resp.failureCount;
            resp.responses.forEach((r, idx) => {
                if (!r.success) {
                    const code = r.error && r.error.code;
                    if (code === 'messaging/registration-token-not-registered' ||
                        code === 'messaging/invalid-registration-token' ||
                        code === 'messaging/invalid-argument') {
                        invalidTokens.push(chunk[idx]);
                    }
                }
            });
        } catch (e) {
            console.error('[fcm] sendEachForMulticast error:', e.message);
            failureCount += chunk.length;
        }
    }
    return { successCount, failureCount, invalidTokens };
}

module.exports = { sendPush, init };
