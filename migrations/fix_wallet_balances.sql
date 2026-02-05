-- Fix: Ensure wallet balance matches transaction sum
-- This script will reset wallets to match their actual transaction history

-- Step 1: Recalculate wallet balances from transactions
UPDATE user_wallet_breakdown uwb
SET 
  coins = COALESCE((
    SELECT SUM(amount) 
    FROM wallet_transactions 
    WHERE user_id = uwb.user_id 
    AND currency_type = 'coins'
  ), 0),
  gems = COALESCE((
    SELECT SUM(amount) 
    FROM wallet_transactions 
    WHERE user_id = uwb.user_id 
    AND currency_type = 'gems'
  ), 0),
  cash = COALESCE((
    SELECT SUM(amount) 
    FROM wallet_transactions 
    WHERE user_id = uwb.user_id 
    AND currency_type = 'cash'
  ), 0);

-- Step 2: Reset users table balance to match wallet
UPDATE users u
SET balance = COALESCE((
  SELECT cash 
  FROM user_wallet_breakdown 
  WHERE user_id = u.id
), 0);

-- Step 3: Verify - Show users with mismatched balances
SELECT 
  u.id,
  u.email,
  u.balance as users_balance,
  COALESCE(uwb.cash, 0) as wallet_cash,
  COUNT(wt.id) as transaction_count
FROM users u
LEFT JOIN user_wallet_breakdown uwb ON u.id = uwb.user_id
LEFT JOIN wallet_transactions wt ON u.id = wt.user_id
GROUP BY u.id
HAVING users_balance != wallet_cash OR (users_balance > 0 AND transaction_count = 0);
