const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
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

app.set('trust proxy', true);
app.use(cors());
app.use(bodyParser.json({ limit: '15mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '15mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

// ── Public APK Download (No Login Required) ──────────────────────────────────
// Note: the landing site (home / privacy-policy / help) now lives in its own
// repo and is deployed separately as a static site. This server only exposes
// the API, including the referral-aware download flow below.
//
// The APK is hosted by THIS server: manually upload the built .apk into the
// backend/uploads/apk/ directory. The newest .apk in that folder is served.
// GET /api/download/file          → Streams the hosted APK file (binary)
// GET /api/download/:referralCode → Logs referral + interstitial → APK file
// GET /api/download               → Streams the APK directly (no referral)
const APK_DIR = path.join(__dirname, 'uploads', 'apk');

// Resolve the APK to serve: newest *.apk file dropped into uploads/apk/.
function resolveApkFile() {
    try {
        const files = fs.readdirSync(APK_DIR)
            .filter((f) => f.toLowerCase().endsWith('.apk'))
            .map((f) => {
                const full = path.join(APK_DIR, f);
                return { full, mtime: fs.statSync(full).mtimeMs };
            })
            .sort((a, b) => b.mtime - a.mtime);
        return files[0]?.full || null;
    } catch (e) {
        // Directory missing or unreadable → no APK available
        return null;
    }
}

// Stream the hosted APK as a download. Returns 404 if none has been uploaded.
function sendApkFile(req, res) {
    const apkPath = resolveApkFile();
    if (!apkPath) {
        return res.status(404).json({
            message: 'APK download not available. Please contact support.'
        });
    }
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    return res.download(apkPath, 'app-release.apk', (err) => {
        if (err && !res.headersSent) {
            console.error('Error streaming APK:', err);
            res.status(500).end();
        }
    });
}

async function handleDownload(req, res) {
    try {
        const referralCode = req.params.referralCode || req.query.ref || '';

        // Make sure an APK is actually available before doing anything else.
        if (!resolveApkFile()) {
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

        // If there's no referral code, stream the APK directly.
        if (!referralCode) {
            return sendApkFile(req, res);
        }

        // With a referral code, serve an interstitial page that copies the
        // code to the clipboard before starting the APK download. The Flutter
        // app's login screen scans the clipboard on first launch and applies
        // the code automatically.
        const forwardedProto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
        const downloadUrl = `${forwardedProto}://${req.get('host')}/api/download/file`;
        const safeCode = String(referralCode).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        const safeUrl = downloadUrl.replace(/"/g, '&quot;');
        const clipboardPayload = `referral code: ${safeCode}`;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Download App</title>
<style>
  body{margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f8f6;color:#1b1b1b;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
  .card{background:#fff;border-radius:20px;padding:28px;max-width:380px;width:100%;box-shadow:0 6px 24px rgba(0,0,0,.08);text-align:center}
  h1{font-size:20px;margin:0 0 8px;color:#0f9d58}
  p{font-size:14px;line-height:1.5;color:#555;margin:8px 0}
  .code{font-size:22px;font-weight:800;letter-spacing:2px;color:#0f9d58;background:#eafaf0;padding:12px 16px;border-radius:12px;display:inline-block;margin:12px 0}
  .btn{display:block;background:#0f9d58;color:#fff;text-decoration:none;padding:16px 20px;border-radius:30px;font-weight:700;font-size:16px;margin-top:18px;border:0;cursor:pointer;width:100%}
  .note{font-size:12px;color:#888;margin-top:14px}
  .ok{color:#0f9d58;font-weight:600;display:none;margin-top:10px}
</style>
</head>
<body>
  <div class="card">
    <h1>You've been invited!</h1>
    <p>Your referral code is</p>
    <div class="code">${safeCode}</div>
    <p>Tap the button below — we'll copy your referral code and start the app download. It will be applied automatically when you sign in.</p>
    <button id="dl" class="btn">Copy Code &amp; Download</button>
    <div id="ok" class="ok">Code copied! Starting download…</div>
    <p class="note">If the download doesn't start, <a href="${safeUrl}">tap here</a>.</p>
  </div>
<script>
(function(){
  var payload = ${JSON.stringify(clipboardPayload)};
  var apk = ${JSON.stringify(downloadUrl)};
  function copy(text){
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text);
      }
    } catch(e){}
    return new Promise(function(resolve){
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand('copy'); } catch(e){}
      document.body.removeChild(ta); resolve();
    });
  }
  document.getElementById('dl').addEventListener('click', function(){
    copy(payload).finally(function(){
      document.getElementById('ok').style.display = 'block';
      setTimeout(function(){ window.location.href = apk; }, 400);
    });
  });
  // Best-effort silent copy on page load (may be blocked without gesture)
  copy(payload).catch(function(){});
})();
</script>
</body>
</html>`);
    } catch (error) {
        console.error('Error in download endpoint:', error);
        return res.status(500).json({ message: 'Server error' });
    }
}
app.get('/api/download', handleDownload);
app.get('/api/download/file', sendApkFile); // direct binary, must precede :referralCode
app.get('/api/download/:referralCode', handleDownload);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
