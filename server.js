const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const { run, get, all, initDB } = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const LOADING_DOCK_CAPACITY = 8;
const LOADING_DOORS = [1, 2, 3, 4, 5, 6, 7, 8];

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper: Current Date in YYYY-MM-DD
function getTodayString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// Helper: Format Time string
function getTimeString() {
    return new Date().toLocaleTimeString('en-US', { hour12: true });
}

// API: Get today's trucks
app.get('/api/trucks/today', async (req, res) => {
    try {
        const today = getTodayString();
        const trucks = await all(
            `SELECT * FROM trucks WHERE date = ? ORDER BY id ASC`,
            [today]
        );
        res.json({ success: true, date: today, trucks });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Get stats today
app.get('/api/stats/today', async (req, res) => {
    try {
        const today = getTodayString();
        const rows = await all(
            `SELECT status, count(*) as count FROM trucks WHERE date = ? GROUP BY status`,
            [today]
        );
        const stats = {
            Waiting: 0,
            Called: 0,
            Loading: 0,
            Completed: 0,
            Departed: 0,
            Cancelled: 0,
            Total: 0
        };
        rows.forEach(r => {
            if (stats[r.status] !== undefined) stats[r.status] = r.count;
            stats.Total += r.count;
        });

        // Occupied doors
        const activeTrucks = await all(
            `SELECT loading_door, status, queue, truck_number, driver_name, load_type FROM trucks 
             WHERE date = ? AND status IN ('Called', 'Loading') AND loading_door IS NOT NULL`,
            [today]
        );

        res.json({ success: true, stats, activeTrucks, dockCapacity: LOADING_DOCK_CAPACITY });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Register Truck
app.post('/api/trucks/register', async (req, res) => {
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

        // Check duplicate active truck today
        const existing = await get(
            `SELECT * FROM trucks WHERE date = ? AND UPPER(truck_number) = ? AND status NOT IN ('Departed', 'Cancelled')`,
            [today, cleanTruckNum]
        );

        if (existing) {
            return res.status(400).json({
                success: false,
                error: `Truck ${cleanTruckNum} is already registered today (Queue: ${existing.queue}, Status: ${existing.status}).`
            });
        }

        // Generate Queue Number (Count today's trucks + 1)
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

        // Realtime broadcast to Dispatcher and Display
        io.emit('truck_registered', newTruck);
        io.emit('queue_updated');

        res.json({ success: true, truck: newTruck });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Helper: Get available door
async function getAvailableDoor(today) {
    const occupiedRows = await all(
        `SELECT loading_door FROM trucks WHERE date = ? AND status IN ('Called', 'Loading') AND loading_door IS NOT NULL`,
        [today]
    );
    const occupiedDoors = occupiedRows.map(r => Number(r.loading_door));
    return LOADING_DOORS.find(d => !occupiedDoors.includes(d)) || null;
}

// API: Call Next Truck (Auto assign first available door)
app.post('/api/trucks/call-next', async (req, res) => {
    try {
        const today = getTodayString();
        const availableDoor = await getAvailableDoor(today);

        if (!availableDoor) {
            return res.status(400).json({
                success: false,
                error: 'All 8 loading doors are currently occupied. Please complete or depart an existing truck first.'
            });
        }

        // Get earliest waiting truck
        const nextTruck = await get(
            `SELECT * FROM trucks WHERE date = ? AND status = 'Waiting' ORDER BY arrival_timestamp ASC LIMIT 1`,
            [today]
        );

        if (!nextTruck) {
            return res.status(400).json({ success: false, error: 'No trucks are waiting in the queue.' });
        }

        const now = new Date();
        const calledTime = getTimeString();
        const calledTimestamp = now.toISOString();

        await run(
            `UPDATE trucks SET status = 'Called', loading_door = ?, called_time = ?, called_timestamp = ? WHERE id = ?`,
            [availableDoor, calledTime, calledTimestamp, nextTruck.id]
        );

        const updatedTruck = await get(`SELECT * FROM trucks WHERE id = ?`, [nextTruck.id]);

        // Real-time broadcast with chime & voice trigger
        io.emit('truck_called', updatedTruck);
        io.emit('queue_updated');

        res.json({ success: true, truck: updatedTruck });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Call Specific Truck & Select Door
app.post('/api/trucks/:id/call', async (req, res) => {
    try {
        const { id } = req.params;
        const { door } = req.body;
        const today = getTodayString();

        const truck = await get(`SELECT * FROM trucks WHERE id = ?`, [id]);
        if (!truck) return res.status(404).json({ success: false, error: 'Truck not found.' });
        if (truck.status !== 'Waiting') {
            return res.status(400).json({ success: false, error: `Only waiting trucks can be called. Current status: ${truck.status}` });
        }

        let assignedDoor = Number(door);
        if (!assignedDoor || assignedDoor < 1 || assignedDoor > LOADING_DOCK_CAPACITY) {
            assignedDoor = await getAvailableDoor(today);
            if (!assignedDoor) {
                return res.status(400).json({ success: false, error: 'No loading doors are currently available.' });
            }
        } else {
            // Check if selected door is occupied
            const occupied = await get(
                `SELECT * FROM trucks WHERE date = ? AND status IN ('Called', 'Loading') AND loading_door = ? AND id != ?`,
                [today, assignedDoor, id]
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
            `UPDATE trucks SET status = 'Called', loading_door = ?, called_time = ?, called_timestamp = ? WHERE id = ?`,
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

// API: Start Loading
app.post('/api/trucks/:id/start-loading', async (req, res) => {
    try {
        const { id } = req.params;
        const truck = await get(`SELECT * FROM trucks WHERE id = ?`, [id]);
        if (!truck) return res.status(404).json({ success: false, error: 'Truck not found.' });

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

// API: Complete Loading
app.post('/api/trucks/:id/complete', async (req, res) => {
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

// API: Depart Truck (Frees the dock door)
app.post('/api/trucks/:id/depart', async (req, res) => {
    try {
        const { id } = req.params;
        const truck = await get(`SELECT * FROM trucks WHERE id = ?`, [id]);
        if (!truck) return res.status(404).json({ success: false, error: 'Truck not found.' });

        const now = new Date();
        const departedTime = getTimeString();
        const departedTimestamp = now.toISOString();

        await run(
            `UPDATE trucks SET status = 'Departed', loading_door = NULL, departed_time = ?, departed_timestamp = ? WHERE id = ?`,
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

// API: Cancel Truck
app.post('/api/trucks/:id/cancel', async (req, res) => {
    try {
        const { id } = req.params;
        const truck = await get(`SELECT * FROM trucks WHERE id = ?`, [id]);
        if (!truck) return res.status(404).json({ success: false, error: 'Truck not found.' });

        const now = new Date();
        const cancelledTime = getTimeString();
        const cancelledTimestamp = now.toISOString();

        await run(
            `UPDATE trucks SET status = 'Cancelled', loading_door = NULL, cancelled_time = ?, cancelled_timestamp = ? WHERE id = ?`,
            [cancelledTime, cancelledTimestamp, id]
        );

        const updatedTruck = await get(`SELECT * FROM trucks WHERE id = ?`, [id]);
        io.emit('truck_status_changed', updatedTruck);
        io.emit('queue_updated');

        res.json({ success: true, truck: updatedTruck });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Reports query
app.get('/api/reports', async (req, res) => {
    try {
        const { date, start_date, end_date } = req.query;
        let query = `SELECT * FROM trucks`;
        let params = [];

        if (date) {
            query += ` WHERE date = ?`;
            params.push(date);
        } else if (start_date && end_date) {
            query += ` WHERE date BETWEEN ? AND ?`;
            params.push(start_date, end_date);
        } else {
            query += ` WHERE date = ?`;
            params.push(getTodayString());
        }

        query += ` ORDER BY id ASC`;
        const trucks = await all(query, params);

        res.json({ success: true, trucks });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Serve friendly route URLs
const PUBLIC_DIR = path.join(__dirname, 'public');

app.get('/', (req, res) => res.sendFile('index.html', { root: PUBLIC_DIR }));
app.get('/register', (req, res) => res.sendFile('index.html', { root: PUBLIC_DIR }));
app.get('/dispatch', (req, res) => res.sendFile('dispatch.html', { root: PUBLIC_DIR }));
app.get('/display', (req, res) => res.sendFile('display.html', { root: PUBLIC_DIR }));
app.get('/reports', (req, res) => res.sendFile('reports.html', { root: PUBLIC_DIR }));

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
        console.log(`2. Dispatcher Screen: http://192.168.100.81:${PORT}/dispatch`);
        console.log(`3. TV Display Screen: http://192.168.100.81:${PORT}/display`);
        console.log(`4. Reports Screen:    http://192.168.100.81:${PORT}/reports`);
        console.log(`====================================================`);
    });
});
