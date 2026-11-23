'use strict';
// CUSTOM WEAPONS: made by a player for ◆1,000,000 and ALL their progress. Each of
// its moves (ATK, SPECIAL, SUPER, ULTIMATE) is either borrowed from a real weapon
// and tuned, or BUILT from scratch (a pattern, effects, and shots with a picture
// the player makes). Then it is checked: a weapon over the
// POWER limit cannot be made. Both sides load this file, so the meter on the
// page and the check on the server are the same sum.
//
// The texture is a small pixel grid: `pal` (up to 15 colours) and `px`, one hex
// digit per pixel, row by row ('0' = see-through, '1' = pal[0]...). Its left side
// is the grip (the hand); the weapon points right.
(function (root) {
  const PRICE = 1000000;
  const MAX_OWNED = 5;                      // custom weapons one account can hold
  // How far each slider goes, in percent of the borrowed move.
  const LIM = { d: [50, 300], s: [50, 200], r: [70, 160], c: [50, 200] };
  const ULT_DMG = 2.5, ULT_CD = 2.5, ULT_MIN_CD = 30000;   // a borrowed ULTIMATE: its move, 2.5x as strong and 2.5x as slow to come back
  const W = { atk: 0.40, sp: 0.25, su: 0.20, ult: 0.15 };  // how much each move counts towards POWER
  const REF = 0.85 * 1.4;                   // the FIRE SPEAR (a secret weapon) on that scale
  const LIMIT = REF * 13;                   // the most a custom weapon may have: thirteen times the Fire Spear
  const TEX = { minW: 8, maxW: 48, minH: 4, maxH: 24, maxPal: 15, minPx: 12 };
  const SHOT = { minW: 3, maxW: 16, minH: 3, maxH: 12, maxPal: 8, minPx: 3 };   // a projectile's picture
  // Moves that only work with their own weapon's machinery: never borrowed.
  const NO_ATK = ['vortex'];
  const NO_MOVE = ['kunaistorm', 'soulstorm', 'absorbheal'];

  // ── BUILD YOUR OWN: moves made from scratch, with shots you draw ──
  // m: how much stronger it makes the move (for POWER).
  const FX = {
    pierce:    { n: 'PIERCE',    m: 1.25, t: 'goes through every foe' },
    homing:    { n: 'HOMING',    m: 1.2,  t: 'turns to chase foes' },
    explode:   { n: 'EXPLODE',   m: 1.35, t: 'blows up, hitting all around' },
    burn:      { n: 'BURN',      m: 1.15, t: 'sets foes on fire' },
    freeze:    { n: 'FREEZE',    m: 1.15, t: 'slows foes down' },
    poison:    { n: 'POISON',    m: 1.15, t: 'venom that keeps hurting' },
    stun:      { n: 'STUN',      m: 1.3,  t: 'stops foes for a moment' },
    chain:     { n: 'CHAIN',     m: 1.35, t: 'lightning jumps to 2 more foes' },
    knock:     { n: 'KNOCKBACK', m: 1.05, t: 'shoves foes away' },
    lifesteal: { n: 'LIFESTEAL', m: 1.2,  t: 'heals you a fifth of the damage' },
    bounce:    { n: 'BOUNCE',    m: 1.1,  t: 'bounces off the walls twice' },
    split:     { n: 'SPLIT',     m: 1.3,  t: 'bursts into 3 smaller shots when it hits' },
    crit:      { n: 'CRIT',      m: 1.25, t: '1 in 4 hits do double damage' },
    execute:   { n: 'EXECUTE',   m: 1.2,  t: 'hits again a foe under 30% health' },
    pull:      { n: 'PULL',      m: 1.1,  t: 'drags foes towards you' },
    curse:     { n: 'CURSE',     m: 1.3,  t: 'every bad effect at once, for a moment' },
    frostbite: { n: 'FROSTBITE', m: 1.2,  t: 'the 3rd hit freezes a foe solid' },
    teleport:  { n: 'TELEPORT',  m: 1.05, t: 'you jump to where the shot lands' },
  };
  const MAX_FX = 4;
  // PASSIVES: always on while you hold it (up to 2). v: what each one adds to POWER.
  const PAS = {
    regen:  { n: 'REGEN',  t: 'heals 2% of your health every second', v: 0.35 },
    rage:   { n: 'RAGE',   t: '+40% damage while you are under 40% health', v: 0.3 },
    dodge:  { n: 'DODGE',  t: '1 hit in 7 misses you completely', v: 0.35 },
    thorns: { n: 'THORNS', t: 'whoever hits you takes 30% of it back', v: 0.25 },
    revive: { n: 'REVIVE', t: 'once a game, come back at 40% health instead of dying', v: 0.4 },
  };
  const MAX_PAS = 2;
  const cleanPas = l => [...new Set((Array.isArray(l) ? l : []).filter(k => PAS[k]))].slice(0, MAX_PAS);
  const PATS = {
    volley: { n: 'VOLLEY', t: 'a fan of shots at the nearest foe',          shots: true,  hits: b => Math.pow(b.n, 0.6) },
    ring:   { n: 'RING',   t: 'shots fly out all around you',               shots: true,  hits: b => Math.pow(b.n, 0.45) },
    rain:   { n: 'RAIN',   t: 'shots fall from the sky on the foes near you', shots: true, hits: b => Math.pow(Math.min(b.n, 8), 0.75) },
    orbit:  { n: 'ORBIT',  t: 'shots circle you, hitting what they touch',  shots: true,  hits: b => Math.pow(b.n, 0.5) * Math.pow(b.dur / 1000, 0.6) * Math.pow(b.ospin / 32, 0.3) * Math.pow(b.orad / 50, 0.2) },
    nova:   { n: 'NOVA',   t: 'a blast all around you',                     shots: false, hits: b => 1.6 * Math.pow(b.range / 120, 0.3) },
    beam:   { n: 'BEAM',   t: 'a beam through everything in a line',        shots: false, hits: () => 1.5 },
    dash:   { n: 'DASH',   t: 'dash through the nearest foe, hitting all on the way', shots: false, hits: () => 1.3 },
    backfire: { n: 'BACKFIRE', t: 'shots fly out BEHIND you (behind your dash, after a DASH)', shots: true, hits: b => Math.pow(b.n, 0.5) },
    mines:  { n: 'MINES',  t: 'shots drop around you and wait there, hitting whoever steps on them', shots: true, hits: b => Math.pow(b.n, 0.5) * Math.pow(b.dur / 1000, 0.3) },
    spiral: { n: 'SPIRAL', t: 'shots fire one after another, turning round you', shots: true, hits: b => Math.pow(b.n, 0.5) },
  };
  const MAX_STEPS = 3;                      // a move can be up to 3 patterns, one after another (a COMBO)
  // [lowest, highest, to start with]
  const B = {
    shot:  { dmg: [5, 200, 30], n: [1, 7, 1], speed: [3, 14, 7], range: [100, 520, 220], wait: [120, 3000, 650] },
    swing: { dmg: [5, 260, 40], range: [30, 140, 60], wait: [150, 3000, 800] },
    move:  { dmg: [5, 900, 60], n: [1, 24, 5], range: [60, 600, 260], cd: [1500, 60000, 8000], dur: [1000, 8000, 3000],
             orad: [24, 140, 50], ospin: [5, 80, 32], delay: [0, 2000, 250] },   // ORBIT's size, its spin (tenths of a turn-radian a second); a step's wait
  };
  const ULT_BUILD_MIN_CD = 15000;
  // What a common weapon does a second (ATK, SPECIAL) and a legendary's SUPER: a built move like that scores 1.
  const REF_ATK = 46, REF_SP = 9.4, REF_SU = 5;

  const tier = w => !w ? 0 : w.secret ? 1.4 : w.mythic ? 1.3 : w.uncommon ? 1.05 : w.shopOnly ? 1.15 : 1;
  const clamp = (v, [a, b]) => Math.max(a, Math.min(b, Math.round(Number(v) || 100)));
  const pct = (v, k) => clamp(v, LIM[k]) / 100;
  const okSrc = w => !!w && !w.custom;
  const num = (v, [a, b, def]) => { const n = Math.round(Number(v)); return Math.max(a, Math.min(b, Number.isFinite(n) ? n : def)); };
  const cleanFx = fx => [...new Set((Array.isArray(fx) ? fx : []).filter(k => FX[k]))].slice(0, MAX_FX);
  const fxMult = fx => fx.reduce((m, k) => m * FX[k].m, 1);
  const isBuild = m => !!m && m.mode === 'build';

  // A built ATK or move, with every number inside its limits.
  function cleanAtkB(r) {
    if (r.style === 'both') {               // SWING + SHOTS: it hits close and fires too
      const L = B.swing, Q = B.shot;
      return { mode: 'build', style: 'both', dmg: num(r.dmg, L.dmg), range: num(r.range, L.range), wait: num(r.wait, L.wait), spin: !!r.spin,
               sdmg: num(r.sdmg, Q.dmg), n: num(r.n, Q.n), speed: num(r.speed, Q.speed), srange: num(r.srange, Q.range), fx: cleanFx(r.fx), shot: cleanTex(r.shot, SHOT) };
    }
    if (r.style === 'swing') { const L = B.swing; return { mode: 'build', style: 'swing', dmg: num(r.dmg, L.dmg), range: num(r.range, L.range), wait: num(r.wait, L.wait), spin: !!r.spin }; }
    const L = B.shot;
    return { mode: 'build', style: 'shot', dmg: num(r.dmg, L.dmg), n: num(r.n, L.n), speed: num(r.speed, L.speed), range: num(r.range, L.range),
             wait: num(r.wait, L.wait), fx: cleanFx(r.fx), shot: cleanTex(r.shot, SHOT) };
  }
  // One pattern of a move (the move itself is the first; a COMBO adds more).
  function cleanStep(r) {
    const L = B.move, pat = PATS[r && r.pat] ? r.pat : 'volley';
    return { pat, dmg: num(r.dmg, L.dmg), n: num(r.n, L.n), range: num(r.range, L.range), dur: num(r.dur, L.dur),
             orad: num(r.orad, L.orad), ospin: num(r.ospin, L.ospin), delay: num(r.delay, L.delay) };
  }
  function cleanMoveB(r, ult) {
    const L = B.move, first = cleanStep(r);
    const steps = (Array.isArray(r.steps) ? r.steps : []).slice(0, MAX_STEPS - 1).map(cleanStep);
    const shots = [first, ...steps].some(s => PATS[s.pat].shots);
    const { delay, ...main } = first; void delay;
    return { mode: 'build', ...main, cd: Math.max(ult ? ULT_BUILD_MIN_CD : 0, num(r.cd, L.cd)), fx: cleanFx(r.fx), steps,
             shot: shots ? cleanTex(r.shot, SHOT) : null };
  }
  function atkValue(b) {
    if (b.style === 'both') return atkValue({ ...b, style: 'swing' }) + atkValue({ style: 'shot', dmg: b.sdmg, n: b.n, wait: b.wait, range: b.srange, fx: b.fx });
    if (b.style === 'swing') return (b.dmg * 1000 / b.wait) / REF_ATK * Math.sqrt(b.range / 60) * (b.spin ? 1.3 : 1);
    return (b.dmg * Math.pow(b.n, 0.6) * 1000 / b.wait) / REF_ATK * Math.sqrt(b.range / 180) * fxMult(b.fx);
  }
  const moveValue = (b, ref) => ([b, ...(b.steps || [])].reduce((s, st) => s + st.dmg * PATS[st.pat].hits(st), 0) * fxMult(b.fx) * 1000 / b.cd) / ref;

  // POWER of a spec, given a look-up from weapon id to its definition.
  function power(spec, byId) {
    if (!spec) return 0;
    let s = 0;
    const a = spec.atk;
    if (isBuild(a)) s += W.atk * atkValue(cleanAtkB(a));
    else { const aw = a && byId(a.from); if (aw) s += W.atk * tier(aw) * pct(a.d, 'd') / pct(a.s, 's') * Math.sqrt(pct(a.r, 'r')); }
    for (const [k, part, ref] of [['sp', 'special', REF_SP], ['su', 'super', REF_SU]]) {
      const m = spec[k];
      if (isBuild(m)) { s += W[k] * moveValue(cleanMoveB(m), ref); continue; }
      const w = m && byId(m.from);
      if (w && w[part]) s += W[k] * tier(w) * pct(m.d, 'd') / pct(m.c, 'c');
    }
    for (const k of cleanPas(spec.pas)) s += PAS[k].v;
    const u = spec.ult;
    if (isBuild(u)) s += W.ult * moveValue(cleanMoveB(u, true), REF_SU);
    else { const uw = u && byId(u.from); if (uw && uw[u.part]) s += W.ult * tier(uw) * pct(u.d, 'd') / pct(u.c, 'c'); }
    return s;
  }
  const powerPct = (spec, byId) => Math.round(power(spec, byId) / REF * 100);
  const LIMIT_PCT = Math.round(LIMIT / REF * 100);

  const hex6 = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
  function cleanTex(t, L = TEX) {
    if (!t || typeof t !== 'object') return null;
    const w = Math.floor(t.w), h = Math.floor(t.h);
    if (!(w >= L.minW && w <= L.maxW && h >= L.minH && h <= L.maxH)) return null;
    if (!Array.isArray(t.pal) || !t.pal.length || t.pal.length > L.maxPal || !t.pal.every(hex6)) return null;
    const px = String(t.px || '').toLowerCase();
    if (px.length !== w * h || !/^[0-9a-f]*$/.test(px)) return null;
    let solid = 0;
    for (const ch of px) { const i = parseInt(ch, 16); if (i > t.pal.length) return null; if (i) solid++; }
    if (solid < L.minPx) return null;
    return { w, h, pal: t.pal.map(c => c.toLowerCase()), px };
  }

  // Check a spec from the page. Returns { spec } (cleaned) or { error }.
  function check(raw, byId, names, noLimit) {
    if (!raw || typeof raw !== 'object') return { error: 'Nothing to make.' };
    const name = String(raw.name || '').toUpperCase().replace(/[^A-Z0-9 '\-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);
    if (name.length < 3) return { error: 'Give it a name (3 letters or more).' };
    if (names && names.includes(name)) return { error: 'A weapon is already called ' + name + '.' };
    const color = hex6(raw.color) ? raw.color.toLowerCase() : null;
    if (!color) return { error: 'Pick its colour.' };
    const tex = cleanTex(raw.tex);
    if (!tex) return { error: 'Its texture is missing or too small: generate one, draw one or upload an image.' };
    const a = raw.atk || {};
    let atk;
    if (isBuild(a)) {
      atk = cleanAtkB(a);
      if (atk.style !== 'swing' && !atk.shot) return { error: 'Give your ATK shots a picture (at least 3 pixels).' };
    } else {
      const aw = byId(a.from);
      if (!okSrc(aw) || NO_ATK.includes(a.from)) return { error: 'Pick the ATK it borrows.' };
      atk = { from: a.from, d: clamp(a.d, LIM.d), s: clamp(a.s, LIM.s), r: clamp(a.r, LIM.r) };
    }
    const spec = { name, color, tex, atk, pas: cleanPas(raw.pas) };
    const move = (m, part, need, ult) => {
      if (isBuild(m)) {
        const b = cleanMoveB(m, ult);
        if ([b, ...b.steps].some(s => PATS[s.pat].shots) && !b.shot) return { error: 'Give the shots of its ' + (need || (ult ? 'ULTIMATE' : 'SUPER')) + ' a picture.' };
        return { v: b };
      }
      if (!m || !m.from) return need ? { error: 'Pick its ' + need + '.' } : { v: null };
      const w = byId(m.from), mv = w && w[part];
      if (!okSrc(w) || !mv || NO_MOVE.includes(mv.kind)) return { error: 'That move cannot be borrowed.' };
      return { v: { from: m.from, d: clamp(m.d, LIM.d), c: clamp(m.c, LIM.c) } };
    };
    let r = move(raw.sp, 'special', 'SPECIAL'); if (r.error) return r; spec.sp = r.v;
    r = move(raw.su, 'super'); if (r.error) return r; spec.su = r.v;
    const u = raw.ult;
    if (isBuild(u)) { r = move(u, 'super', null, true); if (r.error) return r; spec.ult = { ...r.v, part: 'super' }; }
    else if (u && u.from) {
      const part = u.part === 'super' ? 'super' : 'special';
      r = move(u, part); if (r.error) return r;
      spec.ult = { ...r.v, part };
    } else spec.ult = null;
    const p = power(spec, byId);
    if (!noLimit && p > LIMIT) return { error: 'TOO STRONG', power: Math.round(p / REF * 100), limit: LIMIT_PCT };
    spec.power = Math.round(p / REF * 100);
    return { spec };
  }

  // The weapon a spec makes. A borrowed ATK lends its weapon's whole way of
  // fighting (melee or shots, and its tricks); a built one is plain shots or a swing.
  const KEEP_OUT = ['id', 'name', 'price', 'mythic', 'mythicKills', 'mythicNeeds', 'mythicBoss', 'needLegendary', 'needAll', 'needMind',
                    'needLight', 'needSamurai', 'bossReward', 'uncommon', 'from', 'unlockXp', 'special', 'super'];
  function build(id, spec, byId) {
    const a = spec.atk, w = {};
    if (isBuild(a)) {
      if (a.style === 'swing') Object.assign(w, { type: 'melee', damage: a.dmg, range: a.range, atkSpd: a.wait, ...(a.spin ? { swing360: true } : {}) });
      else if (a.style === 'both') Object.assign(w, { type: 'melee', damage: a.dmg, range: a.range, atkSpd: a.wait, ...(a.spin ? { swing360: true } : {}),
                                                      cwShot: { n: a.n, speed: a.speed, fx: a.fx, dmg: a.sdmg, range: a.srange, swing: true } });
      else Object.assign(w, { type: 'ranged', damage: a.dmg, range: a.range, atkSpd: a.wait, cwShot: { n: a.n, speed: a.speed, fx: a.fx } });
    } else {
      const aw = byId(a.from);
      for (const [k, v] of Object.entries(aw)) if (!KEEP_OUT.includes(k)) w[k] = v;
      Object.assign(w, { damage: Math.max(1, Math.round(aw.damage * a.d / 100)), atkSpd: Math.max(70, Math.round(aw.atkSpd * a.s / 100)), range: Math.round(aw.range * a.r / 100) });
    }
    const mv = (m, part, dm, cm, minCd, slot) => {
      if (isBuild(m)) return { kind: 'cwmove', slot, pat: m.pat, dmg: m.dmg, cd: m.cd, n: m.n, range: m.range, dur: m.dur, orad: m.orad, ospin: m.ospin, fx: m.fx, steps: m.steps || [] };
      const src = byId(m.from)[part];
      return { ...src, dmg: Math.max(1, Math.round((src.dmg || 0) * m.d / 100 * dm)), cd: Math.max(minCd || 500, Math.round(src.cd * m.c / 100 * cm)) };
    };
    Object.assign(w, {
      id, name: spec.name, custom: true, secret: true, shopOnly: true, noRequirement: true, price: 0, unlockXp: 0,
      ...(spec.pas && spec.pas.length ? { cwPas: cleanPas(spec.pas) } : {}),
      special: mv(spec.sp, 'special', 1, 1, 0, 'sp'),
      super: spec.su ? mv(spec.su, 'super', 1, 1, 0, 'su') : undefined,
      ultimate: spec.ult ? { ...mv(spec.ult, spec.ult.part, ULT_DMG, ULT_CD, ULT_MIN_CD, 'ult'), part: spec.ult.part } : undefined,
    });
    if (!w.super) delete w.super;
    if (!w.ultimate) delete w.ultimate;
    return w;
  }

  // ── Shot pictures: a few to start from (all fly to the right) ──
  const SHOT_SHAPES = ['orb', 'arrow', 'star', 'shard', 'flame', 'bolt', 'blade', 'skull', 'heart', 'moon', 'diamond', 'ring', 'kunai', 'rock', 'bubble'];
  function genShot(shape, c1, c2) {
    const dims = { orb: [8, 8], arrow: [14, 5], star: [9, 9], shard: [12, 6], flame: [13, 8], bolt: [14, 7], blade: [8, 12], skull: [9, 9], heart: [9, 8], moon: [8, 10], diamond: [9, 9], ring: [9, 9], kunai: [14, 5], rock: [9, 8], bubble: [10, 10] }[shape] || [8, 8];
    const [w, h] = dims, g = new Array(w * h).fill(0);
    const pal = [c1, shade(c1, 0.55), c2, shade(c1, -0.45)];
    const put = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < w && y < h) g[y * w + x] = c; };
    const disc = (x, y, r, c) => { for (let j = -Math.ceil(r); j <= r; j++) for (let i = -Math.ceil(r); i <= r; i++) if (i * i + j * j <= r * r) put(x + i, y + j, c); };
    switch (shape) {
      case 'arrow': for (let x = 1; x < 10; x++) put(x, 2, 3); for (let x = 10; x < 14; x++) for (let y = 2 - (13 - x) * 0.6; y <= 2 + (13 - x) * 0.6; y++) put(x, y, 1);
        put(13, 2, 2); put(0, 0, 2); put(1, 1, 2); put(0, 4, 2); put(1, 3, 2); break;
      case 'star': for (let i = -4; i <= 4; i++) { put(4 + i, 4, 1); put(4, 4 + i, 1); if (Math.abs(i) < 3) { put(4 + i, 4 + i, 1); put(4 + i, 4 - i, 1); } } disc(4, 4, 1.5, 2); put(4, 4, 2); break;
      case 'shard': for (let x = 0; x < 12; x++) { const hw = x < 4 ? x * 0.7 : (11 - x) * 0.35; for (let y = -hw; y <= hw; y++) put(x, 2.5 + y, y < 0 ? 2 : 1); } put(11, 2.5, 2); break;
      case 'flame': for (let x = 0; x < 9; x++) { const hw = x * 0.35; for (let y = -hw; y <= hw; y++) put(x, 4 + y, (x + Math.round(y)) % 3 ? 3 : 1); }
        disc(9, 4, 3, 1); disc(9.5, 4, 1.6, 2); break;
      case 'bolt': { const pts = [[0, 1], [5, 1], [3, 5], [9, 5], [7, 2], [13, 3]]; for (let i = 0; i < pts.length - 1; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let k = 0; k <= n; k++) { put(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, 1); put(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n + 1, 2); } } break; }
      case 'blade': for (let t = -1.3; t <= 1.3; t += 0.05) for (let r = 4.5; r <= 7 - Math.abs(t) * 1.5; r += 0.5) put(1 + Math.cos(t) * r, 6 + Math.sin(t) * r, r > 6 ? 2 : 1); break;
      case 'skull': disc(4, 3.5, 3.5, 2); for (let x = 2; x <= 6; x++) put(x, 7, 2); put(3, 8, 2); put(5, 8, 2); put(2, 3, 4); put(3, 3, 4); put(5, 3, 4); put(6, 3, 4); put(4, 5, 4); break;
      case 'heart': disc(2.5, 2.5, 2.2, 1); disc(6.5, 2.5, 2.2, 1); for (let y = 3; y < 8; y++) for (let x = y - 3; x <= 11 - y; x++) put(x, y, 1); put(2, 2, 2); put(1, 2, 2); break;
      case 'moon': disc(4, 5, 4.2, 1); for (let y = 0; y < 10; y++) for (let x = 0; x < 8; x++) if ((x - 6.2) * (x - 6.2) + (y - 4.5) * (y - 4.5) < 11) g[y * w + x] = 0; put(1, 4, 2); put(1, 5, 2); break;
      case 'diamond': for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) if (Math.abs(x - 4) + Math.abs(y - 4) <= 4) put(x, y, x + y < 8 ? 2 : Math.abs(x - 4) + Math.abs(y - 4) === 4 ? 4 : 1); break;
      case 'ring': for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) { const d = Math.hypot(x - 4, y - 4); if (d <= 4.3 && d >= 2.4) put(x, y, d > 3.6 ? 1 : 2); } break;
      case 'kunai': put(0, 2, 3); put(1, 1, 3); put(1, 3, 3); put(0, 0, 3); put(0, 4, 3); for (let x = 1; x < 6; x++) put(x, 2, 4); for (let x = 6; x < 14; x++) for (let y = -(13 - x) * 0.3; y <= (13 - x) * 0.3; y++) put(x, 2 + y, y < 0 ? 2 : 1); break;
      case 'rock': for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) if (Math.hypot((x - 4) / 4.3, (y - 3.7) / 3.6) <= 1) put(x, y, (x * 7 + y * 3) % 5 === 0 ? 4 : y < 3 ? 2 : 1); break;
      case 'bubble': for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) { const d = Math.hypot(x - 4.5, y - 4.5); if (d <= 4.6 && d > 3.7) put(x, y, 1); } put(3, 2, 2); put(2, 3, 2); put(3, 3, 2); break;
      default: disc(3.5, 3.5, 3.6, 1); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (g[y * w + x] && x + y > 9) g[y * w + x] = 4; disc(2.5, 2.5, 1.3, 2);
    }
    return { w, h, pal, px: g.map(v => v.toString(16)).join('') };
  }

  // The texture as weapon art (the same kit every weapon draws with). Rows of
  // one colour are drawn as one bar.
  function art(tex) {
    const u = Math.min(32 / tex.w, 16 / tex.h), x0 = -2, y0 = -tex.h * u / 2;
    const runs = [];
    for (let y = 0; y < tex.h; y++) {
      let x = 0;
      while (x < tex.w) {
        const i = parseInt(tex.px[y * tex.w + x], 16);
        let e = x + 1;
        while (e < tex.w && parseInt(tex.px[y * tex.w + e], 16) === i) e++;
        if (i) runs.push([x0 + x * u, y0 + y * u, (e - x) * u, u, tex.pal[i - 1]]);
        x = e;
      }
    }
    return { custom: true, draw(k) { for (const [x, y, w, h, c] of runs) k.r(x, y, w + 0.02, h + 0.02, c); } };
  }

  // ── The generator: a pixel weapon from a shape, three colours and a seed ──
  const SHAPES = ['sword', 'axe', 'spear', 'hammer', 'staff', 'scythe', 'dagger', 'bow', 'greatsword', 'trident', 'katana', 'mace', 'wand', 'gun', 'lance', 'sickle',
                  'rapier', 'cleaver', 'halberd', 'pickaxe', 'crossbow', 'club', 'chakram', 'shuriken', 'cannon', 'fan'];
  function shade(c, f) {
    const n = parseInt(c.slice(1), 16), ch = [n >> 16, (n >> 8) & 255, n & 255];
    const o = ch.map(v => Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f)));
    return '#' + o.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
  }
  function rng(seed) { let s = (Math.floor(seed) >>> 0) || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; }; }
  function generate(shape, blade, handle, gem, seed) {
    const R = rng(seed), w = 40, h = 16, g = new Array(w * h).fill(0);
    const pal = [handle, shade(handle, -0.35), shade(blade, -0.3), blade, shade(blade, 0.45), gem, shade(gem, 0.5), shade(blade, -0.55)];
    const [HA, HD, BD, BL, BH, GM, GH, DK] = [1, 2, 3, 4, 5, 6, 7, 8];
    const put = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < w && y < h) g[y * w + x] = c; };
    const rect = (x, y, rw, rh, c) => { for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) put(x + i, y + j, c); };
    const disc = (x, y, r, c) => { for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r + r * 0.6) put(x + i, y + j, c); };
    const mid = 8;
    const haft = (len) => { rect(0, mid - 1, len, 2, HA); rect(0, mid, len, 1, HD); for (let x = 2; x < len; x += 3 + Math.floor(R() * 2)) put(x, mid - 1, HD); };
    const pommel = () => { disc(0, mid - 0.5, 1, GM); put(0, mid - 1, GH); };
    // A straight blade from x0 to the tip, `half` thick each side of the middle.
    const bladeTo = (x0, tip, half) => {
      for (let x = x0; x <= tip; x++) {
        const t = (x - x0) / Math.max(1, tip - x0), hw = x > tip - half * 2 ? Math.max(0, Math.round(half * (tip - x) / (half * 2))) : half;
        for (let y = -hw; y <= hw; y++) put(x, mid + y, y < 0 ? BH : y === 0 ? BL : BD);
        if (hw === 0) put(x, mid, BL);
        if (t > 0.1 && t < 0.7 && R() < 0.05) put(x, mid, GM);          // a rune
      }
    };
    const len = (a, b) => a + Math.floor(R() * (b - a + 1));
    switch (shape) {
      case 'dagger': { const hl = 6; haft(hl); pommel(); rect(hl, mid - 3, 2, 6, BD); put(hl, mid - 3, BH); bladeTo(hl + 2, len(22, 27), 1); break; }
      case 'greatsword': { const hl = 9; haft(hl); pommel(); rect(hl, mid - 6, 2, 12, BD); rect(hl, mid - 6, 2, 1, BH); disc(hl + 1, mid, 1, GM); bladeTo(hl + 2, len(37, 39), 3); break; }
      case 'axe': {
        const hl = len(30, 34); haft(hl); pommel();
        const hx = hl - 8;
        for (let j = -7; j <= 6; j++) { const reach = 6 + Math.round(Math.cos(j / 7 * 1.2) * 3); for (let i = 0; i < reach; i++) put(hx + i, mid + j, i === reach - 1 ? BH : j < -4 ? BH : BL); }
        rect(hx - 1, mid - 2, 2, 4, BD);
        if (R() < 0.6) for (let j = -3; j <= 3; j++) put(hx - 2 - Math.abs(j) % 2, mid + j, BD);   // a back spike
        break;
      }
      case 'hammer': {
        const hl = len(28, 32); haft(hl); pommel();
        rect(hl - 3, mid - 6, 9, 12, BD); rect(hl - 3, mid - 6, 9, 2, BH); rect(hl - 2, mid - 4, 7, 8, BL);
        disc(hl + 1, mid, 1, GM); break;
      }
      case 'staff': {
        const hl = len(29, 32); haft(hl); pommel();
        const ox = hl + 4; disc(ox, mid, 4, GM); disc(ox - 1, mid - 1, 1, GH);
        for (const d of [-5, 5]) { rect(hl, mid + d - (d < 0 ? 0 : 1), 3, 1, BL); put(hl + 2, mid + d * 0.8, BH); }
        break;
      }
      case 'spear': case 'trident': {
        const hl = len(28, 31); haft(hl); pommel(); rect(hl - 1, mid - 2, 2, 4, BD);
        if (shape === 'trident') { rect(hl + 1, mid - 5, 1, 10, BD); for (const d of [-5, 0, 4]) { const e = d ? 7 : 9; rect(hl + 1, mid + d, e, 1, BL); put(hl + 1 + e, mid + d, BH); put(hl + e, mid + d - 1, BH); } }
        else for (let x = hl + 1; x < w; x++) { const hw = Math.round((w - x) / (w - hl) * 3); for (let y = -hw; y <= hw; y++) put(x, mid + y, y < 0 ? BH : BL); }
        break;
      }
      case 'scythe': {
        const hl = len(32, 35); haft(hl); pommel(); rect(hl - 1, mid - 3, 3, 4, BD);
        for (let t = 0; t <= 1; t += 0.01) { const x = hl + 1 - t * 22, y = mid - 3 - Math.sin(t * Math.PI * 0.55) * 5;
          const th = Math.max(1, Math.round(4 * (1 - t))); for (let k = 0; k < th; k++) put(x, y + k, k === 0 ? BH : k === th - 1 ? BD : BL); }
        break;
      }
      case 'bow': {
        for (let j = -7; j <= 7; j++) { const x = 3 + Math.round(Math.cos(j / 7 * 1.3) * 7); put(x, mid + j, HA); put(x + 1, mid + j, HD); }
        for (let j = -7; j <= 7; j++) put(3, mid + j, BH);
        rect(3, mid - 1, 26, 1, BL); bladeTo(28, 34, 1); rect(3, mid - 2, 4, 3, BD); disc(10, mid, 1, GM);
        break;
      }
      case 'katana': { const hl = 10; haft(hl); for (let x = 1; x < hl; x += 2) put(x, mid - 1, GM); rect(hl, mid - 3, 1, 6, GM); rect(hl + 1, mid - 2, 1, 4, BD);
        const tip = len(36, 39); for (let x = hl + 2; x <= tip; x++) { const c = Math.round(((x - hl) / (tip - hl)) ** 2 * 3); put(x, mid - 1 - c, BH); put(x, mid - c, BL); if (x < tip - 1) put(x, mid + 1 - c, BD); } break; }
      case 'mace': { const hl = len(26, 30); haft(hl); pommel(); disc(hl + 4, mid, 4, BL); disc(hl + 3, mid - 1, 2, BH);
        for (const [dx, dy] of [[0, -6], [0, 6], [6, 0], [4, -4], [4, 4], [-3, -5], [-3, 5]]) put(hl + 4 + dx, mid + dy, BD); break; }
      case 'wand': { const hl = len(22, 26); rect(0, mid - 1, hl, 2, HA); rect(0, mid, hl, 1, HD); for (let x = 3; x < hl; x += 5) put(x, mid - 1, GM);
        for (const [dx, dy] of [[0, 0], [1, -1], [1, 1], [2, 0], [-1, 0], [0, -2], [0, 2], [2, -2], [2, 2]]) put(hl + 2 + dx, mid + dy, Math.abs(dx) + Math.abs(dy) < 2 ? GH : GM);
        put(hl + 5, mid - 3, GH); put(hl + 6, mid + 3, GH); break; }
      case 'gun': { rect(0, mid, 6, 5, HA); rect(1, mid + 1, 4, 4, HD); rect(4, mid - 2, 26, 4, BD); rect(4, mid - 2, 26, 1, BH); rect(30, mid - 1, 4, 2, DK);
        rect(8, mid + 2, 2, 3, BD); put(9, mid + 4, BD); rect(14, mid - 4, 3, 2, GM); break; }
      case 'lance': { const hl = 12; haft(hl); pommel(); rect(hl, mid - 4, 3, 8, BD); rect(hl, mid - 4, 3, 1, BH);
        for (let x = hl + 3; x < w; x++) { const hw = Math.max(0, Math.round((w - x) / (w - hl - 3) * 3)); for (let y = -hw; y <= hw; y++) put(x, mid + y, y < 0 ? BH : y > 0 ? BD : BL); } break; }
      case 'sickle': { const hl = 12; haft(hl); pommel();
        for (let t = 0; t <= Math.PI * 1.15; t += 0.04) { const x = hl + 7 + Math.cos(t - Math.PI / 2) * 7, y = mid - 1 + Math.sin(t - Math.PI / 2) * 7; put(x, y, BL); put(x - Math.cos(t) * 0.9, y + 1, t < 1.6 ? BH : BD); }
        break; }
      case 'rapier': { const hl = 7; haft(hl); pommel();
        for (let j = -4; j <= 4; j++) put(hl + 1 + Math.round(Math.abs(j) * 0.4), mid + j, Math.abs(j) > 3 ? BH : BD);
        for (let x = hl + 2; x < 39; x++) { put(x, mid, BL); if (x < 34) put(x, mid - 1, BH); } put(39, mid, BH); break; }
      case 'cleaver': { const hl = 12; haft(hl); pommel(); const bw = len(20, 24);
        rect(hl, mid - 7, bw, 8, BL); rect(hl, mid - 7, bw, 1, BH); rect(hl, mid, bw, 1, BD); rect(hl, mid - 7, 1, 8, BD);
        g[(mid - 5) * w + hl + bw - 4] = 0; g[(mid - 5) * w + hl + bw - 3] = 0; g[(mid - 4) * w + hl + bw - 4] = 0; g[(mid - 4) * w + hl + bw - 3] = 0; break; }
      case 'halberd': { const hl = len(30, 33); haft(hl); pommel(); bladeTo(hl, 39, 1);
        for (let j = 1; j <= 7; j++) for (let i = 0; i < 7 - Math.round(j * 0.5); i++) put(hl - 8 + i, mid - j, i === 6 - Math.round(j * 0.5) ? BH : BL);
        for (let j = 1; j <= 3; j++) put(hl - 4, mid + j, BD); break; }
      case 'pickaxe': { const hl = len(28, 31); haft(hl); pommel();
        for (let j = -7; j <= 7; j++) { const x = hl + 1 - Math.round(Math.abs(j) * 0.45); put(x, mid + j, Math.abs(j) > 5 ? BH : BL); put(x + 1, mid + j, BD); } break; }
      case 'crossbow': { rect(0, mid - 1, 30, 3, HA); rect(0, mid + 1, 30, 1, HD); rect(4, mid + 2, 3, 3, HD);
        for (let j = -7; j <= 7; j++) { put(25 + Math.round(Math.cos(j / 7 * 1.2) * 3), mid + j, BD); put(24 + Math.round(Math.cos(j / 7 * 1.2) * 3), mid + j, BL); put(22 + Math.round((7 - Math.abs(j)) / 3), mid + j, BH); }
        rect(20, mid - 1, 16, 1, BH); put(36, mid - 1, GM); put(37, mid - 1, GM); break; }
      case 'club': { for (let x = 0; x < 36; x++) { const hw = Math.round(1 + x / 36 * 4); for (let y = -hw; y <= hw; y++) put(x, mid + y, y < 0 ? HA : HD); }
        for (const [x, y] of [[20, -2], [26, 2], [31, -3], [33, 2], [28, -1]]) put(x, mid + y, GM);
        if (R() < 0.6) for (const [x, y] of [[24, -5], [30, -6], [30, 6], [34, -5], [34, 5]]) put(x, mid + y, BD); break; }
      case 'chakram': { haft(20); pommel(); const cxr = 30;
        for (let y = 0; y < h; y++) for (let x = 22; x < w; x++) { const d = Math.hypot(x - cxr, y - mid); if (d <= 7.5 && d >= 4.2) put(x, y, d > 6.8 ? BH : y < mid ? BL : BD); } break; }
      case 'shuriken': { haft(22); pommel(); const sx = 31;
        for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.3; for (let r = 0; r <= 7; r++) { const hw = Math.max(0, Math.round((7 - r) / 3)); for (let q = -hw; q <= hw; q++) put(sx + Math.cos(a) * r - Math.sin(a) * q, mid + Math.sin(a) * r + Math.cos(a) * q, q < 0 ? BH : BL); } }
        disc(sx, mid, 1, GM); put(sx, mid, 0); break; }
      case 'cannon': { rect(0, mid - 1, 7, 2, HA); rect(6, mid - 4, 29, 8, BD); rect(6, mid - 4, 29, 2, BL); rect(6, mid - 3, 29, 1, BH); rect(34, mid - 5, 3, 10, BL); rect(34, mid - 5, 3, 1, BH);
        disc(13, mid + 5, 2.6, HA); disc(13, mid + 5, 1, GM); rect(20, mid - 6, 2, 2, GM); break; }
      case 'fan': { haft(8); pommel();
        for (let r = 3; r <= 17; r += 0.4) for (let a = -1.05; a <= 0.35; a += 0.015) { const rib = Math.abs(((a + 1.05) / 0.2) % 1) < 0.1; put(8 + Math.cos(a) * r, mid + 4 + Math.sin(a) * r, r > 16.4 ? BD : rib ? HD : r > 14.5 ? GM : (Math.floor((a + 1.05) / 0.2) % 2 ? BL : BH)); }
        break; }
      default: { const hl = 8; haft(hl); pommel(); rect(hl, mid - 4, 2, 8, BD); rect(hl, mid - 4, 2, 1, BH); disc(hl + 1, mid, 0, GM); bladeTo(hl + 2, len(30, 36), 2); }
    }
    if (R() < 0.5) for (let n = 0; n < 3; n++) { const x = 12 + Math.floor(R() * 20); if (g[mid * w + x]) put(x, mid, R() < 0.5 ? GH : GM); }
    void DK;
    return { w, h, pal, px: g.map(v => v.toString(16)).join('') };
  }

  // ── STYLES: a new look for a picture, colour by colour (light and dark parts stay light and dark) ──
  const hexRgb = c => { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const rgbHex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  function toHsl([r, g, b]) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
    if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; } return [h, s, l]; }
  function fromHsl(h, s, l) { h = ((h % 360) + 360) % 360 / 360; const f = (p, q, t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    if (!s) return [l * 255, l * 255, l * 255]; const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255]; }
  const lum = c => toHsl(hexRgb(c))[2];
  const STYLES = {
    gold:    { n: 'GOLD',    f: (c) => rgbHex(fromHsl(44, 0.85, 0.15 + lum(c) * 0.75)) },
    silver:  { n: 'SILVER',  f: (c) => rgbHex(fromHsl(215, 0.12, 0.2 + lum(c) * 0.75)) },
    ice:     { n: 'ICE',     f: (c) => rgbHex(fromHsl(195, 0.7, 0.35 + lum(c) * 0.6)) },
    fire:    { n: 'FIRE',    f: (c) => { const l = lum(c); return rgbHex(fromHsl(l * 55, 1, 0.25 + l * 0.55)); } },
    shadow:  { n: 'SHADOW',  f: (c) => rgbHex(fromHsl(272, 0.55, 0.06 + lum(c) * 0.45)) },
    toxic:   { n: 'TOXIC',   f: (c) => rgbHex(fromHsl(100, 0.85, 0.15 + lum(c) * 0.6)) },
    blood:   { n: 'BLOOD',   f: (c) => rgbHex(fromHsl(354, 0.85, 0.1 + lum(c) * 0.5)) },
    ocean:   { n: 'OCEAN',   f: (c) => rgbHex(fromHsl(212, 0.8, 0.12 + lum(c) * 0.65)) },
    neon:    { n: 'NEON',    f: (c) => { const [h, , l] = toHsl(hexRgb(c)); return rgbHex(fromHsl(h, 1, 0.45 + l * 0.3)); } },
    pastel:  { n: 'PASTEL',  f: (c) => { const [h, , l] = toHsl(hexRgb(c)); return rgbHex(fromHsl(h, 0.6, 0.65 + l * 0.3)); } },
    rainbow: { n: 'RAINBOW', f: (c, i, n) => rgbHex(fromHsl(i / Math.max(1, n) * 330, 0.9, 0.3 + lum(c) * 0.5)) },
    invert:  { n: 'INVERT',  f: (c) => rgbHex(hexRgb(c).map(v => 255 - v)) },
    grey:    { n: 'STONE',   f: (c) => rgbHex(fromHsl(30, 0.06, 0.1 + lum(c) * 0.8)) },
    retro:   { n: 'GAMEBOY', f: (c) => ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'][Math.min(3, Math.floor(lum(c) * 4))] },
  };
  function restyle(tex, style) {
    const S = STYLES[style]; if (!tex || !S) return tex;
    return { ...tex, pal: tex.pal.map((c, i) => S.f(c, i, tex.pal.length)) };
  }

  const CustomW = { PRICE, MAX_OWNED, LIM, ULT_DMG, ULT_CD, LIMIT, LIMIT_PCT, REF, TEX, SHOT, NO_ATK, NO_MOVE, SHAPES, FX, MAX_FX, PATS, B, SHOT_SHAPES, ULT_BUILD_MIN_CD,
                    isBuild, cleanAtkB, cleanMoveB, genShot, PAS, MAX_PAS, MAX_STEPS, STYLES, restyle,
                    tier, power, powerPct, check, cleanTex, build, art, generate, shade };
  if (typeof module !== 'undefined' && module.exports) module.exports = CustomW;
  else root.CustomW = CustomW;
})(typeof window !== 'undefined' ? window : globalThis);
