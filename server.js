// Force Philippine Standard Time (PHT, UTC+8) for all server operations
process.env.TZ = 'Asia/Manila';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { run, get, all, initDB, hashPassword } = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const LOADING_DOCK_CAPACITY = 8;
const LOADING_DOORS = [1, 2, 3, 4, 5, 6, 7, 8];

// In-memory active user sessions (token -> user)
const sessions = new Map();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Authentication Middleware for Protected Actions
function requireAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader ? authHeader.replace('Bearer ', '').trim() : req.headers['x-auth-token'];

    if (!token || !sessions.has(token)) {
        return res.status(401).json({
            success: false,
            error: 'Access Denied: Please log in with an authorized staff account.'
        });
    }

    req.user = sessions.get(token);
    next();
}

// -------------------------------------------------------------
// ROLE-BASED ACCESS CONTROL (RBAC)
// Dito lang binabago kung sino ang puwede sa ano.
// Roles (galing sa database.js): admin, dispatcher, guard, warehouse
// -------------------------------------------------------------
const PERMISSIONS = {
    // Gate Registration
    'trucks:register':  ['admin', 'guard'],
    // Dispatcher actions
    'trucks:call':      ['admin', 'dispatcher'],
    'trucks:loading':   ['admin', 'dispatcher'],          // start loading + complete loading
    'trucks:depart':    ['admin', 'dispatcher'],
    'trucks:cancel':    ['admin', 'dispatcher'],
    // SAP OTC flow — dispatcher can set doc_transfer_to_sap; sapanalyst does the rest; admin does all
    'trucks:sap_flow':  ['admin', 'sapanalyst', 'dispatcher'],
    // Reports
    'reports:view':     ['admin', 'sapanalyst', 'warehouse'],
    // Admin only
    'users:manage':     ['admin']
};

// Aling page/screen ang puwedeng buksan ng bawat role
const SCREEN_ACCESS = {
    register: ['admin', 'guard'],                                           // index.html — Gate Registration
    dispatch: ['admin', 'dispatcher', 'warehouse', 'sapanalyst'],           // dispatch.html
    display:  ['admin', 'dispatcher', 'warehouse', 'sapanalyst', 'guard'], // display.html — Live TV Queue (public)
    reports:  ['admin', 'sapanalyst', 'warehouse'],                         // reports.html — Reports & Logs
    'sap-tv': ['admin', 'sapanalyst', 'dispatcher', 'warehouse']           // sap-tv.html — Live TV SAP Documentation
};

// Saan dadalhin ang user pagkatapos mag-login
const HOME_PAGE = {
    admin:      '/dispatch',
    dispatcher: '/dispatch',
    warehouse:  '/dispatch',
    guard:      '/',
    sapanalyst: '/dispatch'
};

function screensFor(role) {
    return Object.keys(SCREEN_ACCESS).filter(name => SCREEN_ACCESS[name].includes(role));
}

// Gamitin sa route: app.post('/api/...', requirePermission('trucks:call'), handler)
function requirePermission(permission) {
    return [
        requireAuth,
        (req, res, next) => {
            const allowedRoles = PERMISSIONS[permission] || [];
            if (!allowedRoles.includes(req.user.role)) {
                return res.status(403).json({
                    success: false,
                    error: `Access Denied: ang role mong "${req.user.role}" ay walang pahintulot sa action na ito.`
                });
            }
            next();
        }
    ];
}

// -------------------------------------------------------------
// AUTHENTICATION APIS
// -------------------------------------------------------------

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'Please enter both username and password.' });
        }

        const hashed = hashPassword(password);
        const user = await get(
            `SELECT id, username, name, role FROM users WHERE LOWER(username) = LOWER(?) AND password = ?`,
            [username.trim(), hashed]
        );

        if (!user) {
            return res.status(401).json({ success: false, error: 'Incorrect username or password.' });
        }

        const token = crypto.randomBytes(32).toString('hex');
        sessions.set(token, user);

        res.json({
            success: true,
            token,
            screens: screensFor(user.role),
            home: HOME_PAGE[user.role] || '/login',
            user: {
                id: user.id,
                username: user.username,
                name: user.name,
                role: user.role
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Verify Current Session
app.get('/api/auth/me', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader ? authHeader.replace('Bearer ', '').trim() : req.headers['x-auth-token'];

    if (token && sessions.has(token)) {
        const u = sessions.get(token);
        return res.json({ success: true, user: u, screens: screensFor(u.role), home: HOME_PAGE[u.role] || '/login' });
    }
    res.status(401).json({ success: false, error: 'Not logged in' });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader ? authHeader.replace('Bearer ', '').trim() : req.headers['x-auth-token'];
    if (token) sessions.delete(token);
    res.json({ success: true, message: 'Logged out successfully' });
});

// List Users (Admin only)
app.get('/api/users', requirePermission('users:manage'), async (req, res) => {
    try {
        const users = await all(`SELECT id, username, name, role, created_at FROM users ORDER BY id ASC`);
        res.json({ success: true, users });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Change Password
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
    try {
        const { target_username, new_password } = req.body;
        const currentUser = req.user;

        const usernameToUpdate = (currentUser.role === 'admin' && target_username)
            ? target_username.trim()
            : currentUser.username;

        if (!new_password || new_password.length < 4) {
            return res.status(400).json({ success: false, error: 'Password must be at least 4 characters long.' });
        }

        const hashed = hashPassword(new_password);
        await run(`UPDATE users SET password = ? WHERE LOWER(username) = LOWER(?)`, [hashed, usernameToUpdate]);

        res.json({ success: true, message: `Password for ${usernameToUpdate} updated successfully.` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------
// HELPERS
// -------------------------------------------------------------

function getTodayString() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

function getTimeString() {
    return new Date().toLocaleTimeString('en-US', {
        timeZone: 'Asia/Manila',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
}

function getDateDaysAgo(days = 7) {
    const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(d);
}

async function getAvailableDoor() {
    const occupiedRows = await all(
        `SELECT loading_door FROM trucks WHERE status IN ('Called', 'Loading') AND loading_door IS NOT NULL`
    );
    const occupiedDoors = occupiedRows.map(r => Number(r.loading_door));
    return LOADING_DOORS.find(d => !occupiedDoors.includes(d)) || null;
}

// -------------------------------------------------------------
// TRUCK QUEUE APIS
// -------------------------------------------------------------

// API: Get trucks (Defaults to past 7 days + all currently active trucks)
app.get('/api/trucks/today', async (req, res) => {
    try {
        const today = getTodayString();
        const scope = req.query.scope || '7days';
        const days = parseInt(req.query.days) || 7;
        const startDate = getDateDaysAgo(days - 1);

        let query = '';
        let params = [];

        if (scope === 'today_only' || days === 1) {
            // Today's trucks PLUS any currently active trucks (Waiting, Called, Loading)
            query = `SELECT * FROM trucks WHERE date = ? OR status IN ('Waiting', 'Called', 'Loading') ORDER BY id ASC`;
            params = [today];
        } else if (scope === 'active_only') {
            // Strictly active trucks only
            query = `SELECT * FROM trucks WHERE status IN ('Waiting', 'Called', 'Loading') ORDER BY id ASC`;
            params = [];
        } else {
            // Default 7 days (1 week) PLUS any active trucks regardless of date
            query = `SELECT * FROM trucks WHERE date >= ? OR status IN ('Waiting', 'Called', 'Loading') ORDER BY id ASC`;
            params = [startDate];
        }

        const trucks = await all(query, params);
        res.json({ success: true, date: today, startDate, scope, days, count: trucks.length, trucks });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Get stats (Active counts across all active trucks + 7-day stats)
app.get('/api/stats/today', async (req, res) => {
    try {
        const today = getTodayString();
        const weekStartDate = getDateDaysAgo(6);

        // 1. Active trucks currently in plant (regardless of arrival date)
        const activeRows = await all(
            `SELECT status, count(*) as count FROM trucks WHERE status IN ('Waiting', 'Called', 'Loading') GROUP BY status`
        );
        const stats = {
            Waiting: 0,
            Called: 0,
            Loading: 0,
            Completed: 0,
            Departed: 0,
            Cancelled: 0,
            Total: 0,
            CompletedWeek: 0,
            TotalWeek: 0
        };

        activeRows.forEach(r => {
            if (stats[r.status] !== undefined) stats[r.status] = r.count;
        });

        // 2. Today's completed and totals
        const todayRows = await all(
            `SELECT status, count(*) as count FROM trucks WHERE date = ? GROUP BY status`,
            [today]
        );
        todayRows.forEach(r => {
            if (r.status === 'Completed') stats.Completed = r.count;
            if (r.status === 'Departed') stats.Departed = r.count;
            if (r.status === 'Cancelled') stats.Cancelled = r.count;
            stats.Total += r.count;
        });

        // 3. Past 7 days (1 week) totals
        const weekRows = await all(
            `SELECT status, count(*) as count FROM trucks WHERE date >= ? GROUP BY status`,
            [weekStartDate]
        );
        weekRows.forEach(r => {
            if (r.status === 'Completed' || r.status === 'Departed') {
                stats.CompletedWeek += r.count;
            }
            stats.TotalWeek += r.count;
        });

        // 4. Doors currently occupied: any truck Called or Loading (never falsely vacant!)
        const activeTrucks = await all(
            `SELECT loading_door, status, queue, truck_number, driver_name, load_type, date, arrival_time FROM trucks 
             WHERE status IN ('Called', 'Loading') AND loading_door IS NOT NULL`
        );

        res.json({ success: true, stats, activeTrucks, dockCapacity: LOADING_DOCK_CAPACITY });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Register Truck (Gate Guard / Staff)
app.post('/api/trucks/register', requirePermission('trucks:register'), async (req, res) => {
    try {
        const {
            truck_number,
            driver_name,
            company,
            contact,
            load_type,
            destination,
            reference,
            priority
        } = req.body;

        if (!truck_number || !driver_name || !load_type || !destination) {
            return res.status(400).json({ success: false, error: 'Truck number, driver name, product load, and destination are required.' });
        }

        const today = getTodayString();
        const cleanTruckNum = truck_number.trim().toUpperCase();

        // Check duplicate active truck currently inside the plant
        const existing = await get(
            `SELECT * FROM trucks WHERE UPPER(truck_number) = ? AND status NOT IN ('Departed', 'Cancelled')`,
            [cleanTruckNum]
        );

        if (existing) {
            return res.status(400).json({
                success: false,
                error: `Truck ${cleanTruckNum} is currently active in the queue (Queue: ${existing.queue}, Date: ${existing.date}, Status: ${existing.status}).`
            });
        }

        // Generate Queue Number
        const countRow = await get(`SELECT count(*) as total FROM trucks WHERE date = ?`, [today]);
        const nextNum = (countRow ? countRow.total : 0) + 1;
        const queueCode = 'Q' + String(nextNum).padStart(3, '0');

        const now = new Date();
        const arrivalTime = getTimeString();
        const arrivalTimestamp = now.toISOString();

        const insertResult = await run(
            `INSERT INTO trucks (
                queue, date, truck_number, driver_name, company, contact,
                load_type, destination, reference, priority,
                arrival_time, arrival_timestamp, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Waiting')`,
            [
                queueCode,
                today,
                cleanTruckNum,
                driver_name.trim(),
                company ? company.trim() : '',
                contact ? contact.trim() : '',
                load_type.trim(),
                destination.trim(),
                reference ? reference.trim() : '',
                priority || 'Standard',
                arrivalTime,
                arrivalTimestamp
            ]
        );

        const newTruck = await get(`SELECT * FROM trucks WHERE id = ?`, [insertResult.lastID]);

        io.emit('truck_registered', newTruck);
        io.emit('queue_updated');

        res.json({ success: true, truck: newTruck });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Call Next Truck (PROTECTED: Requires Staff Login)
app.post('/api/trucks/call-next', requirePermission('trucks:call'), async (req, res) => {
    try {
        const availableDoor = await getAvailableDoor();

        if (!availableDoor) {
            return res.status(400).json({
                success: false,
                error: 'All 8 loading doors are currently occupied. Please complete or depart an existing truck first.'
            });
        }

        // Call earliest waiting truck across all active trucks (FIFO)
        const nextTruck = await get(
            `SELECT * FROM trucks WHERE status = 'Waiting' ORDER BY arrival_timestamp ASC LIMIT 1`
        );

        if (!nextTruck) {
            return res.status(400).json({ success: false, error: 'No trucks are waiting in the queue.' });
        }

        const now = new Date();
        const calledTime = getTimeString();
        const calledTimestamp = now.toISOString();

        await run(
            `UPDATE trucks SET status = 'Called', loading_door = ?, called_time = ?, called_timestamp = ?, call_count = COALESCE(call_count, 0) + 1 WHERE id = ?`,
            [availableDoor, calledTime, calledTimestamp, nextTruck.id]
        );

        const updatedTruck = await get(`SELECT * FROM trucks WHERE id = ?`, [nextTruck.id]);

        io.emit('truck_called', updatedTruck);
        io.emit('queue_updated');

        res.json({ success: true, truck: updatedTruck });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Call Specific Truck & Select Door (PROTECTED)
app.post('/api/trucks/:id/call', requirePermission('trucks:call'), async (req, res) => {
    try {
        const { id } = req.params;
        const { door } = req.body;

        const truck = await get(`SELECT * FROM trucks WHERE id = ?`, [id]);
        if (!truck) return res.status(404).json({ success: false, error: 'Truck not found.' });
        if (truck.status !== 'Waiting') {
            return res.status(400).json({ success: false, error: `Only waiting trucks can be called. Current status: ${truck.status}` });
        }

        let assignedDoor = Number(door);
        if (!assignedDoor || assignedDoor < 1 || assignedDoor > LOADING_DOCK_CAPACITY) {
            assignedDoor = await getAvailableDoor();
            if (!assignedDoor) {
                return res.status(400).json({ success: false, error: 'No loading doors are currently available.' });
            }
        } else {
            const occupied = await get(
                `SELECT * FROM trucks WHERE status IN ('Called', 'Loading') AND loading_door = ? AND id != ?`,
                [assignedDoor, id]
            );
            if (occupied) {
                return res.status(400).json({
                    success: false,
                    error: `Door ${assignedDoor} is currently occupied by Truck ${occupied.truck_number} (${occupied.queue}).`
                });
            }
        }

        const now = new Date();
        const calledTime = getTimeString();
        const calledTimestamp = now.toISOString();

        await run(
            `UPDATE trucks SET status = 'Called', loading_door = ?, called_time = ?, called_timestamp = ?, call_count = COALESCE(call_count, 0) + 1 WHERE id = ?`,
            [assignedDoor, calledTime, calledTimestamp, id]
        );

        const updatedTruck = await get(`SELECT * FROM trucks WHERE id = ?`, [id]);

        io.emit('truck_called', updatedTruck);
        io.emit('queue_updated');

        res.json({ success: true, truck: updatedTruck });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Recall / Re-page Truck (PROTECTED - Increments Call Count & Announces Again)
app.post('/api/trucks/:id/recall', requirePermission('trucks:call'), async (req, res) => {
    try {
        const { id } = req.params;
        const truck = await get(`SELECT * FROM trucks WHERE id = ?`, [id]);
        if (!truck) return res.status(404).json({ success: false, error: 'Truck not found.' });

        if (truck.status !== 'Called' && truck.status !== 'Waiting') {
            return res.status(400).json({
                success: false,
                error: `Only called or waiting trucks can be repaged. Current status: ${truck.status}`
            });
        }

        const now = new Date();
        const calledTime = getTimeString();
        const calledTimestamp = now.toISOString();

        await run(
            `UPDATE trucks SET status = 'Called', called_time = ?, called_timestamp = ?, call_count = COALESCE(call_count, 1) + 1 WHERE id = ?`,
            [calledTime, calledTimestamp, id]
        );

        const updatedTruck = await get(`SELECT * FROM trucks WHERE id = ?`, [id]);

        io.emit('truck_called', updatedTruck);
        io.emit('queue_updated');

        res.json({ success: true, truck: updatedTruck });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Start Loading (PROTECTED - Requires Assigned Warehouse Recorder)
app.post('/api/trucks/:id/start-loading', requirePermission('trucks:loading'), async (req, res) => {
    try {
        const { id } = req.params;
        const truck = await get(`SELECT * FROM trucks WHERE id = ?`, [id]);
        if (!truck) return res.status(404).json({ success: false, error: 'Truck not found.' });

        // Enforce assigned Warehouse Recorder
        if (!truck.warehouse_recorder || !truck.warehouse_recorder.trim()) {
            return res.status(400).json({
                success: false,
                error: 'Warehouse Recorder is required before starting loading. Please assign personnel first.'
            });
        }

        const now = new Date();
        const loadingTime = getTimeString();
        const loadingTimestamp = now.toISOString();

        await run(
            `UPDATE trucks SET status = 'Loading', loading_time = ?, loading_timestamp = ? WHERE id = ?`,
            [loadingTime, loadingTimestamp, id]
        );

        const updatedTruck = await get(`SELECT * FROM trucks WHERE id = ?`, [id]);
        io.emit('truck_status_changed', updatedTruck);
        io.emit('queue_updated');

        res.json({ success: true, truck: updatedTruck });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Complete Loading (PROTECTED)
app.post('/api/trucks/:id/complete', requirePermission('trucks:loading'), async (req, res) => {
    try {
        const { id } = req.params;
        const truck = await get(`SELECT * FROM trucks WHERE id = ?`, [id]);
        if (!truck) return res.status(404).json({ success: false, error: 'Truck not found.' });

        const now = new Date();
        const completedTime = getTimeString();
        const completedTimestamp = now.toISOString();

        await run(
            `UPDATE trucks SET status = 'Completed', completed_time = ?, completed_timestamp = ? WHERE id = ?`,
            [completedTime, completedTimestamp, id]
        );

        const updatedTruck = await get(`SELECT * FROM trucks WHERE id = ?`, [id]);
        io.emit('truck_status_changed', updatedTruck);
        io.emit('queue_updated');

        res.json({ success: true, truck: updatedTruck });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Depart Truck (PROTECTED)
app.post('/api/trucks/:id/depart', requirePermission('trucks:depart'), async (req, res) => {
    try {
        const { id } = req.params;
        const truck = await get(`SELECT * FROM trucks WHERE id = ?`, [id]);
        if (!truck) return res.status(404).json({ success: false, error: 'Truck not found.' });

        const now = new Date();
        const departedTime = getTimeString();
        const departedTimestamp = now.toISOString();

        await run(
            `UPDATE trucks SET status = 'Departed', departed_time = ?, departed_timestamp = ? WHERE id = ?`,
            [departedTime, departedTimestamp, id]
        );

        const updatedTruck = await get(`SELECT * FROM trucks WHERE id = ?`, [id]);
        io.emit('truck_status_changed', updatedTruck);
        io.emit('queue_updated');

        res.json({ success: true, truck: updatedTruck });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Cancel Truck (PROTECTED)
app.post('/api/trucks/:id/cancel', requirePermission('trucks:cancel'), async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body || {};
        const truck = await get(`SELECT * FROM trucks WHERE id = ?`, [id]);
        if (!truck) return res.status(404).json({ success: false, error: 'Truck not found.' });

        const now = new Date();
        const cancelledTime = getTimeString();
        const cancelledTimestamp = now.toISOString();
        const cancelReason = (reason || '').trim();

        await run(
            `UPDATE trucks SET status = 'Cancelled', loading_door = NULL, cancelled_time = ?, cancelled_timestamp = ?, cancellation_reason = ? WHERE id = ?`,
            [cancelledTime, cancelledTimestamp, cancelReason, id]
        );

        const updatedTruck = await get(`SELECT * FROM trucks WHERE id = ?`, [id]);
        io.emit('truck_status_changed', updatedTruck);
        io.emit('queue_updated');

        res.json({ success: true, truck: updatedTruck });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: SAP OTC Documentation Flow (PROTECTED)
app.post('/api/trucks/:id/sap-flow', requirePermission('trucks:sap_flow'), async (req, res) => {
    try {
        const { id } = req.params;
        const {
            doc_transfer_to_sap,
            doc_received_from_warehouse,
            sap_analyst,
            sap_doc_start,
            sap_doc_end,
            remarks,
            doc_transfer_to_warehouse
        } = req.body || {};

        const truck = await get(`SELECT * FROM trucks WHERE id = ?`, [id]);
        if (!truck) return res.status(404).json({ success: false, error: 'Truck not found.' });

        // Build SET clause dynamically — only update provided fields
        const fields = [];
        const values = [];

        if (doc_transfer_to_sap !== undefined)       { fields.push('doc_transfer_to_sap = ?');       values.push(doc_transfer_to_sap); }
        if (doc_received_from_warehouse !== undefined){ fields.push('doc_received_from_warehouse = ?'); values.push(doc_received_from_warehouse); }
        if (sap_analyst !== undefined)               { fields.push('sap_analyst = ?');               values.push(sap_analyst); }
        if (sap_doc_start !== undefined)             { fields.push('sap_doc_start = ?');             values.push(sap_doc_start); }
        if (sap_doc_end !== undefined)               { fields.push('sap_doc_end = ?');               values.push(sap_doc_end); }
        if (remarks !== undefined)                   { fields.push('remarks = ?');                   values.push(remarks); }
        if (doc_transfer_to_warehouse !== undefined) { fields.push('doc_transfer_to_warehouse = ?'); values.push(doc_transfer_to_warehouse); }

        if (fields.length === 0) {
            return res.status(400).json({ success: false, error: 'No SAP fields provided.' });
        }

        values.push(id);
        await run(`UPDATE trucks SET ${fields.join(', ')} WHERE id = ?`, values);

        const updatedTruck = await get(`SELECT * FROM trucks WHERE id = ?`, [id]);
        io.emit('truck_status_changed', updatedTruck);
        io.emit('queue_updated');

        res.json({ success: true, truck: updatedTruck });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Assign / Update Warehouse Recorder (PROTECTED)
app.post('/api/trucks/:id/warehouse-recorder', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { warehouse_recorder } = req.body || {};
        const truck = await get(`SELECT * FROM trucks WHERE id = ?`, [id]);
        if (!truck) return res.status(404).json({ success: false, error: 'Truck not found.' });

        const recorderName = (warehouse_recorder || '').trim();
        await run(`UPDATE trucks SET warehouse_recorder = ? WHERE id = ?`, [recorderName || null, id]);

        const updatedTruck = await get(`SELECT * FROM trucks WHERE id = ?`, [id]);
        io.emit('truck_status_changed', updatedTruck);
        io.emit('queue_updated');

        res.json({ success: true, truck: updatedTruck });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Reports query (PROTECTED)
app.get('/api/reports', requirePermission('reports:view'), async (req, res) => {
    try {
        const { date, start_date, end_date, days } = req.query;
        let query = `SELECT * FROM trucks`;
        let params = [];

        if (date) {
            query += ` WHERE date = ?`;
            params.push(date);
        } else if (start_date && end_date) {
            query += ` WHERE date BETWEEN ? AND ?`;
            params.push(start_date, end_date);
        } else if (days) {
            const startDate = getDateDaysAgo(parseInt(days) - 1);
            query += ` WHERE date >= ?`;
            params.push(startDate);
        } else {
            // Default: past 7 days (1 week)
            const startDate = getDateDaysAgo(6);
            query += ` WHERE date >= ?`;
            params.push(startDate);
        }

        query += ` ORDER BY id ASC`;
        const trucks = await all(query, params);

        res.json({ success: true, trucks });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------
// BACKUP & AUTO-RESTORE APIS
// -------------------------------------------------------------

// API: Auto-sync cached trucks from client browser to restore if server restarted
app.post('/api/backup/sync', requireAuth, async (req, res) => {
    try {
        const { trucks } = req.body;
        if (!Array.isArray(trucks) || trucks.length === 0) {
            return res.json({ success: true, restored: 0 });
        }

        let restoredCount = 0;
        for (const t of trucks) {
            if (!t.queue || !t.truck_number || !t.date) continue;

            const existing = await get(
                `SELECT id FROM trucks WHERE queue = ? AND date = ? AND truck_number = ?`,
                [t.queue, t.date, t.truck_number]
            );

            if (!existing) {
                await run(
                    `INSERT INTO trucks (
                        queue, date, truck_number, driver_name, company, contact,
                        load_type, destination, reference, priority, loading_door,
                        arrival_time, arrival_timestamp, called_time, called_timestamp,
                        loading_time, loading_timestamp, completed_time, completed_timestamp,
                        departed_time, departed_timestamp, cancelled_time, cancelled_timestamp,
                        status
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        t.queue, t.date, t.truck_number, t.driver_name || '', t.company || '', t.contact || '',
                        t.load_type || '', t.destination || '', t.reference || '', t.priority || 'Standard',
                        t.loading_door || null, t.arrival_time || '', t.arrival_timestamp || '',
                        t.called_time || null, t.called_timestamp || null,
                        t.loading_time || null, t.loading_timestamp || null,
                        t.completed_time || null, t.completed_timestamp || null,
                        t.departed_time || null, t.departed_timestamp || null,
                        t.cancelled_time || null, t.cancelled_timestamp || null,
                        t.status || 'Waiting'
                    ]
                );
                restoredCount++;
            }
        }

        if (restoredCount > 0) {
            io.emit('queue_updated');
        }

        res.json({ success: true, restored: restoredCount });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Export all database records as JSON
app.get('/api/backup/export', requireAuth, async (req, res) => {
    try {
        const trucks = await all(`SELECT * FROM trucks ORDER BY id ASC`);
        res.setHeader('Content-Disposition', `attachment; filename=MHC_Backup_${getTodayString()}.json`);
        res.setHeader('Content-Type', 'application/json');
        res.json({
            system: 'May Harvest Corporation - Dispatch Queuing System',
            exported_at: new Date().toISOString(),
            record_count: trucks.length,
            trucks
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// -------------------------------------------------------------
// ROUTES
// -------------------------------------------------------------
const PUBLIC_DIR = path.join(__dirname, 'public');

app.get('/', (req, res) => res.sendFile('index.html', { root: PUBLIC_DIR }));
app.get('/login', (req, res) => res.sendFile('login.html', { root: PUBLIC_DIR }));
app.get('/register', (req, res) => res.sendFile('index.html', { root: PUBLIC_DIR }));
app.get('/dispatch', (req, res) => res.sendFile('dispatch.html', { root: PUBLIC_DIR }));
app.get('/display', (req, res) => res.sendFile('display.html', { root: PUBLIC_DIR })); // PUBLIC (Trucker view)
app.get('/driver', (req, res) => res.sendFile('display.html', { root: PUBLIC_DIR }));  // PUBLIC (Trucker shortcut)
app.get('/reports', (req, res) => res.sendFile('reports.html', { root: PUBLIC_DIR }));
app.get('/sap-tv', (req, res) => res.sendFile('sap-tv.html', { root: PUBLIC_DIR }));

// WebSockets connection
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Start Server
initDB().then(() => {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`====================================================`);
        console.log(`MAY HARVEST CORPORATION - DISPATCH QUEUING SYSTEM`);
        console.log(`====================================================`);
        console.log(`Local Access:        http://localhost:${PORT}`);
        console.log(`Network (LAN) Access: http://192.168.100.81:${PORT}`);
        console.log(`----------------------------------------------------`);
        console.log(`1. Gate Registration: http://192.168.100.81:${PORT}/`);
        console.log(`2. Dispatcher Screen: http://192.168.100.81:${PORT}/dispatch (Protected)`);
        console.log(`3. TV Display Screen: http://192.168.100.81:${PORT}/display  (Public for Truckers)`);
        console.log(`4. Reports Screen:    http://192.168.100.81:${PORT}/reports  (Protected)`);
        console.log(`5. Staff Login:       http://192.168.100.81:${PORT}/login`);
        console.log(`====================================================`);
    });
});
