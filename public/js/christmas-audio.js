// ========================================================
// MHC CHRISTMAS SOUND EFFECT ENGINE (WEB AUDIO API)
// 100% Client-Side Pure Synth - 0KB Audio Assets
// ========================================================
let audioCtx = null;
let soundEnabled = true;

function initAudio() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// Synthesize Authentic Sleigh Jingle Bells
function playSleighBellNote(freq, gainLevel = 0.08, delayMs = 0) {
  setTimeout(() => {
    if (!soundEnabled || !audioCtx) return;
    try {
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(gainLevel, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.4);
    } catch(e) {}
  }, delayMs);
}

// Full Christmas Sleigh Bell Jingle Chime
function triggerChristmasJingle() {
  initAudio();
  if (!soundEnabled) return;

  const bellPitches = [2093, 2349, 2637, 3136, 3520, 4186];
  bellPitches.forEach((pitch, i) => {
    playSleighBellNote(pitch, 0.06, i * 65);
    playSleighBellNote(pitch * 1.5, 0.03, i * 65 + 15);
  });
}

function toggleChristmasSound() {
  soundEnabled = !soundEnabled;
  const btn = document.getElementById('christmasSoundBtn');
  if (btn) {
    btn.innerHTML = soundEnabled 
      ? '🔔 <span style="font-size:11px; font-weight:700;">Bells: ON</span>' 
      : '🔕 <span style="font-size:11px; font-weight:700;">Bells: OFF</span>';
    btn.style.opacity = soundEnabled ? '1' : '0.6';
  }
  if (soundEnabled) {
    triggerChristmasJingle();
  }
}

window.addEventListener('click', () => {
  initAudio();
}, { once: true });

document.addEventListener('DOMContentLoaded', () => {
  const caravan = document.getElementById('santaCaravan');
  if (caravan) {
    caravan.addEventListener('animationiteration', () => {
      if (soundEnabled) {
        setTimeout(() => triggerChristmasJingle(), 400);
      }
    });
  }
});
