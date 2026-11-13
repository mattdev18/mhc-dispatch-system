process.env.TZ = 'Asia/Manila';
const crypto = require('crypto');
const { createClient } = require('@libsql/client');

let dbClient = null;

function hashPassword(pwd) {
    return crypto.createHash('sha256').update(String(pwd)).digest('hex');
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

// Execute a write query (INSERT, UPDATE, DELETE, CREATE)
async function run(sql, params = []) {
    const client = getClient();
    const result = await client.execute({ sql, args: params });
    return {
        lastID: Number(result.lastInsertRowid ?? 0),
        changes: result.rowsAffected ?? 0
    };
}

// Execute and return ONE row
async function get(sql, params = []) {
    const client = getClient();
    const result = await client.execute({ sql, args: params });
    if (result.rows && result.rows.length > 0) {
        return rowToObject(result.rows[0], result.columns);
    }
    return null;
}

// Execute and return ALL rows
async function all(sql, params = []) {
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

    // Seed Plant Name
    await client.execute(`
        INSERT OR IGNORE INTO settings (key, value) VALUES ('plant_name', 'MAY HARVEST CORPORATION')
    `);

    // Sync 5 staff users from environment variables.
    // Passwords come ONLY from Render environment variables (no defaults in code).
    const staffUsers = [
        { username: 'admin',       env: 'MHC_ADMIN',       name: 'Plant Administrator', role: 'admin' },
        { username: 'dispatcher1', env: 'MHC_DISPATCHER1', name: 'Lead Dispatcher',     role: 'dispatcher' },
        { username: 'dispatcher2', env: 'MHC_DISPATCHER2', name: 'Shift Dispatcher',    role: 'dispatcher' },
        { username: 'guard',       env: 'MHC_GUARD',       name: 'Gate Security Guard', role: 'guard' },
        { username: 'warehouse',   env: 'MHC_WAREHOUSE',   name: 'Dock Supervisor',     role: 'warehouse' }
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
        const pwd = process.env[u.env];
        if (!pwd || pwd.length < 10) {
            console.warn(`Skipping ${u.username}: ${u.env} is missing or shorter than 10 characters.`);
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

module.exports = { run, get, all, initDB, hashPassword };
