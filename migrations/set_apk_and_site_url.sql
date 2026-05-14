-- Sets apk_download_url and site_url so referral share links work end-to-end.
-- apk_download_url → Google Drive direct-download URL (id-form, not /view).
-- site_url         → public Express backend (serves /api/download/:referralCode).
-- Run with: node backend/runMigration.js migrations/set_apk_and_site_url.sql

INSERT INTO `app_settings` (`setting_key`, `setting_value`)
VALUES ('apk_download_url', 'https://drive.google.com/uc?export=download&id=1RG5nUme7Qd-6p7vvPD6p-lQVHfcPgwjV')
ON DUPLICATE KEY UPDATE `setting_value` = VALUES(`setting_value`);

INSERT INTO `app_settings` (`setting_key`, `setting_value`)
VALUES ('site_url', 'https://rewards-backend-zkhh.onrender.com')
ON DUPLICATE KEY UPDATE `setting_value` = VALUES(`setting_value`);
