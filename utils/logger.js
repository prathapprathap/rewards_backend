// File logger: mirrors every console.* call and every API request/response
// into backend/logs/app-YYYY-MM-DD.log (a new file each day).
// Must be required FIRST in server.js so startup/DB logs are captured too.
const fs = require('fs');
const path = require('path');
const util = require('util');

const LOG_DIR = path.join(__dirname, '..', 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

const MAX_BODY = 2000; // chars of request/response body kept per line
const SECRET_KEYS = /pass(word)?|token|secret|authorization|otp|api_?key/i;

let currentDate = null;
let stream = null;

function getStream() {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== currentDate) {
        if (stream) stream.end();
        currentDate = today;
        stream = fs.createWriteStream(path.join(LOG_DIR, `app-${today}.log`), { flags: 'a' });
    }
    return stream;
}

// Called before a log file is deleted: if it's the one being written, close
// it so the next write re-creates it instead of writing to a deleted file.
function releaseFile(name) {
    if (stream && name === `app-${currentDate}.log`) {
        stream.end();
        stream = null;
        currentDate = null;
    }
}

function write(level, text) {
    getStream().write(`${new Date().toISOString()} [${level}] ${text}\n`);
}

// Mirror console.* to the file, keeping normal terminal output.
for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
        original(...args);
        write(level.toUpperCase(), util.format(...args));
    };
}

process.on('uncaughtException', (err) => {
    write('FATAL', `uncaughtException: ${err.stack || err}`);
});
process.on('unhandledRejection', (reason) => {
    write('FATAL', `unhandledRejection: ${reason?.stack || reason}`);
});

function redact(value) {
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = SECRET_KEYS.test(k) ? '***' : redact(v);
        }
        return out;
    }
    return value;
}

function short(value) {
    if (value === undefined || value === null || value === '') return '-';
    let text;
    if (Buffer.isBuffer(value)) return `<binary ${value.length} bytes>`;
    if (typeof value === 'string') {
        try { text = JSON.stringify(redact(JSON.parse(value))); } catch { text = value; }
    } else {
        text = JSON.stringify(redact(value));
    }
    return text.length > MAX_BODY ? `${text.slice(0, MAX_BODY)}…(+${text.length - MAX_BODY} chars)` : text;
}

// Express middleware: one REQ line and one RES line per API call.
function requestLogger(req, res, next) {
    // Skip static files, and the log viewer itself (its responses ARE log lines).
    if (req.path.startsWith('/uploads') || req.path.startsWith('/api/admin/logs')) return next();

    const start = Date.now();
    const id = Math.random().toString(36).slice(2, 8);
    write('REQ', `#${id} ${req.method} ${req.originalUrl} ip=${req.ip} ua="${req.headers['user-agent'] || '-'}" body=${short(req.body)}`);

    let responseBody;
    const originalSend = res.send.bind(res);
    res.send = (body) => {
        responseBody = body;
        return originalSend(body);
    };

    res.on('finish', () => {
        write('RES', `#${id} ${res.statusCode} ${req.method} ${req.originalUrl} ${Date.now() - start}ms body=${short(responseBody)}`);
    });
    next();
}

module.exports = { requestLogger, releaseFile, LOG_DIR };
