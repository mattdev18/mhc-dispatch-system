process.env.TZ = 'Asia/Manila';
const crypto = require('crypto');
const { createClient } = require('@libsql/client');
const { Pool } = require('pg');

let pgPool = null;
let dbClient = null;

function hashPassword(pwd) {
    return crypto.createHash('sha256').update(String(pwd)).digest('hex');
}

function getDatabaseType() {
    if (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL) return 'postgres';
    if (process.env.TURSO_DB_URL && process.env.TURSO_DB_TOKEN) return 'turso';
    return 'sqlite';
}

function getPgPool() {
    if (!pgPool) {
        const connStr = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
        pgPool = new Pool({
            connectionString: connStr,
            ssl: { rejectUnauthorized: false }
        });
        console.log('[DB] Connected to Supabase PostgreSQL Cloud Database');
    }
    return pgPool;
}

function getClient() {
    if (dbClient) return dbClient;

    const url = process.env.TURSO_DB_URL;
    const authToken = process.env.TURSO_DB_TOKEN;

    if (url && authToken) {
        // --- CLOUD MODE: Turso Cloud SQLite ---
        dbClient = createClient({ url, authToken });
        console.log('[DB] Connected to Turso Cloud Database:', url);
    } else {
        // --- LOCAL FALLBACK: Local SQLite file (for development only) ---
        const localPath = 'file:mhc_dispatch_local.db';
        dbClient = createClient({ url: localPath });
        console.log('[DB] TURSO_DB_URL or TURSO_DB_TOKEN not set. Using local SQLite fallback.');
    }

    return dbClient;
}

function convertSqlToPg(sql) {
    let converted = sql;
    // Replace SQLite-specific INSERT OR REPLACE / IGNORE
    if (/INSERT\s+OR\s+REPLACE\s+INTO\s+user_sessions/i.test(converted)) {
        converted = 'INSERT INTO user_sessions (token, user_id, username, name, role, last_active) VALUES (?, ?, ?, ?, ?, NOW()) ON CONFLICT (token) DO UPDATE SET last_active = NOW()';
    } else if (/INSERT\s+OR\s+REPLACE\s+INTO\s+settings/i.test(converted)) {
        converted = 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value';
    } else if (/INSERT\s+OR\s+IGNORE\s+INTO\s+settings/i.test(converted)) {
        converted = 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING';
    }

    let idx = 1;
    converted = converted.replace(/\?/g, () => `$${idx++}`);
    converted = converted.replace(/datetime\('now'\)/gi, 'NOW()');
    return converted;
}

// Execute a write query (INSERT, UPDATE, DELETE, CREATE)
async function run(sql, params = []) {
    if (getDatabaseType() === 'postgres') {
        const pool = getPgPool();
        let pgSql = convertSqlToPg(sql);
        if (/INSERT\s+INTO\s+trucks/i.test(pgSql) && !/RETURNING/i.test(pgSql)) {
            pgSql += ' RETURNING id';
        }
        const result = await pool.query(pgSql, params);
        return {
            lastID: result.rows && result.rows.length > 0 && result.rows[0].id ? Number(result.rows[0].id) : (result.rowCount ?? 0),
            changes: result.rowCount ?? 0
        };
    }

    const client = getClient();
    const result = await client.execute({ sql, args: params });
    return {
        lastID: Number(result.lastInsertRowid ?? 0),
        changes: result.rowsAffected ?? 0
    };
}

// Execute and return ONE row
async function get(sql, params = []) {
    if (getDatabaseType() === 'postgres') {
        const pool = getPgPool();
        const pgSql = convertSqlToPg(sql);
        const result = await pool.query(pgSql, params);
        if (result.rows && result.rows.length > 0) {
            return result.rows[0];
        }
        return null;
    }

    const client = getClient();
    const result = await client.execute({ sql, args: params });
    if (result.rows && result.rows.length > 0) {
        return rowToObject(result.rows[0], result.columns);
    }
    return null;
}

// Execute and return ALL rows
async function all(sql, params = []) {
    if (getDatabaseType() === 'postgres') {
        const pool = getPgPool();
        const pgSql = convertSqlToPg(sql);
        const result = await pool.query(pgSql, params);
        return result.rows || [];
    }

    const client = getClient();
    const result = await client.execute({ sql, args: params });
    if (!result.rows) return [];
    return result.rows.map(row => rowToObject(row, result.columns));
}

// Convert libsql row array to a plain JS object with column names as keys
function rowToObject(row, columns) {
    const obj = {};
    columns.forEach((col, i) => {
        const val = row[i];
        // Convert BigInt to Number for JSON serialization
        obj[col] = typeof val === 'bigint' ? Number(val) : val;
    });
    return obj;
}

// Initialize schema and seed staff users
async function initDB() {
    if (getDatabaseType() === 'postgres') {
        const pool = getPgPool();
        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.user_sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                username TEXT NOT NULL,
                name TEXT NOT NULL,
                role TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                last_active TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        console.log('--------------------------------------------------');
        console.log('Database initialized successfully.');
        console.log('Mode: Supabase PostgreSQL (Cloud)');
        console.log('--------------------------------------------------');
        return;
    }

    const client = getClient();

    // Trucks Table
    await client.execute(`
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
            doc_transfer_to_sap TEXT,
            doc_received_from_warehouse TEXT,
            sap_analyst TEXT,
            sap_doc_start TEXT,
            sap_doc_end TEXT,
            remarks TEXT,
            doc_transfer_to_warehouse TEXT,
            doc_runner_dispatched TEXT,
            doc_runner_received TEXT,
            warehouse_recorder TEXT,
            departed_time TEXT,
            departed_timestamp TEXT,
            cancelled_time TEXT,
            cancelled_timestamp TEXT,
            cancellation_reason TEXT,
            call_count INTEGER DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'Waiting',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Safe migration: Add call_count and cancellation_reason to trucks if they do not already exist
    try {
        await client.execute(`ALTER TABLE trucks ADD COLUMN call_count INTEGER DEFAULT 1`);
        console.log('[DB Migration] Added call_count column to trucks table.');
    } catch (e) {
        // Column already exists or table is already up to date
    }

    try {
        await client.execute(`ALTER TABLE trucks ADD COLUMN cancellation_reason TEXT`);
        console.log('[DB Migration] Added cancellation_reason column to trucks table.');
    } catch (e) {
        // Column already exists or table is already up to date
    }

    // Safe migration: SAP & Warehouse Documentation Flow columns
    const sapColumns = [
        'doc_transfer_to_sap',
        'doc_received_from_warehouse',
        'sap_analyst',
        'sap_doc_start',
        'sap_doc_end',
        'remarks',
        'doc_transfer_to_warehouse',
        'doc_runner_dispatched',
        'doc_runner_received',
        'warehouse_recorder'
    ];

    for (const col of sapColumns) {
        try {
            await client.execute(`ALTER TABLE trucks ADD COLUMN ${col} TEXT`);
            console.log(`[DB Migration] Added ${col} column to trucks table.`);
        } catch (e) {
            // Column already exists or table is already up to date
        }
    }

    // Settings Table
    await client.execute(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    `);

    // Users Table
    await client.execute(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Sessions Table (Persistent Database-Backed User Sessions)
    await client.execute(`
        CREATE TABLE IF NOT EXISTS user_sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            name TEXT NOT NULL,
            role TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_active DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Seed Plant Name
    await client.execute(`
        INSERT OR IGNORE INTO settings (key, value) VALUES ('plant_name', 'MAY HARVEST CORPORATION')
    `);

    // Sync 5 staff users from environment variables.
    // Passwords come ONLY from Render environment variables (no defaults in code).
    const staffUsers = [
        { username: 'admin',       env: 'MHC_ADMIN',       name: 'Plant Administrator', role: 'admin',      fallback: 'admiralsMHC@2026' },
        { username: 'dispatcher1', env: 'MHC_DISPATCHER1', name: 'Lead Dispatcher',     role: 'dispatcher', fallback: 'dispatch1MHC@2026!' },
        { username: 'dispatcher2', env: 'MHC_DISPATCHER2', name: 'Shift Dispatcher',    role: 'dispatcher', fallback: 'Dispatch02MHC@2026!!' },
        { username: 'guard',       env: 'MHC_GUARD',       name: 'Gate Security Guard', role: 'guard',      fallback: 'guardMHC@2026' },
        { username: 'warehouse',   env: 'MHC_WAREHOUSE',   name: 'Dock Supervisor',     role: 'warehouse',  fallback: 'WH_MHC@2026+' }
    ];

    // Special case: seed or update sapanalyst with default password if env var is missing
    const sapPwd = process.env.MHC_SAPANALYST || 'sap_otc26';
    const hashedSap = hashPassword(sapPwd);
    const sapAnalystExists = await get('SELECT id FROM users WHERE username = ?', ['sapanalyst']);
    if (!sapAnalystExists) {
        await client.execute({
            sql: 'INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)',
            args: ['sapanalyst', hashedSap, 'SAP OTC Analyst', 'sapanalyst']
        });
        console.log('Seeded sapanalyst user (default password).');
    } else {
        await client.execute({
            sql: 'UPDATE users SET password = ?, role = ? WHERE username = ?',
            args: [hashedSap, 'sapanalyst', 'sapanalyst']
        });
        console.log('Synchronized sapanalyst user credentials.');
    }

    for (const u of staffUsers) {
        const pwd = process.env[u.env] || u.fallback;
        if (!pwd || pwd.length < 8) {
            console.warn(`Skipping ${u.username}: password missing or shorter than 8 characters.`);
            continue;
        }
        const hashed = hashPassword(pwd);

        const existing = await get('SELECT id FROM users WHERE username = ?', [u.username]);
        if (existing) {
            await client.execute({ sql: 'UPDATE users SET password = ? WHERE username = ?', args: [hashed, u.username] });
        } else {
            await client.execute({
                sql: 'INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)',
                args: [u.username, hashed, u.name, u.role]
            });
        }
        console.log(`Seeded ${u.role}: ${u.username}`);
    }

    const dbMode = (process.env.TURSO_DB_URL && process.env.TURSO_DB_TOKEN)
        ? `Turso Cloud (${process.env.TURSO_DB_URL})`
        : 'Local SQLite (fallback)';

    console.log('--------------------------------------------------');
    console.log('Database initialized successfully.');
    console.log('Mode:', dbMode);
    console.log('--------------------------------------------------');
}

async function saveSession(token, user) {
    if (!token || !user) return;
    await run(
        `INSERT OR REPLACE INTO user_sessions (token, user_id, username, name, role, last_active) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
        [token, user.id, user.username, user.name, user.role]
    );
}

async function getSession(token) {
    if (!token) return null;
    const row = await get(`SELECT user_id as id, username, name, role FROM user_sessions WHERE token = ?`, [token]);
    return row || null;
}

async function deleteSession(token) {
    if (!token) return;
    await run(`DELETE FROM user_sessions WHERE token = ?`, [token]);
}

module.exports = { run, get, all, initDB, hashPassword, saveSession, getSession, deleteSession };
