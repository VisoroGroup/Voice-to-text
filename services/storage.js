const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

const dataDir = path.join(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'transcriptions.db');

let db = null;

// Event emitter for SSE
const transcriptionEmitter = new EventEmitter();
transcriptionEmitter.setMaxListeners(50);

/**
 * Initialize the database (must be called before any other function)
 */
async function initDatabase() {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    const SQL = await initSqlJs();

    if (fs.existsSync(dbPath)) {
        const fileBuffer = fs.readFileSync(dbPath);
        db = new SQL.Database(fileBuffer);
    } else {
        db = new SQL.Database();
    }

    // Create tables
    db.run(`
    CREATE TABLE IF NOT EXISTS transcriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT,
      sender_name TEXT,
      timestamp INTEGER,
      transcription TEXT,
      language TEXT,
      duration REAL,
      source TEXT DEFAULT 'whatsapp',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

    db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

    // Default settings
    const defaults = {
        auto_reply: 'true',
        default_language: 'auto'
    };

    for (const [key, value] of Object.entries(defaults)) {
        const existing = db.exec('SELECT value FROM settings WHERE key = ?', [key]);
        if (existing.length === 0 || existing[0].values.length === 0) {
            db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [key, value]);
        }
    }

    persist();
    console.log('✅ Database initialized at', dbPath);
}

/**
 * Persist database to disk
 */
function persist() {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
}

/**
 * Save a new transcription record — emits 'new' event for SSE
 */
function saveTranscription({ sender, senderName, timestamp, transcription, language, duration, source }) {
    db.run(
        `INSERT INTO transcriptions (sender, sender_name, timestamp, transcription, language, duration, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [sender, senderName, timestamp, transcription, language, duration, source]
    );
    persist();

    const result = db.exec('SELECT last_insert_rowid() as id');
    const id = result[0].values[0][0];

    // Fetch the full record and emit for SSE listeners
    const record = getTranscription(id);
    if (record) {
        transcriptionEmitter.emit('new', record);
    }

    return id;
}

/**
 * Get paginated transcriptions with optional filtering
 */
function getTranscriptions({ page = 1, limit = 20, source, search } = {}) {
    let whereClauses = [];
    let params = [];

    if (source && source !== 'all') {
        whereClauses.push('source = ?');
        params.push(source);
    }

    if (search) {
        whereClauses.push('(transcription LIKE ? OR sender_name LIKE ?)');
        params.push(`%${search}%`, `%${search}%`);
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const countResult = db.exec(`SELECT COUNT(*) as total FROM transcriptions ${whereSQL}`, params);
    const total = countResult.length > 0 ? countResult[0].values[0][0] : 0;

    const dataResult = db.exec(
        `SELECT * FROM transcriptions ${whereSQL} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset]
    );

    let data = [];
    if (dataResult.length > 0) {
        const columns = dataResult[0].columns;
        data = dataResult[0].values.map(row => {
            const obj = {};
            columns.forEach((col, i) => { obj[col] = row[i]; });
            return obj;
        });
    }

    return {
        data,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 }
    };
}

/**
 * Get a single transcription by ID
 */
function getTranscription(id) {
    const result = db.exec('SELECT * FROM transcriptions WHERE id = ?', [id]);
    if (result.length === 0 || result[0].values.length === 0) return null;

    const columns = result[0].columns;
    const row = result[0].values[0];
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
}

/**
 * Update a transcription's text
 */
function updateTranscription(id, text) {
    const exists = db.exec('SELECT COUNT(*) FROM transcriptions WHERE id = ?', [id]);
    if (exists[0].values[0][0] === 0) return false;

    db.run('UPDATE transcriptions SET transcription = ? WHERE id = ?', [text, id]);
    persist();
    return true;
}

/**
 * Delete a transcription by ID
 */
function deleteTranscription(id) {
    const before = db.exec('SELECT COUNT(*) FROM transcriptions WHERE id = ?', [id]);
    const existed = before[0].values[0][0] > 0;

    if (existed) {
        db.run('DELETE FROM transcriptions WHERE id = ?', [id]);
        persist();
    }
    return existed;
}

/**
 * Delete all transcriptions
 */
function deleteAllTranscriptions() {
    db.run('DELETE FROM transcriptions');
    persist();
}

/**
 * Get aggregate statistics
 */
function getStats() {
    const total = db.exec('SELECT COUNT(*) FROM transcriptions');
    const totalCount = total[0].values[0][0];

    const dur = db.exec('SELECT COALESCE(SUM(duration), 0) FROM transcriptions');
    const totalDuration = dur[0].values[0][0];

    const bySourceResult = db.exec('SELECT source, COUNT(*) as count FROM transcriptions GROUP BY source');
    const bySource = {};
    if (bySourceResult.length > 0) {
        bySourceResult[0].values.forEach(row => { bySource[row[0]] = row[1]; });
    }

    const byLangResult = db.exec(`
    SELECT language, COUNT(*) as count FROM transcriptions
    WHERE language IS NOT NULL
    GROUP BY language ORDER BY count DESC LIMIT 10
  `);
    const byLanguage = [];
    if (byLangResult.length > 0) {
        byLangResult[0].values.forEach(row => {
            byLanguage.push({ language: row[0], count: row[1] });
        });
    }

    const recentResult = db.exec("SELECT COUNT(*) FROM transcriptions WHERE created_at >= datetime('now', '-24 hours')");
    const last24Hours = recentResult[0].values[0][0];

    // Calculate disk usage
    let diskUsageBytes = 0;
    try { diskUsageBytes = fs.statSync(dbPath).size; } catch (e) { }

    return {
        totalTranscriptions: totalCount,
        totalDurationSeconds: totalDuration,
        totalDurationMinutes: Math.round(totalDuration / 60 * 10) / 10,
        totalDurationHours: Math.round(totalDuration / 3600 * 10) / 10,
        last24Hours,
        bySource,
        byLanguage,
        diskUsageBytes,
        diskUsageMB: Math.round(diskUsageBytes / 1024 / 1024 * 100) / 100
    };
}

/**
 * Get a setting value
 */
function getSetting(key) {
    const result = db.exec('SELECT value FROM settings WHERE key = ?', [key]);
    if (result.length === 0 || result[0].values.length === 0) return null;
    return result[0].values[0][0];
}

/**
 * Get all settings
 */
function getAllSettings() {
    const result = db.exec('SELECT key, value FROM settings');
    const settings = {};
    if (result.length > 0) {
        result[0].values.forEach(row => { settings[row[0]] = row[1]; });
    }
    return settings;
}

/**
 * Set a setting value
 */
function setSetting(key, value) {
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
    persist();
}

/**
 * Export all transcriptions as JSON
 */
function exportAll() {
    const result = db.exec('SELECT * FROM transcriptions ORDER BY created_at DESC');
    if (result.length === 0) return [];
    const columns = result[0].columns;
    return result[0].values.map(row => {
        const obj = {};
        columns.forEach((col, i) => { obj[col] = row[i]; });
        return obj;
    });
}

module.exports = {
    initDatabase,
    saveTranscription,
    getTranscriptions,
    getTranscription,
    updateTranscription,
    deleteTranscription,
    deleteAllTranscriptions,
    getStats,
    getSetting,
    getAllSettings,
    setSetting,
    exportAll,
    transcriptionEmitter
};
