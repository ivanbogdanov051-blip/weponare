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
    parry()  { tone(1200, 0.14, 'square', 0.28, 2400); tone(700, 0.12, 'triangle', 0.2, 1600); noise(0.05, 0.12, 4000); },
  };

  // ── Background music: 5 selectable looping chiptune tracks ──
  const NT = {
    C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196, A3: 220, B3: 246.94,
    C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, B4: 493.88,
    C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, R: 0,
  };
  const _ = NT.R;

  const TRACKS = [
    { // 1 — Heroic (A minor)
      name: 'HEROIC', step: 0.165, wave: 'square',
      mel: [NT.A4,_,NT.C5,NT.E5, NT.D5,NT.C5,NT.A4,_, NT.G4,_,NT.A4,NT.C5, NT.E5,_,NT.D5,_,
            NT.A4,_,NT.C5,NT.E5, NT.G5,NT.E5,NT.D5,NT.C5, NT.A4,_,NT.G4,NT.A4, NT.C5,_,_,_],
      bass: [NT.A3,NT.A3,NT.F3,NT.F3, NT.C4,NT.C4,NT.G3,NT.E3],
    },
    { // 2 — Frantic (fast, driving)
      name: 'FRANTIC', step: 0.12, wave: 'square',
      mel: [NT.E5,NT.E5,_,NT.E5, _,NT.C5,NT.E5,_, NT.G5,_,_,_, NT.G4,_,_,_,
            NT.C5,_,_,NT.G4, _,_,NT.E4,_, NT.A4,_,NT.B4,_, NT.A4,NT.G4,NT.E5,_],
      bass: [NT.C4,NT.C4,NT.G3,NT.G3, NT.A3,NT.A3,NT.E3,NT.E3],
    },
    { // 3 — Calm (slow, soft triangle)
      name: 'CALM', step: 0.22, wave: 'triangle',
      mel: [NT.C5,_,NT.E5,_, NT.G5,_,NT.E5,_, NT.F5,_,NT.D5,_, NT.C5,_,_,_,
            NT.A4,_,NT.C5,_, NT.E5,_,NT.D5,_, NT.G4,_,NT.B4,_, NT.C5,_,_,_],
      bass: [NT.C3,NT.C3,NT.A3,NT.A3, NT.F3,NT.F3,NT.G3,NT.G3],
    },
    { // 4 — Dark (low, ominous saw)
      name: 'DARK', step: 0.18, wave: 'sawtooth',
      mel: [NT.D4,_,NT.D4,NT.F4, NT.D4,_,NT.C4,_, NT.D4,_,NT.A4,NT.G4, NT.F4,_,NT.D4,_,
            NT.D4,_,NT.F4,NT.A4, NT.B4,_,NT.A4,NT.F4, NT.G4,_,NT.F4,NT.D4, NT.C4,_,_,_],
      bass: [NT.D3,NT.D3,NT.D3,NT.C3, NT.A3,NT.A3,NT.G3,NT.F3],
    },
    { // 5 — Bouncy (major, playful)
      name: 'BOUNCY', step: 0.15, wave: 'square',
      mel: [NT.G4,_,NT.B4,NT.D5, NT.G5,_,NT.D5,_, NT.E5,_,NT.C5,_, NT.G4,_,_,_,
            NT.C5,_,NT.E5,NT.G5, NT.E5,_,NT.C5,_, NT.D5,NT.E5,NT.D5,NT.B4, NT.G4,_,_,_],
      bass: [NT.G3,NT.G3,NT.C4,NT.C4, NT.E3,NT.E3,NT.D3,NT.D3],
    },
  ];

  let trackIdx = 0;
  try { trackIdx = Math.min(TRACKS.length - 1, Math.max(0, parseInt(localStorage.getItem('weponare_track')) || 0)); } catch {}

  function startMusic() {
    if (!ctx || musicPlaying) return;
    musicPlaying = true;
    musicStep = 0;
    scheduleTrack();
  }
  function scheduleTrack() {
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
    const tr = TRACKS[trackIdx];
    musicTimer = setInterval(() => {
      if (muted || !ctx) return;
      const mel = tr.mel[musicStep % tr.mel.length];
      if (mel) tone(mel, tr.step * 0.85, tr.wave, 0.15, null, musicGain);
      if (musicStep % 2 === 0) {
        const bass = tr.bass[(musicStep / 2 | 0) % tr.bass.length];
        if (bass) tone(bass / 2, tr.step * 1.7, 'triangle', 0.22, null, musicGain);
      }
      musicStep++;
    }, tr.step * 1000);
  }
  function stopMusic() {
    musicPlaying = false;
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }
  // Idempotently match music playback to whether we're in gameplay.
  function syncMusic(inGame) { if (inGame) startMusic(); else stopMusic(); }

  // Cycle to the next track; reschedule live if music is playing. Returns {idx,name,count}.
  function changeTrack() {
    trackIdx = (trackIdx + 1) % TRACKS.length;
    try { localStorage.setItem('weponare_track', String(trackIdx)); } catch {}
    if (musicPlaying) { musicStep = 0; scheduleTrack(); }
    return { idx: trackIdx, name: TRACKS[trackIdx].name, count: TRACKS.length };
  }
  function trackInfo() { return { idx: trackIdx, name: TRACKS[trackIdx].name, count: TRACKS.length }; }

  function toggleMute() {
    muted = !muted;
    try { localStorage.setItem('weponare_muted', muted ? '1' : '0'); } catch {}
    if (masterGain) masterGain.gain.value = muted ? 0 : 0.7;
    return muted;
  }
  function isMuted() { return muted; }

  return { init, resume, sfx, startMusic, stopMusic, syncMusic, toggleMute, isMuted, changeTrack, trackInfo };
})();

if (typeof window !== 'undefined') window.GameAudio = GameAudio;
