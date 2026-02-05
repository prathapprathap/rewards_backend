-- Offer18 Integration Schema
-- This migration adds support for click tracking, postbacks, and event callbacks

-- Table to track offer clicks with unique click IDs
CREATE TABLE IF NOT EXISTS offer_clicks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  click_id VARCHAR(64) UNIQUE NOT NULL,
  user_id INT NOT NULL,
  offer_id INT NOT NULL,
  device_id VARCHAR(255),
  ip_address VARCHAR(45),
  user_agent TEXT,
  status ENUM('clicked', 'pending', 'completed', 'rejected') DEFAULT 'clicked',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
  INDEX idx_click_id (click_id),
  INDEX idx_user_offer (user_id, offer_id),
  INDEX idx_status (status)
);

-- Table to track events/callbacks from Offer18
CREATE TABLE IF NOT EXISTS offer_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  click_id VARCHAR(64) NOT NULL,
  offer_id INT NOT NULL,
  user_id INT NOT NULL,
  event_name VARCHAR(100) NOT NULL,
  event_value DECIMAL(10, 2) DEFAULT 0,
  payout DECIMAL(10, 2) NOT NULL,
  currency_type ENUM('coins', 'gems', 'cash') DEFAULT 'cash',
  status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  postback_data JSON,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
  INDEX idx_click_id (click_id),
  INDEX idx_user_offer (user_id, offer_id),
  INDEX idx_status (status)
);

-- Table to track postback logs for debugging
CREATE TABLE IF NOT EXISTS postback_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  click_id VARCHAR(64),
  offer_id INT,
  raw_data JSON,
  ip_address VARCHAR(45),
  status ENUM('success', 'failed', 'duplicate') DEFAULT 'success',
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_click_id (click_id),
  INDEX idx_created_at (created_at)
);

-- Table to track device fingerprints for fraud prevention
CREATE TABLE IF NOT EXISTS device_fingerprints (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  device_id VARCHAR(255) NOT NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  is_suspicious BOOLEAN DEFAULT FALSE,
  notes TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_user_device (user_id, device_id),
  INDEX idx_device_id (device_id),
  INDEX idx_suspicious (is_suspicious)
);

-- Add wallet support for multiple currency types
CREATE TABLE IF NOT EXISTS user_wallet_breakdown (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  coins DECIMAL(10, 2) DEFAULT 0,
  gems DECIMAL(10, 2) DEFAULT 0,
  cash DECIMAL(10, 2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_user_wallet (user_id)
);

-- Add conversion tracking settings to offers table
-- Note: These columns will only be added if they don't exist
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE table_name = 'offers'
   AND table_schema = DATABASE()
   AND column_name = 'tracking_link') > 0,
  'SELECT 1',
  'ALTER TABLE offers ADD COLUMN tracking_link TEXT'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE table_name = 'offers'
   AND table_schema = DATABASE()
   AND column_name = 'currency_type') > 0,
  'SELECT 1',
  'ALTER TABLE offers ADD COLUMN currency_type ENUM(''coins'', ''gems'', ''cash'') DEFAULT ''cash'' AFTER amount'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE table_name = 'offers'
   AND table_schema = DATABASE()
   AND column_name = 'conversion_cap') > 0,
  'SELECT 1',
  'ALTER TABLE offers ADD COLUMN conversion_cap INT DEFAULT 0 COMMENT ''Max conversions per user, 0 = unlimited'''
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE table_name = 'offers'
   AND table_schema = DATABASE()
   AND column_name = 'requires_approval') > 0,
  'SELECT 1',
  'ALTER TABLE offers ADD COLUMN requires_approval BOOLEAN DEFAULT FALSE'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Transaction history for all wallet operations
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  transaction_type ENUM('offer_reward', 'referral', 'spin', 'scratch', 'withdrawal', 'admin_adjustment') NOT NULL,
  currency_type ENUM('coins', 'gems', 'cash') DEFAULT 'cash',
  amount DECIMAL(10, 2) NOT NULL,
  balance_before DECIMAL(10, 2),
  balance_after DECIMAL(10, 2),
  offer_id INT NULL,
  event_id INT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE SET NULL,
  FOREIGN KEY (event_id) REFERENCES offer_events(id) ON DELETE SET NULL,
  INDEX idx_user_id (user_id),
  INDEX idx_transaction_type (transaction_type),
  INDEX idx_created_at (created_at)
);
