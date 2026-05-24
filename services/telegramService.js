// Telegram notification service
// Mirrors the PHP implementation from rewardmobi.xyz/CallBack-Data-PostBack.php
// Sends an HTML-formatted message to a Telegram bot/chat when an offer is approved.

const db = require('../config/db');

const COMPANY_NAME = 'RewardMobi';

async function getTelegramConfig() {
    const [rows] = await db.query(
        "SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN ('telegram_bot_token','telegram_chat_id')"
    );
    const cfg = { bot_token: '', chat_id: '' };
    for (const r of rows) {
        if (r.setting_key === 'telegram_bot_token') cfg.bot_token = (r.setting_value || '').trim();
        if (r.setting_key === 'telegram_chat_id') cfg.chat_id = (r.setting_value || '').trim();
    }
    return cfg;
}

// Send raw HTML message
async function sendMessage(text) {
    try {
        const { bot_token, chat_id } = await getTelegramConfig();
        if (!bot_token || !chat_id) {
            console.log('ℹ️ Telegram not configured (bot_token or chat_id missing) — skipping notification');
            return false;
        }

        const url = `https://api.telegram.org/bot${bot_token}/sendMessage?chat_id=${encodeURIComponent(chat_id)}&text=${encodeURIComponent(text)}&parse_mode=html`;

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'user-agent': 'Mozilla/5.0 (Linux; Android 10; TECNO KE6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.99 Mobile Safari/537.36'
            }
        });

        if (!res.ok) {
            const body = await res.text().catch(() => '');
            console.error('Telegram sendMessage failed:', res.status, body);
            return false;
        }
        return true;
    } catch (err) {
        console.error('Telegram sendMessage error:', err.message);
        return false;
    }
}

// Build + send offer-approved notification (matches PHP format exactly)
// fields: offerName, coin (payout amount), phoneNumber, deviceId
async function sendOfferApprovedNotification({ offerName, coin, phoneNumber, deviceId }) {
    const text =
        `<b>OfferName: ${offerName ?? ''}\n` +
        `Coin : ${coin ?? ''}\n` +
        `PhoneNumber : ${phoneNumber ?? ''}\n` +
        `DeviceId : ${deviceId ?? ''}\n` +
        `Company : ${COMPANY_NAME}\n` +
        `</b>`;
    return sendMessage(text);
}

module.exports = {
    sendMessage,
    sendOfferApprovedNotification,
    getTelegramConfig,
};
