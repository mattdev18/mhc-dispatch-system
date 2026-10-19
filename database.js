const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, 'mhc_dispatch.db');
const db = new sqlite3.Database(DB_PATH);

// Helper to wrap db queries in Promises
function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function initDB() {
    await run(`
        CREATE TABLE IF NOT EXISTS trucks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            queue TEXT NOT NULL,
            date TEXT NOT NULL,
            truck_number TEXT NOT NULL,
            driver_name TEXT NOT NULL,
            company TEXT,
            contact TEXT,
            load_type TEXT NOT NULL,
            destination TEXT NOT NULL,
            reference TEXT,
            priority TEXT DEFAULT 'Standard',
            loading_door INTEGER,
            arrival_time TEXT,
            arrival_timestamp TEXT,
            called_time TEXT,
            called_timestamp TEXT,
            loading_time TEXT,
            loading_timestamp TEXT,
            completed_time TEXT,
            completed_timestamp TEXT,
            departed_time TEXT,
            departed_timestamp TEXT,
            cancelled_time TEXT,
            cancelled_timestamp TEXT,
            status TEXT NOT NULL DEFAULT 'Waiting',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    `);

    // Insert default plant name if not exists
    const plantName = await get(`SELECT value FROM settings WHERE key = 'plant_name'`);
    if (!plantName) {
        await run(`INSERT INTO settings (key, value) VALUES ('plant_name', 'MAY HARVEST CORPORATION')`);
    }

    console.log('SQLite Database initialized successfully at:', DB_PATH);
}

module.exports = {
    db,
    run,
    get,
    all,
    initDB
};
