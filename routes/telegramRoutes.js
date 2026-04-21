const express = require('express');
const router = express.Router();
const db = require('../config/db');
const axios = require('axios');

// Webhook endpoint for Telegram Bot
router.post('/webhook', async (req, res) => {
    const { message } = req.body;

    if (!message || !message.text) return res.sendStatus(200);

    const chatId = message.chat.id.toString();
    const text = message.text;

    // Check if it is a /start command with a user_id parameter
    // Example: /start 123
    if (text.startsWith('/start ')) {
        const appUserId = text.split(' ')[1];

        if (appUserId) {
            try {
                // Link the telegram_id to the user record
                await db.query(
                    'UPDATE users SET telegram_id = ? WHERE id = ?',
                    [chatId, appUserId]
                );

                // Get bot token and name from settings
                const [settings] = await db.query(
                    'SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (?, ?)',
                    ['telegram_bot_token', 'site_name']
                );
                const settingsMap = settings.reduce((acc, s) => {
                    acc[s.setting_key] = s.setting_value;
                    return acc;
                }, {});

                const botToken = settingsMap['telegram_bot_token'];
                const siteName = settingsMap['site_name'];

                if (botToken) {
                    // Send a confirmation message back to the user
                    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                        chat_id: chatId,
                        text: `✅ Verified! Your Telegram account is now linked to ${siteName}.\n\nYou can now go back to the app and claim your reward.`
                    });
                }
            } catch (error) {
                console.error('Error linking telegram user:', error);
            }
        }
    }

    res.sendStatus(200);
});

module.exports = router;
