const socket = io();

let isSoundActive = false;
let lastCalledTruck = null;

// Clock & Date
function updateClock() {
    const now = new Date();
    const clockEl = document.getElementById('tvClock');
    const dateEl = document.getElementById('tvDate');

    if (clockEl) {
        clockEl.textContent = now.toLocaleTimeString('en-US', { hour12: true });
    }
    if (dateEl) {
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        dateEl.textContent = now.toLocaleDateString('en-US', options).toUpperCase();
    }
}
setInterval(updateClock, 1000);
updateClock();

// Sound Toggle
function toggleSound() {
    initAudio();
    isSoundActive = true;
    const btn = document.getElementById('soundBtn');
    btn.innerHTML = '✓ Sound &amp; Voice Active';
    btn.style.background = '#0f172a';
    btn.style.color = '#86efac';
    btn.style.border = '1px solid #22c55e';
    playChime(); // test chime feedback
}

// Socket Events
socket.on('truck_called', (truck) => {
    lastCalledTruck = truck;
    displayNowCalling(truck);
    if (isSoundActive) {
        announceTruck(truck);
    }
    fetchQueueData();
});

socket.on('queue_updated', () => {
    fetchQueueData();
});

// Fetch Live Display Data
async function fetchQueueData() {
    try {
        const [trucksRes, statsRes] = await Promise.all([
            fetch('/api/trucks/today'),
            fetch('/api/stats/today')
        ]);

        const trucksData = await trucksRes.json();
        const statsData = await statsRes.json();

        if (trucksData.success) {
            renderTicker(trucksData.trucks || []);

            // If no truck currently displayed as called, pick most recent Called or Loading truck
            if (!lastCalledTruck) {
                const active = (trucksData.trucks || []).filter(t => t.status === 'Called' || t.status === 'Loading');
                if (active.length > 0) {
                    displayNowCalling(active[active.length - 1]);
                }
            }
        }

        if (statsData.success) {
            renderDoors(statsData.activeTrucks || []);
        }
    } catch (err) {
        console.error('Error fetching TV display data:', err);
    }
}

// Update Now Calling Panel
function displayNowCalling(truck) {
    if (!truck) return;

    document.getElementById('callingQueue').textContent = truck.queue;
    document.getElementById('callingPlate').textContent = truck.truck_number;
    document.getElementById('callingDoor').textContent = truck.loading_door 
        ? `PROCEED TO: DOOR ${truck.loading_door}` 
        : 'PROCEED TO DISPATCH BAY';
    document.getElementById('callingDriver').textContent = `Driver: ${truck.driver_name}`;
    document.getElementById('callingLoad').textContent = `${truck.load_type} • Destination: ${truck.destination}`;

    const panel = document.getElementById('callingPanel');
    panel.style.animation = 'none';
    void panel.offsetWidth; // trigger reflow
    panel.style.animation = 'tvGlow 1.5s 3 alternate';
}

// Render 8 Loading Doors on TV
function renderDoors(activeTruckList) {
    const grid = document.getElementById('tvDoorsGrid');
    const doorMap = {};

    activeTruckList.forEach(t => {
        if (t.loading_door) {
            doorMap[Number(t.loading_door)] = t;
        }
    });

    let html = '';
    let occupiedCount = 0;

    for (let door = 1; door <= 8; door++) {
        const truck = doorMap[door];

        if (!truck) {
            html += `
                <div class="tv-door-box vacant">
                    <div class="tv-door-top">
                        <span class="tv-door-num">DOOR ${door}</span>
                        <span class="tv-door-status" style="background: rgba(255,255,255,0.1); color: #94a3b8;">VACANT</span>
                    </div>
                    <div style="text-align: center; color: #64748b; font-size: 14px; margin: auto;">
                        Available
                    </div>
                </div>
            `;
        } else {
            occupiedCount++;
            const isCalled = truck.status === 'Called';
            const boxClass = isCalled ? 'tv-door-box called' : 'tv-door-box loading';
            const statusColor = isCalled ? '#f59e0b' : '#ea580c';

            html += `
                <div class="${boxClass}">
                    <div class="tv-door-top">
                        <span class="tv-door-num">DOOR ${door}</span>
                        <span class="tv-door-status" style="background: ${statusColor}; color: white;">
                            ${escapeHtml(truck.status)}
                        </span>
                    </div>
                    <div class="tv-door-plate">${escapeHtml(truck.truck_number)}</div>
                    <div class="tv-door-queue">${escapeHtml(truck.queue)} • ${escapeHtml(truck.driver_name)}</div>
                    <div class="tv-door-load">${escapeHtml(truck.load_type || '')}</div>
                </div>
            `;
        }
    }

    grid.innerHTML = html;
    document.getElementById('dockSummary').textContent = `${occupiedCount} of 8 Doors Active`;
}

// Render Bottom Ticker
function renderTicker(trucks) {
    const ticker = document.getElementById('tvTickerList');
    const waiting = trucks.filter(t => t.status === 'Waiting');

    if (waiting.length === 0) {
        ticker.innerHTML = '<span style="color: #64748b; font-size: 14px;">No other waiting trucks in queue.</span>';
        return;
    }

    ticker.innerHTML = waiting.map(t => `
        <div class="tv-ticker-item">
            <strong>${escapeHtml(t.queue)}</strong>: ${escapeHtml(t.truck_number)} (${escapeHtml(t.driver_name)})
        </div>
    `).join('');
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Auto-enable audio on first click anywhere on the page
document.addEventListener('click', () => {
    if (!isSoundActive) {
        toggleSound();
    }
}, { once: true });

// Initial Load & Heartbeat
fetchQueueData();
setInterval(fetchQueueData, 10000); // Poll every 10s as backup
