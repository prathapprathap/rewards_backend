-- Extends task submissions to support multiple screenshots and demo previews.
-- Run with: node backend/runMigration.js migrations/add_fill_form_fields.sql

-- 1) Add screenshot count + demo screenshots to offers
ALTER TABLE `offers`
  ADD COLUMN `required_screenshot_count` INT NOT NULL DEFAULT 1 AFTER `requires_screenshot`,
  ADD COLUMN `demo_screenshots` TEXT NULL AFTER `required_screenshot_count`;

-- 2) Add JSON column for multiple screenshots on submissions
--    Keep existing screenshot_url for backwards compatibility.
ALTER TABLE `task_submissions`
  ADD COLUMN `screenshot_urls` TEXT NULL AFTER `screenshot_url`;
