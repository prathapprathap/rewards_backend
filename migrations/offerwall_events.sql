-- ============================================================
-- Migration: Multi-Event Offerwall System
-- Adds offer_event_steps table to support progressive reward
-- milestones (e.g. Install → Level 5 → Purchase) per offer.
-- Run this AFTER the existing offer18_integration.sql migration.
-- ============================================================

-- 1. offer_event_steps
--    Stores the ordered list of events that earn a reward within a single offer.
CREATE TABLE IF NOT EXISTS offer_event_steps (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  offer_id     INT          NOT NULL,
  event_id     VARCHAR(64)  NOT NULL COMMENT 'Unique event key sent in postback (e.g. evt_install)',
  event_name   VARCHAR(255) NOT NULL COMMENT 'Human-readable label for the Flutter app',
  points       DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'Reward amount for this single event',
  currency_type ENUM('cash','coins','gems') DEFAULT 'cash',
  step_order   INT          NOT NULL DEFAULT 0 COMMENT 'Display order (0-indexed)',
  created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
  UNIQUE KEY unique_offer_event (offer_id, event_id),
  INDEX idx_offer_id (offer_id)
);

-- 2. Ensure the offer_events table has an event_id column so postbacks
--    can be matched to specific offer_event_steps, preventing duplicate rewards
--    per (user, offer, event_id) combination.
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE table_name = 'offer_events'
   AND table_schema = DATABASE()
   AND column_name = 'event_step_id') > 0,
  'SELECT 1',
  'ALTER TABLE offer_events ADD COLUMN event_step_id INT NULL AFTER click_id'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 3. Unique constraint on offer_events to prevent duplicate postbacks
--    for the exact same (click_id, event_name) combination.
--    (safe to run; ALTER IGNORE handles already-existing key)
ALTER TABLE offer_events
  ADD UNIQUE KEY IF NOT EXISTS unique_click_event (click_id, event_name);
