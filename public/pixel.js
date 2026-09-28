'use strict';

(function () {

// ─── Pixel toolkit ────────────────────────────────────────────────────────────
// Sprites are built as raw RGBA buffers, one array element per pixel, so nothing
// is ever antialiased: every edge lands on a pixel boundary and shading is done
// with explicit ramps and dither patterns rather than gradients. The buffer API
// is pure (no canvas), so the same code runs in a test harness.

function hexRgb(h) {
  if (Array.isArray(h)) return h;
  const s = String(h).replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

// Move a colour along the light/dark axis. Positive lightens toward white;
// negative darkens toward a cool shadow rather than flat black, which keeps
// pixel shading from going muddy.
function shade(c, amt) {
  const [r, g, b, a] = hexRgb(c);
  if (amt >= 0) {
    return [r + (255 - r) * amt | 0, g + (255 - g) * amt | 0, b + (255 - b) * amt | 0, a];
  }
  const k = 1 + amt;
  return [r * k | 0, g * k | 0, (b * k + 10 * -amt) | 0, a];
}

// A five-step ramp from one base colour: [darkest, dark, base, light, lightest].
function ramp(base) {
  return [shade(base, -0.55), shade(base, -0.28), hexRgb(base), shade(base, 0.22), shade(base, 0.45)];
}

const CLEAR = [0, 0, 0, 0];

// Material ramps shared by every sprite, so a steel blade and a steel trap plate
// read as the same substance.
const MAT5 = {
  wood:     ramp('#6b4326'),
  darkwood: ramp('#3d2412'),
  leather:  ramp('#4a2f1a'),
  steel:    ramp('#9aa8b8'),
  iron:     ramp('#5a616d'),
  gold:     ramp('#d9a520'),
  bone:     ramp('#ded6c0'),
  stone:    ramp('#6e6b78'),
  flesh:    ramp('#e0a878'),
  rope:     ramp('#b8a678'),
  venom:    ramp('#8ad048'),
  blood:    ramp('#a83a3a'),
};

// ── Buffers ──

function makeBuf(w, h) {
  return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}

function setPx(b, x, y, c) {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return;
  const col = hexRgb(c);
  if (col[3] === 0) return;
  const i = (y * b.w + x) * 4;
  if (col[3] === 255) {
    b.data[i] = col[0]; b.data[i + 1] = col[1]; b.data[i + 2] = col[2]; b.data[i + 3] = 255;
    return;
  }
  // Source-over blend, so soft accents (glow, grime) can sit on top.
  const sa = col[3] / 255, da = b.data[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  for (let k = 0; k < 3; k++) {
    b.data[i + k] = (col[k] * sa + b.data[i + k] * da * (1 - sa)) / oa;
  }
  b.data[i + 3] = oa * 255;
}

function getA(b, x, y) {
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return 0;
  return b.data[((y | 0) * b.w + (x | 0)) * 4 + 3];
}

function rect(b, x, y, w, h, c) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) setPx(b, xx, yy, c);
}

// ── Dither patterns: how two ramp steps meet without a gradient ──
const DITHER = {
  checker: (x, y) => (x + y) & 1,
  sparse:  (x, y) => ((x * 2 + y) % 4 === 0 ? 1 : 0),
  dense:   (x, y) => (((x + y) & 1) || ((x & 1) && (y & 1)) ? 1 : 0),
  vert:    (x, y) => x & 1,
  horiz:   (x, y) => y & 1,
  grain:   (x, y) => ((x * 7 + y * 13) % 5 === 0 ? 1 : 0),
  scale:   (x, y) => ((x + (y & 1) * 2) % 4 < 2 ? 1 : 0),
};

function ditherRect(b, x, y, w, h, cA, cB, pattern) {
  const f = DITHER[pattern] || DITHER.checker;
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) setPx(b, xx, yy, f(xx, yy) ? cB : cA);
  }
}

// Scanline polygon fill on integer pixel centres — no antialiasing.
function poly(b, pts, c) {
  if (pts.length < 3) return;
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  minY = Math.max(0, Math.floor(minY)); maxY = Math.min(b.h - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    const cy = y + 0.5;
    const xs = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > cy) !== (yj > cy)) xs.push(xi + (cy - yi) / (yj - yi) * (xj - xi));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) setPx(b, x, y, c);
    }
  }
}

function line(b, x0, y0, x1, y1, c) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    setPx(b, x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = err * 2;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx)  { err += dx; y0 += sy; }
  }
}

function disc(b, cx, cy, r, c) {
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) setPx(b, x, y, c);
    }
  }
}

function ringPx(b, cx, cy, r, thick, c) {
  const ro = r + thick / 2, ri = r - thick / 2;
  for (let y = Math.floor(cy - ro); y <= Math.ceil(cy + ro); y++) {
    for (let x = Math.floor(cx - ro); x <= Math.ceil(cx + ro); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= ro && d >= ri) setPx(b, x, y, c);
    }
  }
}

// A hard 1px border around every opaque cluster. This is what makes pixel art
// read against a busy floor, and it runs after the fill so it never tints.
function outline(b, c, includeDiagonals) {
  const out = [];
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      if (getA(b, x, y) > 0) continue;
      const n = getA(b, x - 1, y) || getA(b, x + 1, y) || getA(b, x, y - 1) || getA(b, x, y + 1) ||
        (includeDiagonals && (getA(b, x - 1, y - 1) || getA(b, x + 1, y - 1) ||
                              getA(b, x - 1, y + 1) || getA(b, x + 1, y + 1)));
      if (n) out.push([x, y]);
    }
  }
  for (const [x, y] of out) setPx(b, x, y, c);
}

// Rim light: brighten the top-left lip of every filled cluster and darken the
// bottom-right one, so flat shapes pick up a consistent light direction.
function rimLight(b, lightC, darkC) {
  const lit = [], dim = [];
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      if (getA(b, x, y) === 0) continue;
      if (getA(b, x, y - 1) === 0 || getA(b, x - 1, y) === 0) lit.push([x, y]);
      else if (getA(b, x, y + 1) === 0 || getA(b, x + 1, y) === 0) dim.push([x, y]);
    }
  }
  if (lightC) for (const [x, y] of lit) setPx(b, x, y, lightC);
  if (darkC)  for (const [x, y] of dim) setPx(b, x, y, darkC);
}

// Recolour every opaque pixel, keeping its relative brightness. Used for the
// white hit-flash and the slowed tint without authoring extra sprites.
function tint(b, c, strength) {
  const col = hexRgb(c), k = strength === undefined ? 1 : strength;
  for (let i = 0; i < b.data.length; i += 4) {
    if (b.data[i + 3] === 0) continue;
    for (let j = 0; j < 3; j++) b.data[i + j] = b.data[i + j] * (1 - k) + col[j] * k;
  }
}

// ── Char-grid authoring ──
// Fixed-size sprites are written as rows of characters with a colour key, which
// is far easier to read and revise than a pile of rect() calls.
function fromGrid(rows, key) {
  const h = rows.length, w = Math.max(...rows.map(r => r.length));
  const b = makeBuf(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === ' ') continue;
      const c = key[ch];
      if (c) setPx(b, x, y, c);
    }
  }
  return b;
}

// ── Canvas bridge + cache (browser only) ──

const _spriteCache = new Map();

function bufToCanvas(b) {
  const cv = document.createElement('canvas');
  cv.width = b.w; cv.height = b.h;
  const g = cv.getContext('2d');
  const img = g.createImageData(b.w, b.h);
  img.data.set(b.data);
  g.putImageData(img, 0, 0);
  return cv;
}

// Build once, reuse forever. Sprites are keyed by everything that changes their
// pixels, so a monster's type, size and hit state each get their own bitmap.
function sprite(key, build) {
  let cv = _spriteCache.get(key);
  if (cv !== undefined) return cv;
  const b = build();
  cv = b ? bufToCanvas(b) : null;
  _spriteCache.set(key, cv);
  // A runaway key would leak memory; bound it and evict oldest-first.
  if (_spriteCache.size > 900) _spriteCache.delete(_spriteCache.keys().next().value);
  return cv;
}

// ── Extra rasterisers used by the weapon pipeline ──

// Arc segment of an annulus, pixel-tested rather than stroked.
function arcPx(b, cx, cy, r, thick, c, a0, a1) {
  const ro = r + thick / 2, ri = r - thick / 2;
  const full = Math.abs(a1 - a0) >= Math.PI * 2 - 1e-6;
  const norm = a => { while (a < 0) a += Math.PI * 2; while (a >= Math.PI * 2) a -= Math.PI * 2; return a; };
  const lo = norm(Math.min(a0, a1)), hi = norm(Math.max(a0, a1));
  for (let y = Math.floor(cy - ro); y <= Math.ceil(cy + ro); y++) {
    for (let x = Math.floor(cx - ro); x <= Math.ceil(cx + ro); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > ro || d < ri) continue;
      if (!full) {
        const a = norm(Math.atan2(dy, dx));
        const inside = lo <= hi ? (a >= lo && a <= hi) : (a >= lo || a <= hi);
        if (!inside) continue;
      }
      setPx(b, x, y, c);
    }
  }
}

// Thick line by distance-to-segment, so joints stay solid at any width.
function thickLine(b, x0, y0, x1, y1, w, c) {
  const half = Math.max(0.5, w / 2);
  const minX = Math.floor(Math.min(x0, x1) - half), maxX = Math.ceil(Math.max(x0, x1) + half);
  const minY = Math.floor(Math.min(y0, y1) - half), maxY = Math.ceil(Math.max(y0, y1) + half);
  const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const t = l2 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2)) : 0;
      const qx = x0 + t * dx, qy = y0 + t * dy;
      if (Math.hypot(px - qx, py - qy) <= half) setPx(b, x, y, c);
    }
  }
}

// Only the namespace is exported. Top-level function names in a classic script
// become globals, and names like rect/line/shade collided with other scripts —
// a browser refuses to load a later script that redeclares one.
const PixelKit = {
  hexRgb, shade, ramp, MAT5, CLEAR, DITHER,
  makeBuf, setPx, getA, rect, ditherRect, poly, line, disc, ringPx, arcPx, thickLine,
  outline, rimLight, tint, fromGrid, sprite, bufToCanvas,
};

if (typeof window !== 'undefined') window.PixelKit = PixelKit;
if (typeof module !== 'undefined') module.exports = PixelKit;
})();
