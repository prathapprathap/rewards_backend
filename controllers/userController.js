const db = require('../config/db');
const QUERIES = require('../constants/queries');
const { processReferralCommission } = require('./referralController');

exports.loginWithGoogle = async (req, res) => {
    const { google_id, email, name, profile_pic, device_id, referral_code } = req.body;

    if (!google_id || !email) {
        return res.status(400).json({ message: 'Google ID and Email are required' });
    }

    let finalReferralCode = referral_code;

    try {
        // --- AUTO-DETECT REFERRAL (IP + UA Attribution) ---
        if (!finalReferralCode) {
            const clientIp = req.ip;
            const userAgent = req.headers['user-agent'] || 'unknown';

            // 1. Try to find recent attribution for this IP
            // We sort by created_at DESC to get the latest one in case of multiple clicks on the same WiFi
            const [attributions] = await db.query(
                `SELECT id, referral_code FROM referral_attributions 
                 WHERE ip_address = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
                 ORDER BY created_at DESC`,
                [clientIp]
            );

            if (attributions.length > 0) {
                // If multiple exist on the same IP, we pick the most recent one
                // (Optional: filter by User Agent if UA matching is implemented in the app)
                finalReferralCode = attributions[0].referral_code;
                const attributionId = attributions[0].id;

                console.log(`Auto-detected referral code ${finalReferralCode} for IP ${clientIp} (ID: ${attributionId})`);

                // Delete ONLY the specific attribution we used
                await db.query('DELETE FROM referral_attributions WHERE id = ?', [attributionId]);
            }
        }

        // Check if user exists
        const [rows] = await db.query(QUERIES.USER.CHECK_EXISTING_BY_GOOGLE_ID, [google_id]);

        if (rows.length > 0) {
            // User exists, return user data
            const user = rows[0];

            // Generate referral code if not exists
            if (!user.referral_code) {
                const newReferralCode = generateReferralCode();
                await db.query(QUERIES.USER.GENERATE_REFERRAL_CODE, [newReferralCode, user.id]);
                user.referral_code = newReferralCode;
            }

            // Device restriction logic
            if (device_id) {
                if (!user.device_id) {
                    // First time login - register this device
                    await db.query(QUERIES.USER.UPDATE_DEVICE_ID, [device_id, user.id]);
                    user.device_id = device_id;
                } else if (user.device_id !== device_id) {
                    // Different device - BLOCK
                    return res.status(403).json({
                        message: 'This account is already registered on another device.',
                        error_code: 'DEVICE_LOCKED'
                    });
                }
                // else: same device - allow login
            }

            return res.status(200).json({ message: 'Login successful', user });
        } else {
            // ✅ CHECK: Prevent new signup if device already has an account
            if (device_id) {
                const [deviceCheck] = await db.query(
                    'SELECT id, email FROM users WHERE device_id = ?',
                    [device_id]
                );

                if (deviceCheck.length > 0) {
                    return res.status(403).json({
                        message: `This device is already registered with ${deviceCheck[0].email}. One account per device only.`,
                        error_code: 'DEVICE_ALREADY_REGISTERED',
                        existing_email: deviceCheck[0].email
                    });
                }
            }

            // User does not exist, create new user
            const [result] = await db.query(
                QUERIES.USER.CREATE_USER,
                [google_id, email, name, profile_pic, device_id]
            );

            const userId = result.insertId;

            // Generate unique referral code for new user
            const newReferralCode = generateReferralCode();
            await db.query(QUERIES.USER.GENERATE_REFERRAL_CODE, [newReferralCode, userId]);

            // Process referral if code provided
            let referrerId = null;
            if (finalReferralCode) {
                const [referrerRows] = await db.query(QUERIES.USER.GET_USER_BY_REFERRAL_CODE, [finalReferralCode]);
                if (referrerRows.length > 0) {
                    referrerId = referrerRows[0].id;
                    // Set referred_by on new user
                    await db.query(QUERIES.USER.SET_REFERRED_BY, [finalReferralCode, userId]);
                    // Create referral record (PENDING status)
                    await db.query(QUERIES.USER.CREATE_REFERRAL, [referrerId, userId]);
                }
            }

            // Get new user bonus from settings
            const [bonusSettings] = await db.query(
                'SELECT setting_value FROM app_settings WHERE setting_key = ?',
                ['new_user_spin_bonus']
            );
            const bonusSpins = parseInt(bonusSettings[0]?.setting_value || '2');

            // Credit bonus spins to new user
            await db.query(
                `INSERT INTO user_spins (user_id, available_spins, total_spins_earned) 
                 VALUES (?, ?, ?)`,
                [userId, bonusSpins, bonusSpins]
            );

            // --- SIGNUP BONUS LOGIC (Cash Only) ---
            const [settings] = await db.query(
                'SELECT setting_key, setting_value FROM app_settings WHERE setting_key = ?',
                ['signup_bonus_cash']
            );
            const settingsMap = settings.reduce((acc, s) => {
                acc[s.setting_key] = s.setting_value;
                return acc;
            }, {});

            const cashBonus = parseFloat(settingsMap.signup_bonus_cash || '0');

            if (cashBonus > 0) {
                // Initialize wallet breakdown
                await db.query(
                    `INSERT INTO user_wallet_breakdown (user_id, cash) 
                     VALUES (?, ?)
                     ON DUPLICATE KEY UPDATE cash = cash + ?`,
                    [userId, cashBonus, cashBonus]
                );

                // Update main user balance
                await db.query(
                    'UPDATE users SET wallet_balance = wallet_balance + ?, total_earnings = total_earnings + ? WHERE id = ?',
                    [cashBonus, cashBonus, userId]
                );

                // Record transaction
                await db.query(
                    `INSERT INTO wallet_transactions 
                     (user_id, transaction_type, currency_type, amount, balance_before, balance_after, description, status) 
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [userId, 'signup_bonus', 'cash', cashBonus, 0, cashBonus, `Signup bonus: ₹${cashBonus}`, 'success']
                );
            }
            // --------------------------------------------------------

            const newUser = {
                id: userId,
                google_id,
                email,
                name,
                profile_pic,
                device_id,
                wallet_balance: cashBonus,
                total_earnings: cashBonus,
                referral_code: newReferralCode,
                referred_by: finalReferralCode || null
            };

            return res.status(201).json({
                message: 'User registered successfully',
                user: newUser,
                bonus_spins: bonusSpins,
                signup_bonus_cash: cashBonus
            });
        }
    } catch (error) {
        console.error('Error in loginWithGoogle:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Helper function to generate unique referral code
function generateReferralCode() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return code;
}

exports.getUserProfile = async (req, res) => {
    const { id } = req.params;

    try {
        const [rows] = await db.query(QUERIES.USER.GET_PROFILE_BY_ID, [id]);

        if (rows.length > 0) {
            return res.status(200).json(rows[0]);
        } else {
            return res.status(404).json({ message: 'User not found' });
        }
    } catch (error) {
        console.error('Error in getUserProfile:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

exports.updatePayoutDetails = async (req, res) => {
    const { userId } = req.params;
    const { upi_id } = req.body;

    try {
        await db.query('UPDATE users SET upi_id = ? WHERE id = ?', [upi_id, userId]);
        return res.status(200).json({ message: 'Payout details updated successfully' });
    } catch (error) {
        console.error('Error in updatePayoutDetails:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

exports.applyReferralCode = async (req, res) => {
    const { userId } = req.params;
    const { referral_code } = req.body;

    if (!referral_code || !referral_code.toString().trim()) {
        return res.status(400).json({ message: 'Referral code is required' });
    }

    const normalizedCode = referral_code.toString().trim().toUpperCase();
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [userRows] = await connection.query(
            'SELECT id, referral_code, referred_by FROM users WHERE id = ? LIMIT 1',
            [userId]
        );

        if (userRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'User not found' });
        }

        const user = userRows[0];

        if (user.referred_by && user.referred_by.toString().trim() !== '') {
            await connection.rollback();
            return res.status(400).json({ message: 'Referral code already applied for this account' });
        }

        if ((user.referral_code || '').toString().toUpperCase() === normalizedCode) {
            await connection.rollback();
            return res.status(400).json({ message: 'You cannot use your own referral code' });
        }

        const [referrerRows] = await connection.query(
            'SELECT id, referral_code, name FROM users WHERE UPPER(referral_code) = ? LIMIT 1',
            [normalizedCode]
        );

        if (referrerRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Invalid referral code' });
        }

        const referrer = referrerRows[0];

        const [existingReferral] = await connection.query(
            'SELECT id FROM referrals WHERE referred_user_id = ? LIMIT 1',
            [userId]
        );

        if (existingReferral.length > 0) {
            await connection.rollback();
            return res.status(400).json({ message: 'Referral already linked for this account' });
        }

        await connection.query(
            'UPDATE users SET referred_by = ? WHERE id = ?',
            [referrer.referral_code, userId]
        );

        await connection.query(
            'INSERT INTO referrals (referrer_id, referred_user_id, status, commission_earned) VALUES (?, ?, ?, ?)',
            [referrer.id, userId, 'PENDING', 0]
        );

        await connection.commit();

        return res.status(200).json({
            success: true,
            message: 'Referral code applied successfully',
            referred_by: referrer.referral_code,
            referrer_name: referrer.name || null
        });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error applying referral code:', error);
        return res.status(500).json({ message: 'Server error' });
    } finally {
        if (connection) connection.release();
    }
};

// Get offers with scratch status for a specific user
exports.getUserOffers = async (req, res) => {
    const { userId } = req.params;

    try {
        // Get all offers
        const [offers] = await db.query(
            `SELECT * FROM offers 
             WHERE LOWER(status) NOT IN ('inactive', 'disabled', 'deleted') 
             ORDER BY created_at DESC`
        );

        // Get scratched offers for this user
        let scratchedIds = new Set();
        try {
            const [scratched] = await db.query(
                'SELECT offer_id FROM scratched_offers WHERE user_id = ?',
                [userId]
            );
            scratchedIds = new Set(scratched.map(s => s.offer_id));
        } catch (e) {
            console.error('Error fetching scratched offers (table may not exist):', e.message);
        }

        // Get all offer IDs
        const offerIds = offers.map(o => o.id);

        // Get completion data: which events the user has completed (approved) for each offer
        let completionMap = {}; // offerId -> { completed_steps, earned_amount, events: [...] }
        let totalStepsMap = {}; // offerId -> total step count

        if (offerIds.length > 0) {
            try {
                const placeholders = offerIds.map(() => '?').join(',');

                // Get total steps per offer
                const [stepCounts] = await db.query(
                    `SELECT offer_id, COUNT(*) as total_steps
                     FROM offer_event_steps
                     WHERE offer_id IN (${placeholders})
                     GROUP BY offer_id`,
                    offerIds
                );
                for (const sc of stepCounts) {
                    totalStepsMap[sc.offer_id] = sc.total_steps;
                }

                // Get user's completed events for these offers
                const [completedEvents] = await db.query(
                    `SELECT oe.offer_id, oe.event_name, oe.payout,
                            oes.points as step_points
                     FROM offer_events oe
                     LEFT JOIN offer_event_steps oes
                       ON oe.offer_id = oes.offer_id
                       AND LOWER(TRIM(oe.event_name)) = LOWER(TRIM(oes.event_name))
                     WHERE oe.user_id = ?
                       AND oe.offer_id IN (${placeholders})
                       AND oe.status = 'approved'
                     GROUP BY oe.offer_id, oe.event_name`,
                    [userId, ...offerIds]
                );

                for (const ev of completedEvents) {
                    if (!completionMap[ev.offer_id]) {
                        completionMap[ev.offer_id] = {
                            completed_steps: 0,
                            earned_amount: 0,
                            events: []
                        };
                    }
                    const earned = parseFloat(ev.step_points) || parseFloat(ev.payout) || 0;
                    completionMap[ev.offer_id].completed_steps += 1;
                    completionMap[ev.offer_id].earned_amount += earned;
                    completionMap[ev.offer_id].events.push({
                        event_name: ev.event_name,
                        earned: earned
                    });
                }
            } catch (e) {
                console.error('Error fetching completion data (tables may not exist):', e.message);
                // Continue without completion data - offers will still show
            }
        }

        // Mark offers with scratch + completion status
        const offersWithStatus = offers.map(offer => {
            const totalSteps = totalStepsMap[offer.id] || 0;
            const completion = completionMap[offer.id] || { completed_steps: 0, earned_amount: 0, events: [] };
            const isAllCompleted = totalSteps > 0 && completion.completed_steps >= totalSteps;
            const hasAnyCompletion = completion.completed_steps > 0;

            return {
                ...offer,
                is_scratched: scratchedIds.has(offer.id),
                completed_steps: completion.completed_steps,
                total_steps: totalSteps,
                earned_amount: completion.earned_amount,
                is_completed: isAllCompleted,
                has_partial_completion: hasAnyCompletion && !isAllCompleted,
                completed_events: completion.events
            };
        });

        return res.status(200).json(offersWithStatus);
    } catch (error) {
        console.error('Error in getUserOffers:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Mark an offer as scratched
exports.scratchOffer = async (req, res) => {
    const { userId } = req.params;
    const { offer_id } = req.body;

    if (!offer_id) {
        return res.status(400).json({ message: 'Offer ID is required' });
    }

    try {
        // Check if already scratched
        const [existing] = await db.query(
            'SELECT * FROM scratched_offers WHERE user_id = ? AND offer_id = ?',
            [userId, offer_id]
        );

        if (existing.length > 0) {
            return res.status(200).json({ message: 'Already scratched', already_scratched: true });
        }

        // Mark as scratched
        await db.query(
            'INSERT INTO scratched_offers (user_id, offer_id) VALUES (?, ?)',
            [userId, offer_id]
        );

        // Get the offer details
        const [offerRows] = await db.query('SELECT * FROM offers WHERE id = ?', [offer_id]);
        const offer = offerRows[0];

        // ❌ DO NOT CREDIT WALLET HERE!
        // Wallet should ONLY be credited when user completes the offer task
        // and Offer18 sends a postback to /api/offer18/postback
        // The scratch card only REVEALS the offer, it doesn't give money

        return res.status(200).json({
            message: 'Offer revealed successfully. Complete the task to earn rewards!',
            offer: offer,
            already_scratched: false
        });
    } catch (error) {
        console.error('Error in scratchOffer:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Get user's available spins
exports.getUserSpins = async (req, res) => {
    const { userId } = req.params;

    try {
        const [spins] = await db.query(
            'SELECT * FROM user_spins WHERE user_id = ?',
            [userId]
        );

        if (spins.length === 0) {
            // Create default spin record if doesn't exist
            await db.query(
                'INSERT INTO user_spins (user_id, available_spins) VALUES (?, ?)',
                [userId, 0]
            );
            return res.status(200).json({
                available_spins: 0,
                total_spins_earned: 0,
                total_spins_used: 0
            });
        }

        return res.status(200).json(spins[0]);
    } catch (error) {
        console.error('Error in getUserSpins:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Use a spin and get reward
exports.useSpin = async (req, res) => {
    const { userId } = req.params;

    try {
        // Check available spins
        const [spins] = await db.query(
            'SELECT * FROM user_spins WHERE user_id = ?',
            [userId]
        );

        if (spins.length === 0 || spins[0].available_spins <= 0) {
            return res.status(400).json({ message: 'No spins available' });
        }

        // Get spin reward values from settings
        const [settings] = await db.query(
            'SELECT setting_value FROM app_settings WHERE setting_key = ?',
            ['spin_reward_values']
        );

        const rewardValues = settings[0]?.setting_value.split(',').map(v => parseInt(v.trim())) || [1, 2, 5, 10];

        // Weighted random selection to favor lower values
        // Algorithm:
        // 1. Assign High weights to values <= 10
        // 2. Assign Low weights to values > 10
        const itemsWithWeights = rewardValues.map(value => {
            let weight = 0;
            if (value <= 2) weight = 50;       // Very high chance for 1, 2
            else if (value <= 5) weight = 30;  // High chance for 5
            else if (value <= 10) weight = 15; // Moderate chance for 10
            else if (value <= 50) weight = 4;  // Low chance for 25, 50
            else weight = 1;                   // Very low chance for 100+
            return { value, weight };
        });

        const totalWeight = itemsWithWeights.reduce((sum, item) => sum + item.weight, 0);
        let randomNum = Math.random() * totalWeight;

        let reward = itemsWithWeights[0].value;
        for (const item of itemsWithWeights) {
            if (randomNum < item.weight) {
                reward = item.value;
                break;
            }
            randomNum -= item.weight;
        }

        // Deduct spin and add reward to wallet
        await db.query(
            'UPDATE user_spins SET available_spins = available_spins - 1, total_spins_used = total_spins_used + 1 WHERE user_id = ?',
            [userId]
        );

        await db.query(
            'UPDATE users SET wallet_balance = wallet_balance + ?, total_earnings = total_earnings + ? WHERE id = ?',
            [reward, reward, userId]
        );

        // Record transaction in wallet_transactions for consistency
        const [wallets] = await db.query('SELECT cash FROM user_wallet_breakdown WHERE user_id = ?', [userId]);
        const currentCash = wallets[0] ? parseFloat(wallets[0].cash) : 0;

        await db.query(
            `INSERT INTO wallet_transactions 
            (user_id, transaction_type, currency_type, amount, balance_before, balance_after, description, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, 'spin', 'cash', reward, currentCash, currentCash + reward, 'Spin & Win reward', 'success']
        );

        // Update user_wallet_breakdown
        await db.query(
            `INSERT INTO user_wallet_breakdown (user_id, cash) VALUES (?, ?) 
             ON DUPLICATE KEY UPDATE cash = cash + ?`,
            [userId, reward, reward]
        );

        // Get updated data
        const [updatedSpins] = await db.query('SELECT * FROM user_spins WHERE user_id = ?', [userId]);
        const [updatedUser] = await db.query('SELECT wallet_balance, total_earnings FROM users WHERE id = ?', [userId]);

        return res.status(200).json({
            message: 'Spin successful',
            reward,
            available_spins: updatedSpins[0].available_spins,
            wallet_balance: parseFloat(updatedUser[0].wallet_balance),
            total_earnings: parseFloat(updatedUser[0].total_earnings)
        });
    } catch (error) {
        console.error('Error in useSpin:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Redeem promo code
exports.redeemPromoCode = async (req, res) => {
    const { userId } = req.params;
    const { code } = req.body;

    if (!code) {
        return res.status(400).json({ message: 'Code is required' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Check if code exists and is active (Case-insensitive)
        const [codes] = await connection.query(
            'SELECT * FROM promocodes WHERE UPPER(code) = UPPER(?) AND status = ?',
            [code.trim(), 'Active']
        );

        if (codes.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Invalid or expired code' });
        }

        const promoCode = codes[0];

        // Check overall limit
        if (promoCode.claimed_count >= promoCode.users_limit) {
            await connection.rollback();
            return res.status(400).json({ message: 'This code usage limit has been reached' });
        }

        // Check if user already used this code
        const [used] = await connection.query(
            'SELECT * FROM used_promo_codes WHERE user_id = ? AND promo_id = ?',
            [userId, promoCode.id]
        );

        if (used.length > 0) {
            await connection.rollback();
            return res.status(400).json({ message: 'You have already used this code' });
        }

        // --- CHECK CONDITIONS ---

        // 1. Minimum Offers Condition (Total COMPLETED/APPROVED offers)
        const minOffers = parseInt(promoCode.min_offers || 0);
        if (minOffers > 0) {
            const [offerCount] = await connection.query(
                `SELECT COUNT(DISTINCT offer_id) as count 
                 FROM offer_events 
                 WHERE user_id = ? AND status = 'approved'`,
                [userId]
            );
            if (offerCount[0].count < minOffers) {
                await connection.rollback();
                return res.status(400).json({
                    message: `You need to complete at least ${minOffers} offers to use this code.`
                });
            }
        }

        // 2. Minimum Referrals Condition (Successfully completed referrals)
        const minReferrals = parseInt(promoCode.min_referrals || 0);
        if (minReferrals > 0) {
            const [referralCount] = await connection.query(
                `SELECT COUNT(*) as count 
                 FROM referrals 
                 WHERE referrer_id = ? AND status = 'COMPLETED'`,
                [userId]
            );
            if (referralCount[0].count < minReferrals) {
                await connection.rollback();
                return res.status(400).json({
                    message: `You need to have at least ${minReferrals} successful referrals to use this code.`
                });
            }
        }

        // All checks passed - Credit wallet
        const reward = parseFloat(promoCode.amount || 0);
        if (isNaN(reward) || reward <= 0) {
            await connection.rollback();
            return res.status(400).json({ message: 'Invalid reward amount for this code' });
        }

        // Update claimed count
        await connection.query('UPDATE promocodes SET claimed_count = claimed_count + 1 WHERE id = ?', [promoCode.id]);

        // Update users table balance
        await connection.query(
            'UPDATE users SET wallet_balance = wallet_balance + ?, total_earnings = total_earnings + ? WHERE id = ?',
            [reward, reward, userId]
        );

        // Update wallet breakdown for data consistency
        await connection.query(
            `INSERT INTO user_wallet_breakdown (user_id, cash) VALUES (?, ?) 
             ON DUPLICATE KEY UPDATE cash = cash + ?`,
            [userId, reward, reward]
        );

        // Record usage
        await connection.query(
            'INSERT INTO used_promo_codes (user_id, promo_id) VALUES (?, ?)',
            [userId, promoCode.id]
        );

        // Record transaction details
        const [userWallet] = await connection.query('SELECT wallet_balance FROM users WHERE id = ?', [userId]);
        const balanceAfter = userWallet[0]?.wallet_balance || reward;
        const balanceBefore = balanceAfter - reward;

        await connection.query(
            `INSERT INTO wallet_transactions 
            (user_id, transaction_type, currency_type, amount, balance_before, balance_after, description) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, 'promo', 'cash', reward, balanceBefore, balanceAfter, `Redeemed code: ${code}`]
        );

        await connection.commit();
        return res.status(200).json({
            message: `Congratulations! You received ₹${reward} reward.`,
            reward: reward
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error in redeemPromoCode:', error);
        return res.status(500).json({ message: 'Server error: ' + error.message });
    } finally {
        if (connection) connection.release();
    }
};



// Get app settings
exports.getAppSettings = async (req, res) => {
    try {
        const [settings] = await db.query('SELECT * FROM app_settings');
        return res.status(200).json(settings);
    } catch (error) {
        console.error('Error in getAppSettings:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};
