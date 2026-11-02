// Audio Announcement System - Airport Paging & PA System Simulation
let audioCtx = null;
let soundEnabled = false;
let currentAnnouncementId = 0;
let cachedVoices = [];

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    soundEnabled = true;
    loadVoices();
}

// Preload and cache browser Speech Synthesis voices
function loadVoices() {
    if ('speechSynthesis' in window) {
        cachedVoices = window.speechSynthesis.getVoices() || [];
        if (typeof updateTvVoiceOptions === 'function') {
            updateTvVoiceOptions();
        }
    }
}

if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices();
}

// Classic 4-Tone European/Asian International Airport Chime (Ding-Dong-Ding-Dong)
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

// STRICT FEMALE AIRPORT ANNOUNCER VOICE SELECTION
// 1. Explicitly blacklist male voices (Microsoft David, George, Mark, etc.)
// 2. Prioritize natural English female voices (Zira, Jenny, Aria, Samantha, Karen, Google US English, etc.)
function getPreferredFemaleVoice() {
    if (!('speechSynthesis' in window)) return null;

    let voices = cachedVoices;
    if (!voices || voices.length === 0) {
        voices = window.speechSynthesis.getVoices() || [];
        cachedVoices = voices;
    }
    if (voices.length === 0) return null;

    // Check custom saved voice in localStorage
    const savedVoiceUri = localStorage.getItem('mhc_preferred_voice');
    if (savedVoiceUri) {
        const foundSaved = voices.find(v => v.voiceURI === savedVoiceUri || v.name === savedVoiceUri);
        if (foundSaved) return foundSaved;
    }

    const femaleRegex = /zira|jenny|aria|samantha|karen|victoria|sonia|hazel|susan|catherine|stephanie|linda|female/i;
    const maleRegex = /david|george|mark|richard|james|guy|male/i;

    // 1st Priority: English voice explicitly known to be female
    const femaleEnglish = voices.find(v => 
        v.lang.toLowerCase().startsWith('en') && 
        femaleRegex.test(v.name)
    );
    if (femaleEnglish) return femaleEnglish;

    // 2nd Priority: Google US English (Standard clear female announcer in Chrome)
    const googleUs = voices.find(v => 
        v.name.includes('Google') && 
        v.lang.toLowerCase().startsWith('en') && 
        !maleRegex.test(v.name)
    );
    if (googleUs) return googleUs;

    // 3rd Priority: Any English voice that is NOT in the male blacklist
    const nonMaleEnglish = voices.find(v => 
        v.lang.toLowerCase().startsWith('en') && 
        !maleRegex.test(v.name)
    );
    if (nonMaleEnglish) return nonMaleEnglish;

    // 4th Priority: Any non-male voice in any language
    const anyNonMale = voices.find(v => !maleRegex.test(v.name));
    if (anyNonMale) return anyNonMale;

    return voices[0] || null;
}

// Speak single phrase with strict Female Airport Timbre
function speakPhrase(text) {
    return new Promise((resolve) => {
        if (!('speechSynthesis' in window)) {
            resolve();
            return;
        }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 0.88;   // Crisp, measured airport broadcast cadence
        utterance.pitch = 1.15;  // Higher pitch for bright, distinct female PA sound
        utterance.volume = 1.0;  // Maximum loudness

        const voice = getPreferredFemaleVoice();
        if (voice) {
            utterance.voice = voice;
            console.log('[Airport Voice] Speaking with female voice:', voice.name, `(${voice.lang})`);
        }

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

    // Ensure voices are initialized
    if (cachedVoices.length === 0 && 'speechSynthesis' in window) {
        cachedVoices = window.speechSynthesis.getVoices() || [];
    }

    // Cancel any previous announcement to avoid overlapping
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }

    const thisAnnouncementId = ++currentAnnouncementId;

    // Format plate phonetically with spaces (e.g. "A B C 1 2 3")
    const cleanPlate = (truck.truck_number || '').trim().toUpperCase();
    const spacedPlate = cleanPlate.split('').join(' ').replace(/\s+/g, ' ');

    const door = truck.loading_door ? `door ${truck.loading_door}` : 'the dispatch area';
    const phrase = `Paging truck with plate number ${spacedPlate}, please proceed to ${door}.`;

    const REPEATS = 3; // Repeated 3 times

    for (let i = 1; i <= REPEATS; i++) {
        if (thisAnnouncementId !== currentAnnouncementId) break;

        // 1. Play Airport 4-Tone Chime
        await playChime();
        if (thisAnnouncementId !== currentAnnouncementId) break;

        // 2. Loud spoken announcement (Female Voice)
        await speakPhrase(phrase);
        if (thisAnnouncementId !== currentAnnouncementId) break;

        // 3. Pause between repetitions
        if (i < REPEATS) {
            await new Promise(r => setTimeout(r, 1200));
        }
    }
}
