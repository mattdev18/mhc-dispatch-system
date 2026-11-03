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

        if (truck.status === 'Waiting') {
            actionButtons = `
                <button class="btn btn-primary" style="font-size: 11px; padding: 6px 10px;" onclick="openDoorModal(${truck.id})">
                    📢 Call &amp; Door
                </button>
                <button class="btn btn-danger" style="font-size: 11px; padding: 6px 10px;" onclick="cancelTruck(${truck.id})">
                    Cancel
                </button>
            `;
        } else if (truck.status === 'Called') {
            const callCount = Number(truck.call_count) || 1;
            actionButtons = `
                <button class="btn btn-primary" style="font-size: 11px; padding: 6px 10px;" onclick="recallTruck(${truck.id})" title="Play 3x Airport Announcement again">
                    📢 Recall (${callCount}x)
                </button>
                <button class="btn btn-warning" style="font-size: 11px; padding: 6px 10px;" onclick="startLoading(${truck.id})">
                    ▶ Start Loading
                </button>
                <button class="btn btn-danger" style="font-size: 11px; padding: 6px 10px;" onclick="cancelTruck(${truck.id})">
                    Cancel
                </button>
            `;
        } else if (truck.status === 'Loading') {
            actionButtons = `
                <button class="btn btn-success" style="font-size: 11px; padding: 6px 10px;" onclick="completeLoading(${truck.id})">
                    ✓ Complete
                </button>
            `;
        } else if (truck.status === 'Completed') {
            actionButtons = `
                <button class="btn btn-secondary" style="font-size: 11px; padding: 6px 10px;" onclick="departTruck(${truck.id})">
                    🚛 Depart Plant
                </button>
            `;
        } else {
            actionButtons = `<span style="color: #94a3b8; font-size: 12px;">Finished</span>`;
        }

        const doorText = truck.loading_door 
            ? `<span class="badge-door">DOOR ${escapeHtml(truck.loading_door)}</span>`
            : `<span style="color: #94a3b8;">—</span>`;

        const isToday = (truck.date === todayStr);
        const dateBadge = isToday
            ? `<span style="display: inline-block; font-size: 11px; padding: 2px 7px; background: #dcfce7; color: #166534; font-weight: 700; border-radius: 4px;">Today</span>`
            : `<span style="display: inline-block; font-size: 11px; padding: 2px 7px; background: #f1f5f9; color: #475569; font-weight: 600; border-radius: 4px;">${escapeHtml(truck.date || '—')}</span>`;

        return `
            <tr>
                <td><strong>${escapeHtml(truck.queue)}</strong></td>
                <td>${doorText}</td>
                <td>${dateBadge}</td>
                <td style="font-weight: 700; color: #0f172a;">${escapeHtml(truck.truck_number)}</td>
                <td>${escapeHtml(truck.driver_name)}</td>
                <td>${escapeHtml(truck.company || '—')}</td>
                <td>${escapeHtml(truck.load_type)}</td>
                <td>${escapeHtml(truck.destination)}</td>
                <td>${escapeHtml(truck.arrival_time)}</td>
                <td><span class="badge badge-waiting">${escapeHtml(truck.priority)}</span></td>
                <td><span class="badge badge-${truck.status.toLowerCase()}">${escapeHtml(truck.status)}${truck.status === 'Called' && Number(truck.call_count) > 1 ? ` (${truck.call_count}x)` : ''}</span></td>
                <td><div style="display: flex; gap: 6px; flex-wrap: wrap;">${actionButtons}</div></td>
            </tr>
        `;
    }).join('');
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
    pendingStartLoadingTruckId = id;

    const details = document.getElementById('startLoadingTruckDetails');
    if (details) {
        details.innerHTML = `
            <div><strong>Queue:</strong> ${escapeHtml(truck.queue)}</div>
            <div><strong>Plate:</strong> ${escapeHtml(truck.truck_number)}</div>
            <div><strong>Driver:</strong> ${escapeHtml(truck.driver_name)}</div>
            <div><strong>Door:</strong> DOOR ${escapeHtml(truck.loading_door || 'N/A')}</div>
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
