// Protect page: require staff login
verifyAuth(true);

let reportTrucks = [];

// Clock
function updateClock() {
    const el = document.getElementById('clock');
    if (el) el.textContent = new Date().toLocaleTimeString('en-US');
}
setInterval(updateClock, 1000);
updateClock();

function getTodayString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function setTodayAndLoad() {
    document.getElementById('filterDate').value = getTodayString();
    loadReportData();
}

async function loadReportData() {
    const dateInput = document.getElementById('filterDate').value || getTodayString();
    const tbody = document.getElementById('reportTableBody');
    tbody.innerHTML = `<tr><td colspan="14" style="text-align: center; padding: 25px; color: #64748b;">Loading report data for ${dateInput}...</td></tr>`;

    try {
        const res = await fetch(`/api/reports?date=${encodeURIComponent(dateInput)}`);
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

    if (trucks.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="14" style="text-align: center; padding: 35px; color: #64748b;">
                    No records found for the selected date.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = trucks.map(t => `
        <tr>
            <td><strong>${escapeHtml(t.queue)}</strong></td>
            <td style="font-weight: 700;">${escapeHtml(t.truck_number)}</td>
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
            <td><span class="badge badge-${t.status.toLowerCase()}">${escapeHtml(t.status)}</span></td>
        </tr>
    `).join('');
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
        "Loading Time",
        "Completed Time",
        "Departed Time",
        "Current Status"
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
        t.loading_time || '',
        t.completed_time || '',
        t.departed_time || '',
        t.status
    ]);

    const escapeCsv = (val) => '"' + String(val ?? '').replace(/"/g, '""') + '"';

    const csvContent = [
        headers.map(escapeCsv).join(','),
        ...rows.map(r => r.map(escapeCsv).join(','))
    ].join('\r\n');

    const dateStr = document.getElementById('filterDate').value || getTodayString();
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `May_Harvest_Dispatch_Report_${dateStr}.csv`;
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

// Init
setTodayAndLoad();
