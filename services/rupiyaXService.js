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

// RupiyaX's API expects every field as a JSON string — a JS value that happens to be
// a number (e.g. an all-digit account number read back from a numeric DB column) gets
// serialized unquoted by JSON.stringify, which RupiyaX's Go backend then rejects with
// "cannot unmarshal number into Go value of type RecipientJSON". Force strings here.
const asString = (v) => (v === undefined || v === null || v === '') ? undefined : String(v);

// Register a beneficiary with RupiyaX. method: 'upi' or 'imps'.
// For 'upi', detail1 is the UPI VPA. For 'imps', detail1 is account number and detail2 is IFSC.
// Note: this endpoint was found to leave some accounts in a broken state that later fails
// payout with a RupiyaX-side JSON unmarshal error — the withdrawal payout path below no
// longer uses this, but it's kept for the admin "add payment account" flow.
async function addBeneficiary({ name, method, detail1, detail2, email, mobile }) {
    try {
        const json = await callRupiyaX('/api/v1/beneficiaries/add', {
            method: 'POST',
            body: {
                name: asString(name),
                method: asString(method),
                detail1: asString(detail1),
                detail2: asString(detail2),
                email: asString(email),
                mobile: asString(mobile),
            },
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

// Trigger a payout directly to recipient details — no pre-registered beneficiary.
// The public /beneficiaries/add + beneficiary_id flow was found to reliably fail with
// a RupiyaX-side error ("cannot unmarshal number into Go value of type RecipientJSON")
// for certain accounts (confirmed via raw curl, independent of our code). Direct mode,
// with method sent uppercase and amount as a string — matching the payload RupiyaX's
// own dashboard uses — was confirmed working, so payouts go straight through this path.
// method: 'IMPS' or 'UPI'. For IMPS pass acc_no + ifsc; for UPI pass upi.
async function requestPayout({ amount, ref_id, comment, method, name, upi, acc_no, ifsc }) {
    try {
        const json = await callRupiyaX('/api/v1/payouts/request', {
            method: 'POST',
            body: {
                amount: Number(amount),
                ref_id: asString(ref_id),
                comment: comment ?? '',
                method: asString(method)?.toLowerCase(),
                name: asString(name),
                upi: asString(upi) ?? '',
                acc_no: asString(acc_no) ?? '',
                ifsc: asString(ifsc) ?? '',
            },
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
