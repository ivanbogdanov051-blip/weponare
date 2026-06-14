'use strict';

// ─── GameAudio ──────────────────────────────────────────────────────────────
// All sound is synthesized at runtime with the Web Audio API — no asset files,
// so it works offline and on Android with zero downloads. Must be init()'d from
// a user gesture (button click / keypress) due to browser autoplay policy.

const GameAudio = (() => {
  let ctx = null;
  let masterGain = null, musicGain = null;
  let muted = false;
  let musicPlaying = false, musicTimer = null, musicStep = 0;

  try { muted = localStorage.getItem('weponare_muted') === '1'; } catch {}

  function init() {
    if (ctx) { resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = muted ? 0 : 0.7;
      masterGain.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.18;
      musicGain.connect(masterGain);
    } catch (e) { ctx = null; }
  }
  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

  // One-shot tone with an exponential decay envelope.
  function tone(freq, dur, type, vol, slideTo, dest) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(Math.max(0.0001, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || masterGain);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // Filtered white noise burst (impacts, swooshes).
  function noise(dur, vol, filterFreq) {
    if (!ctx || muted) return;
    const t = ctx.currentTime;
    const n = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buffer;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = filterFreq || 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0001, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(masterGain);
    src.start(t); src.stop(t + dur + 0.02);
  }

  const sfx = {
    swing()  { tone(430, 0.13, 'triangle', 0.22, 200); noise(0.07, 0.10, 2600); },
    shoot()  { tone(720, 0.12, 'square', 0.18, 1300); },
    special(){ tone(170, 0.45, 'sawtooth', 0.32, 70); noise(0.32, 0.22, 1700);
               tone(330, 0.4, 'square', 0.18, 110); },
    hit()    { noise(0.07, 0.28, 850); tone(150, 0.09, 'square', 0.18, 80); },
    death()  { tone(280, 0.26, 'square', 0.26, 55); noise(0.22, 0.18, 1100); },
    unlock() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.26, 'square', 0.26), i * 110)); },
    waveclear(){ [392, 523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.3, 'triangle', 0.26), i * 120)); },
    xp()     { tone(880, 0.08, 'sine', 0.12, 1320); },
  };

  // ── Background music: looping chiptune over a walking bass (A-minor-ish) ──
  const NT = {
    A3: 220, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392,
    A4: 440, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, R: 0,
  };
  const MELODY = [
    NT.A4, NT.R, NT.C5, NT.E5,  NT.D5, NT.C5, NT.A4, NT.R,
    NT.G4, NT.R, NT.A4, NT.C5,  NT.E5, NT.R, NT.D5, NT.R,
    NT.A4, NT.R, NT.C5, NT.E5,  NT.G5, NT.E5, NT.D5, NT.C5,
    NT.A4, NT.R, NT.G4, NT.A4,  NT.C5, NT.R, NT.R, NT.R,
  ];
  const BASS = [NT.A3, NT.A3, NT.F4, NT.F4, NT.C4, NT.C4, NT.G4, NT.E4];
  const STEP = 0.165; // seconds per 16th-ish step

  function startMusic() {
    if (!ctx || musicPlaying) return;
    musicPlaying = true;
    musicStep = 0;
    musicTimer = setInterval(() => {
      if (muted || !ctx) return;
      const mel = MELODY[musicStep % MELODY.length];
      if (mel) tone(mel, STEP * 0.85, 'square', 0.16, null, musicGain);
      if (musicStep % 2 === 0) {
        const bass = BASS[(musicStep / 2 | 0) % BASS.length];
        if (bass) tone(bass / 2, STEP * 1.7, 'triangle', 0.22, null, musicGain);
      }
      musicStep++;
    }, STEP * 1000);
  }
  function stopMusic() {
    musicPlaying = false;
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }
  // Idempotently match music playback to whether we're in gameplay.
  function syncMusic(inGame) { if (inGame) startMusic(); else stopMusic(); }

  function toggleMute() {
    muted = !muted;
    try { localStorage.setItem('weponare_muted', muted ? '1' : '0'); } catch {}
    if (masterGain) masterGain.gain.value = muted ? 0 : 0.7;
    return muted;
  }
  function isMuted() { return muted; }

  return { init, resume, sfx, startMusic, stopMusic, syncMusic, toggleMute, isMuted };
})();

if (typeof window !== 'undefined') window.GameAudio = GameAudio;
