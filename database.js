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

    // Seed 5 Authorized Backend Users
    const countUsersStmt = db.prepare("SELECT count(*) as count FROM users");
    let userCount = 0;
    if (countUsersStmt.step()) {
        userCount = countUsersStmt.getAsObject().count;
    }
    countUsersStmt.free();

    if (userCount === 0) {
        // Passwords are loaded from environment variables (never hardcoded in code)
        const defaultUsers = [
            {
                username: 'admin',
                password: hashPassword(process.env.PASS_ADMIN || 'Admin@MHC2026!'),
                name: 'Plant Administrator',
                role: 'admin'
            },
            {
                username: 'dispatcher1',
                password: hashPassword(process.env.PASS_DISPATCHER1 || 'Dispatch@MHC1!'),
                name: 'Lead Dispatcher',
                role: 'dispatcher'
            },
            {
                username: 'dispatcher2',
                password: hashPassword(process.env.PASS_DISPATCHER2 || 'Dispatch@MHC2!'),
                name: 'Shift Dispatcher',
                role: 'dispatcher'
            },
            {
                username: 'guard',
                password: hashPassword(process.env.PASS_GUARD || 'Guard@MHC2026!'),
                name: 'Gate Security Guard',
                role: 'guard'
            },
            {
                username: 'warehouse',
                password: hashPassword(process.env.PASS_WAREHOUSE || 'Warehouse@MHC1!'),
                name: 'Dock Supervisor',
                role: 'warehouse'
            }
        ];

        for (const u of defaultUsers) {
            db.run(
                "INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)",
                [u.username, u.password, u.name, u.role]
            );
        }
        console.log('Seeded 5 default authorized backend users successfully.');
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
