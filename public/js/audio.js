// Audio Announcement System - Airport Paging & PA System Simulation
let audioCtx = null;
let soundEnabled = false;
let currentAnnouncementId = 0;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    soundEnabled = true;
}

// Classic 4-Tone International Airport Chime (Ding-Dong-Ding-Dong)
// Tones: C5 (523.25Hz) -> G4 (392.00Hz) -> A4 (440.00Hz) -> E4 (329.63Hz)
function playChime() {
    return new Promise((resolve) => {
        try {
            if (!audioCtx) initAudio();
            if (audioCtx.state === 'suspended') audioCtx.resume();

            const ctx = audioCtx;
            const now = ctx.currentTime;

            const tones = [
                { freq: 523.25, time: 0.0,  dur: 0.45 },
                { freq: 392.00, time: 0.35, dur: 0.45 },
                { freq: 440.00, time: 0.70, dur: 0.45 },
                { freq: 329.63, time: 1.05, dur: 0.85 }
            ];

            tones.forEach(t => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(t.freq, now + t.time);

                gain.gain.setValueAtTime(0.001, now + t.time);
                gain.gain.exponentialRampToValueAtTime(0.5, now + t.time + 0.04);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + t.time + t.dur);

                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + t.time);
                osc.stop(now + t.time + t.dur);
            });

            setTimeout(resolve, 1900);
        } catch (e) {
            console.warn('Audio chime notice:', e);
            resolve();
        }
    });
}

// Helper to choose the best available voice in user browser
function getPreferredVoice() {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices() || [];
    if (voices.length === 0) return null;

    // Look for clear English broadcast voices (Natural, Google, Samantha, Zira, Jenny, etc.)
    const preferred = voices.find(v => 
        v.lang.toLowerCase().startsWith('en') && 
        /natural|google|samantha|zira|jenny/i.test(v.name)
    );
    if (preferred) return preferred;

    // Fallback: any English voice
    const anyEnglish = voices.find(v => v.lang.toLowerCase().startsWith('en'));
    if (anyEnglish) return anyEnglish;

    return voices[0] || null;
}

// Speak a single phrase via SpeechSynthesis
function speakPhrase(text) {
    return new Promise((resolve) => {
        if (!('speechSynthesis' in window)) {
            resolve();
            return;
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.88; // Crisp, clear, measured broadcast pace
        utterance.pitch = 1.0;
        utterance.volume = 1.0; // Maximum loudness

        const voice = getPreferredVoice();
        if (voice) utterance.voice = voice;

        utterance.onend = () => {
            setTimeout(resolve, 600);
        };
        utterance.onerror = () => {
            resolve();
        };

        window.speechSynthesis.speak(utterance);
    });
}

// Full Airport Paging Sequence:
// Repeats 3 times loudly: Chime -> Spoken Announcement -> Pause
async function announceTruck(truck) {
    if (!truck) return;

    // Cancel any ongoing speech to prevent overlapping
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }

    const thisAnnouncementId = ++currentAnnouncementId;

    // Format plate phonetically with spaces (e.g. "A B C 1 2 3")
    const cleanPlate = (truck.truck_number || '').trim().toUpperCase();
    const spacedPlate = cleanPlate.split('').join(' ').replace(/\s+/g, ' ');

    const door = truck.loading_door ? `door ${truck.loading_door}` : 'the dispatch area';
    const phrase = `Paging truck with plate number ${spacedPlate}, please proceed to ${door}.`;

    const REPEATS = 3; // Repeated 3 times as requested

    for (let i = 1; i <= REPEATS; i++) {
        // If another truck was called during playback, stop this sequence
        if (thisAnnouncementId !== currentAnnouncementId) break;

        // 1. Play Airport 4-Tone Chime
        await playChime();
        if (thisAnnouncementId !== currentAnnouncementId) break;

        // 2. Loud spoken announcement
        await speakPhrase(phrase);
        if (thisAnnouncementId !== currentAnnouncementId) break;

        // 3. Pause between repetitions
        if (i < REPEATS) {
            await new Promise(r => setTimeout(r, 1200));
        }
    }
}
