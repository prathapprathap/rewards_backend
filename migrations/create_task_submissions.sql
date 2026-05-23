-- Creates the task_submissions table only (idempotent).
-- Use when the offers.requires_screenshot column already exists and the
-- combined migration aborts on the ALTER step.
-- Run with: node backend/runMigration.js migrations/create_task_submissions.sql

CREATE TABLE IF NOT EXISTS `task_submissions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `offer_id` INT NOT NULL,
  `screenshot_url` VARCHAR(500) NOT NULL,
  `contact_info` VARCHAR(120) DEFAULT NULL,
  `status` ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `admin_note` VARCHAR(500) DEFAULT NULL,
  `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  `reviewed_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_user_offer` (`user_id`, `offer_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `task_submissions_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `task_submissions_offer_fk` FOREIGN KEY (`offer_id`) REFERENCES `offers` (`id`) ON DELETE CASCADE
);
