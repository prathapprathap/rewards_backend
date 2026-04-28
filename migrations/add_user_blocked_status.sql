-- Add is_blocked column to users table
ALTER TABLE `users` ADD COLUMN `is_blocked` TINYINT(1) DEFAULT 0;
