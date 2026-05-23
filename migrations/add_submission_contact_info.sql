-- Adds a contact_info column to task_submissions so users can supply a
-- WhatsApp number or email along with their proof screenshot.
-- Run with: node backend/runMigration.js migrations/add_submission_contact_info.sql

ALTER TABLE `task_submissions`
  ADD COLUMN `contact_info` VARCHAR(120) NULL DEFAULT NULL AFTER `screenshot_url`;
