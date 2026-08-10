// RupiyaX payout gateway service (admin-triggered only)
// https://api.rupiyax.com — API key is stored in app_settings (rupiyax_api_key),
// same pattern as telegramService.js.

const db = require('../config/db');

const BASE_URL = 'https://api.rupiyax.com';

async function getRupiyaXConfig() {
    const [rows] = await db.query(
        "SELECT setting_value FROM app_settings WHERE setting_key = 'rupiyax_api_key'"
    );
    return { api_key: (rows[0]?.setting_value || '').trim() };
}

async function callRupiyaX(path, { method = 'GET', body } = {}) {
    const { api_key } = await getRupiyaXConfig();
    if (!api_key) {
        return { success: false, message: 'RupiyaX API key not configured', data: null };
    }

    const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
            'x-api-key': api_key,
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    const json = await res.json().catch(() => null);
    return json || { success: false, message: `RupiyaX returned non-JSON response (${res.status})`, data: null };
}

// Register a beneficiary with RupiyaX. method: 'upi' or 'imps'.
// For 'upi', detail1 is the UPI VPA. For 'imps', detail1 is account number and detail2 is IFSC.
async function addBeneficiary({ name, method, detail1, detail2, email, mobile }) {
    try {
        const json = await callRupiyaX('/api/v1/beneficiaries/add', {
            method: 'POST',
            body: { name, method, detail1, detail2, email, mobile },
        });

        if (!json.success) {
            console.error('RupiyaX addBeneficiary failed:', json.message);
        }
        return json;
    } catch (err) {
        console.error('RupiyaX addBeneficiary error:', err.message);
        return { success: false, message: err.message, data: null };
    }
}

// Trigger a payout to a previously registered beneficiary_id.
async function requestPayout({ beneficiary_id, amount, ref_id, comment }) {
    try {
        const json = await callRupiyaX('/api/v1/payouts/request', {
            method: 'POST',
            body: { beneficiary_id, amount, ref_id, comment },
        });

        if (!json.success) {
            console.error('RupiyaX requestPayout failed:', json.message);
        }
        return json;
    } catch (err) {
        console.error('RupiyaX requestPayout error:', err.message);
        return { success: false, message: err.message, data: null };
    }
}

// Poll settlement status for a previously requested payout.
async function checkPayoutStatus({ trx_id, ref_id }) {
    try {
        const qs = trx_id ? `trx_id=${encodeURIComponent(trx_id)}` : `ref_id=${encodeURIComponent(ref_id)}`;
        const json = await callRupiyaX(`/api/v1/payouts/status?${qs}`);

        if (!json.success) {
            console.error('RupiyaX checkPayoutStatus failed:', json.message);
        }
        return json;
    } catch (err) {
        console.error('RupiyaX checkPayoutStatus error:', err.message);
        return { success: false, message: err.message, data: null };
    }
}

// Retrieve current RupiyaX wallet balance (all fees/GST/SMS charges are deducted from this).
async function getWalletBalance() {
    try {
        const json = await callRupiyaX('/api/v1/wallet/balance');
        if (!json.success) {
            console.error('RupiyaX getWalletBalance failed:', json.message);
        }
        return json;
    } catch (err) {
        console.error('RupiyaX getWalletBalance error:', err.message);
        return { success: false, message: err.message, data: null };
    }
}

module.exports = {
    getRupiyaXConfig,
    addBeneficiary,
    requestPayout,
    checkPayoutStatus,
    getWalletBalance,
};
