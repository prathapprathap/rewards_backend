-- Migration: user_payment_accounts table
-- Run this on your MySQL database

CREATE TABLE IF NOT EXISTS `user_payment_accounts` (
  `id`              int          NOT NULL AUTO_INCREMENT,
  `user_id`         int          NOT NULL,
  `account_type`    enum('upi','bank') NOT NULL DEFAULT 'upi',
  -- UPI fields
  `upi_id`          varchar(255)  DEFAULT NULL,
  -- Bank account fields
  `bank_name`       varchar(255)  DEFAULT NULL,
  `account_holder`  varchar(255)  DEFAULT NULL,
  `account_number`  varchar(50)   DEFAULT NULL,
  `ifsc_code`       varchar(20)   DEFAULT NULL,
  -- meta
  `is_primary`      tinyint(1)   NOT NULL DEFAULT 0,
  `verified`        tinyint(1)   NOT NULL DEFAULT 0,
  `created_at`      timestamp    NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      timestamp    NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  CONSTRAINT `upa_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
);
