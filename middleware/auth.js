const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/jwt');

// Admin authentication guard.
// Requires a valid Bearer JWT (issued by adminController.login). On success it
// attaches the decoded payload to req.admin; otherwise responds 401.
module.exports = function adminAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

    if (!token) {
        return res.status(401).json({ message: 'Unauthorized: missing admin token' });
    }

    try {
        req.admin = jwt.verify(token, JWT_SECRET);
        return next();
    } catch (err) {
        return res.status(401).json({ message: 'Unauthorized: invalid or expired token' });
    }
};
