-- Make offer_clicks hold exactly one row per (user_id, offer_id) instead of
-- one row per click. Required by the trackClick/handlePostback changes that
-- upsert on click and allow postbacks to match by device_id as a fallback
-- to click_id.
--
-- Written for broad compatibility (MySQL 5.7+ / MariaDB, no window
-- functions, no "IF NOT EXISTS" on ALTER TABLE) since some hosts don't
-- support the newer syntax.
--
-- Run this manually against the live DB after reviewing. Take a backup of
-- offer_clicks first.

-- 1. Inspect how many duplicate (user_id, offer_id) rows currently exist.
--    Run this first to gauge impact before deleting anything.
SELECT user_id, offer_id, COUNT(*) AS row_count
FROM offer_clicks
GROUP BY user_id, offer_id
HAVING COUNT(*) > 1;

-- 2. Dedupe: for each (user_id, offer_id), keep exactly one row.
--    Priority: a 'completed' row wins (preserves reward history/status),
--    otherwise the most recently created row wins. All other rows for that
--    (user_id, offer_id) pair are deleted.
--
--    offer_events.click_id references may point at click_ids being deleted
--    here; offer_events itself is untouched (it's the historical ledger and
--    doesn't need a live FK to offer_clicks), so no data loss on that side.
DELETE oc FROM offer_clicks oc
LEFT JOIN (
    SELECT t.user_id, t.offer_id, t.id AS keep_id
    FROM offer_clicks t
    WHERE t.id = (
        SELECT id FROM offer_clicks t2
        WHERE t2.user_id = t.user_id AND t2.offer_id = t.offer_id
        ORDER BY (t2.status = 'completed') DESC, t2.created_at DESC, t2.id DESC
        LIMIT 1
    )
) keepers ON keepers.user_id = oc.user_id AND keepers.offer_id = oc.offer_id AND keepers.keep_id = oc.id
WHERE keepers.keep_id IS NULL;

-- 3. Add the uniqueness constraint the app now relies on for its
--    INSERT ... ON DUPLICATE KEY UPDATE upsert in trackClick.
--    If this errors with "Duplicate key name", the key already exists —
--    safe to skip.
ALTER TABLE offer_clicks
    ADD UNIQUE KEY unique_user_offer (user_id, offer_id);

-- 3b. Index device_id: handlePostback now falls back to
-- WHERE device_id = ? [AND offer_id = ?] when click_id doesn't match.
-- If this errors with "Duplicate key name", the key already exists —
-- safe to skip.
ALTER TABLE offer_clicks
    ADD KEY idx_device_id (device_id);

-- 4. Sanity check: should return 0 rows.
SELECT user_id, offer_id, COUNT(*) AS row_count
FROM offer_clicks
GROUP BY user_id, offer_id
HAVING COUNT(*) > 1;
