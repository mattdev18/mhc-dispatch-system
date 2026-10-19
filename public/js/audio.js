// Audio Announcement System using Web Audio API & Speech Synthesis
let audioCtx = null;
let soundEnabled = false;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    soundEnabled = true;
}

// 2-Tone Airport/Station Chime (Ding-Dong)
function playChime() {
    return new Promise((resolve) => {
        try {
            if (!audioCtx) initAudio();
            if (audioCtx.state === 'suspended') audioCtx.resume();

            const now = audioCtx.currentTime;

            // Tone 1: 587.33 Hz (D5)
            const osc1 = audioCtx.createOscillator();
            const gain1 = audioCtx.createGain();
            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(587.33, now);

            gain1.gain.setValueAtTime(0.001, now);
            gain1.gain.exponentialRampToValueAtTime(0.4, now + 0.05);
            gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);

            osc1.connect(gain1);
            gain1.connect(audioCtx.destination);
            osc1.start(now);
            osc1.stop(now + 0.6);

            // Tone 2: 880.00 Hz (A5)
            const osc2 = audioCtx.createOscillator();
            const gain2 = audioCtx.createGain();
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(880.00, now + 0.4);

            gain2.gain.setValueAtTime(0.001, now + 0.4);
            gain2.gain.exponentialRampToValueAtTime(0.5, now + 0.45);
            gain2.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);

            osc2.connect(gain2);
            gain2.connect(audioCtx.destination);
            osc2.start(now + 0.4);
            osc2.stop(now + 1.2);

            setTimeout(resolve, 1100);
        } catch (e) {
            console.warn('Audio chime error:', e);
            resolve();
        }
    });
}

// Spoken voice announcement
function speakAnnouncement(truck) {
    if (!('speechSynthesis' in window)) return;

    // Format plate with spaces for clear speech (e.g., A B C 1 2 3 4)
    const plateLetters = truck.truck_number.split('').join(' ');
    const door = truck.loading_door ? `Loading Door ${truck.loading_door}` : 'the dispatch area';
    
    const message = `Now calling queue ${truck.queue}, truck plate ${plateLetters}. Driver ${truck.driver_name}, please proceed to ${door}.`;

    const utterance = new SpeechSynthesisUtterance(message);
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.lang = 'en-US';

    window.speechSynthesis.speak(utterance);
}

// Call Truck audio sequence: Chime first, then Voice announcement!
async function announceTruck(truck) {
    await playChime();
    speakAnnouncement(truck);
}
