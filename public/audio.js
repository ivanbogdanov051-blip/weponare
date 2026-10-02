'use strict';

// ─── GameAudio ──────────────────────────────────────────────────────────────
// All sound is synthesized at runtime with the Web Audio API — no asset files,
// so it works offline and on Android with zero downloads. Must be init()'d from
// a user gesture (button click / keypress) due to browser autoplay policy.

const GameAudio = (() => {
  let ctx = null;
  let masterGain = null, musicGain = null, sfxGain = null;
  let muted = false;
  let musicPlaying = false, musicTimer = null;

  try { muted = localStorage.getItem('weponare_muted') === '1'; } catch {}

  function init() {
    if (ctx) { resume(); return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = muted ? 0 : 0.7;
      masterGain.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.22;
      musicGain.connect(masterGain);
      // Sound effects sit well under the music so it can be heard in a fight.
      sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.38;
      sfxGain.connect(masterGain);
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
    o.connect(g); g.connect(dest || sfxGain);
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
    src.connect(filt); filt.connect(g); g.connect(sfxGain);
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
    trap()   { tone(120, 0.3, 'sawtooth', 0.3, 50); noise(0.25, 0.28, 900); },
    pickup() { tone(660, 0.08, 'square', 0.2, 990); setTimeout(() => tone(990, 0.1, 'square', 0.2, 1320), 70); },
    useitem(){ [440, 660, 880].forEach((f, i) => setTimeout(() => tone(f, 0.12, 'triangle', 0.22), i * 60)); },
  };

  // ── Background music ──
  // Songs are composed once, from a compact description: a key and scale, a
  // chord progression, a tempo and a mix of voices (lead, bass, arpeggio, pad,
  // drums). The composer lays them out as a full arrangement — intro, theme,
  // contrast, breakdown, climax — and repeats it until the song runs past two
  // minutes, so a track doesn't loop every few seconds. Melodies are written
  // relative to each bar's chord, so they follow the harmony.
  const SCALES = {
    minor: [0,2,3,5,7,8,10], major: [0,2,4,5,7,9,11], dorian: [0,2,3,5,7,9,10],
    phrygian: [0,1,3,5,7,8,10], harmonic: [0,2,3,5,7,8,11], mixolydian: [0,2,4,5,7,9,10],
    lydian: [0,2,4,6,7,9,11], pentatonic: [0,3,5,7,10],
  };
  // Note rhythms for one bar (16 steps), by how busy the melody should be.
  const RHYTHMS = {
    sparse: [[0,8],[0,6,8],[0,4,8,12],[0,10]],
    mid:    [[0,3,6,8,11,14],[0,2,4,8,10,12],[0,4,6,8,12,14],[0,3,8,11]],
    dense:  [[0,2,4,6,8,10,12,14],[0,1,3,4,6,8,9,11,12,14],[0,2,3,4,6,7,8,10,12,14]],
  };
  // Bass lines per bar: [step, scale-degree offset, length in steps]. 99 = octave.
  const BASS = {
    root8:  [[0,0,2],[2,0,2],[4,0,2],[6,0,2],[8,0,2],[10,0,2],[12,0,2],[14,99,2]],
    oct:    [[0,0,2],[2,99,2],[4,0,2],[6,99,2],[8,0,2],[10,99,2],[12,0,2],[14,99,2]],
    half:   [[0,0,8],[8,4,8]],
    synco:  [[0,0,3],[3,0,3],[6,4,2],[8,0,3],[11,0,3],[14,4,2]],
    walk:   [[0,0,4],[4,2,4],[8,4,4],[12,2,4]],
    drive:  [[0,0,1],[1,0,1],[2,0,2],[4,0,1],[5,0,1],[6,0,2],[8,0,1],[9,0,1],[10,0,2],[12,0,1],[13,0,1],[14,0,2]],
    gallop: Array.from({ length: 16 }, (_, i) => [i, i % 8 === 7 ? 4 : 0, 1]),
    whole:  [[0,0,16]],
  };
  const everyOther = [0,2,4,6,8,10,12,14];
  // Drum patterns: step lists for kick, snare, hat, open hat.
  const DRUMS = {
    rock:    { k: [0,8,10],  s: [4,12], h: everyOther },
    four:    { k: [0,4,8,12], s: [4,12], h: [2,6,10,14], o: [2,6,10,14] },
    half:    { k: [0],       s: [8],    h: everyOther },
    dnb:     { k: [0,10],    s: [4,12,15], h: everyOther },
    march:   { k: [0,8],     s: [4,12,14,15], h: [] },
    metal:   { k: [0,1,3,6,8,9,11,14], s: [4,12], h: [0,4,8,12] },
    shuffle: { k: [0,8],     s: [4,12], h: [0,3,6,8,11,14] },
    soft:    { k: [0],       s: [],     h: [4,12] },
    none:    { k: [],        s: [],     h: [] },
  };

  const TRACKS = [
    { name: 'HEROIC', bpm: 138, root: 57, scale: 'minor', prog: [0,5,2,6], prog2: [5,6,0,4], lead: 'square', bass: 'oct', bassWave: 'triangle',
      drums: 'rock', arp: 'bc', arpRate: 2, dens: 'mid', form: 'IAABACBDAD', seed: 11 },
    { name: 'FRANTIC', bpm: 172, root: 52, scale: 'harmonic', prog: [0,5,3,4], prog2: [3,4,0,0], lead: 'square', bass: 'drive', bassWave: 'sawtooth',
      drums: 'dnb', arp: 'always', arpRate: 2, dens: 'dense', form: 'IAABACBDAD', seed: 22 },
    { name: 'CALM', bpm: 76, root: 53, scale: 'major', prog: [0,4,5,3], prog2: [3,0,4,4], lead: 'triangle', leadVol: 0.16, bass: 'whole', bassWave: 'triangle',
      drums: 'none', arp: 'always', arpRate: 2, arpWave: 'sine', pad: true, dens: 'sparse', legato: 1, form: 'IAABACBAAB', seed: 33 },
    { name: 'DARK', bpm: 104, root: 50, scale: 'phrygian', prog: [0,0,5,6], prog2: [0,1,5,1], lead: 'sawtooth', leadVol: 0.1, bass: 'synco', bassWave: 'triangle',
      drums: 'half', arp: 'none', pad: true, dens: 'sparse', form: 'IAABACBDAD', seed: 44 },
    { name: 'BOUNCY', bpm: 152, root: 55, scale: 'major', prog: [0,3,4,0], prog2: [5,3,4,0], lead: 'square', bass: 'oct', bassWave: 'triangle',
      drums: 'march', arp: 'bc', arpRate: 2, dens: 'mid', form: 'IAABACBDAD', seed: 55 },
    { name: 'SEA SHANTY', bpm: 126, root: 50, scale: 'dorian', prog: [0,6,0,4], prog2: [3,6,0,4], lead: 'square', leadVol: 0.11, bass: 'oct', bassWave: 'triangle',
      drums: 'shuffle', arp: 'none', swing: 0.3, dens: 'mid', form: 'IAABACBDAD', seed: 66 },
    { name: 'DESERT WIND', bpm: 112, root: 52, scale: 'harmonic', prog: [0,5,0,4], prog2: [3,4,0,0], lead: 'sawtooth', leadVol: 0.09, bass: 'half', bassWave: 'triangle',
      drums: 'march', arp: 'always', arpRate: 2, arpWave: 'sine', dens: 'mid', form: 'IAABACBDAD', seed: 77 },
    { name: 'BOSS FIGHT', bpm: 156, root: 48, scale: 'minor', prog: [0,5,6,4], prog2: [3,6,4,0], lead: 'sawtooth', leadVol: 0.1, bass: 'gallop', bassWave: 'sawtooth',
      drums: 'metal', arp: 'none', dens: 'dense', form: 'IAABACBDDA', seed: 88 },
    { name: 'STARLIGHT', bpm: 92, root: 53, scale: 'lydian', prog: [0,1,4,0], prog2: [3,4,1,0], lead: 'sine', leadVol: 0.17, bass: 'half', bassWave: 'sine',
      drums: 'soft', arp: 'always', arpRate: 1, arpWave: 'sine', pad: true, dens: 'sparse', legato: 1, form: 'IAABACBAAB', seed: 99 },
    { name: 'ARCADE', bpm: 164, root: 55, scale: 'mixolydian', prog: [0,6,3,0], prog2: [3,4,0,0], lead: 'square', bass: 'oct', bassWave: 'square',
      drums: 'rock', arp: 'bc', arpRate: 1, dens: 'dense', form: 'IAABACBDAD', seed: 110 },
    { name: 'CASTLE', bpm: 88, root: 50, scale: 'minor', prog: [0,3,4,0], prog2: [5,3,4,4], lead: 'triangle', leadVol: 0.16, bass: 'half', bassWave: 'triangle',
      drums: 'march', arp: 'bc', arpRate: 2, pad: true, dens: 'mid', form: 'IAABACBDAD', seed: 121 },
    { name: 'NEON NIGHTS', bpm: 124, root: 57, scale: 'minor', prog: [0,3,5,4], prog2: [5,3,0,4], lead: 'sawtooth', leadVol: 0.09, bass: 'oct', bassWave: 'sawtooth',
      drums: 'four', arp: 'always', arpRate: 2, dens: 'mid', form: 'IAABACBDAD', seed: 132 },
    { name: 'FOREST', bpm: 96, root: 52, scale: 'dorian', prog: [0,3,5,4], prog2: [3,6,0,0], lead: 'triangle', leadVol: 0.15, bass: 'walk', bassWave: 'triangle',
      drums: 'soft', arp: 'always', arpRate: 2, pad: true, dens: 'mid', form: 'IAABACBAAB', seed: 143 },
    { name: 'THUNDER', bpm: 180, root: 52, scale: 'phrygian', prog: [0,0,1,6], prog2: [0,5,6,1], lead: 'sawtooth', leadVol: 0.1, bass: 'gallop', bassWave: 'sawtooth',
      drums: 'metal', arp: 'none', dens: 'dense', form: 'IAABACBDDA', seed: 154 },
    { name: 'ANCIENT', bpm: 98, root: 55, scale: 'pentatonic', prog: [0,2,3,1], prog2: [0,3,1,4], lead: 'triangle', leadVol: 0.16, bass: 'half', bassWave: 'triangle',
      drums: 'soft', arp: 'always', arpRate: 2, arpWave: 'sine', pad: true, dens: 'sparse', legato: 1, form: 'IAABACBAAB', seed: 165 },
    { name: 'VICTORY', bpm: 144, root: 58, scale: 'major', prog: [0,4,5,3], prog2: [3,4,0,0], lead: 'square', bass: 'oct', bassWave: 'triangle',
      drums: 'rock', arp: 'bc', arpRate: 2, dens: 'mid', form: 'IAABACBDAD', seed: 176 },
    { name: 'BLUES', bpm: 106, root: 57, scale: 'minor', prog: [0,3,0,4], prog2: [3,3,0,4], lead: 'square', leadVol: 0.1, bass: 'walk', bassWave: 'triangle',
      drums: 'shuffle', arp: 'none', swing: 0.32, dens: 'mid', form: 'IAABACBDAD', seed: 187 },
    { name: 'CYBERPUNK', bpm: 138, root: 50, scale: 'minor', prog: [0,6,5,6], prog2: [3,5,6,4], lead: 'sawtooth', leadVol: 0.09, bass: 'drive', bassWave: 'square',
      drums: 'dnb', arp: 'always', arpRate: 1, dens: 'dense', form: 'IAABACBDAD', seed: 198 },
    { name: 'LULLABY', bpm: 66, root: 55, scale: 'major', prog: [0,3,0,4], prog2: [5,3,4,0], lead: 'sine', leadVol: 0.18, bass: 'whole', bassWave: 'sine',
      drums: 'none', arp: 'bc', arpRate: 2, arpWave: 'sine', pad: true, dens: 'sparse', legato: 1, form: 'IAABACBAAB', seed: 209 },
    { name: 'CHAOS', bpm: 188, root: 51, scale: 'phrygian', prog: [0,1,6,1], prog2: [5,6,1,0], lead: 'sawtooth', leadVol: 0.1, bass: 'gallop', bassWave: 'sawtooth',
      drums: 'metal', arp: 'always', arpRate: 1, dens: 'dense', form: 'IAABACBDDA', seed: 220 },
  ];
  const SHUFFLE = TRACKS.length;   // one extra choice: a new random song each time one ends

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Lay a track out as a list of events per 16th-note step.
  function buildSong(def) {
    const rng = mulberry32(def.seed);
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    const scale = SCALES[def.scale], L = scale.length;
    const midi = (d) => def.root + scale[((d % L) + L) % L] + 12 * Math.floor(d / L);
    // Keep every pitch in a comfortable range: nothing shrill, nothing muddy.
    const hz = (m) => { while (m > 88) m -= 12; return 440 * Math.pow(2, (m - 69) / 12); };
    const stepDur = 60 / def.bpm / 4, barSec = stepDur * 16;
    const legato = def.legato || 0.88;

    let form = def.form.split('');
    const base = form.filter(c => c !== 'I');
    while (form.length * 4 * barSec < 125) form = form.concat(base);
    const steps = form.length * 64;
    const ev = new Array(steps);
    const add = (s, e) => { (ev[s] || (ev[s] = [])).push(e); };

    // A two-bar melodic phrase, as degrees relative to each bar's chord root.
    const CT = [-3, 0, 2, 4, 7, 9];
    const makePhrase = (dens, lift, firstBar) => {
      const bars = [];
      let prev = pick([0, 2, 4]);
      for (let b = 0; b < 2; b++) {
        if (b === 0 && firstBar) { bars.push(firstBar); prev = firstBar[firstBar.length - 1].rel - lift; continue; }
        const rh = pick(RHYTHMS[dens]);
        const notes = rh.map((st, i) => {
          let rel;
          if (b === 1 && i === rh.length - 1) rel = pick([0, 0, 4, 2]);
          else if (st % 4 === 0 && rng() < 0.75) rel = CT.slice().sort((x, y) => Math.abs(x - prev) + rng() * 2.5 - Math.abs(y - prev) - rng() * 2.5)[0];
          else rel = Math.max(-3, Math.min(9, prev + pick([-2, -1, -1, 0, 1, 1, 2])));
          prev = rel;
          return { st, rel: rel + lift, len: (i + 1 < rh.length ? rh[i + 1] : 16) - st };
        });
        bars.push(notes);
      }
      return bars;
    };
    const dens = def.dens || 'mid';
    const busier = dens === 'sparse' ? 'mid' : 'dense';
    const A = makePhrase(dens, 0), A2 = makePhrase(dens, 0, A[0]);
    const B = makePhrase(busier, 2), B2 = makePhrase(busier, 2, B[0]);
    const D = makePhrase('dense', 0), D2 = makePhrase('dense', 0, D[0]);
    const themes = { A: [A[0], A[1], A[0], A2[1]], B: [B[0], B[1], B[0], B2[1]], D: [D[0], D[1], D[0], D2[1]] };
    const prog2 = def.prog2 || [def.prog[2], def.prog[3], def.prog[0], def.prog[1]];
    const kitOf = (name) => DRUMS[name] || DRUMS.none;

    form.forEach((sec, si) => {
      const prog = (sec === 'B' || sec === 'D') ? prog2 : def.prog;
      for (let b = 0; b < 4; b++) {
        const g0 = (si * 4 + b) * 16, root = prog[b];
        const quiet = sec === 'I' || sec === 'C';

        // Pad: the chord held for the bar.
        if (def.pad || quiet) {
          for (const k of [0, 2, 4]) add(g0, ['pad', hz(midi(root + k)), stepDur * 15.5]);
        }
        // Bass: not in the intro; plain roots in the breakdown.
        if (sec !== 'I') {
          const pat = BASS[sec === 'C' ? (def.bass === 'gallop' || def.bass === 'drive' ? 'half' : def.bass) : def.bass];
          for (const [st, rel, len] of pat) {
            add(g0 + st, ['bass', hz(midi(root + (rel === 99 ? L : rel)) - 12), Math.max(stepDur * 0.9, len * stepDur * 0.92)]);
          }
        }
        // Lead.
        if (sec === 'A' || sec === 'B' || sec === 'D') {
          for (const n of themes[sec][b]) {
            const d = Math.max(stepDur * 0.9, n.len * stepDur * legato);
            add(g0 + n.st, ['lead', hz(midi(root + n.rel) + 12), d]);
            if (sec === 'D') add(g0 + n.st, ['lead2', hz(midi(root + n.rel - 2) + 12), d]);
          }
        } else if (sec === 'C') {
          // Breakdown: two long notes a bar.
          add(g0, ['lead', hz(midi(root + pick([2, 4, 7])) + 12), stepDur * 7.5]);
          add(g0 + 8, ['lead', hz(midi(root + pick([4, 2, 0])) + 12), stepDur * 7.5]);
        }
        // Arpeggio: a running chord, an octave up when nothing else is playing high.
        const arpOn = def.arp === 'always' ? true : def.arp === 'bc' ? (sec === 'B' || sec === 'C' || sec === 'I') : false;
        if (arpOn) {
          const rate = def.arpRate || 2, shape = [0, 2, 4, 7, 4, 2];
          const hi = (sec === 'A' || sec === 'B' || sec === 'D') ? 0 : 12;
          for (let st = 0, i = 0; st < 16; st += rate, i++) {
            add(g0 + st, ['arp', hz(midi(root + shape[i % shape.length]) + hi), Math.max(stepDur * 0.9, rate * stepDur * 0.8)]);
          }
        }
        // Drums: none in the intro, a skeleton in the breakdown, extra hats in the climax.
        if (def.drums !== 'none' && sec !== 'I') {
          const kit = kitOf(sec === 'C' ? 'soft' : def.drums);
          for (const s of kit.k) add(g0 + s, ['k']);
          for (const s of kit.s) add(g0 + s, ['s']);
          for (const s of kit.h) add(g0 + s, ['h']);
          for (const s of (kit.o || [])) add(g0 + s, ['oh']);
          if (sec === 'D') for (let s = 1; s < 16; s += 2) add(g0 + s, ['h']);
          if (b === 3 && sec !== 'C') for (const s of [12, 13, 14, 15]) add(g0 + s, ['s']);
          if (b === 0 && (sec === 'B' || sec === 'D')) add(g0, ['crash']);
        }
      }
    });
    return { def, ev, steps, stepDur, seconds: steps * stepDur };
  }

  // ── Voices ──
  let noiseBuf = null;
  function getNoise() {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }
  function note(when, freq, dur, type, vol, attack) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(vol, when + (attack || 0.008));
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol * 0.55), when + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g); g.connect(bus);
    o.start(when); o.stop(when + dur + 0.03);
  }
  function drumNoise(when, dur, vol, filterType, freq) {
    const src = ctx.createBufferSource(); src.buffer = getNoise();
    const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(f); f.connect(g); g.connect(bus);
    src.start(when, Math.random() * 0.5); src.stop(when + dur + 0.02);
  }
  function kick(when) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(165, when);
    o.frequency.exponentialRampToValueAtTime(42, when + 0.13);
    g.gain.setValueAtTime(0.55, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.2);
    o.connect(g); g.connect(bus);
    o.start(when); o.stop(when + 0.22);
  }
  function playEvent(e, when) {
    const def = song.def;
    switch (e[0]) {
      case 'lead':  note(when, e[1], e[2], def.lead, def.leadVol || 0.13); break;
      case 'lead2': note(when, e[1], e[2], 'triangle', 0.08); break;
      case 'bass':  note(when, e[1], e[2], def.bassWave || 'triangle', def.bassWave === 'sawtooth' ? 0.13 : 0.2); break;
      case 'arp':   note(when, e[1], e[2], def.arpWave || 'square', 0.055); break;
      case 'pad':   note(when, e[1], e[2], 'triangle', 0.05, 0.25); break;
      case 'k':     kick(when); break;
      case 's':     drumNoise(when, 0.13, 0.3, 'bandpass', 1900); note(when, 190, 0.09, 'triangle', 0.18); break;
      case 'h':     drumNoise(when, 0.04, 0.1, 'highpass', 7500); break;
      case 'oh':    drumNoise(when, 0.16, 0.08, 'highpass', 7000); break;
      case 'crash': drumNoise(when, 1.1, 0.1, 'highpass', 4500); break;
    }
  }

  // ── Playback ──
  let trackIdx = 0;
  try { trackIdx = Math.min(SHUFFLE, Math.max(0, parseInt(localStorage.getItem('weponare_track')) || 0)); } catch {}
  const songs = {};
  let song = null, songId = 0;
  let bus = null, stepPos = 0, nextTime = 0, previewTimer = null;

  function fadeOut(node, secs) {
    try {
      node.gain.cancelScheduledValues(0);
      node.gain.setValueAtTime(node.gain.value, ctx.currentTime);
      node.gain.linearRampToValueAtTime(0, ctx.currentTime + secs);
    } catch {}
    setTimeout(() => { try { node.disconnect(); } catch {} }, 1500);
  }
  function loadSong(id) {
    songId = id;
    if (!songs[id]) songs[id] = buildSong(TRACKS[id]);
    song = songs[id];
    // Every song plays through its own bus, so switching can fade the old one
    // out at once even though its notes are already scheduled.
    if (bus) fadeOut(bus, 0.12);
    bus = ctx.createGain(); bus.gain.value = 1; bus.connect(musicGain);
    stepPos = 0; nextTime = ctx.currentTime + 0.1;
  }
  function randomSong() {
    let id;
    do { id = Math.floor(Math.random() * TRACKS.length); } while (id === songId && TRACKS.length > 1);
    return id;
  }
  function currentName() { return trackIdx === SHUFFLE ? 'SHUFFLE' : TRACKS[trackIdx].name; }

  // Scheduled a little ahead of time, so timing is steady even when the page is busy.
  function tick() {
    if (!ctx || !musicPlaying || !song) return;
    const now = ctx.currentTime;
    if (nextTime < now - 0.5) nextTime = now + 0.05;   // we fell behind (hidden tab): carry on from here
    while (nextTime < now + 0.7) {
      const evs = song.ev[stepPos];
      if (evs && !muted) {
        const sw = (stepPos % 2 === 1 ? (song.def.swing || 0) * song.stepDur : 0);
        for (const e of evs) playEvent(e, nextTime + sw);
      }
      nextTime += song.stepDur;
      if (++stepPos >= song.steps) {
        stepPos = 0;
        if (trackIdx === SHUFFLE) loadSong(randomSong());
      }
    }
  }

  function startMusic() {
    if (!ctx || musicPlaying) return;
    musicPlaying = true;
    loadSong(trackIdx === SHUFFLE ? randomSong() : trackIdx);
    musicTimer = setInterval(tick, 80);
    tick();
  }
  function stopMusic() {
    musicPlaying = false;
    if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
    if (bus) { fadeOut(bus, 0.15); bus = null; }
  }
  // Idempotently match music playback to whether we're in gameplay. A match
  // taking over also cancels any menu preview timer.
  function syncMusic(inGame) {
    if (inGame) { if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; } startMusic(); }
    else if (!previewTimer) stopMusic();
  }

  // Cycle to the next track (the last choice is SHUFFLE). Switches live; from
  // the menu, preview() plays a few seconds of it. Returns {idx,name,count}.
  function changeTrack() {
    trackIdx = (trackIdx + 1) % (TRACKS.length + 1);
    try { localStorage.setItem('weponare_track', String(trackIdx)); } catch {}
    if (ctx && musicPlaying) loadSong(trackIdx === SHUFFLE ? randomSong() : trackIdx);
    return trackInfo();
  }
  // Menu: hear the current track for a few seconds.
  function preview() {
    if (!ctx || muted) return;
    if (musicPlaying && !previewTimer) return;    // already playing in a match
    if (previewTimer) clearTimeout(previewTimer);
    if (musicPlaying) loadSong(trackIdx === SHUFFLE ? randomSong() : trackIdx); else startMusic();
    previewTimer = setTimeout(() => { previewTimer = null; stopMusic(); }, 12000);
  }
  function trackInfo() { return { idx: trackIdx, name: currentName(), count: TRACKS.length + 1 }; }

  function toggleMute() {
    muted = !muted;
    try { localStorage.setItem('weponare_muted', muted ? '1' : '0'); } catch {}
    if (masterGain) masterGain.gain.value = muted ? 0 : 0.7;
    return muted;
  }
  function isMuted() { return muted; }

  return { init, resume, sfx, startMusic, stopMusic, syncMusic, toggleMute, isMuted, changeTrack, trackInfo, preview, _debug: { TRACKS, buildSong } };
})();

if (typeof window !== 'undefined') window.GameAudio = GameAudio;
