const socket = io();

let isSoundActive = false;
let lastCalledTruck = null;

// Clock & Date
function updateClock() {
    const now = new Date();
    const clockEl = document.getElementById('tvClock');
    const dateEl = document.getElementById('tvDate');

    if (clockEl) {
        clockEl.textContent = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
    }
    if (dateEl) {
        const options = { timeZone: 'Asia/Manila', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        dateEl.textContent = now.toLocaleDateString('en-US', options).toUpperCase();
    }
}
setInterval(updateClock, 1000);
updateClock();

// Fullscreen Toggle for Commercial Outdoor TV
function toggleTvFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.log('[TV Fullscreen] Request error:', err);
        });
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

// Sound Toggle
function toggleSound() {
    initAudio();
    isSoundActive = true;
    const btn = document.getElementById('soundBtn');
    if (btn) {
        btn.innerHTML = '✓ Audio: On';
        btn.style.background = 'rgba(34, 197, 94, 0.2)';
        btn.style.color = '#86efac';
        btn.style.borderColor = '#22c55e';
    }
    updateTvVoiceOptions();
    playChime(); // test chime feedback
}

// TV Voice Selector: Populate available female airport voices
function updateTvVoiceOptions() {
    const select = document.getElementById('tvVoiceSelect');
    if (!select || !('speechSynthesis' in window)) return;

    const voices = window.speechSynthesis.getVoices() || [];
    if (voices.length === 0) return;

    const femaleRegex = /zira|jenny|aria|samantha|karen|victoria|sonia|hazel|susan|catherine|stephanie|linda|female/i;
    const maleRegex = /david|george|mark|richard|james|guy|male/i;

    let candidateList = voices.filter(v => v.lang.toLowerCase().startsWith('en') && !maleRegex.test(v.name));
    if (candidateList.length === 0) {
        candidateList = voices.filter(v => !maleRegex.test(v.name));
    }
    if (candidateList.length === 0) candidateList = voices;

    const currentFemale = (typeof getPreferredFemaleVoice === 'function') ? getPreferredFemaleVoice() : null;

    select.innerHTML = '';
    candidateList.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.voiceURI || v.name;
        const isFem = femaleRegex.test(v.name) || v.name.includes('Google');
        opt.textContent = `👩 ${v.name} (${v.lang})${isFem ? ' — Female Airport' : ''}`;
        if (currentFemale && (v.voiceURI === currentFemale.voiceURI || v.name === currentFemale.name)) {
            opt.selected = true;
        }
        select.appendChild(opt);
    });

    select.style.display = 'inline-block';
}

function changeTvVoice(voiceKey) {
    localStorage.setItem('mhc_preferred_voice', voiceKey);
    console.log('[Airport Voice] Switched TV voice to:', voiceKey);
}

if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = updateTvVoiceOptions;
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

socket.on('truck_status_changed', () => {
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
            const allTrucks = trucksData.trucks || [];
            renderTicker(allTrucks);

            // 1. Check if there is an actively CALLED truck (must proceed to door)
            const calledTrucks = allTrucks.filter(t => t.status === 'Called');
            if (calledTrucks.length > 0) {
                const activeCall = calledTrucks[calledTrucks.length - 1];
                lastCalledTruck = activeCall;
                displayNowCalling(activeCall);
            } else {
                // 2. No truck is currently called (e.g. previous truck has already started loading!)
                // Switch left hero box to: STANDBY / NEXT TO BE CALLED (Option 1)
                lastCalledTruck = null;
                const waitingTrucks = allTrucks.filter(t => t.status === 'Waiting');
                waitingTrucks.sort((a, b) => new Date(a.arrival_timestamp) - new Date(b.arrival_timestamp));

                if (waitingTrucks.length > 0) {
                    displayStandbyNextUp(waitingTrucks[0], waitingTrucks.length, statsData);
                } else {
                    displayAllClear(statsData);
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

// Update Now Calling Panel (Active Call Mode)
function displayNowCalling(truck) {
    if (!truck) return;

    const panel = document.getElementById('callingPanel');
    if (panel) {
        panel.classList.remove('standby');
        panel.style.animation = 'none';
        void panel.offsetWidth; // trigger reflow
        panel.style.animation = 'tvGlow 1.5s 3 alternate';
    }

    const badge = document.getElementById('callingBadge');
    if (badge) badge.textContent = 'NOW CALLING';

    document.getElementById('callingQueue').textContent = truck.queue;
    document.getElementById('callingPlate').textContent = truck.truck_number;
    document.getElementById('callingDoor').textContent = truck.loading_door 
        ? `PROCEED TO: DOOR ${truck.loading_door}` 
        : 'PROCEED TO DISPATCH BAY';
    document.getElementById('callingDriver').textContent = `Driver: ${truck.driver_name}`;
    document.getElementById('callingLoad').textContent = `${truck.load_type} • Destination: ${truck.destination}`;

    // Update Call Counter Badge
    const countBadge = document.getElementById('callingCountBadge');
    if (countBadge) {
        const count = Number(truck.call_count) || 1;
        countBadge.style.display = 'inline-block';
        if (count === 1) {
            countBadge.style.background = 'rgba(34, 197, 94, 0.2)';
            countBadge.style.color = '#86efac';
            countBadge.style.border = '1px solid #22c55e';
            countBadge.textContent = '📢 1st Call';
        } else if (count === 2) {
            countBadge.style.background = 'rgba(245, 158, 11, 0.25)';
            countBadge.style.color = '#fde047';
            countBadge.style.border = '1px solid #eab308';
            countBadge.textContent = '⚠️ 2nd Call';
        } else {
            countBadge.style.background = 'rgba(239, 68, 68, 0.3)';
            countBadge.style.color = '#fca5a5';
            countBadge.style.border = '1px solid #ef4444';
            countBadge.textContent = `🚨 ${count}rd Call (Final Call)`;
        }
    }
}

// Standby / Next In Line Mode (Option 1)
function displayStandbyNextUp(truck, waitingCount, statsData) {
    const panel = document.getElementById('callingPanel');
    if (panel) {
        panel.classList.add('standby');
        panel.style.animation = 'none';
    }

    const badge = document.getElementById('callingBadge');
    if (badge) badge.textContent = '⏳ STANDBY • NEXT UP';

    const countBadge = document.getElementById('callingCountBadge');
    if (countBadge) {
        countBadge.style.display = 'inline-block';
        countBadge.style.background = 'rgba(56, 189, 248, 0.2)';
        countBadge.style.color = '#7dd3fc';
        countBadge.style.border = '1px solid #38bdf8';
        countBadge.textContent = `1st of ${waitingCount} in Staging`;
    }

    document.getElementById('callingQueue').textContent = truck.queue;
    document.getElementById('callingPlate').textContent = truck.truck_number;
    document.getElementById('callingDoor').textContent = 'STANDBY AT STAGING AREA';
    document.getElementById('callingDriver').textContent = `Driver: ${truck.driver_name} • ${truck.company || '—'}`;

    const loadEl = document.getElementById('callingLoad');
    if (loadEl) {
        loadEl.innerHTML = `
            <span>${escapeHtml(truck.load_type)} • Destination: ${escapeHtml(truck.destination)}</span>
            <div style="margin-top: 8px; font-size: 13px; color: #38bdf8; font-weight: 600;">
                Please prepare at staging. You will be paged via speaker once a dock door opens.
            </div>
        `;
    }
}

// All Clear Mode (No trucks waiting)
function displayAllClear(statsData) {
    const panel = document.getElementById('callingPanel');
    if (panel) {
        panel.classList.add('standby');
        panel.style.animation = 'none';
    }

    const badge = document.getElementById('callingBadge');
    if (badge) badge.textContent = '✓ DOCKS IN OPERATION';

    const countBadge = document.getElementById('callingCountBadge');
    if (countBadge) countBadge.style.display = 'none';

    document.getElementById('callingQueue').textContent = '---';
    document.getElementById('callingPlate').textContent = 'STAGING CLEAR';
    document.getElementById('callingDoor').textContent = 'ALL QUEUED TRUCKS SERVED';
    document.getElementById('callingDriver').textContent = 'Plant logistics operating smoothly.';

    const loadEl = document.getElementById('callingLoad');
    if (loadEl) {
        loadEl.innerHTML = `<span style="color: #94a3b8;">Gate registration is open for incoming trucks.</span>`;
    }
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
                        <span class="tv-door-num">DOOR 0${door}</span>
                        <span class="tv-door-status" style="background: rgba(34, 197, 94, 0.15); color: #86efac; border: 1px solid rgba(34,197,94,0.3);">
                            🟢 AVAILABLE
                        </span>
                    </div>
                    <div style="text-align: center; color: #64748b; font-size: 13.5px; margin: auto; font-weight: 700; letter-spacing: 0.5px;">
                        BAY READY
                    </div>
                </div>
            `;
        } else {
            occupiedCount++;
            const isCalled = truck.status === 'Called';
            const boxClass = isCalled ? 'tv-door-box called' : 'tv-door-box loading';
            const statusColor = isCalled ? '#f59e0b' : '#ea580c';
            const statusBadgeText = isCalled ? '📢 CALLED' : '🚛 LOADING';
            const callBadgeText = (isCalled && truck.call_count && Number(truck.call_count) > 1)
                ? ` (${truck.call_count}x)`
                : '';

            html += `
                <div class="${boxClass}">
                    <div class="tv-door-top">
                        <span class="tv-door-num">DOOR 0${door}</span>
                        <span class="tv-door-status" style="background: ${statusColor}; color: white;">
                            ${statusBadgeText}${callBadgeText}
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

// Render Bottom Ticker (Continuous Smooth Loop for Truckers in Staging)
function renderTicker(trucks) {
    const ticker = document.getElementById('tvTickerList');
    if (!ticker) return;

    const waiting = trucks.filter(t => t.status === 'Waiting');

    if (waiting.length === 0) {
        ticker.innerHTML = '<span style="color: #64748b; font-size: 14px; font-weight: 600;">No other waiting trucks in queue. Staging area clear.</span>';
        ticker.style.animation = 'none';
        return;
    }

    const itemsHtml = waiting.map(t => `
        <div class="tv-ticker-item">
            <strong>${escapeHtml(t.queue)}</strong>
            <span class="tv-ticker-chip-plate">${escapeHtml(t.truck_number)}</span>
            <span class="tv-ticker-chip-driver">(${escapeHtml(t.driver_name || 'Driver')})</span>
        </div>
    `).join('');

    // Duplicate list if 2 or more trucks to create infinite seamless marquee loop
    if (waiting.length >= 2) {
        ticker.innerHTML = itemsHtml + itemsHtml;
        const duration = Math.max(22, waiting.length * 6);
        ticker.style.animation = `tvTickerScroll ${duration}s linear infinite`;
    } else {
        ticker.innerHTML = itemsHtml;
        ticker.style.animation = 'none';
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

// Auto-enable audio on first click anywhere on the page
document.addEventListener('click', () => {
    if (!isSoundActive) {
        toggleSound();
    }
}, { once: true });

// Initial Load & Heartbeat
fetchQueueData();
setInterval(fetchQueueData, 60000); // 60s fallback (Socket.IO pushes live real-time updates instantly)
