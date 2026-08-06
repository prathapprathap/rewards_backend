-- offer_clicks holds one row per (user_id, offer_id) and trackClick
-- overwrites click_id on every re-click (see offer_clicks_one_per_user_offer.sql).
-- That means a click_id already handed to an ad network on an earlier click
-- can be orphaned by a later re-click, and a postback that comes back with
-- the old click_id then fails to match ("Click not found").
--
-- This table remembers every click_id that trackClick is about to overwrite,
-- pointing at the offer_clicks row it belonged to, so handlePostback can
-- resolve a stale click_id back to the current row as a final fallback.
--
-- Run this manually against the live DB after reviewing.

CREATE TABLE IF NOT EXISTS offer_clicks_id_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    old_click_id VARCHAR(64) NOT NULL,
    offer_click_row_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    KEY idx_old_click_id (old_click_id),
    KEY idx_offer_click_row_id (offer_click_row_id)
);
