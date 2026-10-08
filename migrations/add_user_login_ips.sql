-- Track every distinct IP a user has ever logged in from.
-- Used to tell apart a genuine second device sharing a colliding hardware_id
-- from the same person retrying on their own device.
CREATE TABLE `user_login_ips` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `ip_address` VARCHAR(64) NOT NULL,
  `first_seen_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uniq_user_ip` (`user_id`, `ip_address`),
  KEY `idx_user_id` (`user_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
