const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { LOG_DIR, releaseFile } = require('../utils/logger');

// Only files the logger creates — also blocks path traversal (../ etc).
const LOG_NAME = /^app-\d{4}-\d{2}-\d{2}\.log$/;
const LINE = /^(\S+) \[(\w+)\] (.*)$/;

function resolveLogFile(name) {
    if (!LOG_NAME.test(name || '')) return null;
    const full = path.join(LOG_DIR, name);
    return fs.existsSync(full) ? full : null;
}

// GET /api/admin/logs → [{ name, size, modified }], newest first
exports.listLogs = async (req, res) => {
    try {
        const files = fs.readdirSync(LOG_DIR)
            .filter((f) => LOG_NAME.test(f))
            .map((f) => {
                const stat = fs.statSync(path.join(LOG_DIR, f));
                return { name: f, size: stat.size, modified: stat.mtime };
            })
            .sort((a, b) => b.name.localeCompare(a.name));
        res.status(200).json(files);
    } catch (error) {
        console.error('Error listing logs:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/admin/logs/:name?level=ERROR&search=text&limit=500
// Returns the LAST `limit` matching lines, newest first.
exports.readLog = async (req, res) => {
    const file = resolveLogFile(req.params.name);
    if (!file) return res.status(404).json({ message: 'Log file not found' });

    const level = (req.query.level || '').toUpperCase();
    const search = (req.query.search || '').toLowerCase();
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 500, 1), 5000);

    try {
        const matches = [];
        let totalLines = 0;
        const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });

        for await (const raw of rl) {
            if (!raw) continue;
            totalLines++;
            const m = LINE.exec(raw);
            const entry = m
                ? { time: m[1], level: m[2], message: m[3] }
                : { time: null, level: 'LOG', message: raw }; // continuation of a multi-line message
            if (level && entry.level !== level) continue;
            if (search && !raw.toLowerCase().includes(search)) continue;
            matches.push(entry);
            if (matches.length > limit) matches.shift();
        }

        res.status(200).json({ totalLines, lines: matches.reverse() });
    } catch (error) {
        console.error('Error reading log:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/admin/logs/:name/download → raw file
exports.downloadLog = async (req, res) => {
    const file = resolveLogFile(req.params.name);
    if (!file) return res.status(404).json({ message: 'Log file not found' });
    res.download(file);
};

// DELETE /api/admin/logs/:name
exports.deleteLog = async (req, res) => {
    const file = resolveLogFile(req.params.name);
    if (!file) return res.status(404).json({ message: 'Log file not found' });
    try {
        releaseFile(req.params.name);
        fs.unlinkSync(file);
        res.status(200).json({ message: 'Log file deleted' });
    } catch (error) {
        console.error('Error deleting log:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// DELETE /api/admin/logs → delete every log file
exports.deleteAllLogs = async (req, res) => {
    try {
        const files = fs.readdirSync(LOG_DIR).filter((f) => LOG_NAME.test(f));
        for (const f of files) {
            releaseFile(f);
            fs.unlinkSync(path.join(LOG_DIR, f));
        }
        res.status(200).json({ message: `${files.length} log file(s) deleted` });
    } catch (error) {
        console.error('Error deleting logs:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
