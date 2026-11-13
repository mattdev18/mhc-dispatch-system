// Protect page: require staff login
verifyAuth(true);

const socket = io();

let todayTrucks = [];
let todayStats = {};
let activeDoors = {};
let selectedTruckForModal = null;
let currentScope = '7days';

function setQueueScope(scope) {
    currentScope = scope;
    ['btnScope7Days', 'btnScopeToday', 'btnScopeActive'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.className = 'btn btn-outline';
    });

    if (scope === '7days') {
        const b = document.getElementById('btnScope7Days');
        if (b) b.className = 'btn btn-primary';
    } else if (scope === 'today_only') {
        const b = document.getElementById('btnScopeToday');
        if (b) b.className = 'btn btn-primary';
    } else if (scope === 'active_only') {
        const b = document.getElementById('btnScopeActive');
        if (b) b.className = 'btn btn-primary';
    }

    loadTodayData();
}

// Clock
function updateClock() {
    const el = document.getElementById('clock');
    if (el) el.textContent = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
}
setInterval(updateClock, 1000);
updateClock();

// Connection
socket.on('connect', () => {
    document.getElementById('connDot').className = 'conn-dot online';
    document.getElementById('connText').textContent = 'Online / Sync';
});

socket.on('disconnect', () => {
    document.getElementById('connDot').className = 'conn-dot';
    document.getElementById('connText').textContent = 'Offline';
});

// Real-time Socket Listeners
socket.on('queue_updated', () => {
    loadTodayData();
});

socket.on('truck_registered', (truck) => {
    loadTodayData();
});

socket.on('truck_called', (truck) => {
    loadTodayData();
});

// Load Data from Server
async function loadTodayData() {
    try {
        const [trucksRes, statsRes] = await Promise.all([
            fetch(`/api/trucks/today?scope=${encodeURIComponent(currentScope)}`),
            fetch('/api/stats/today')
        ]);

        const trucksData = await trucksRes.json();
        const statsData = await statsRes.json();

        if (trucksData.success) {
            todayTrucks = trucksData.trucks || [];

            // Auto-recovery / Self-healing cache:
            // If the server was rebooted/restarted with an empty DB, but our browser has recent truck data,
            // immediately restore it into the database via /api/backup/sync!
            const cachedBackup = localStorage.getItem('mhc_trucks_7d');
            if (todayTrucks.length === 0 && cachedBackup) {
                try {
                    const parsed = JSON.parse(cachedBackup);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        console.log('Restoring 7-day trucks from browser cache to server...');
                        await fetch('/api/backup/sync', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ trucks: parsed })
                        });
                        const refetch = await fetch(`/api/trucks/today?scope=${encodeURIComponent(currentScope)}`);
                        const refetchData = await refetch.json();
                        if (refetchData.success && refetchData.trucks) {
                            todayTrucks = refetchData.trucks;
                        }
                    }
                } catch (syncErr) {
                    console.warn('Backup auto-sync notice:', syncErr);
                }
            } else if (todayTrucks.length > 0) {
                // Keep local cache fresh with latest 7-day snapshot
                try {
                    localStorage.setItem('mhc_trucks_7d', JSON.stringify(todayTrucks));
                } catch (e) {}
            }
        }

        if (statsData.success) {
            todayStats = statsData.stats || {};
            renderStats();
            renderDoors(statsData.activeTrucks || []);
        }

        renderTable();
        updateAlarmToggleButton();
    } catch (err) {
        console.error('Error fetching dispatch data:', err);
    }
}

// Render Stats
function renderStats() {
    document.getElementById('statWaiting').textContent = todayStats.Waiting || 0;
    document.getElementById('statCalled').textContent = todayStats.Called || 0;
    document.getElementById('statLoading').textContent = todayStats.Loading || 0;
    document.getElementById('statCompleted').textContent = todayStats.Completed || 0;
    document.getElementById('statTotal').textContent = todayStats.Total || 0;
}

// Render 8 Loading Doors
function renderDoors(activeTruckList) {
    const grid = document.getElementById('doorsGrid');
    activeDoors = {};

    activeTruckList.forEach(t => {
        if (t.loading_door) {
            activeDoors[Number(t.loading_door)] = t;
        }
    });

    let html = '';
    for (let i = 1; i <= 8; i++) {
        const truck = activeDoors[i];

        if (!truck) {
            html += `
                <div class="door-card vacant">
                    <div class="door-header">
                        <span>DOOR ${i}</span>
                        <span class="badge" style="background: #dcfce7; color: #166534;">VACANT</span>
                    </div>
                    <div style="padding: 12px 0; color: #64748b; font-size: 13px;">
                        Ready for truck assignment
                    </div>
                </div>
            `;
        } else {
            const isCalled = truck.status === 'Called';
            const cardClass = isCalled ? 'door-card called' : 'door-card loading';
            const statusBadgeClass = isCalled ? 'badge-called' : 'badge-loading';

            // Find full truck object
            const fullTruck = todayTrucks.find(t => t.id === truck.id) || truck;

            const recorderTag = fullTruck.warehouse_recorder
                ? `<div style="margin-top: 6px; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; padding: 4px 8px; font-size: 11px; font-weight: 700; color: #334155;">👷 Recorder: <span style="color: #1d4ed8;">${escapeHtml(fullTruck.warehouse_recorder)}</span></div>`
                : '';

            let actionBtn = '';
            if (isCalled) {
                actionBtn = `<button class="btn btn-warning" style="width: 100%; font-size: 11px; padding: 6px;" onclick="startLoading(${fullTruck.id})">▶ Start Loading</button>`;
            } else {
                actionBtn = `<button class="btn btn-success" style="width: 100%; font-size: 11px; padding: 6px;" onclick="completeLoading(${fullTruck.id})">✓ Mark Complete</button>`;
            }

            html += `
                <div class="${cardClass}">
                    <div class="door-header">
                        <span>DOOR ${i}</span>
                        <span class="badge ${statusBadgeClass}">${escapeHtml(truck.status)}</span>
                    </div>
                    <div class="door-truck">${escapeHtml(truck.truck_number)}</div>
                    <div class="door-driver">Queue: <strong>${escapeHtml(truck.queue)}</strong> | ${escapeHtml(truck.driver_name)}</div>
                    <div class="door-load">${escapeHtml(truck.load_type || '')}</div>
                    ${recorderTag}
                    <div style="margin-top: 10px;">
                        ${actionBtn}
                    </div>
                </div>
            `;
        }
    }

    grid.innerHTML = html;
}

// Render Table
function renderTable() {
    const tbody = document.getElementById('queueTableBody');
    const search = (document.getElementById('searchInput').value || '').toLowerCase().trim();

    let list = todayTrucks;

    if (search) {
        list = list.filter(t =>
            (t.queue || '').toLowerCase().includes(search) ||
            (t.truck_number || '').toLowerCase().includes(search) ||
            (t.driver_name || '').toLowerCase().includes(search) ||
            (t.company || '').toLowerCase().includes(search) ||
            (t.destination || '').toLowerCase().includes(search) ||
            (t.priority || '').toLowerCase().includes(search) ||
            (t.load_type || '').toLowerCase().includes(search)
        );
    }

    const sortOrder = { 'Called': 1, 'Loading': 2, 'Waiting': 3, 'Completed': 4, 'Departed': 5, 'Cancelled': 6 };
    list.sort((a, b) => {
        if (sortOrder[a.status] !== sortOrder[b.status]) {
            return (sortOrder[a.status] || 99) - (sortOrder[b.status] || 99);
        }
        return new Date(a.arrival_timestamp) - new Date(b.arrival_timestamp);
    });

    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
    let hasCriticalOverdue = false;

    if (list.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="12" style="text-align: center; padding: 35px; color: #64748b;">
                    No trucks matching query or registered in this view.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = list.map(truck => {
        let actionButtons = '';
        const role = currentUser ? currentUser.role : null;

        // ── WAREHOUSE: view only, no action buttons ──────────────────────
        if (role === 'warehouse') {
            actionButtons = `<span style="color:#94a3b8;font-size:12px;">View Only</span>`;

        // ── DISPATCHER: Call+Cancel / Recall+Load+Cancel / Complete / DocTransferSAP+Depart ──
        } else if (role === 'dispatcher') {
            if (truck.status === 'Waiting') {
                actionButtons = `
                    <button class="btn btn-primary" style="font-size: 11px; padding: 6px 10px;" onclick="openDoorModal(${truck.id})">📢 Call &amp; Door</button>
                    <button class="btn btn-danger" style="font-size: 11px; padding: 6px 10px;" onclick="cancelTruck(${truck.id})">Cancel</button>
                `;
            } else if (truck.status === 'Called') {
                const callCount = Number(truck.call_count) || 1;
                actionButtons = `
                    <button class="btn btn-primary" style="font-size: 11px; padding: 6px 10px;" onclick="recallTruck(${truck.id})" title="Play 3x Airport Announcement again">📢 Recall (${callCount}x)</button>
                    <button class="btn btn-warning" style="font-size: 11px; padding: 6px 10px;" onclick="startLoading(${truck.id})">▶ Start Loading</button>
                    <button class="btn btn-danger" style="font-size: 11px; padding: 6px 10px;" onclick="cancelTruck(${truck.id})">Cancel</button>
                `;
            } else if (truck.status === 'Loading') {
                actionButtons = `<button class="btn btn-success" style="font-size: 11px; padding: 6px 10px;" onclick="completeLoading(${truck.id})">✓ Complete</button>`;
            } else if (truck.status === 'Completed') {
                const sapDone = truck.doc_transfer_to_sap
                    ? `<span class="sap-done-badge" title="Transferred to SAP at ${escapeHtml(truck.doc_transfer_to_sap)}">📄 SAP ✓</span>`
                    : `<button class="btn btn-primary sap-btn" onclick="openSapTransferToSapModal(${truck.id})" title="Transfer documents to SAP OTC">📄 Transfer to SAP</button>`;

                const isTransferWhDone = !!truck.doc_transfer_to_warehouse;
                let departBtn = '';
                if (isTransferWhDone) {
                    departBtn = `<button class="btn btn-secondary sap-btn btn-depart-active" style="background:#059669;border-color:#059669;color:#fff;font-weight:700;" onclick="departTruck(${truck.id})" title="Documents returned from SAP (${escapeHtml(truck.doc_transfer_to_warehouse)}) — Ready for Plant Departure">🚛 Depart Plant</button>`;
                } else {
                    departBtn = `<button class="btn btn-secondary sap-btn btn-depart-locked" disabled style="opacity:0.5;cursor:not-allowed;background:#64748b;color:#f8fafc;border-color:#64748b;" title="Locked: Awaiting SAP document transfer back to Warehouse before plant departure">🔒 Depart Plant</button>`;
                }

                actionButtons = `
                    <div class="sap-actions-wrap">
                        ${sapDone}
                        ${departBtn}
                    </div>
                `;
            } else {
                actionButtons = `<span style="color:#94a3b8;font-size:12px;">Finished</span>`;
            }

        // ── SAP ANALYST: only SAP flow on Completed/Loading trucks ────────
        } else if (role === 'sapanalyst') {
            if (['Completed', 'Loading'].includes(truck.status)) {
                actionButtons = buildSapActionButtons(truck);
            } else {
                actionButtons = `<span style="color:#94a3b8;font-size:12px;">—</span>`;
            }

        // ── ADMIN: ALL buttons — dispatcher + SAP OTC combined ───────────
        } else if (role === 'admin') {
            if (truck.status === 'Waiting') {
                actionButtons = `
                    <button class="btn btn-primary" style="font-size: 11px; padding: 6px 10px;" onclick="openDoorModal(${truck.id})">📢 Call &amp; Door</button>
                    <button class="btn btn-danger" style="font-size: 11px; padding: 6px 10px;" onclick="cancelTruck(${truck.id})">Cancel</button>
                `;
            } else if (truck.status === 'Called') {
                const callCount = Number(truck.call_count) || 1;
                actionButtons = `
                    <button class="btn btn-primary" style="font-size: 11px; padding: 6px 10px;" onclick="recallTruck(${truck.id})" title="Play 3x Airport Announcement again">📢 Recall (${callCount}x)</button>
                    <button class="btn btn-warning" style="font-size: 11px; padding: 6px 10px;" onclick="startLoading(${truck.id})">▶ Start Loading</button>
                    <button class="btn btn-danger" style="font-size: 11px; padding: 6px 10px;" onclick="cancelTruck(${truck.id})">Cancel</button>
                `;
            } else if (truck.status === 'Loading') {
                actionButtons = `<button class="btn btn-success" style="font-size: 11px; padding: 6px 10px;" onclick="completeLoading(${truck.id})">✓ Complete</button>`;
            } else if (truck.status === 'Completed') {
                // Admin = Dispatcher buttons + All SAP buttons combined
                actionButtons = buildAdminCompletedButtons(truck);
            } else {
                actionButtons = `<span style="color:#94a3b8;font-size:12px;">Finished</span>`;
            }

        // ── FALLBACK (unknown role) ───────────────────────────────────────
        } else {
            if (truck.status === 'Waiting') {
                actionButtons = `
                    <button class="btn btn-primary" style="font-size: 11px; padding: 6px 10px;" onclick="openDoorModal(${truck.id})">📢 Call &amp; Door</button>
                    <button class="btn btn-danger" style="font-size: 11px; padding: 6px 10px;" onclick="cancelTruck(${truck.id})">Cancel</button>
                `;
            } else if (truck.status === 'Called') {
                const callCount = Number(truck.call_count) || 1;
                actionButtons = `
                    <button class="btn btn-primary" style="font-size: 11px; padding: 6px 10px;" onclick="recallTruck(${truck.id})">📢 Recall (${callCount}x)</button>
                    <button class="btn btn-warning" style="font-size: 11px; padding: 6px 10px;" onclick="startLoading(${truck.id})">▶ Start Loading</button>
                    <button class="btn btn-danger" style="font-size: 11px; padding: 6px 10px;" onclick="cancelTruck(${truck.id})">Cancel</button>
                `;
            } else if (truck.status === 'Loading') {
                actionButtons = `<button class="btn btn-success" style="font-size: 11px; padding: 6px 10px;" onclick="completeLoading(${truck.id})">✓ Complete</button>`;
            } else if (truck.status === 'Completed') {
                actionButtons = `<button class="btn btn-secondary" style="font-size: 11px; padding: 6px 10px;" onclick="departTruck(${truck.id})">🚛 Depart Plant</button>`;
            } else {
                actionButtons = `<span style="color:#94a3b8;font-size:12px;">Finished</span>`;
            }
        }

        const doorText = truck.loading_door 
            ? `<span class="badge-door">DOOR ${escapeHtml(truck.loading_door)}</span>`
            : `<span style="color: #94a3b8;">—</span>`;

        const isToday = (truck.date === todayStr);
        const dateBadge = isToday
            ? `<span style="display: inline-block; font-size: 11px; padding: 2px 7px; background: #dcfce7; color: #166534; font-weight: 700; border-radius: 4px;">Today</span>`
            : `<span style="display: inline-block; font-size: 11px; padding: 2px 7px; background: #f1f5f9; color: #475569; font-weight: 600; border-radius: 4px;">${escapeHtml(truck.date || '—')}</span>`;

        const isRecorderLocked = ['Completed', 'Departed', 'Cancelled'].includes(truck.status);
        let recorderHtml;
        if (isRecorderLocked) {
            recorderHtml = truck.warehouse_recorder
                ? `<span style="display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 700; color: #0369a1; background: #f0f9ff; border: 1px solid #bae6fd; padding: 4px 8px; border-radius: 6px;">👷 ${escapeHtml(truck.warehouse_recorder)}</span>`
                : `<span style="color: #94a3b8; font-size: 12px;">—</span>`;
        } else {
            recorderHtml = truck.warehouse_recorder
                ? `<button class="btn btn-outline" style="font-size: 11px; padding: 4px 8px; border-color: #93c5fd; color: #1d4ed8; background: #eff6ff; font-weight: 700;" onclick="openRecorderModal(${truck.id})">👷 ${escapeHtml(truck.warehouse_recorder)} ✏️</button>`
                : `<button class="btn btn-outline" style="font-size: 11px; padding: 4px 8px; border: 1px dashed #94a3b8; color: #64748b; background: #f8fafc;" onclick="openRecorderModal(${truck.id})">➕ Assign</button>`;
        }

        let priorityHtml = '';
        if (role === 'admin') {
            priorityHtml = `<button type="button" class="btn btn-outline" style="font-size: 11px; padding: 3px 8px; border-color: #93c5fd; color: #1d4ed8; background: #eff6ff; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;" onclick="openEditPriorityModal(${truck.id})" title="Plant Admin: Click to reclassify Priority Category">`
                + `<span>${escapeHtml(truck.priority || 'Standard')}</span>`
                + `<span style="font-size: 10px; opacity: 0.85;">✏️</span>`
                + `</button>`;
        } else {
            priorityHtml = `<span class="badge badge-waiting">${escapeHtml(truck.priority || 'Standard')}</span>`;
        }
        let rowClass = '';
        let elapsedBadge = '';
        let isStaleOver12Hours = false;

        if (truck.status === 'Waiting' && (truck.arrival_timestamp || truck.created_at)) {
            const ts = truck.arrival_timestamp || truck.created_at;
            const elapsedMins = (Date.now() - new Date(ts).getTime()) / (60 * 1000);
            if (elapsedMins >= 12 * 60) {
                isStaleOver12Hours = true;
            }
            if (elapsedMins >= 60) {
                rowClass = 'overdue-critical';
                elapsedBadge = '<div class="badge-overdue-critical">⚠️ Overdue: ' + (elapsedMins / 60).toFixed(1) + 'h in Staging</div>';
                hasCriticalOverdue = true;
            } else if (elapsedMins >= 30) {
                rowClass = 'overdue-warning';
                elapsedBadge = '<div class="badge-overdue-warning">⏳ Wait: ' + Math.round(elapsedMins) + 'm elapsed</div>';
            }
        } else if (['Called', 'Loading'].includes(truck.status) && (truck.arrival_timestamp || truck.created_at)) {
            const ts = truck.arrival_timestamp || truck.created_at;
            const elapsedMins = (Date.now() - new Date(ts).getTime()) / (60 * 1000);
            if (elapsedMins >= 12 * 60) {
                isStaleOver12Hours = true;
            }
        }

        // Admin-Only Quick Depart button (Strictly visible only for trucks waiting over 12 hours)
        if (role === 'admin' && isStaleOver12Hours) {
            actionButtons += '<button type="button" class="btn btn-admin-quick-depart" onclick="openQuickDepartModal(' + truck.id + ')" title="Plant Admin Only: Clear stale truck waiting over 12 hours that physically left earlier"><span>⚡ Quick Depart</span></button>';
        }

        return `
            <tr class="${rowClass}">
                <td><strong>${escapeHtml(truck.queue)}</strong></td>
                <td>${doorText}</td>
                <td>${dateBadge}</td>
                <td style="font-weight: 700; color: #0f172a;">${escapeHtml(truck.truck_number)}</td>
                <td>${escapeHtml(truck.driver_name)}</td>
                <td>${escapeHtml(truck.company || '—')}</td>
                <td>${escapeHtml(truck.load_type)}</td>
                <td>${escapeHtml(truck.destination)}</td>
                <td>
                    <div>${escapeHtml(truck.arrival_time)}</div>
                    ${elapsedBadge}
                </td>
                <td>${priorityHtml}</td>
                <td><span class="badge badge-${truck.status.toLowerCase()}">${escapeHtml(truck.status)}${truck.status === 'Called' && Number(truck.call_count) > 1 ? ` (${truck.call_count}x)` : ''}</span></td>
                <td>${recorderHtml}</td>
                <td><div style="display: flex; gap: 6px; flex-wrap: wrap;">${actionButtons}</div></td>
            </tr>
        `;
    }).join('');

    if (hasCriticalOverdue) {
        checkAndTriggerAlarmSound();
    }
}

// Call Next Truck (Auto door assignment)
async function callNextTruck() {
    try {
        const res = await fetch('/api/trucks/call-next', { method: 'POST' });
        const data = await res.json();

        if (!data.success) {
            alert(data.error || 'Failed to call next truck.');
            return;
        }

        alert(`CALLING TRUCK:\nQueue: ${data.truck.queue}\nPlate: ${data.truck.truck_number}\nAssigned Door: DOOR ${data.truck.loading_door}\nDriver: ${data.truck.driver_name}`);
        loadTodayData();
    } catch (err) {
        alert('Network error: ' + err.message);
    }
}

// Recall / Re-page Truck (Increments call count & announces 3x on TV board)
async function recallTruck(id) {
    try {
        const res = await fetch(`/api/trucks/${id}/recall`, { method: 'POST' });
        const data = await res.json();

        if (!data.success) {
            alert(data.error || 'Failed to recall truck.');
            return;
        }

        const callNum = data.truck.call_count || 1;
        alert(`RECALLING TRUCK (${callNum}x):\nQueue: ${data.truck.queue}\nPlate: ${data.truck.truck_number}\nDoor: DOOR ${data.truck.loading_door || 'BAY'}\nDriver: ${data.truck.driver_name}`);
        loadTodayData();
    } catch (err) {
        alert('Network error: ' + err.message);
    }
}

// Manual Door Selection Modal
function openDoorModal(truckId) {
    selectedTruckForModal = todayTrucks.find(t => t.id === truckId);
    if (!selectedTruckForModal) return;

    document.getElementById('modalTruckInfo').innerHTML = `
        <strong>Queue:</strong> ${escapeHtml(selectedTruckForModal.queue)}<br>
        <strong>Plate:</strong> ${escapeHtml(selectedTruckForModal.truck_number)}<br>
        <strong>Driver:</strong> ${escapeHtml(selectedTruckForModal.driver_name)}<br>
        <strong>Load:</strong> ${escapeHtml(selectedTruckForModal.load_type)}
    `;

    const optionsContainer = document.getElementById('doorOptions');
    let buttonsHtml = '';

    for (let door = 1; door <= 8; door++) {
        const isOccupied = !!activeDoors[door];
        if (isOccupied) {
            buttonsHtml += `
                <button type="button" class="btn btn-outline" disabled style="opacity: 0.5; background: #f1f5f9; cursor: not-allowed;">
                    Door ${door}<br><small>(In Use)</small>
                </button>
            `;
        } else {
            buttonsHtml += `
                <button type="button" class="btn btn-primary" onclick="confirmCallWithDoor(${door})">
                    Door ${door}<br><small>Vacant</small>
                </button>
            `;
        }
    }

    optionsContainer.innerHTML = buttonsHtml;
    document.getElementById('doorModal').classList.add('show');
}

function closeDoorModal() {
    document.getElementById('doorModal').classList.remove('show');
    selectedTruckForModal = null;
}

async function confirmCallWithDoor(door) {
    if (!selectedTruckForModal) return;
    try {
        const res = await fetch(`/api/trucks/${selectedTruckForModal.id}/call`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ door })
        });
        const data = await res.json();
        if (!data.success) {
            alert(data.error || 'Failed to assign door.');
            return;
        }
        closeDoorModal();
        loadTodayData();
    } catch (err) {
        alert('Network error: ' + err.message);
    }
}

// State for action modals
let pendingStartLoadingTruckId = null;
let pendingDepartTruckId = null;
let pendingCancelTruck = null;

// Start Loading Modal Confirmation
function startLoading(id) {
    const truck = todayTrucks.find(t => t.id === id);
    if (!truck) return;

    // Strict validation: Require Warehouse Recorder before starting loading
    if (!truck.warehouse_recorder || !truck.warehouse_recorder.trim()) {
        alert(`⚠️ Warehouse Recorder Required!\n\nPlease assign a Warehouse Recorder first for ${truck.truck_number} (${truck.queue}) before starting loading.`);
        openRecorderModal(id);
        return;
    }

    pendingStartLoadingTruckId = id;

    const details = document.getElementById('startLoadingTruckDetails');
    if (details) {
        details.innerHTML = `
            <div><strong>Queue:</strong> ${escapeHtml(truck.queue)}</div>
            <div><strong>Plate:</strong> ${escapeHtml(truck.truck_number)}</div>
            <div><strong>Driver:</strong> ${escapeHtml(truck.driver_name)}</div>
            <div><strong>Door:</strong> DOOR ${escapeHtml(truck.loading_door || 'N/A')}</div>
            <div><strong>Warehouse Recorder:</strong> <span style="color:#2563eb;font-weight:700;">👷 ${escapeHtml(truck.warehouse_recorder)}</span></div>
            <div><strong>Load:</strong> ${escapeHtml(truck.load_type || '—')}</div>
        `;
    }
    document.getElementById('startLoadingModal').classList.add('show');
}

function closeStartLoadingModal() {
    pendingStartLoadingTruckId = null;
    const modal = document.getElementById('startLoadingModal');
    if (modal) modal.classList.remove('show');
}

async function executeStartLoading() {
    if (!pendingStartLoadingTruckId) return;
    const id = pendingStartLoadingTruckId;
    closeStartLoadingModal();

    try {
        const res = await fetch(`/api/trucks/${id}/start-loading`, { method: 'POST' });
        const data = await res.json();
        if (!data.success) alert(data.error);
        loadTodayData();
    } catch (err) {
        alert('Network error: ' + err.message);
    }
}

// Complete Loading
async function completeLoading(id) {
    try {
        const res = await fetch(`/api/trucks/${id}/complete`, { method: 'POST' });
        const data = await res.json();
        if (!data.success) alert(data.error);
        loadTodayData();
    } catch (err) {
        alert('Network error: ' + err.message);
    }
}

// Depart Plant Caution Modal
function departTruck(id) {
    const truck = todayTrucks.find(t => t.id === id);
    if (!truck) return;

    const user = currentUser || getAuthUser();
    if (user && user.role === 'dispatcher' && !truck.doc_transfer_to_warehouse) {
        alert('Locked: You cannot depart this truck until the SAP team completes "Transfer to Warehouse".');
        return;
    }

    pendingDepartTruckId = id;

    const details = document.getElementById('departTruckDetails');
    if (details) {
        details.innerHTML = `
            <div><strong>Queue:</strong> ${escapeHtml(truck.queue)}</div>
            <div><strong>Plate:</strong> ${escapeHtml(truck.truck_number)}</div>
            <div><strong>Driver:</strong> ${escapeHtml(truck.driver_name)}</div>
            <div><strong>Company:</strong> ${escapeHtml(truck.company || '—')}</div>
            <div><strong>Destination:</strong> ${escapeHtml(truck.destination || '—')}</div>
        `;
    }
    document.getElementById('departModal').classList.add('show');
}

function closeDepartModal() {
    pendingDepartTruckId = null;
    const modal = document.getElementById('departModal');
    if (modal) modal.classList.remove('show');
}

async function executeDepartTruck() {
    if (!pendingDepartTruckId) return;
    const id = pendingDepartTruckId;
    closeDepartModal();

    try {
        const res = await fetch(`/api/trucks/${id}/depart`, { method: 'POST' });
        const data = await res.json();
        if (!data.success) alert(data.error);
        loadTodayData();
    } catch (err) {
        alert('Network error: ' + err.message);
    }
}

// Two-Step Cancellation Modal Flow
function cancelTruck(id) {
    const truck = todayTrucks.find(t => t.id === id);
    if (!truck) return;
    pendingCancelTruck = truck;

    // Reset to Step 1
    document.getElementById('cancelStep1Container').style.display = 'block';
    document.getElementById('cancelStep2Container').style.display = 'none';

    // Show: “Q023 – CCP-4778 – Clarado Baer”
    const truckInfoString = `${escapeHtml(truck.queue)} – ${escapeHtml(truck.truck_number)} – ${escapeHtml(truck.driver_name)}`;
    document.getElementById('cancelTruckDetails').textContent = truckInfoString;

    const reasonInput = document.getElementById('cancelReasonInput');
    if (reasonInput) reasonInput.value = '';
    onCancelReasonChange();

    document.getElementById('cancelModal').classList.add('show');
}

function closeCancelModal() {
    pendingCancelTruck = null;
    const modal = document.getElementById('cancelModal');
    if (modal) modal.classList.remove('show');
}

function proceedToCancelStep2() {
    if (!pendingCancelTruck) return;
    document.getElementById('cancelStep1Container').style.display = 'none';
    document.getElementById('cancelStep2Container').style.display = 'block';

    const truck = pendingCancelTruck;
    document.getElementById('cancelStep2TruckSummary').innerHTML = `
        Cancelling truck: <strong>${escapeHtml(truck.queue)}</strong> (${escapeHtml(truck.truck_number)} – ${escapeHtml(truck.driver_name)})
    `;

    const input = document.getElementById('cancelReasonInput');
    if (input) {
        input.focus();
    }
    onCancelReasonChange();
}

function backToCancelStep1() {
    document.getElementById('cancelStep2Container').style.display = 'none';
    document.getElementById('cancelStep1Container').style.display = 'block';
}

function onCancelReasonChange() {
    const input = document.getElementById('cancelReasonInput');
    const btn = document.getElementById('btnConfirmCancel');
    const msg = document.getElementById('cancelReasonValidationMsg');
    if (!input || !btn) return;

    const val = input.value.trim();
    const isValid = val.length >= 3;

    if (isValid) {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        if (msg) {
            msg.textContent = '✓ Ready to confirm cancellation.';
            msg.style.color = '#16a34a';
        }
    } else {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
        if (msg) {
            msg.textContent = `At least 3 characters required (currently ${val.length}/3).`;
            msg.style.color = '#64748b';
        }
    }
}

async function executeConfirmCancel() {
    if (!pendingCancelTruck) return;
    const input = document.getElementById('cancelReasonInput');
    const reason = (input ? input.value : '').trim();
    if (reason.length < 3) return;

    const id = pendingCancelTruck.id;
    closeCancelModal();

    try {
        const res = await fetch(`/api/trucks/${id}/cancel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason })
        });
        const data = await res.json();
        if (!data.success) alert(data.error);
        loadTodayData();
    } catch (err) {
        alert('Network error: ' + err.message);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Initial Load
loadTodayData();

// =============================================================
// SAP OTC DOCUMENTATION FLOW
// Visible only to sapanalyst role in Dispatcher Station
// =============================================================

const SAP_ANALYSTS = [
    'Louell Santos', 'Marlo Romasanta', 'Aron Detiquiz', 'Julius San Jose',
    'Grant Gener', 'Gerwin Cristobal', 'Erick Gulinao', 'Hernan Santos'
];

// Build SAP action buttons for a completed/loading truck (sapanalyst role)
function buildSapActionButtons(truck) {
    const steps = [];

    // Step 1: Document Received (unlocked - directly clickable with verification caution)
    if (!truck.doc_received_from_warehouse) {
        steps.push(`<button class="btn btn-primary sap-btn" onclick="openSapReceivedModal(${truck.id})" title="Click to verify physical receipt of documents from warehouse">📦 Document Received</button>`);
    } else {
        steps.push(`<span class="sap-done-badge" title="Received from Warehouse at ${escapeHtml(truck.doc_received_from_warehouse)}">📦 Doc Received ✓</span>`);
    }

    // Step 2: SAP Analyst / OTC
    if (!truck.sap_analyst) {
        steps.push(`<button class="btn btn-primary sap-btn" onclick="openSapAnalystModal(${truck.id})" title="Assign SAP OTC Analyst handling documentation">👤 Set Analyst</button>`);
    } else {
        steps.push(`<span class="sap-done-badge" title="Assigned Analyst: ${escapeHtml(truck.sap_analyst)}">👤 ${escapeHtml(truck.sap_analyst.split(' ')[0])} ✓</span>`);
    }

    // Step 3: Document Start
    if (!truck.sap_doc_start) {
        steps.push(`<button class="btn btn-warning sap-btn" style="background:#d97706;color:#fff;" onclick="openSapDocStartModal(${truck.id})" title="Record documentation start time">▶ Document Start</button>`);
    } else {
        steps.push(`<span class="sap-done-badge" title="Documentation started at ${escapeHtml(truck.sap_doc_start)}">▶ Doc Started ✓</span>`);
    }

    // Step 4: Document End
    if (truck.sap_doc_start && !truck.sap_doc_end) {
        steps.push(`<button class="btn btn-success sap-btn" onclick="openSapDocEndModal(${truck.id})" title="Record documentation completion time">✅ Document End</button>`);
    } else if (truck.sap_doc_end) {
        steps.push(`<span class="sap-done-badge" title="Documentation ended at ${escapeHtml(truck.sap_doc_end)}">✅ Doc Ended ✓</span>`);
    }

    // Step 5: Doc Transfer to Warehouse
    if (!truck.doc_transfer_to_warehouse) {
        if (truck.sap_doc_end) {
            steps.push(`<button class="btn btn-primary sap-btn" onclick="openSapTransferWarehouseModal(${truck.id})" title="Transfer processed documents back to Warehouse">🏭 Transfer to WH</button>`);
        } else {
            steps.push(`<button class="btn btn-primary sap-btn" style="opacity:0.45;cursor:not-allowed;background:#94a3b8;border-color:#94a3b8;" disabled title="Complete Document End first before returning to Warehouse">🏭 Transfer</button>`);
        }
    } else {
        steps.push(`<span class="sap-done-badge" title="Transferred to Warehouse at ${escapeHtml(truck.doc_transfer_to_warehouse)}">🏭 Transferred ✓</span>`);
    }

    return `<div class="sap-actions-wrap">${steps.join('')}</div>`;
}

// Admin combined view: Dispatcher + SAP OTC buttons for Completed trucks
function buildAdminCompletedButtons(truck) {
    const steps = [];

    // Dispatcher: Doc Transfer to SAP
    if (!truck.doc_transfer_to_sap) {
        steps.push(`<button class="btn btn-primary sap-btn" onclick="openSapTransferToSapModal(${truck.id})" title="Transfer documents to SAP OTC">📄 Transfer to SAP</button>`);
    } else {
        steps.push(`<span class="sap-done-badge">📄 SAP ✓</span>`);
    }

    // SAP: Document Received (unlocked - directly clickable with verification caution)
    if (!truck.doc_received_from_warehouse) {
        steps.push(`<button class="btn btn-primary sap-btn" onclick="openSapReceivedModal(${truck.id})" title="Click to verify physical receipt of documents from warehouse">📦 Document Received</button>`);
    } else {
        steps.push(`<span class="sap-done-badge">📦 Doc Received ✓</span>`);
    }

    // SAP: Analyst
    if (!truck.sap_analyst) {
        steps.push(`<button class="btn btn-primary sap-btn" onclick="openSapAnalystModal(${truck.id})" title="Assign SAP OTC Analyst handling documentation">👤 Set Analyst</button>`);
    } else {
        steps.push(`<span class="sap-done-badge">👤 ${escapeHtml(truck.sap_analyst.split(' ')[0])} ✓</span>`);
    }

    // SAP: Document Start
    if (!truck.sap_doc_start) {
        steps.push(`<button class="btn btn-warning sap-btn" style="background:#d97706;color:#fff;" onclick="openSapDocStartModal(${truck.id})" title="Record documentation start time">▶ Document Start</button>`);
    } else {
        steps.push(`<span class="sap-done-badge">▶ Doc Started ✓</span>`);
    }

    // SAP: Document End
    if (truck.sap_doc_start && !truck.sap_doc_end) {
        steps.push(`<button class="btn btn-success sap-btn" onclick="openSapDocEndModal(${truck.id})" title="Record documentation completion time">✅ Document End</button>`);
    } else if (truck.sap_doc_end) {
        steps.push(`<span class="sap-done-badge">✅ Doc Ended ✓</span>`);
    }

    // SAP: Transfer to Warehouse
    if (!truck.doc_transfer_to_warehouse) {
        steps.push(`<button class="btn btn-primary sap-btn" onclick="openSapTransferWarehouseModal(${truck.id})" title="Transfer processed documents back to Warehouse">🏭 Transfer</button>`);
    } else {
        steps.push(`<span class="sap-done-badge">🏭 Transferred ✓</span>`);
    }

    // Dispatcher / Admin: Depart Plant
    if (truck.doc_transfer_to_warehouse) {
        steps.push(`<button class="btn btn-secondary sap-btn" style="background:#059669;border-color:#059669;color:#fff;font-weight:700;" onclick="departTruck(${truck.id})" title="Transfer to Warehouse completed — Ready for Plant Departure">🚛 Depart Plant</button>`);
    } else {
        steps.push(`<button class="btn btn-secondary sap-btn" style="background:#475569;border-color:#475569;color:#cbd5e1;opacity:0.85;" onclick="departTruck(${truck.id})" title="Admin Override: Documents pending return from SAP team">🔒 Depart Plant (Override)</button>`);
    }

    return `<div class="sap-actions-wrap">${steps.join('')}</div>`;
}

// --- Shared helper: get truck from cache ---
function getTruckFromCache(id) {
    const numId = Number(id);
    return todayTrucks.find(t => t.id === numId || t.id === id) || null;
}

function truckLabel(truck) {
    return truck ? `${escapeHtml(truck.queue)} – ${escapeHtml(truck.truck_number)} – ${escapeHtml(truck.driver_name)}` : '';
}

// ---- SAP: Doc Received from Warehouse ----
let pendingSapReceivedId = null;
function openSapReceivedModal(id) {
    pendingSapReceivedId = id;
    const truck = getTruckFromCache(id);
    if (!truck) return;
    const infoEl = document.getElementById('sapReceivedTruckInfo');
    if (infoEl) {
        infoEl.innerHTML = `
            <div style="font-size: 15px; font-weight: 800; color: #1e40af;">${escapeHtml(truck.queue)} &bull; ${escapeHtml(truck.truck_number)}</div>
            <div style="font-size: 12.5px; font-weight: 600; color: #475569; margin-top: 4px;">Driver: ${escapeHtml(truck.driver_name)} &bull; Hauler: ${escapeHtml(truck.company || '—')}</div>
            <div style="font-size: 12px; color: #64748b; margin-top: 2px;">Load: ${escapeHtml(truck.load_type)} &rarr; ${escapeHtml(truck.destination)}</div>
        `;
    }
    const modal = document.getElementById('sapReceivedModal');
    if (modal) modal.classList.add('show');
}
function closeSapReceivedModal() {
    pendingSapReceivedId = null;
    document.getElementById('sapReceivedModal').classList.remove('show');
}
async function executeSapReceived() {
    if (!pendingSapReceivedId) return;
    const id = pendingSapReceivedId;
    closeSapReceivedModal();
    await callSapFlow(id, { doc_received_from_warehouse: getCurrentTimeString() });
}

// ---- SAP: Analyst Selector ----
let pendingSapAnalystId = null;
function openSapAnalystModal(id) {
    pendingSapAnalystId = id;
    const truck = getTruckFromCache(id);
    document.getElementById('sapAnalystTruckInfo').textContent = truckLabel(truck);
    const btnContainer = document.getElementById('sapAnalystButtons');
    btnContainer.innerHTML = SAP_ANALYSTS.map(name =>
        `<button class="btn btn-outline sap-analyst-name-btn" style="font-size:13px;padding:10px 8px;border-color:#1e40af;color:#1e40af;" onclick="executeSapAnalyst('${name.replace(/'/g, "\\'")}')">👤 ${name}</button>`
    ).join('');
    document.getElementById('sapAnalystModal').classList.add('show');
}
function closeSapAnalystModal() {
    pendingSapAnalystId = null;
    document.getElementById('sapAnalystModal').classList.remove('show');
}
async function executeSapAnalyst(analystName) {
    if (!pendingSapAnalystId) return;
    const id = pendingSapAnalystId;
    closeSapAnalystModal();
    await callSapFlow(id, { sap_analyst: analystName });
}

// ---- SAP: Doc Start ----
let pendingSapDocStartId = null;
function openSapDocStartModal(id) {
    pendingSapDocStartId = id;
    const truck = getTruckFromCache(id);
    document.getElementById('sapDocStartTruckInfo').textContent = truckLabel(truck);
    document.getElementById('sapDocStartModal').classList.add('show');
}
function closeSapDocStartModal() {
    pendingSapDocStartId = null;
    document.getElementById('sapDocStartModal').classList.remove('show');
}
async function executeSapDocStart() {
    if (!pendingSapDocStartId) return;
    const id = pendingSapDocStartId;
    closeSapDocStartModal();
    await callSapFlow(id, { sap_doc_start: getCurrentTimeString() });
}

// ---- SAP: Doc End ----
let pendingSapDocEndId = null;
function openSapDocEndModal(id) {
    pendingSapDocEndId = id;
    const truck = getTruckFromCache(id);
    document.getElementById('sapDocEndTruckInfo').textContent = truckLabel(truck);
    document.getElementById('sapDocEndStep2Info').textContent = truckLabel(truck);
    document.getElementById('sapRemarksInput').value = '';
    document.getElementById('sapRemarksConfirmBtn').disabled = true;
    document.getElementById('sapDocEndStep1').style.display = '';
    document.getElementById('sapDocEndStep2').style.display = 'none';
    document.getElementById('sapDocEndModal').classList.add('show');
}
function closeSapDocEndModal() {
    pendingSapDocEndId = null;
    document.getElementById('sapDocEndModal').classList.remove('show');
}
function sapDocEndAddRemarks() {
    document.getElementById('sapDocEndStep1').style.display = 'none';
    document.getElementById('sapDocEndStep2').style.display = '';
}
function sapDocEndBackToStep1() {
    document.getElementById('sapDocEndStep1').style.display = '';
    document.getElementById('sapDocEndStep2').style.display = 'none';
}
function checkSapRemarksInput() {
    const val = document.getElementById('sapRemarksInput').value.trim();
    document.getElementById('sapRemarksConfirmBtn').disabled = val.length < 3;
}
async function sapDocEndSkipRemarks() {
    if (!pendingSapDocEndId) return;
    const id = pendingSapDocEndId;
    closeSapDocEndModal();
    await callSapFlow(id, { sap_doc_end: getCurrentTimeString() });
}
async function executeSapDocEnd(withRemarks) {
    if (!pendingSapDocEndId) return;
    const id = pendingSapDocEndId;
    const remarks = withRemarks ? document.getElementById('sapRemarksInput').value.trim() : '';
    closeSapDocEndModal();
    const payload = { sap_doc_end: getCurrentTimeString() };
    if (remarks) payload.remarks = remarks;
    await callSapFlow(id, payload);
}

// ---- SAP: Doc Transfer TO SAP (Dispatcher / Admin action) ----
let pendingSapTransferToSapId = null;
function openSapTransferToSapModal(id) {
    pendingSapTransferToSapId = id;
    const truck = getTruckFromCache(id);
    document.getElementById('sapTransferToSapTruckInfo').textContent = truckLabel(truck);
    document.getElementById('sapTransferToSapModal').classList.add('show');
}
function closeSapTransferToSapModal() {
    pendingSapTransferToSapId = null;
    document.getElementById('sapTransferToSapModal').classList.remove('show');
}
async function executeSapTransferToSap() {
    if (!pendingSapTransferToSapId) return;
    const id = pendingSapTransferToSapId;
    closeSapTransferToSapModal();
    await callSapFlow(id, { doc_transfer_to_sap: getCurrentTimeString() });
}

// ---- SAP: Transfer to Warehouse ----
let pendingSapTransferWarehouseId = null;
function openSapTransferWarehouseModal(id) {
    pendingSapTransferWarehouseId = id;
    const truck = getTruckFromCache(id);
    document.getElementById('sapTransferWarehouseTruckInfo').textContent = truckLabel(truck);
    document.getElementById('sapTransferWarehouseModal').classList.add('show');
}
function closeSapTransferWarehouseModal() {
    pendingSapTransferWarehouseId = null;
    document.getElementById('sapTransferWarehouseModal').classList.remove('show');
}
async function executeSapTransferWarehouse() {
    if (!pendingSapTransferWarehouseId) return;
    const id = pendingSapTransferWarehouseId;
    closeSapTransferWarehouseModal();
    await callSapFlow(id, { doc_transfer_to_warehouse: getCurrentTimeString() });
}

// ---- Core API caller for SAP flow ----
async function callSapFlow(id, fields) {
    try {
        const token = localStorage.getItem('mhc_token');
        const res = await fetch(`/api/trucks/${id}/sap-flow`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(fields)
        });
        const data = await res.json();
        if (!data.success) alert('SAP update error: ' + data.error);
        loadTodayData();
    } catch (err) {
        alert('Network error: ' + err.message);
    }
}

// ---- Helper: current PHT time string ----
function getCurrentTimeString() {
    return new Intl.DateTimeFormat('en-PH', {
        timeZone: 'Asia/Manila',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: true
    }).format(new Date());
}

// =============================================================
// WAREHOUSE RECORDER MODAL & ASSIGNMENT
// =============================================================
let pendingRecorderTruckId = null;

function openRecorderModal(id) {
    const truck = todayTrucks.find(t => t.id === id);
    if (!truck) return;

    if (['Completed', 'Departed', 'Cancelled'].includes(truck.status)) {
        alert(`Cannot edit Warehouse Recorder: Truck ${truck.truck_number} (${truck.queue}) is already ${truck.status}.`);
        return;
    }

    pendingRecorderTruckId = id;

    const summaryEl = document.getElementById('modalRecorderTruckInfo');
    if (summaryEl) {
        summaryEl.innerHTML = `
            <div><strong>Queue:</strong> ${escapeHtml(truck.queue)} &bull; <strong>Plate:</strong> ${escapeHtml(truck.truck_number)}</div>
            <div><strong>Driver:</strong> ${escapeHtml(truck.driver_name)}</div>
        `;
    }

    const input = document.getElementById('recorderNameInput');
    if (input) {
        input.value = truck.warehouse_recorder || '';
    }

    const modal = document.getElementById('recorderModal');
    if (modal) {
        modal.classList.add('show');
    }
    setTimeout(() => { if (input) input.focus(); }, 150);
}

function closeRecorderModal() {
    pendingRecorderTruckId = null;
    const modal = document.getElementById('recorderModal');
    if (modal) {
        modal.classList.remove('show');
    }
}

async function executeSaveRecorder() {
    if (!pendingRecorderTruckId) return;
    const input = document.getElementById('recorderNameInput');
    const val = input ? input.value.trim() : '';

    if (!val) {
        alert('Please enter the name of the Warehouse Recorder.');
        return;
    }

    const id = pendingRecorderTruckId;
    closeRecorderModal();

    try {
        const token = localStorage.getItem('mhc_token');
        const res = await fetch(`/api/trucks/${id}/warehouse-recorder`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ warehouse_recorder: val })
        });
        const data = await res.json();
        if (!data.success) {
            alert('Error updating Warehouse Recorder: ' + data.error);
        }
        loadTodayData();
    } catch (err) {
        alert('Network error: ' + err.message);
    }
}

// Enter key shortcut in recorder input
document.addEventListener('DOMContentLoaded', () => {
    const recInput = document.getElementById('recorderNameInput');
    if (recInput) {
        recInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                executeSaveRecorder();
            }
        });
    }
});


// =============================================================
// QUEUE SEQUENCE RESET (SAPPHIRE ENTERPRISE BUTTON & MODAL)
// =============================================================

function getCurrentStaffUser() {
    return window.currentUser || getAuthUser();
}

// Main handler for "Reset Queue Sequence" button
async function openResetQueueModal() {
    const user = getCurrentStaffUser();
    const role = user ? user.role : null;

    if (role === 'admin') {
        // Admin is authorized to execute reset
        await openAdminResetQueueModal();
    } else {
        // Non-admin (Dispatcher 1, Dispatcher 2, Warehouse, etc.) sees restriction dialog
        openRestrictedResetQueueModal(user);
    }
}

async function openAdminResetQueueModal() {
    try {
        const token = getAuthToken();
        const res = await fetch('/api/queue/status', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();
        const curEl = document.getElementById('modalCurrentSeq');
        if (curEl) {
            curEl.textContent = data.current_queue || 'Q000';
        }
    } catch (e) {
        console.warn('Queue status query failed:', e);
    }

    const modal = document.getElementById('resetQueueModal');
    if (modal) modal.classList.add('show');
}

function closeResetQueueModal() {
    const modal = document.getElementById('resetQueueModal');
    if (modal) modal.classList.remove('show');
}

function openRestrictedResetQueueModal(user) {
    const roleLabel = document.getElementById('lblCurrentStaffRole');
    if (roleLabel) {
        if (user) {
            roleLabel.textContent = (user.name || user.username) + ' (' + (user.role || '').toUpperCase() + ')';
        } else {
            roleLabel.textContent = 'Dispatcher';
        }
    }

    const notice = document.getElementById('requestSuccessNotice');
    if (notice) notice.style.display = 'none';

    const btn = document.getElementById('btnRequestAdminReset');
    if (btn) {
        btn.disabled = false;
        btn.textContent = '🔔 Notify Admin to Reset';
    }

    const modal = document.getElementById('resetQueueRestrictedModal');
    if (modal) modal.classList.add('show');
}

function closeResetQueueRestrictedModal() {
    const modal = document.getElementById('resetQueueRestrictedModal');
    if (modal) modal.classList.remove('show');
}

// Non-admin action: Send request to Admin
async function executeRequestResetQueue() {
    const btn = document.getElementById('btnRequestAdminReset');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Transmitting...';
    }

    try {
        const token = getAuthToken();
        const res = await fetch('/api/queue/request-reset', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            }
        });
        const data = await res.json();
        if (data.success) {
            const notice = document.getElementById('requestSuccessNotice');
            if (notice) notice.style.display = 'block';
            if (btn) btn.textContent = '✓ Admin Alerted!';
        } else {
            alert('Failed to send request: ' + (data.error || 'Unknown error'));
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🔔 Notify Admin to Reset';
            }
        }
    } catch (err) {
        alert('Network error: ' + err.message);
        if (btn) {
            btn.disabled = false;
            btn.textContent = '🔔 Notify Admin to Reset';
        }
    }
}

// Admin execution: Perform Reset
async function executeResetQueue() {
    closeResetQueueModal();
    try {
        const token = getAuthToken();
        const res = await fetch('/api/queue/reset', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            }
        });
        const data = await res.json();
        if (data.success) {
            alert('✓ Queue Sequence Reset to Q001 Successfully!\n\nThe next registered truck will be assigned Q001.\nAll historical logs and reports remain safe.');
            loadTodayData();
        } else {
            alert('Failed to reset queue: ' + (data.error || 'Unknown error'));
        }
    } catch (err) {
        alert('Network error: ' + err.message);
    }
}

// Floating Toast helpers for Admin
function showAdminResetToast(data) {
    const banner = document.getElementById('adminToastBanner');
    const msg = document.getElementById('adminToastMessage');
    if (!banner || !msg) return;

    const requester = escapeHtml(data.requesterName || data.requesterUsername || 'Dispatcher');
    const time = escapeHtml(data.requestedAtDisplay || 'just now');

    msg.innerHTML = 'Dispatcher <strong>' + requester + '</strong> requested a manual queue sequence reset to <strong>Q001</strong> at ' + time + '.';
    banner.style.display = 'block';

    playNotificationBeep();
}

function dismissAdminToast() {
    const banner = document.getElementById('adminToastBanner');
    if (banner) banner.style.display = 'none';
}

function openAdminModalFromToast() {
    dismissAdminToast();
    openAdminResetQueueModal();
}

function playNotificationBeep() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.35);
    } catch (e) {}
}

// Socket listener for real-time queue sequence reset & admin alerts
if (typeof socket !== 'undefined') {
    socket.on('queue_sequence_reset', () => {
        loadTodayData();
    });

    socket.on('queue_reset_requested', (data) => {
        const user = getCurrentStaffUser();
        if (user && user.role === 'admin') {
            showAdminResetToast(data);
        }
    });
}


// =============================================================
// ADMIN PRIORITY CATEGORY RECLASSIFICATION
// =============================================================

let selectedTruckForPriority = null;

function openEditPriorityModal(truckId) {
    selectedTruckForPriority = todayTrucks.find(t => t.id === truckId);
    if (!selectedTruckForPriority) return;

    const truckIdInput = document.getElementById('editPriorityTruckId');
    if (truckIdInput) truckIdInput.value = selectedTruckForPriority.id;

    const summaryEl = document.getElementById('priorityTruckSummary');
    if (summaryEl) {
        summaryEl.innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div><strong>Queue:</strong> ${escapeHtml(selectedTruckForPriority.queue || '—')}</div>
                <div><strong>Plate Number:</strong> ${escapeHtml(selectedTruckForPriority.truck_number || '—')}</div>
                <div><strong>Driver:</strong> ${escapeHtml(selectedTruckForPriority.driver_name || '—')}</div>
                <div><strong>Product Load:</strong> ${escapeHtml(selectedTruckForPriority.load_type || '—')}</div>
            </div>
            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed #cbd5e1;">
                <strong>Current Priority Category:</strong>
                <span class="badge badge-waiting" style="margin-left: 6px;">${escapeHtml(selectedTruckForPriority.priority || 'Standard')}</span>
            </div>
        `;
    }

    const selectEl = document.getElementById('editPrioritySelect');
    if (selectEl) {
        const curVal = selectedTruckForPriority.priority || 'Standard';
        selectEl.value = curVal;
        const exists = Array.from(selectEl.options).some(opt => opt.value === curVal);
        if (!exists && curVal) {
            const newOpt = document.createElement('option');
            newOpt.value = curVal;
            newOpt.textContent = curVal;
            selectEl.appendChild(newOpt);
            selectEl.value = curVal;
        }
    }

    const modal = document.getElementById('editPriorityModal');
    if (modal) modal.classList.add('show');
}

function closeEditPriorityModal() {
    const modal = document.getElementById('editPriorityModal');
    if (modal) modal.classList.remove('show');
    selectedTruckForPriority = null;
}

async function executeSavePriority() {
    const truckIdInput = document.getElementById('editPriorityTruckId');
    const truckId = truckIdInput ? truckIdInput.value : null;
    const selectEl = document.getElementById('editPrioritySelect');
    const newPriority = selectEl ? selectEl.value : '';

    if (!truckId || !newPriority) {
        alert('Please select a valid Priority Category.');
        return;
    }

    const btn = document.getElementById('btnSavePriority');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Saving...';
    }

    try {
        const token = getAuthToken();
        const res = await fetch('/api/trucks/' + encodeURIComponent(truckId) + '/priority', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ priority: newPriority })
        });

        const data = await res.json();
        if (data.success) {
            closeEditPriorityModal();
            loadTodayData();
        } else {
            alert('Failed to update priority: ' + (data.error || 'Unknown error'));
        }
    } catch (err) {
        alert('Network error: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '✓ Confirm & Update Priority';
        }
    }
}

// =============================================================
// HIGH-PITCH STACCATO SOUND ALARM (950Hz 8-PULSE) & QUICK DEPART
// =============================================================

function isCurrentUserAdmin() {
    const user = window.currentUser || getAuthUser();
    return user && user.role === 'admin';
}

let isAlarmMuted = localStorage.getItem('mhc_sound_alarm_muted') === 'true';
let lastAlarmPlayTime = 0;

function updateAlarmToggleButton() {
    const icon = document.getElementById('soundAlarmIcon');
    const text = document.getElementById('soundAlarmText');
    const btn = document.getElementById('btnSoundAlarmToggle');
    if (!icon || !text || !btn) return;

    const isAdmin = isCurrentUserAdmin();

    if (!isAdmin) {
        // Dispatcher 1 & Dispatcher 2: ALARM CANNOT BE TURNED OFF (MANDATORY)
        isAlarmMuted = false;
        icon.textContent = '🔔';
        text.textContent = 'Alarm: Active (Mandatory)';
        btn.style.color = '#15803d';
        btn.style.borderColor = '#86efac';
        btn.style.background = '#f0fdf4';
        btn.style.cursor = 'default';
        btn.style.pointerEvents = 'none'; // Disables click toggle for non-admin
        btn.title = 'Overdue Alert Alarm is mandatory for dispatchers';
        return;
    }

    // Admin User: Can toggle mute if doing administrative reviews
    btn.style.cursor = 'pointer';
    btn.style.pointerEvents = 'auto';
    btn.title = 'Admin: Toggle Stale Truck Overdue Sound Alarm';

    if (isAlarmMuted) {
        icon.textContent = '🔇';
        text.textContent = 'Alarm: Muted';
        btn.style.color = '#ef4444';
        btn.style.borderColor = '#f87171';
        btn.style.background = '#fef2f2';
    } else {
        icon.textContent = '🔔';
        text.textContent = 'Alarm: ON';
        btn.style.color = '#15803d';
        btn.style.borderColor = '#86efac';
        btn.style.background = '#f0fdf4';
    }
}

function toggleSoundAlarm() {
    // Only Admin is authorized to mute the sound alarm
    if (!isCurrentUserAdmin()) {
        return;
    }

    isAlarmMuted = !isAlarmMuted;
    localStorage.setItem('mhc_sound_alarm_muted', isAlarmMuted ? 'true' : 'false');
    updateAlarmToggleButton();
    if (!isAlarmMuted) {
        playStaccatoAlarm();
    }
}

// ⚡ Sound 2: High-Pitch Staccato Pulses (8 rapid beeps at 950Hz)
function playStaccatoAlarm() {
    // Dispatchers can NEVER mute the alarm
    if (!isCurrentUserAdmin()) {
        isAlarmMuted = false;
    } else if (isAlarmMuted) {
        return;
    }

    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const now = ctx.currentTime;
        const beepTimes = [0, 0.12, 0.24, 0.36, 0.6, 0.72, 0.84, 0.96];

        beepTimes.forEach(t => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.type = 'square';
            osc.frequency.setValueAtTime(950, now + t);

            gain.gain.setValueAtTime(0.2, now + t);
            gain.gain.exponentialRampToValueAtTime(0.001, now + t + 0.08);

            osc.start(now + t);
            osc.stop(now + t + 0.08);
        });
    } catch (e) {
        console.warn('Alarm audio error:', e);
    }
}

function checkAndTriggerAlarmSound() {
    const now = Date.now();
    // Sound alarm once every 3 minutes if critical overdue trucks are present
    if (!isAlarmMuted && (now - lastAlarmPlayTime > 3 * 60 * 1000)) {
        lastAlarmPlayTime = now;
        playStaccatoAlarm();
    }
}

// Initial button state sync on page load
document.addEventListener('DOMContentLoaded', () => {
    updateAlarmToggleButton();
});

// Periodic alarm check every 60 seconds
setInterval(() => {
    const hasCritical = (todayTrucks || []).some(t => {
        if (t.status === 'Waiting' && (t.arrival_timestamp || t.created_at)) {
            const elapsed = (Date.now() - new Date(t.arrival_timestamp || t.created_at).getTime()) / (60 * 1000);
            return elapsed >= 60;
        }
        return false;
    });

    if (hasCritical) {
        checkAndTriggerAlarmSound();
    }
}, 60000);

// Quick Depart Modal Handlers
let selectedTruckForQuickDepart = null;

function openQuickDepartModal(truckId) {
    selectedTruckForQuickDepart = todayTrucks.find(t => t.id === truckId);
    if (!selectedTruckForQuickDepart) return;

    const ts = selectedTruckForQuickDepart.arrival_timestamp || selectedTruckForQuickDepart.created_at;
    const elapsedMins = ts ? (Date.now() - new Date(ts).getTime()) / (60 * 1000) : 0;
    if (elapsedMins < 12 * 60) {
        alert('Quick Depart is strictly restricted to trucks that have been in the queue for more than 12 hours.');
        return;
    }

    const truckIdInput = document.getElementById('quickDepartTruckId');
    if (truckIdInput) truckIdInput.value = selectedTruckForQuickDepart.id;

    const summaryEl = document.getElementById('quickDepartTruckSummary');
    if (summaryEl) {
        const ts = selectedTruckForQuickDepart.arrival_timestamp || selectedTruckForQuickDepart.created_at;
        const elapsedMins = ts ? Math.round((Date.now() - new Date(ts).getTime()) / (60 * 1000)) : 0;
        const elapsedStr = elapsedMins >= 60 ? (elapsedMins / 60).toFixed(1) + ' hours' : elapsedMins + ' mins';

        summaryEl.innerHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div><strong>Queue:</strong> <span style="color:#b91c1c; font-weight:800;">${escapeHtml(selectedTruckForQuickDepart.queue)}</span></div>
                <div><strong>Plate Number:</strong> <strong>${escapeHtml(selectedTruckForQuickDepart.truck_number)}</strong></div>
                <div><strong>Driver Name:</strong> ${escapeHtml(selectedTruckForQuickDepart.driver_name)}</div>
                <div><strong>Hauler / Co:</strong> ${escapeHtml(selectedTruckForQuickDepart.company || '—')}</div>
                <div><strong>Product Load:</strong> ${escapeHtml(selectedTruckForQuickDepart.load_type)}</div>
                <div><strong>Gate Arrival:</strong> ${escapeHtml(selectedTruckForQuickDepart.arrival_time)}</div>
            </div>
            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed #cbd5e1; font-weight:700; color:#b91c1c;">
                Elapsed Wait Duration: ~${elapsedStr} (Stale Physical Exit)
            </div>
        `;
    }

    const modal = document.getElementById('quickDepartModal');
    if (modal) modal.classList.add('show');
}

function closeQuickDepartModal() {
    const modal = document.getElementById('quickDepartModal');
    if (modal) modal.classList.remove('show');
    selectedTruckForQuickDepart = null;
}

async function executeQuickDepart() {
    const truckIdInput = document.getElementById('quickDepartTruckId');
    const truckId = truckIdInput ? truckIdInput.value : null;
    const reasonSelect = document.getElementById('quickDepartReason');
    const reason = reasonSelect ? reasonSelect.value : '';

    if (!truckId) return;

    const btn = document.getElementById('btnConfirmQuickDepart');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Clearing...';
    }

    try {
        const token = getAuthToken();
        const res = await fetch('/api/trucks/' + encodeURIComponent(truckId) + '/quick-depart', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ reason: reason })
        });

        const data = await res.json();
        if (data.success) {
            closeQuickDepartModal();
            loadTodayData();
        } else {
            alert('Failed to Quick Depart: ' + (data.error || 'Unknown error'));
        }
    } catch (err) {
        alert('Network error: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '⚡ Confirm Quick Depart & Archive Record';
        }
    }
}
