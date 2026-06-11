// Central JWT config for admin authentication.
// JWT_SECRET MUST be set in the environment (e.g. the Render dashboard) in
// production. The dev fallback only exists so local runs don't crash — tokens
// signed with it are NOT secure.
const JWT_SECRET = process.env.JWT_SECRET || 'INSECURE_DEV_FALLBACK_SET_JWT_SECRET';

if (!process.env.JWT_SECRET) {
    console.warn(
        '⚠️  JWT_SECRET is not set — using an insecure dev fallback. ' +
        'Set JWT_SECRET in your environment before production.'
    );
}

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

module.exports = { JWT_SECRET, JWT_EXPIRES_IN };
