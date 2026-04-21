const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const db = require('./config/db');
const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');
const walletRoutes = require('./routes/walletRoutes');
const offer18Routes = require('./routes/offer18Routes');
const offerRoutes = require('./routes/offerRoutes');


const http = require('http');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Routes
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/offer18', offer18Routes);
app.use('/api/offers', offerRoutes);



// Database Keep-Alive Route
app.get('/api/db-keep-alive', async (req, res) => {
    try {
        await db.query('SELECT 1');
        res.status(200).send('Database is awake');
    } catch (error) {
        console.error('Keep-alive failed:', error);
        res.status(500).send('Database connection error');
    }
});

app.get('/', (req, res) => {
    res.send('HotReward Backend is running');
});

// ── Public APK Download (No Login Required) ──────────────────────────────────
// GET /api/download/:referralCode → Redirects to APK download URL
// GET /api/download             → Redirects to APK download URL (no referral)
async function handleDownload(req, res) {
    try {
        const referralCode = req.params.referralCode || req.query.ref || '';

        // Get APK download URL from settings
        const [settings] = await db.query(
            'SELECT setting_value FROM app_settings WHERE setting_key = ?',
            ['apk_download_url']
        );

        const downloadUrl = settings[0]?.setting_value?.trim();
        if (!downloadUrl) {
            return res.status(404).json({
                message: 'APK download not available. Please contact support.'
            });
        }

        // Log the download/referral click (optional analytics)
        if (referralCode) {
            try {
                // 1. Log the click for analytics
                await db.query(
                    `INSERT INTO referral_downloads (referral_code, ip_address, user_agent, created_at) 
                     VALUES (?, ?, ?, NOW())`,
                    [referralCode, req.ip, req.headers['user-agent'] || '']
                );

                // 2. Cache it for attribution (Auto-detect logic)
                const userAgent = req.headers['user-agent'] || 'unknown';

                // We delete older ones for this IP+UA combo to keep it fresh
                await db.query('DELETE FROM referral_attributions WHERE ip_address = ? AND user_agent = ?', [req.ip, userAgent]);

                await db.query(
                    `INSERT INTO referral_attributions (ip_address, user_agent, referral_code, created_at) 
                     VALUES (?, ?, ?, NOW())`,
                    [req.ip, userAgent, referralCode]
                );
            } catch (e) {
                console.log('Referral logging/attribution failed:', e.message);
            }
        }

        // Redirect to APK download
        return res.redirect(302, downloadUrl);
    } catch (error) {
        console.error('Error in download endpoint:', error);
        return res.status(500).json({ message: 'Server error' });
    }
}
app.get('/api/download', handleDownload);
app.get('/api/download/:referralCode', handleDownload);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

