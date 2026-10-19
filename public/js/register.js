const socket = io();
let currentRegisteredTruck = null;

// Clock
function updateClock() {
    const el = document.getElementById('clock');
    if (el) el.textContent = new Date().toLocaleTimeString('en-US');
}
setInterval(updateClock, 1000);
updateClock();

// Connection Indicator
socket.on('connect', () => {
    document.getElementById('connDot').className = 'conn-dot online';
    document.getElementById('connText').textContent = 'Online / Sync';
});

socket.on('disconnect', () => {
    document.getElementById('connDot').className = 'conn-dot';
    document.getElementById('connText').textContent = 'Offline';
});

// Form Submission
const form = document.getElementById('truckForm');
const alertBox = document.getElementById('alertBox');
const submitBtn = document.getElementById('submitBtn');

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showAlert('', false);

    const payload = {
        truck_number: document.getElementById('truck_number').value.trim().toUpperCase(),
        driver_name: document.getElementById('driver_name').value.trim(),
        company: document.getElementById('company').value.trim(),
        contact: document.getElementById('contact').value.trim(),
        load_type: document.getElementById('load_type').value.trim(),
        destination: document.getElementById('destination').value.trim(),
        reference: document.getElementById('reference').value.trim(),
        priority: document.getElementById('priority').value
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Registering Truck...';

    try {
        const res = await fetch('/api/trucks/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (!data.success) {
            showAlert(data.error || 'Failed to register truck.', true);
            submitBtn.disabled = false;
            submitBtn.textContent = '🎟️ REGISTER TRUCK & ISSUE QUEUE TICKET';
            return;
        }

        currentRegisteredTruck = data.truck;
        showSuccessTicket(data.truck);
    } catch (err) {
        showAlert('Network error: ' + err.message, true);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '🎟️ REGISTER TRUCK & ISSUE QUEUE TICKET';
    }
});

function showAlert(msg, isError) {
    if (!msg) {
        alertBox.style.display = 'none';
        return;
    }
    alertBox.style.display = 'block';
    alertBox.style.background = isError ? '#fee2e2' : '#dcfce7';
    alertBox.style.color = isError ? '#991b1b' : '#166534';
    alertBox.style.border = isError ? '1px solid #f87171' : '1px solid #86efac';
    alertBox.textContent = msg;
}

function showSuccessTicket(truck) {
    document.getElementById('formCard').style.display = 'none';
    const successCard = document.getElementById('ticketSuccessCard');
    successCard.style.display = 'block';

    document.getElementById('successQueue').textContent = truck.queue;
    document.getElementById('successDetails').innerHTML = `
        <strong>Plate Number:</strong> ${escapeHtml(truck.truck_number)}<br>
        <strong>Driver Name:</strong> ${escapeHtml(truck.driver_name)}<br>
        <strong>Company:</strong> ${escapeHtml(truck.company || '—')}<br>
        <strong>Load Type:</strong> ${escapeHtml(truck.load_type)}<br>
        <strong>Destination:</strong> ${escapeHtml(truck.destination)}<br>
        <strong>Category:</strong> <span class="badge badge-waiting">${escapeHtml(truck.priority)}</span><br>
        <strong>Arrival Time:</strong> ${escapeHtml(truck.arrival_time)}
    `;

    // Auto trigger print for smooth gate operations
    setupPrintTicket(truck);
}

function setupPrintTicket(truck) {
    document.getElementById('printQueueNum').textContent = truck.queue;
    document.getElementById('printMeta').innerHTML = `
        <strong>Date:</strong> ${escapeHtml(truck.date)}<br>
        <strong>Arrival:</strong> ${escapeHtml(truck.arrival_time)}<br>
        <strong>Plate:</strong> ${escapeHtml(truck.truck_number)}<br>
        <strong>Driver:</strong> ${escapeHtml(truck.driver_name)}<br>
        <strong>Company:</strong> ${escapeHtml(truck.company || '—')}<br>
        <strong>Load:</strong> ${escapeHtml(truck.load_type)}<br>
        <strong>Destination:</strong> ${escapeHtml(truck.destination)}<br>
        <strong>Category:</strong> ${escapeHtml(truck.priority)}<br>
        <strong>Ref/FO:</strong> ${escapeHtml(truck.reference || '—')}
    `;
}

function printQueueTicket() {
    if (!currentRegisteredTruck) return;
    setupPrintTicket(currentRegisteredTruck);
    const printEl = document.getElementById('printTicketArea');
    printEl.style.display = 'block';
    window.print();
    printEl.style.display = 'none';
}

function resetFormForNext() {
    document.getElementById('ticketSuccessCard').style.display = 'none';
    document.getElementById('formCard').style.display = 'block';
    form.reset();
    document.getElementById('truck_number').focus();
    showAlert('', false);
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
