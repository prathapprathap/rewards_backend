-- Full Database Dump
-- Generated for RewardsApp

SET FOREIGN_KEY_CHECKS = 0;

-- Table: account_delete_requests
CREATE TABLE `account_delete_requests` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `email` varchar(255) NOT NULL,
  `balance` decimal(10,2) DEFAULT '0.00',
  `note` text,
  `status` enum('PENDING','CANCELLED','DELETED') DEFAULT 'PENDING',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `account_delete_requests_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

-- Table: admin_info
CREATE TABLE `admin_info` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(255) NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `password` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`)
);

-- Table: app_settings
CREATE TABLE `app_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `setting_key` varchar(100) NOT NULL,
  `setting_value` text NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `setting_key` (`setting_key`)
);

-- Table: banners
CREATE TABLE `banners` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(255) DEFAULT NULL,
  `subtitle` varchar(255) DEFAULT NULL,
  `image_url` varchar(255) DEFAULT NULL,
  `action_type` varchar(50) DEFAULT NULL,
  `action_value` varchar(255) DEFAULT NULL,
  `status` varchar(20) DEFAULT 'Active',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

-- Table: checkins
CREATE TABLE `checkins` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `checkin_date` date NOT NULL,
  `reward_amount` decimal(10,2) DEFAULT '0.00',
  `streak_count` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_date` (`user_id`,`checkin_date`),
  CONSTRAINT `checkins_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

-- Table: device_fingerprints
CREATE TABLE `device_fingerprints` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `device_id` varchar(255) NOT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text,
  `first_seen` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_suspicious` tinyint(1) DEFAULT '0',
  `notes` text,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_device` (`user_id`,`device_id`),
  KEY `idx_device_id` (`device_id`),
  KEY `idx_suspicious` (`is_suspicious`),
  CONSTRAINT `device_fingerprints_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

-- Table: offer_clicks
CREATE TABLE `offer_clicks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `click_id` varchar(64) NOT NULL,
  `user_id` int NOT NULL,
  `offer_id` int NOT NULL,
  `device_id` varchar(255) DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text,
  `status` enum('clicked','pending','completed','rejected') DEFAULT 'clicked',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `click_id` (`click_id`),
  KEY `offer_id` (`offer_id`),
  KEY `idx_click_id` (`click_id`),
  KEY `idx_user_offer` (`user_id`,`offer_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `offer_clicks_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `offer_clicks_ibfk_2` FOREIGN KEY (`offer_id`) REFERENCES `offers` (`id`) ON DELETE CASCADE
);

-- Table: offer_event_steps
CREATE TABLE `offer_event_steps` (
  `id` int NOT NULL AUTO_INCREMENT,
  `offer_id` int NOT NULL,
  `event_name` varchar(100) NOT NULL,
  `event_id` varchar(100) DEFAULT NULL,
  `description` text,
  `points` decimal(10,2) DEFAULT '0.00',
  `currency_type` varchar(20) DEFAULT 'cash',
  `step_order` int DEFAULT '0',
  `is_first_step` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `offer_id` (`offer_id`)
);

-- Table: offer_events
CREATE TABLE `offer_events` (
  `id` int NOT NULL AUTO_INCREMENT,
  `click_id` varchar(64) NOT NULL,
  `event_step_id` int DEFAULT NULL,
  `offer_id` int NOT NULL,
  `user_id` int NOT NULL,
  `event_name` varchar(100) NOT NULL,
  `event_value` decimal(10,2) DEFAULT '0.00',
  `payout` decimal(10,2) NOT NULL,
  `currency_type` enum('coins','gems','cash') DEFAULT 'cash',
  `status` enum('pending','approved','rejected') DEFAULT 'pending',
  `postback_data` json DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `processed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `offer_id` (`offer_id`),
  KEY `idx_click_id` (`click_id`),
  KEY `idx_user_offer` (`user_id`,`offer_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `offer_events_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `offer_events_ibfk_2` FOREIGN KEY (`offer_id`) REFERENCES `offers` (`id`) ON DELETE CASCADE
);

-- Table: offers
CREATE TABLE `offers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `offer_name` varchar(255) NOT NULL,
  `offer_id` varchar(255) DEFAULT NULL,
  `heading` varchar(255) DEFAULT NULL,
  `history_name` varchar(255) DEFAULT NULL,
  `offer_url` varchar(255) DEFAULT NULL,
  `amount` decimal(10,2) DEFAULT '0.00',
  `currency_type` varchar(20) DEFAULT 'cash',
  `event_name` varchar(255) DEFAULT NULL,
  `description` text,
  `image_url` varchar(255) DEFAULT NULL,
  `refer_payout` varchar(255) DEFAULT NULL,
  `status` varchar(50) DEFAULT 'Active',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `tracking_link` text,
  `conversion_cap` int DEFAULT '0' COMMENT 'Max conversions per user, 0 = unlimited',
  `requires_approval` tinyint(1) DEFAULT '0',
  `side_label` varchar(100) DEFAULT NULL,
  `side_label_color` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`id`)
);

-- Table: postback_logs
CREATE TABLE `postback_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `click_id` varchar(64) DEFAULT NULL,
  `offer_id` int DEFAULT NULL,
  `raw_data` json DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `status` enum('success','failed','pending') DEFAULT 'pending',
  `error_message` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_click_id` (`click_id`),
  KEY `idx_created_at` (`created_at`)
);

-- Table: promocodes
CREATE TABLE `promocodes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `code` varchar(50) NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `users_limit` int NOT NULL,
  `claimed_count` int DEFAULT '0',
  `for_whom` enum('All','New','Old') DEFAULT 'All',
  `status` enum('Active','Inactive') DEFAULT 'Active',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `min_offers` int DEFAULT '0',
  `min_referrals` int DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
);

-- Table: referral_attributions
CREATE TABLE `referral_attributions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `ip_address` varchar(45) NOT NULL,
  `user_agent` text NOT NULL,
  `referral_code` varchar(10) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_attribution` (`ip_address`,`created_at`)
);

-- Table: referral_downloads
CREATE TABLE `referral_downloads` (
  `id` int NOT NULL AUTO_INCREMENT,
  `referral_code` varchar(10) DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

-- Table: referrals
CREATE TABLE `referrals` (
  `id` int NOT NULL AUTO_INCREMENT,
  `referrer_id` int NOT NULL,
  `referred_user_id` int NOT NULL,
  `status` enum('PENDING','COMPLETED') DEFAULT 'PENDING',
  `commission_earned` decimal(10,2) DEFAULT '0.00',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_referral` (`referrer_id`,`referred_user_id`),
  KEY `referred_user_id` (`referred_user_id`),
  CONSTRAINT `referrals_ibfk_1` FOREIGN KEY (`referrer_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `referrals_ibfk_2` FOREIGN KEY (`referred_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

-- Table: scratched_offers
CREATE TABLE `scratched_offers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `offer_id` int NOT NULL,
  `scratched_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_offer` (`user_id`,`offer_id`),
  KEY `offer_id` (`offer_id`),
  CONSTRAINT `scratched_offers_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `scratched_offers_ibfk_2` FOREIGN KEY (`offer_id`) REFERENCES `offers` (`id`) ON DELETE CASCADE
);

-- Table: tasks
CREATE TABLE `tasks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `description` text,
  `reward_coins` decimal(10,2) DEFAULT '0.00',
  `icon_color` varchar(50) DEFAULT NULL,
  `action_url` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

-- Table: transactions
CREATE TABLE `transactions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `type` enum('CREDIT','DEBIT') NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `transactions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

-- Table: used_promo_codes
CREATE TABLE `used_promo_codes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `promo_id` int NOT NULL,
  `claimed_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_promo` (`user_id`,`promo_id`),
  KEY `promo_id` (`promo_id`),
  CONSTRAINT `used_promo_codes_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `used_promo_codes_ibfk_2` FOREIGN KEY (`promo_id`) REFERENCES `promocodes` (`id`) ON DELETE CASCADE
);

-- Table: user_spins
CREATE TABLE `user_spins` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `available_spins` int DEFAULT '0',
  `total_spins_earned` int DEFAULT '0',
  `total_spins_used` int DEFAULT '0',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user` (`user_id`),
  CONSTRAINT `user_spins_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

-- Table: user_wallet_breakdown
CREATE TABLE `user_wallet_breakdown` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `coins` decimal(10,2) DEFAULT '0.00',
  `gems` decimal(10,2) DEFAULT '0.00',
  `cash` decimal(10,2) DEFAULT '0.00',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_wallet` (`user_id`),
  CONSTRAINT `user_wallet_breakdown_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

-- Table: users
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `google_id` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `profile_pic` varchar(255) DEFAULT NULL,
  `wallet_balance` decimal(10,2) DEFAULT '0.00',
  `device_id` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `referral_code` varchar(10) DEFAULT NULL,
  `referred_by` varchar(10) DEFAULT NULL,
  `total_earnings` decimal(10,2) DEFAULT '0.00',
  `referral_earnings` decimal(10,2) DEFAULT '0.00',
  `last_checkin_date` date DEFAULT NULL,
  `checkin_streak` int DEFAULT '0',
  `upi_id` varchar(255) DEFAULT NULL,
  `telegram_id` varchar(50) DEFAULT NULL,
  `last_login_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `google_id` (`google_id`),
  UNIQUE KEY `referral_code` (`referral_code`)
);

-- Table: wallet_transactions
CREATE TABLE `wallet_transactions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `transaction_type` varchar(100) NOT NULL,
  `currency_type` varchar(20) DEFAULT 'cash',
  `amount` decimal(10,2) NOT NULL,
  `balance_before` decimal(10,2) DEFAULT NULL,
  `balance_after` decimal(10,2) DEFAULT NULL,
  `offer_id` int DEFAULT NULL,
  `event_id` int DEFAULT NULL,
  `withdrawal_id` int DEFAULT NULL,
  `description` text,
  `status` varchar(50) DEFAULT 'success',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `offer_id` (`offer_id`),
  KEY `event_id` (`event_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_transaction_type` (`transaction_type`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `wallet_transactions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `wallet_transactions_ibfk_2` FOREIGN KEY (`offer_id`) REFERENCES `offers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `wallet_transactions_ibfk_3` FOREIGN KEY (`event_id`) REFERENCES `offer_events` (`id`) ON DELETE SET NULL
);

-- Table: withdrawals
CREATE TABLE `withdrawals` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `method` varchar(50) NOT NULL,
  `details` text,
  `status` enum('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `withdrawals_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);

SET FOREIGN_KEY_CHECKS = 1;

-- Initial Data for Setup
INSERT INTO `admin_info` (`username`, `password`) VALUES ('admin', '$2b$10$w6KxQW9DkL8U6Z5R9Y/7ueS6FvE7mN5sQ3jO8z8z8z8z8z8z8z8z8'); -- password: admin123
