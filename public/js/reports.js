// Protect page: require staff login
verifyAuth(true);

let reportTrucks = [];
let currentFilterDesc = 'Past 7 Days';

// Clock
function updateClock() {
    const el = document.getElementById('clock');
    if (el) el.textContent = new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
}
setInterval(updateClock, 1000);
updateClock();

function getTodayString() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

function setActiveButton(activeId) {
    ['btnRep7Days', 'btnRepToday', 'btnRep30Days'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.className = (id === activeId) ? 'btn btn-primary' : 'btn btn-outline';
    });
}

// Load Preset: 7days, today, 30days
async function loadPreset(preset) {
    let url = '/api/reports';
    if (preset === '7days') {
        setActiveButton('btnRep7Days');
        currentFilterDesc = 'Past_7_Days';
        url = '/api/reports?days=7';
    } else if (preset === 'today') {
        setActiveButton('btnRepToday');
        currentFilterDesc = 'Today_' + getTodayString();
        url = `/api/reports?date=${encodeURIComponent(getTodayString())}`;
    } else if (preset === '30days') {
        setActiveButton('btnRep30Days');
        currentFilterDesc = 'Past_30_Days';
        url = '/api/reports?days=30';
    }

    await fetchAndDisplay(url, currentFilterDesc);
}

// Load Custom Range
async function loadCustomRange() {
    const start = document.getElementById('filterStartDate').value;
    const end = document.getElementById('filterEndDate').value;

    if (!start || !end) {
        alert('Please select both From and To dates.');
        return;
    }

    if (start > end) {
        alert('From date cannot be after To date.');
        return;
    }

    setActiveButton(null);
    currentFilterDesc = `${start}_to_${end}`;
    const url = `/api/reports?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`;
    await fetchAndDisplay(url, `Date Range ${start} to ${end}`);
}

async function fetchAndDisplay(url, label) {
    const tbody = document.getElementById('reportTableBody');
    tbody.innerHTML = `<tr><td colspan="15" style="text-align: center; padding: 25px; color: #64748b;">Loading report data (${escapeHtml(label)})...</td></tr>`;

    try {
        const res = await fetch(url);
        const data = await res.json();

        if (!data.success) {
            alert('Failed to load report data: ' + data.error);
            return;
        }

        reportTrucks = data.trucks || [];
        calculateMetrics(reportTrucks);
        renderReportTable(reportTrucks);
    } catch (err) {
        console.error('Error fetching report:', err);
    }
}

// Calculate Average Turnaround Times
function calculateMetrics(trucks) {
    let waitTimes = [];
    let loadTimes = [];
    let turnaroundTimes = [];
    let completedCount = 0;

    trucks.forEach(t => {
        if (t.status === 'Completed' || t.status === 'Departed') {
            completedCount++;
        }

        // Wait Time: Arrival to Called
        if (t.arrival_timestamp && t.called_timestamp) {
            const diff = (new Date(t.called_timestamp) - new Date(t.arrival_timestamp)) / (1000 * 60);
            if (diff >= 0 && diff < 1440) waitTimes.push(diff);
        }

        // Loading Time: Loading to Completed
        if (t.loading_timestamp && t.completed_timestamp) {
            const diff = (new Date(t.completed_timestamp) - new Date(t.loading_timestamp)) / (1000 * 60);
            if (diff >= 0 && diff < 1440) loadTimes.push(diff);
        }

        // Turnaround Time: Arrival to Departed
        if (t.arrival_timestamp && t.departed_timestamp) {
            const diff = (new Date(t.departed_timestamp) - new Date(t.arrival_timestamp)) / (1000 * 60);
            if (diff >= 0 && diff < 1440) turnaroundTimes.push(diff);
        }
    });

    const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

    const avgWait = avg(waitTimes);
    const avgLoad = avg(loadTimes);
    const avgTurn = avg(turnaroundTimes);

    document.getElementById('repTotal').textContent = trucks.length;
    document.getElementById('repCompleted').textContent = completedCount;
    document.getElementById('repAvgWait').textContent = avgWait !== null ? `${avgWait} mins` : '-- mins';
    document.getElementById('repAvgLoad').textContent = avgLoad !== null ? `${avgLoad} mins` : '-- mins';
    document.getElementById('repAvgTurnaround').textContent = avgTurn !== null ? `${avgTurn} mins` : '-- mins';
    document.getElementById('recordCount').textContent = `${trucks.length} Records Found`;
}

// Render Report Table
function renderReportTable(trucks) {
    const tbody = document.getElementById('reportTableBody');
    const todayStr = getTodayString();

    if (trucks.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="15" style="text-align: center; padding: 35px; color: #64748b;">
                    No records found for the selected period.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = trucks.map(t => {
        const isToday = (t.date === todayStr);
        const dateBadge = isToday
            ? `<span style="font-size: 11px; padding: 2px 6px; background: #dcfce7; color: #166534; font-weight: 700; border-radius: 4px;">Today</span>`
            : `<span style="font-size: 11px; padding: 2px 6px; background: #f1f5f9; color: #475569; font-weight: 600; border-radius: 4px;">${escapeHtml(t.date || '—')}</span>`;

            const reasonHtml = (t.status === 'Cancelled' && t.cancellation_reason) 
                ? `<br><small style="color: #ef4444; font-size: 10px; display: block; margin-top: 2px;">Reason: ${escapeHtml(t.cancellation_reason)}</small>`
                : '';

        return `
            <tr>
                <td><strong>${escapeHtml(t.queue)}</strong></td>
                <td>${dateBadge}</td>
                <td style="font-weight: 700; color: #0f172a;">${escapeHtml(t.truck_number)}</td>
                <td>${escapeHtml(t.driver_name)}</td>
                <td>${escapeHtml(t.company || '—')}</td>
                <td>${escapeHtml(t.load_type)}</td>
                <td>${escapeHtml(t.destination)}</td>
                <td><span class="badge badge-waiting">${escapeHtml(t.priority)}</span></td>
                <td>${t.loading_door ? 'Door ' + escapeHtml(t.loading_door) : '—'}</td>
                <td>${escapeHtml(t.arrival_time || '—')}</td>
                <td>${escapeHtml(t.called_time || '—')}</td>
                <td>${escapeHtml(t.loading_time || '—')}</td>
                <td>${escapeHtml(t.completed_time || '—')}</td>
                <td>${escapeHtml(t.departed_time || '—')}</td>
                <td><span class="badge badge-${(t.status || '').toLowerCase()}">${escapeHtml(t.status)}</span>${reasonHtml}</td>
            </tr>
        `;
    }).join('');
}

// Export to CSV
function exportCSV() {
    if (reportTrucks.length === 0) {
        alert('No records available to export.');
        return;
    }

    const headers = [
        "Queue Number",
        "Date",
        "Truck / Plate Number",
        "Driver Name",
        "Company / Hauler",
        "Contact Number",
        "Product / Load",
        "Destination",
        "Reference / FO / SO",
        "Priority Category",
        "Loading Door",
        "Arrival Time",
        "Called Time",
        "Times Called",
        "Loading Time",
        "Completed Time",
        "Departed Time",
        "Current Status",
        "Cancellation Reason"
    ];

    const rows = reportTrucks.map(t => [
        t.queue,
        t.date,
        t.truck_number,
        t.driver_name,
        t.company || '',
        t.contact || '',
        t.load_type,
        t.destination,
        t.reference || '',
        t.priority,
        t.loading_door ? `Door ${t.loading_door}` : '',
        t.arrival_time || '',
        t.called_time || '',
        t.call_count ? `${t.call_count}x` : '1x',
        t.loading_time || '',
        t.completed_time || '',
        t.departed_time || '',
        t.status,
        t.cancellation_reason || ''
    ]);

    const escapeCsv = (val) => '"' + String(val ?? '').replace(/"/g, '""') + '"';

    const csvContent = [
        headers.map(escapeCsv).join(','),
        ...rows.map(r => r.map(escapeCsv).join(','))
    ].join('\r\n');

    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `May_Harvest_Dispatch_Report_${currentFilterDesc}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Init with 7 days preset by default!
loadPreset('7days');
