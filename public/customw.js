'use strict';
// CUSTOM WEAPONS: made by a player for ◆1,000,000 and ALL their progress. Each of
// its moves (ATK, SPECIAL, SUPER, ULTIMATE) is borrowed from a real weapon and
// tuned (more damage, faster, further...). Then it is checked: a weapon over the
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
  const LIM = { d: [50, 200], s: [60, 200], r: [70, 150], c: [60, 200] };
  const ULT_DMG = 2.5, ULT_CD = 2.5, ULT_MIN_CD = 30000;   // an ULTIMATE: its move, 2.5x as strong and 2.5x as slow to come back
  const W = { atk: 0.40, sp: 0.25, su: 0.20, ult: 0.15 };  // how much each move counts towards POWER
  const REF = 0.85 * 1.4;                   // the FIRE SPEAR (a secret weapon) on that scale
  const LIMIT = 1.45;                       // the most a custom weapon may have: about 122% of the Fire Spear
  const TEX = { minW: 8, maxW: 48, minH: 4, maxH: 24, maxPal: 15, minPx: 12 };
  // Moves that only work with their own weapon's machinery: never borrowed.
  const NO_ATK = ['vortex'];
  const NO_MOVE = ['kunaistorm', 'soulstorm', 'absorbheal'];

  const tier = w => !w ? 0 : w.secret ? 1.4 : w.mythic ? 1.3 : w.uncommon ? 1.05 : w.shopOnly ? 1.15 : 1;
  const clamp = (v, [a, b]) => Math.max(a, Math.min(b, Math.round(Number(v) || 100)));
  const pct = (v, k) => clamp(v, LIM[k]) / 100;
  const okSrc = w => !!w && !w.custom;

  // POWER of a spec, given a look-up from weapon id to its definition.
  function power(spec, byId) {
    if (!spec) return 0;
    let s = 0;
    const a = spec.atk, aw = a && byId(a.from);
    if (aw) s += W.atk * tier(aw) * pct(a.d, 'd') / pct(a.s, 's') * Math.sqrt(pct(a.r, 'r'));
    for (const [k, part] of [['sp', 'special'], ['su', 'super']]) {
      const m = spec[k], w = m && byId(m.from);
      if (w && w[part]) s += W[k] * tier(w) * pct(m.d, 'd') / pct(m.c, 'c');
    }
    const u = spec.ult, uw = u && byId(u.from);
    if (uw && uw[u.part]) s += W.ult * tier(uw) * pct(u.d, 'd') / pct(u.c, 'c');
    return s;
  }
  const powerPct = (spec, byId) => Math.round(power(spec, byId) / REF * 100);
  const LIMIT_PCT = Math.round(LIMIT / REF * 100);

  const hex6 = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
  function cleanTex(t) {
    if (!t || typeof t !== 'object') return null;
    const w = Math.floor(t.w), h = Math.floor(t.h);
    if (!(w >= TEX.minW && w <= TEX.maxW && h >= TEX.minH && h <= TEX.maxH)) return null;
    if (!Array.isArray(t.pal) || !t.pal.length || t.pal.length > TEX.maxPal || !t.pal.every(hex6)) return null;
    const px = String(t.px || '').toLowerCase();
    if (px.length !== w * h || !/^[0-9a-f]*$/.test(px)) return null;
    let solid = 0;
    for (const ch of px) { const i = parseInt(ch, 16); if (i > t.pal.length) return null; if (i) solid++; }
    if (solid < TEX.minPx) return null;
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
    if (!tex) return { error: 'Its texture is missing or too small: generate one or upload an image.' };
    const a = raw.atk || {}, aw = byId(a.from);
    if (!okSrc(aw) || NO_ATK.includes(a.from)) return { error: 'Pick the ATK it borrows.' };
    const spec = { name, color, tex, atk: { from: a.from, d: clamp(a.d, LIM.d), s: clamp(a.s, LIM.s), r: clamp(a.r, LIM.r) } };
    const move = (m, part, need) => {
      if (!m || !m.from) return need ? { error: 'Pick its ' + need + '.' } : { v: null };
      const w = byId(m.from), mv = w && w[part];
      if (!okSrc(w) || !mv || NO_MOVE.includes(mv.kind)) return { error: 'That move cannot be borrowed.' };
      return { v: { from: m.from, d: clamp(m.d, LIM.d), c: clamp(m.c, LIM.c) } };
    };
    let r = move(raw.sp, 'special', 'SPECIAL'); if (r.error) return r; spec.sp = r.v;
    r = move(raw.su, 'super'); if (r.error) return r; spec.su = r.v;
    const u = raw.ult;
    if (u && u.from) {
      const part = u.part === 'super' ? 'super' : 'special';
      r = move(u, part); if (r.error) return r;
      spec.ult = { ...r.v, part };
    } else spec.ult = null;
    const p = power(spec, byId);
    if (!noLimit && p > LIMIT) return { error: 'TOO STRONG', power: Math.round(p / REF * 100), limit: LIMIT_PCT };
    spec.power = Math.round(p / REF * 100);
    return { spec };
  }

  // The weapon a spec makes, from the weapons it borrows from. The ATK weapon
  // lends its whole way of fighting (melee or shots, and its tricks).
  const KEEP_OUT = ['id', 'name', 'price', 'mythic', 'mythicKills', 'mythicNeeds', 'mythicBoss', 'needLegendary', 'needAll', 'needMind',
                    'needLight', 'needSamurai', 'bossReward', 'uncommon', 'from', 'unlockXp', 'special', 'super'];
  function build(id, spec, byId) {
    const aw = byId(spec.atk.from);
    const w = {};
    for (const [k, v] of Object.entries(aw)) if (!KEEP_OUT.includes(k)) w[k] = v;
    const mv = (m, part, dm, cm, minCd) => {
      const src = byId(m.from)[part];
      return { ...src, dmg: Math.max(1, Math.round((src.dmg || 0) * m.d / 100 * dm)), cd: Math.max(minCd || 500, Math.round(src.cd * m.c / 100 * cm)) };
    };
    Object.assign(w, {
      id, name: spec.name, custom: true, secret: true, shopOnly: true, noRequirement: true, price: 0, unlockXp: 0,
      damage: Math.max(1, Math.round(aw.damage * spec.atk.d / 100)),
      atkSpd: Math.max(70, Math.round(aw.atkSpd * spec.atk.s / 100)),
      range: Math.round(aw.range * spec.atk.r / 100),
      special: mv(spec.sp, 'special', 1, 1),
      super: spec.su ? mv(spec.su, 'super', 1, 1) : undefined,
      ultimate: spec.ult ? { ...mv(spec.ult, spec.ult.part, ULT_DMG, ULT_CD, ULT_MIN_CD), part: spec.ult.part } : undefined,
    });
    if (!w.super) delete w.super;
    if (!w.ultimate) delete w.ultimate;
    return w;
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
  const SHAPES = ['sword', 'axe', 'spear', 'hammer', 'staff', 'scythe', 'dagger', 'bow', 'greatsword', 'trident'];
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
      default: { const hl = 8; haft(hl); pommel(); rect(hl, mid - 4, 2, 8, BD); rect(hl, mid - 4, 2, 1, BH); disc(hl + 1, mid, 0, GM); bladeTo(hl + 2, len(30, 36), 2); }
    }
    if (R() < 0.5) for (let n = 0; n < 3; n++) { const x = 12 + Math.floor(R() * 20); if (g[mid * w + x]) put(x, mid, R() < 0.5 ? GH : GM); }
    void DK;
    return { w, h, pal, px: g.map(v => v.toString(16)).join('') };
  }

  const CustomW = { PRICE, MAX_OWNED, LIM, ULT_DMG, ULT_CD, LIMIT, LIMIT_PCT, REF, TEX, NO_ATK, NO_MOVE, SHAPES,
                    tier, power, powerPct, check, cleanTex, build, art, generate, shade };
  if (typeof module !== 'undefined' && module.exports) module.exports = CustomW;
  else root.CustomW = CustomW;
})(typeof window !== 'undefined' ? window : globalThis);
