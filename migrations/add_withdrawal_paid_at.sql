-- Add a paid_at timestamp so the admin panel can show the real date a
-- withdrawal was approved/paid (created_at is only the request date).
ALTER TABLE `withdrawals`
  ADD COLUMN `paid_at` TIMESTAMP NULL DEFAULT NULL AFTER `created_at`;

-- Backfill existing approved rows so they don't show as blank.
-- Best available approximation is the request date.
UPDATE `withdrawals` SET `paid_at` = `created_at` WHERE `status` = 'APPROVED' AND `paid_at` IS NULL;

-- Contact mobile number captured at withdrawal time (for payout follow-up).
ALTER TABLE `withdrawals`
  ADD COLUMN `mobile` VARCHAR(20) NULL DEFAULT NULL AFTER `details`;

-- Persist the user's mobile so we only ask for it on the first withdrawal.
ALTER TABLE `users`
  ADD COLUMN `mobile` VARCHAR(20) NULL DEFAULT NULL AFTER `upi_id`;
