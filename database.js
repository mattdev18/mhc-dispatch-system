const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, 'mhc_dispatch.db');
let db = null;

function hashPassword(pwd) {
    return crypto.createHash('sha256').update(String(pwd)).digest('hex');
}

function saveToDisk() {
    if (!db) return;
    try {
        const data = db.export();
        fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch (e) {
        console.error('Error saving database to disk:', e);
    }
}

async function run(sql, params = []) {
    if (!db) await initDB();
    db.run(sql, params);
    const lastIDRes = db.exec("SELECT last_insert_rowid()");
    const lastID = (lastIDRes && lastIDRes[0] && lastIDRes[0].values && lastIDRes[0].values[0]) 
        ? lastIDRes[0].values[0][0] 
        : 0;
    const changes = db.getRowsModified();
    saveToDisk();
    return { lastID, changes };
}

async function get(sql, params = []) {
    if (!db) await initDB();
    const stmt = db.prepare(sql);
    stmt.bind(params);
    let row = null;
    if (stmt.step()) {
        row = stmt.getAsObject();
    }
    stmt.free();
    return row;
}

async function all(sql, params = []) {
    if (!db) await initDB();
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
}

async function initDB() {
    if (db) return db;

    const SQL = await initSqlJs();
    if (fs.existsSync(DB_PATH)) {
        try {
            const filebuffer = fs.readFileSync(DB_PATH);
            db = new SQL.Database(filebuffer);
        } catch (e) {
            console.warn('Could not read existing DB file, creating fresh:', e.message);
            db = new SQL.Database();
        }
    } else {
        db = new SQL.Database();
    }

    // Trucks Table
    db.run(`
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

    // Settings Table
    db.run(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    `);

    // Users Table for Staff Authentication
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Seed Plant Name
    const plantStmt = db.prepare("SELECT value FROM settings WHERE key = 'plant_name'");
    let hasPlant = false;
    if (plantStmt.step()) hasPlant = true;
    plantStmt.free();

    if (!hasPlant) {
        db.run("INSERT INTO settings (key, value) VALUES ('plant_name', 'MAY HARVEST CORPORATION')");
    }

    // Sync 5 staff users from environment variables on every startup.
    // Passwords come ONLY from Render environment variables (no defaults in code).
    const staffUsers = [
        { username: 'admin',       env: 'MHC_ADMIN',       name: 'Plant Administrator', role: 'admin' },
        { username: 'dispatcher1', env: 'MHC_DISPATCHER1', name: 'Lead Dispatcher',     role: 'dispatcher' },
        { username: 'dispatcher2', env: 'MHC_DISPATCHER2', name: 'Shift Dispatcher',    role: 'dispatcher' },
        { username: 'guard',       env: 'MHC_GUARD',       name: 'Gate Security Guard', role: 'guard' },
        { username: 'warehouse',   env: 'MHC_WAREHOUSE',   name: 'Dock Supervisor',     role: 'warehouse' }
    ];

    for (const u of staffUsers) {
        const pwd = process.env[u.env];
        if (!pwd || pwd.length < 10) {
            console.warn(`Skipping ${u.username}: ${u.env} is missing or shorter than 10 characters.`);
            continue;
        }
        const hashed = hashPassword(pwd);

        const chk = db.prepare("SELECT id FROM users WHERE username = ?");
        chk.bind([u.username]);
        const exists = chk.step();
        chk.free();

        if (exists) {
            db.run("UPDATE users SET password = ? WHERE username = ?", [hashed, u.username]);
        } else {
            db.run(
                "INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)",
                [u.username, hashed, u.name, u.role]
            );
        }
    }

    saveToDisk();
    console.log('Database (WebAssembly SQLite) initialized successfully at:', DB_PATH);
    return db;
}

module.exports = {
    run,
    get,
    all,
    initDB,
    hashPassword
};
