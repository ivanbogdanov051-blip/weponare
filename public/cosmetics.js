'use strict';
// The animated extras on a character: changing colours, a glow, an animated
// accessory and a nickname background. Each is bought with coins and worn as a
// number on the skin (dyn, glow, aacc, nameBg). Entries only ever get ADDED to the
// end of these lists, and FX_TABLE in server.js (names and prices) has to match.
//
// All of it is painted with plain rectangles, so a fight pays next to nothing: no
// shadows or filters. Every function takes the context it paints on, which is how
// the customize screen shows exactly what you get in a fight.
(() => {
  const RING = 24, STEP_MS = 125;   // a changing colour goes round 24 shades in 3 seconds

  const hex = n => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, k) => { const x = rgb(a), y = rgb(b); return '#' + x.map((v, i) => hex(v + (y[i] - v) * k)).join(''); };
  function hsl(h, s, l) {
    const a = s * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12; return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
    return '#' + hex(f(0)) + hex(f(8)) + hex(f(4));
  }
  const RAINBOW = Array.from({ length: RING }, (_, i) => hsl(i * 15, 1, 0.56));
  const ringOf = keys => Array.from({ length: RING }, (_, i) => {
    const at = i / RING * keys.length, a = Math.floor(at);
    return mix(keys[a], keys[(a + 1) % keys.length], at - a);
  });
  const COLORS = [
    { name: 'NONE' },
    { name: 'RAINBOW', keys: ['#ff3a3a', '#ffcc2a', '#3aff6a', '#2ac8ff', '#a03aff'], ring: RAINBOW },
    { name: 'FIRE',    keys: ['#ff2a1a', '#ff8a1a', '#ffd83a'] },
    { name: 'OCEAN',   keys: ['#0a4ad8', '#12a8e8', '#6ae8e0'] },
    { name: 'TOXIC',   keys: ['#1ac83a', '#a8ff2a', '#e8ff5a'] },
    { name: 'GALAXY',  keys: ['#3a1ad8', '#a02aff', '#ff3ac8'] },
    { name: 'SUNSET',  keys: ['#ff4a7a', '#ff8a3a', '#ffd06a', '#c83aa8'] },
    { name: 'ICE',     keys: ['#a8ecff', '#ffffff', '#5ab8ff'] },
    { name: 'GOLD',    keys: ['#a8700a', '#ffc82a', '#fff0a0'] },
    { name: 'CANDY',   keys: ['#ff6ac8', '#6ae0ff', '#fff06a'] },
  ];
  for (const c of COLORS) if (c.keys && !c.ring) c.ring = ringOf(c.keys);
  const colorAt = (id, now) => { const r = COLORS[id]?.ring; return r ? r[Math.floor(now / STEP_MS) % RING] : null; };
  const swatch = id => { const k = COLORS[id]?.keys; return k ? `linear-gradient(135deg, ${k.join(', ')})` : ''; };

  // ── Glow ──
  const GLOWS = [
    { name: 'NONE' },
    { name: 'AURA',      c: 'own' },
    { name: 'RAINBOW',   c: 'rainbow' },
    { name: 'FIRE',      c: '#ff6a1a', flicker: true },
    { name: 'ICE',       c: '#6ad8ff' },
    { name: 'TOXIC',     c: '#6aff3a' },
    { name: 'VOID',      c: '#9a3aff' },
    { name: 'GOLD',      c: '#ffc82a' },
    { name: 'HEARTBEAT', c: '#ff2a5a', beat: true },
    { name: 'SUPERNOVA', c: '#ffffff', rays: true },
  ];
  // One soft blob per colour, painted once and only stretched after that.
  const blobs = new Map();
  function blob(color) {
    let cv = blobs.get(color);
    if (cv) return cv;
    cv = document.createElement('canvas'); cv.width = cv.height = 48;
    const g = cv.getContext('2d'), gr = g.createRadialGradient(24, 24, 3, 24, 24, 24);
    gr.addColorStop(0, color + 'e0'); gr.addColorStop(0.45, color + '70'); gr.addColorStop(1, color + '00');
    g.fillStyle = gr; g.fillRect(0, 0, 48, 48);
    blobs.set(color, cv);
    return cv;
  }
  function drawGlow(g, id, x, y, w, h, own, now) {
    const d = GLOWS[id];
    if (!d || !d.c) return;
    const color = d.c === 'own' ? own : d.c === 'rainbow' ? RAINBOW[Math.floor(now / STEP_MS) % RING] : d.c;
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;
    let k = 0.82 + 0.18 * Math.sin(now / 320);
    if (d.flicker) k = 0.72 + 0.28 * Math.abs(Math.sin(now / 90) * Math.sin(now / 37));
    if (d.beat) { const t = (now % 1000) / 1000; k = 0.55 + 0.45 * Math.max(Math.exp(-t * 14), Math.exp(-Math.abs(t - 0.24) * 16)); }
    const grow = 13 + 5 * k, a = g.globalAlpha;
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = a * k;
    g.drawImage(blob(color), x - grow, y - grow - 3, w + grow * 2, h + grow * 2 + 3);
    if (d.rays) {
      g.fillStyle = color; g.globalAlpha = a * 0.4;
      const mx = x + w / 2, my = y + h / 2;
      for (let i = 0; i < 8; i++) {
        const an = i * Math.PI / 4 + now / 900, len = 22 + 5 * Math.sin(now / 160 + i * 2);
        for (let r = 13; r < len; r += 2) g.fillRect(Math.round(mx + Math.cos(an) * r), Math.round(my + Math.sin(an) * r), 2, 2);
      }
    }
    g.restore();
  }

  // ── Animated accessories ── back() is under the body, front() over it.
  const px = (g, c, x, y, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); };
  const star = (g, c, x, y) => { px(g, c, x, y - 1, 1, 3); px(g, c, x - 1, y, 3, 1); };
  const heart = (g, c, x, y) => { px(g, c, x, y, 2, 1); px(g, c, x + 3, y, 2, 1); px(g, c, x, y + 1, 5, 1); px(g, c, x + 1, y + 2, 3, 1); px(g, c, x + 2, y + 3, 1, 1); };
  // Repeatable randomness: the same step always gives the same picture.
  const rnd = n => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
  const fade = (g, a, fn) => { const o = g.globalAlpha; g.globalAlpha = o * a; fn(); g.globalAlpha = o; };

  function wings(g, x, y, w, now, a, b, tip) {
    const lift = Math.round(Math.sin(now / 130) * 3);
    for (const side of [-1, 1]) {
      const root = side < 0 ? x + 1 : x + w - 1;
      for (let i = 0; i < 9; i++) {
        const top = y + 7 - Math.round((i * (6 + lift)) / 8) + (i > 6 ? i - 6 : 0), len = Math.max(3, 11 - i);
        px(g, i > 6 ? tip : i % 2 ? a : b, side < 0 ? root - i - 1 : root + i, top, 1, len);
      }
    }
  }

  const ACCS = [
    { name: 'NONE' },
    { name: 'ORBIT STARS', draw(g, x, y, w, h, now, front) {
      for (let i = 0; i < 3; i++) {
        const an = now / 420 + i * 2.094, s = Math.sin(an);
        if ((s > 0) !== front) continue;
        star(g, i === 1 ? '#7ae8ff' : '#ffe84a', x + w / 2 + Math.cos(an) * (w * 0.5 + 8), y + h / 2 - 2 + s * 5);
      }
    } },
    { name: 'FLAME CROWN', front(g, x, y, w, h, now) {
      const top = y - 1;
      for (let i = 0; i < 7; i++) {
        const fx = x + 1 + i * 2, H = 3 + 4 * Math.abs(Math.sin(now / 95 + i * 1.9));
        px(g, '#ff3a1a', fx, top - H, 2, H);
        px(g, '#ff9a2a', fx, top - H * 0.65, 2, H * 0.65);
        px(g, '#ffe84a', fx, top - H * 0.3, 2, H * 0.3);
      }
    } },
    { name: 'ANGEL WINGS', back(g, x, y, w, h, now) { wings(g, x, y, w, now, '#ffffff', '#d8e4ff', '#ffe8a8'); } },
    { name: 'DEMON WINGS', back(g, x, y, w, h, now) { wings(g, x, y, w, now, '#a01830', '#5a0a20', '#ff4a3a'); } },
    { name: 'HEARTS', front(g, x, y, w, h, now) {
      for (let i = 0; i < 4; i++) {
        const t = (now / 1500 + i / 4) % 1;
        fade(g, Math.min(1, (1 - t) * 1.6), () => heart(g, i % 2 ? '#ff5a9a' : '#ff2a5a', x + w / 2 - 2 + Math.sin(t * 7 + i * 2) * (w * 0.5 + 4), y + h - 6 - t * (h + 10)));
      }
    } },
    { name: 'SPIN HALO', front(g, x, y, w, h, now) {
      for (let i = 0; i < 16; i++) {
        const an = i * Math.PI / 8, lit = (Math.sin(an - now / 110) + 1) / 2;
        px(g, lit > 0.72 ? '#ffffff' : '#ffd83a', x + w / 2 + Math.cos(an) * 8, y - 5 + Math.sin(an) * 2.4, 2, 1);
      }
    } },
    { name: 'LIGHTNING', front(g, x, y, w, h, now) {
      const step = Math.floor(now / 90);
      for (let n = 0; n < 2; n++) {
        if (rnd(step + n * 7) < 0.35) continue;
        let bx = x + w / 2 + (n ? 1 : -1) * (w * 0.5 + 2 + rnd(step + n) * 3), by = y - 2 + rnd(step * 3 + n) * 8;
        for (let i = 0; i < 6; i++) {
          px(g, i % 2 ? '#ffffff' : '#7ae8ff', bx, by, 1, 3);
          bx += (rnd(step + i * 5 + n) - 0.5) * 6; by += 3;
        }
      }
    } },
    { name: 'BUBBLES', front(g, x, y, w, h, now) {
      for (let i = 0; i < 6; i++) {
        const t = (now / 1900 + i / 6) % 1, r = 1 + (i % 3);
        const bx = Math.round(x + w / 2 + Math.sin(t * 8 + i * 3) * (w * 0.6 + 2)), by = Math.round(y + h - t * (h + 14));
        fade(g, 0.8 * (1 - t * 0.7), () => {
          g.strokeStyle = '#a8ecff'; g.lineWidth = 1;
          g.strokeRect(bx - r + 0.5, by - r + 0.5, r * 2, r * 2);
          px(g, '#ffffff', bx - r + 1, by - r + 1);
        });
      }
    } },
    { name: 'GHOST PET', back(g, x, y, w, h, now, facing) {
      const dir = facing === 1 ? -1 : 1, gx = Math.round(x + w / 2 + dir * (w * 0.5 + 9)) - 4, gy = Math.round(y + 3 + Math.sin(now / 260) * 3);
      fade(g, 0.92, () => {
        px(g, '#e8f0ff', gx + 1, gy, 6, 1); px(g, '#e8f0ff', gx, gy + 1, 8, 6);
        const f = Math.floor(now / 200) % 2;
        for (let i = 0; i < 4; i++) px(g, '#e8f0ff', gx + i * 2 + f, gy + 7);
        if (Math.floor(now / 1700) % 5) { px(g, '#1a1a2e', gx + 2, gy + 3, 1, 2); px(g, '#1a1a2e', gx + 5, gy + 3, 1, 2); }
      });
    } },
    { name: 'WAVY CAPE', back(g, x, y, w, h, now, facing) {
      const dir = facing === 1 ? -1 : 1, edge = dir < 0 ? x + 2 : x + w - 3;
      for (let r = 0; r < 14; r++) {
        const sway = Math.sin(now / 150 - r * 0.6) * (r / 5), len = 2 + r * 0.45;
        const cx = edge + dir * (len / 2 + 1) + dir * sway;
        px(g, r % 4 === 3 ? '#ffd83a' : r % 2 ? '#c81838' : '#e82a4a', cx - len / 2, y + 9 + r, Math.ceil(len), 1);
      }
    } },
    { name: 'SNOWFALL', front(g, x, y, w, h, now) {
      for (let i = 0; i < 8; i++) {
        const t = (now / 1700 + rnd(i)) % 1, s = i % 3 ? 1 : 2;
        fade(g, Math.min(1, (1 - t) * 3), () => px(g, '#ffffff', x + w / 2 + (rnd(i + 9) - 0.5) * (w + 22) + Math.sin(t * 6 + i) * 2, y - 12 + t * (h + 14), s, s));
      }
    } },
  ];
  function drawAcc(g, id, x, y, w, h, facing, now, front) {
    const d = ACCS[id];
    if (!d) return;
    if (d.draw) d.draw(g, x, y, w, h, now, front);
    else if (front ? d.front : d.back) (front ? d.front : d.back)(g, x, y, w, h, now, facing);
  }

  // ── Nickname backgrounds ── painted in x..x+w, y..y+h.
  const NAME_BGS = [
    { name: 'NONE' },
    { name: 'RAINBOW', paint(g, x, y, w, h, now) {
      for (let i = 0; i < w; i += 2) px(g, hsl(((i * 6 - now / 6) % 360 + 360) % 360, 1, 0.42), x + i, y, 2, h);
    } },
    { name: 'FIRE', paint(g, x, y, w, h, now) {
      px(g, '#3a0804', x, y, w, h);
      for (let i = 0; i < w; i += 2) {
        const f = (0.55 + 0.45 * Math.sin(now / 80 + i * 1.3) * Math.sin(now / 140 + i * 0.7)) * h;
        px(g, '#d0280a', x + i, y + h - f, 2, Math.ceil(f));
        px(g, '#ff8a1a', x + i, y + h - f * 0.55, 2, Math.ceil(f * 0.55));
      }
    } },
    { name: 'OCEAN', paint(g, x, y, w, h, now) {
      px(g, '#06286a', x, y, w, h);
      for (let i = 0; i < w; i += 2) {
        const t = Math.round(y + h * 0.5 + Math.sin(i * 0.28 + now / 240) * 2 + Math.sin(i * 0.11 - now / 400));
        px(g, '#0a78c8', x + i, t, 2, y + h - t);
        px(g, '#7ae8ff', x + i, t, 2, 1);
      }
    } },
    { name: 'MATRIX', paint(g, x, y, w, h, now) {
      px(g, '#021006', x, y, w, h);
      for (let i = 0; i < w; i += 3) {
        const head = Math.floor(now / 90 + rnd(i) * 40) % (h + 5);
        for (let k = 0; k < 4; k++) { const py = head - k; if (py >= 0 && py < h) px(g, k ? '#0a8a30' : '#7affa0', x + i, y + py, 2, 1); }
      }
    } },
    { name: 'STARS', paint(g, x, y, w, h, now) {
      px(g, '#0c0a34', x, y, w, h);
      for (let i = 0; i < w; i += 4) {
        const b = Math.sin(now / 260 + i * 1.7);
        if (b > -0.2) px(g, b > 0.6 ? '#ffffff' : '#a8a0ff', x + i + (i % 3), y + 1 + Math.floor(rnd(i) * (h - 2)));
      }
    } },
    { name: 'LAVA', paint(g, x, y, w, h, now) {
      px(g, '#2a0806', x, y, w, h);
      for (let i = 0; i < w; i += 2) for (let k = 0; k < h; k += 2) {
        const v = Math.sin(i * 0.22 + now / 500) + Math.sin(k * 0.8 - now / 380) + Math.sin((i + k) * 0.16 + now / 700);
        if (v > 0.4) px(g, v > 1.5 ? '#ffc83a' : '#e8481a', x + i, y + k, 2, Math.min(2, h - k));
      }
    } },
    { name: 'ELECTRIC', paint(g, x, y, w, h, now) {
      px(g, '#160a3a', x, y, w, h);
      const step = Math.floor(now / 70);
      for (let n = 0; n < 2; n++) {
        let ly = y + h / 2;
        for (let i = 0; i < w; i += 2) {
          ly = Math.max(y, Math.min(y + h - 1, ly + (rnd(step + i + n * 31) - 0.5) * 5));
          px(g, n ? '#6a8aff' : '#e8f4ff', x + i, ly, 2, 1);
        }
      }
    } },
    { name: 'GOLD', paint(g, x, y, w, h, now) {
      px(g, '#a8700a', x, y, w, h);
      const at = (now / 7) % (w + 30) - 15;
      for (let i = 0; i < w; i += 2) {
        const d = Math.abs(i - at);
        if (d < 12) px(g, d < 4 ? '#fff4c0' : '#ffd83a', x + i, y, 2, h);
      }
    } },
    { name: 'GLITCH', paint(g, x, y, w, h, now) {
      px(g, '#0a0a14', x, y, w, h);
      const step = Math.floor(now / 110);
      for (let k = 0; k < h; k += 2) {
        const off = Math.round(rnd(step + k) * w * 0.7), len = Math.ceil(rnd(step * 2 + k) * w * 0.5);
        px(g, k % 4 ? '#ff2ad8' : '#2ae8ff', x + off, y + k, Math.min(len, w - off), Math.min(2, h - k));
      }
    } },
    { name: 'AURORA', paint(g, x, y, w, h, now) {
      px(g, '#04122a', x, y, w, h);
      for (let i = 0; i < w; i += 2) {
        const H = Math.round((0.5 + 0.5 * Math.sin(i * 0.14 + now / 420)) * h);
        px(g, Math.sin(i * 0.07 - now / 900) > 0 ? '#2ae88a' : '#a03aff', x + i, y + Math.round((h - H) * 0.3), 2, H);
      }
    } },
    { name: 'HEARTS', paint(g, x, y, w, h, now) {
      px(g, '#7a0a3a', x, y, w, h);
      const shift = (now / 45) % 9;
      for (let i = -9; i < w + 9; i += 9) {
        const hx = Math.round(x + i + shift);
        if (hx >= x && hx + 5 <= x + w) heart(g, '#ff7ab8', hx, y + Math.floor((h - 4) / 2));
      }
    } },
  ];
  // The tag over a character's head. With a background the name goes white with a
  // black edge, so it can be read on any of them.
  function nameTag(g, cx, bottomY, label, color, id, now) {
    g.save();
    g.font = '9px "Courier New",monospace';
    g.textBaseline = 'bottom'; g.textAlign = 'center';
    const rx = Math.round(cx), tw = g.measureText(label).width, bg = NAME_BGS[id];
    if (bg && bg.paint) {
      const w = Math.ceil(tw) + 8, x = rx - Math.floor(w / 2), y = bottomY - 11, h = 13;
      bg.paint(g, x, y, w, h, now);
      g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineWidth = 1;
      g.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
      g.lineWidth = 2.5; g.lineJoin = 'round';
      g.strokeText(label, rx, bottomY);
      g.fillStyle = '#ffffff'; g.fillText(label, rx, bottomY);
    } else {
      g.fillStyle = 'rgba(0,0,0,0.75)';
      g.fillRect(rx - tw / 2 - 2, bottomY - 10, tw + 4, 11);
      g.fillStyle = 'rgba(0,0,0,0.9)'; g.fillText(label, rx + 1, bottomY + 1);
      g.fillStyle = color; g.fillText(label, rx, bottomY);
    }
    g.restore();
  }

  window.Cosmetics = { COLORS, GLOWS, ACCS, NAME_BGS, colorAt, swatch, drawGlow, drawAcc, nameTag };
})();
