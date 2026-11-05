'use strict';
// The look of the arena: colours, floor pattern and wall style, each picked in
// Settings. All of it is painted once into a cached image, so a busy pattern costs
// nothing per frame, and it is purely cosmetic: the server knows nothing about it.
//
// Floors stay dark enough for every player, monster and coin colour to stand out.
// A floor colour or pattern brighter than these will hide things in a fight.

const ARENA_THEMES = [
  { id: 'neon',   name: 'NEON',   a: '#2a1466', b: '#5a1a7e', p1: '#ff4ad8', p2: '#3ae0ff', dark: '#140a38', mid: '#3a2090', lite: '#8a6aff', glow: '#3af0ff' },
  { id: 'ocean',  name: 'OCEAN',  a: '#082c52', b: '#083e50', p1: '#1a7ab8', p2: '#22b890', dark: '#06203e', mid: '#14568a', lite: '#5ac0e8', glow: '#9af4ff' },
  { id: 'lava',   name: 'LAVA',   a: '#420c10', b: '#5e2008', p1: '#ff5a1a', p2: '#ffb02a', dark: '#1e0606', mid: '#5a1c10', lite: '#b04a1a', glow: '#ffa52a' },
  { id: 'forest', name: 'FOREST', a: '#0c3428', b: '#20401a', p1: '#3ab05a', p2: '#c8c03a', dark: '#0a2014', mid: '#2a5a30', lite: '#6aaa4a', glow: '#c8f05a' },
  { id: 'candy',  name: 'CANDY',  a: '#621858', b: '#382886', p1: '#ff7ac8', p2: '#7ac8ff', dark: '#3a0e4a', mid: '#a83a8a', lite: '#ffa8e0', glow: '#fff08a' },
  { id: 'desert', name: 'DESERT', a: '#52300e', b: '#602620', p1: '#e8a84a', p2: '#ff7a4a', dark: '#2a1608', mid: '#8a5a24', lite: '#d8a85a', glow: '#ffe08a' },
  { id: 'ice',    name: 'ICE',    a: '#183658', b: '#283670', p1: '#5aa0d0', p2: '#a090f0', dark: '#0e1e3a', mid: '#3a6a9a', lite: '#a8e0f8', glow: '#e8fcff' },
  { id: 'night',  name: 'NIGHT',  a: '#1a1a2e', b: '#20203a', p1: '#8a8ac8', p2: '#6a8ac8', dark: '#14142a', mid: '#2a2a4a', lite: '#5a5a8a', glow: '#8a8ac8' },
];

const ARENA_FLOORS = [
  { id: 'hex',      name: 'HEXAGONS' },
  { id: 'tiles',    name: 'TILES' },
  { id: 'diamonds', name: 'DIAMONDS' },
  { id: 'scales',   name: 'SCALES' },
  { id: 'stripes',  name: 'STRIPES' },
  { id: 'waves',    name: 'WAVES' },
  { id: 'stars',    name: 'STARS' },
  { id: 'plain',    name: 'PLAIN' },
];

const ARENA_WALLS = [
  { id: 'neon',    name: 'NEON' },
  { id: 'brick',   name: 'BRICK' },
  { id: 'metal',   name: 'METAL' },
  { id: 'rock',    name: 'ROCK' },
  { id: 'crystal', name: 'CRYSTAL' },
  { id: 'wood',    name: 'WOOD' },
];

const ARENA_DEFAULT = { theme: 'neon', floor: 'hex', wall: 'neon' };

// ── Floor patterns ──
// Each fills W×H from (0,0) in the two pattern colours; the caller sets the alpha.
const FLOOR_PAINT = {
  tiles(g, W, H, c1, c2) {
    const T = 32;
    for (let y = 0, r = 0; y < H; y += T, r++) {
      for (let x = 0, c = 0; x < W; x += T, c++) {
        if ((r + c) % 2) continue;
        g.fillStyle = (r + c) % 4 ? c2 : c1; g.fillRect(x, y, T, T);
      }
    }
    g.strokeStyle = c1; g.lineWidth = 1; g.beginPath();
    for (let x = 0; x <= W; x += T) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); }
    for (let y = 0; y <= H; y += T) { g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); }
    g.stroke();
  },
  diamonds(g, W, H, c1, c2) {
    const D = 26;
    for (let r = 0, y = 0; y < H + D; y += D, r++) {
      for (let c = 0, x = r % 2 ? D : 0; x < W + D; x += D * 2, c++) {
        g.fillStyle = (r + c) % 2 ? c1 : c2;
        g.beginPath(); g.moveTo(x, y - D + 3); g.lineTo(x + D - 3, y); g.lineTo(x, y + D - 3); g.lineTo(x - D + 3, y); g.closePath(); g.fill();
      }
    }
  },
  hex(g, W, H, c1, c2) {
    const R = 22, w = R * Math.sqrt(3), step = R * 1.5;
    const hex = (x, y, r) => {
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + i * Math.PI / 3, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (i) g.lineTo(px, py); else g.moveTo(px, py);
      }
      g.closePath();
    };
    g.lineWidth = 2; g.strokeStyle = c1; g.fillStyle = c2;
    for (let r = 0, y = 0; y < H + R; y += step, r++) {
      for (let c = 0, x = r % 2 ? w / 2 : 0; x < W + R; x += w, c++) {
        hex(x, y, R - 1); g.stroke();
        if ((r * 2 + c) % 3 === 0) { hex(x, y, R - 7); g.fill(); }
      }
    }
  },
  scales(g, W, H, c1, c2) {
    const R = 20; g.lineWidth = 2;
    for (let r = 0, y = H + R; y > -R; y -= R, r++) {
      g.strokeStyle = r % 2 ? c1 : c2;
      for (let x = r % 2 ? R : 0; x < W + R; x += R * 2) {
        g.beginPath(); g.arc(x, y, R - 1, Math.PI, 0); g.stroke();
        g.beginPath(); g.arc(x, y, R - 8, Math.PI, 0); g.stroke();
      }
    }
  },
  stripes(g, W, H, c1, c2) {
    const B = 30, span = W + H;
    for (let i = -1, x = -H; x < span; x += B * 2, i++) {
      g.fillStyle = i % 2 ? c1 : c2;
      g.beginPath(); g.moveTo(x, H); g.lineTo(x + B, H); g.lineTo(x + B + H, 0); g.lineTo(x + H, 0); g.closePath(); g.fill();
    }
  },
  waves(g, W, H, c1, c2) {
    g.lineWidth = 2.5;
    for (let r = 0, y = 8; y < H + 12; y += 16, r++) {
      g.strokeStyle = r % 2 ? c1 : c2;
      g.beginPath();
      for (let x = -4; x <= W + 4; x += 4) {
        const py = y + Math.sin((x + r * 26) / 15) * 5;
        if (x < 0) g.moveTo(x, py); else g.lineTo(x, py);
      }
      g.stroke();
    }
  },
  stars(g, W, H, c1, c2) {
    const S = 56;
    const star = (x, y, r) => {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r * 0.42 : r;
        if (i) g.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); else g.moveTo(x + Math.cos(a) * q, y + Math.sin(a) * q);
      }
      g.closePath(); g.fill();
    };
    for (let r = 0, y = S / 2; y < H + S; y += S / 2, r++) {
      for (let c = 0, x = (r % 2 ? S : 0) + S / 2; x < W + S; x += S * 2, c++) {
        g.fillStyle = (r + c) % 2 ? c1 : c2;
        star(x, y, r % 2 ? 11 : 15);
      }
    }
  },
  plain() {},
};

// ── Walls ──
// Each paints the TOP wall as a strip L long and T deep, its inner face at y = T.
// The other three sides are the same strip turned round, so the lit edge always
// faces the arena.
const WALL_PAINT = {
  neon(g, L, T, c) {
    g.fillStyle = c.dark; g.fillRect(0, 0, L, T);
    g.fillStyle = c.mid; g.fillRect(0, 1, L, 3);
    g.fillStyle = c.lite;
    for (let x = 6; x < L; x += 24) g.fillRect(x, 5, 12, 1);
    g.save();
    g.shadowColor = c.glow; g.shadowBlur = 7; g.fillStyle = c.glow;
    g.fillRect(0, T - 3, L, 2);
    g.restore();
  },
  brick(g, L, T, c) {
    g.fillStyle = c.dark; g.fillRect(0, 0, L, T);
    const h = 5, w = 18;
    for (let r = 0; r < 2; r++) {
      const y = 1 + r * (h + 1);
      for (let x = r ? -w / 2 : 0, i = 0; x < L; x += w + 1, i++) {
        g.fillStyle = (i * 7 + r * 3) % 5 === 0 ? c.lite : c.mid;
        g.fillRect(x, y, w, h);
        g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(x, y, w, 1);
        g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x, y + h - 1, w, 1);
      }
    }
  },
  metal(g, L, T, c) {
    g.fillStyle = c.mid; g.fillRect(0, 0, L, T);
    g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(0, 1, L, 2);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, T - 4, L, 2);
    const P = 44;
    for (let x = 0; x < L; x += P) {
      g.fillStyle = c.dark; g.fillRect(x, 0, 2, T);
      g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(x + 2, 0, 1, T);
      for (const rx of [6, P - 8]) {
        g.fillStyle = c.dark; g.fillRect(x + rx, 3, 3, 3);
        g.fillStyle = c.lite; g.fillRect(x + rx, 3, 2, 2);
      }
      g.fillStyle = c.glow; g.fillRect(x + P / 2 - 5, 7, 10, 1);
    }
  },
  rock(g, L, T, c) {
    g.fillStyle = c.dark; g.fillRect(0, 0, L, T);
    let seed = 4711 + Math.floor(L);
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let x = -4; x < L;) {
      const w = 9 + rnd() * 14, h = 7 + rnd() * 4, y = T - h - rnd() * 2;
      g.fillStyle = rnd() < 0.3 ? c.lite : c.mid;
      g.beginPath();
      g.moveTo(x, T); g.lineTo(x + 1, y + 3); g.lineTo(x + w * 0.35, y); g.lineTo(x + w * 0.8, y + 1); g.lineTo(x + w, y + 4); g.lineTo(x + w, T);
      g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(x + w * 0.35, y + 1, w * 0.4, 1);
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + w - 2, y + 4, 2, T - y - 4);
      x += w - 1;
    }
  },
  crystal(g, L, T, c) {
    g.fillStyle = c.dark; g.fillRect(0, 0, L, T);
    const W = 16;
    for (let x = 0, i = 0; x < L; x += W, i++) {
      g.fillStyle = i % 2 ? c.mid : c.lite;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + W, 0); g.lineTo(x + W / 2, T); g.closePath(); g.fill();
      g.fillStyle = i % 2 ? c.lite : c.glow;
      g.beginPath(); g.moveTo(x + W / 2, 0); g.lineTo(x + W, 0); g.lineTo(x + W / 2, T); g.closePath(); g.fill();
      g.fillStyle = c.mid;
      g.beginPath(); g.moveTo(x + W / 2, T); g.lineTo(x + W, 1); g.lineTo(x + W * 1.5, T); g.closePath(); g.fill();
    }
  },
  wood(g, L, T, c) {
    g.fillStyle = c.dark; g.fillRect(0, 0, L, T);
    for (let r = 0; r < 2; r++) {
      const y = 1 + r * 5;
      g.fillStyle = r ? c.mid : c.lite; g.fillRect(0, y, L, 4);
      g.fillStyle = 'rgba(0,0,0,0.2)';
      for (let x = (r * 37) % 29; x < L; x += 29) g.fillRect(x, y + 1 + (x % 3 ? 1 : 0), 13, 1);
    }
    for (let x = 0; x < L; x += 60) {
      g.fillStyle = c.dark; g.fillRect(x, 0, 6, T);
      g.fillStyle = c.mid; g.fillRect(x + 1, 0, 4, T);
      g.fillStyle = c.glow; g.fillRect(x + 2, 3, 2, 2); g.fillRect(x + 2, 7, 2, 2);
    }
  },
};

function arenaLookup(list, id) { return list.find(o => o.id === id) || list[0]; }

// Paint a whole scene. `W`,`H` are the image and `ax`,`ay` the wall thickness.
function paintArenaScene(g, W, H, ax, ay, pick) {
  const c = arenaLookup(ARENA_THEMES, pick && pick.theme);
  const floor = arenaLookup(ARENA_FLOORS, pick && pick.floor);
  const wall = arenaLookup(ARENA_WALLS, pick && pick.wall);
  const aw = W - ax * 2, ah = H - ay * 2;

  // Floor: two colours running corner to corner, lit from the middle.
  const base = g.createLinearGradient(0, 0, W, H);
  base.addColorStop(0, c.a); base.addColorStop(1, c.b);
  g.fillStyle = base; g.fillRect(0, 0, W, H);

  g.save();
  g.beginPath(); g.rect(ax, ay, aw, ah); g.clip();
  g.translate(ax, ay);
  g.globalAlpha = 0.16;
  FLOOR_PAINT[floor.id](g, aw, ah, c.p1, c.p2);
  if (floor.id !== 'plain') {     // a marked centre, like a real ring
    const r = Math.min(aw, ah) * 0.24;
    g.globalAlpha = 0.22; g.strokeStyle = c.p2; g.lineWidth = 3;
    g.beginPath(); g.arc(aw / 2, ah / 2, r, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1;
    g.beginPath(); g.arc(aw / 2, ah / 2, r * 0.72, 0, Math.PI * 2); g.stroke();
  }
  g.globalAlpha = 1;
  const lit = g.createRadialGradient(aw / 2, ah / 2, Math.min(aw, ah) * 0.2, aw / 2, ah / 2, Math.max(aw, ah) * 0.62);
  lit.addColorStop(0, 'rgba(0,0,0,0)'); lit.addColorStop(1, 'rgba(0,0,0,0.34)');
  g.fillStyle = lit; g.fillRect(0, 0, aw, ah);
  // The walls cast a shadow on the floor, so they read as standing up.
  const edge = (x, y, w, h, x1, y1, x2, y2) => {
    const s = g.createLinearGradient(x1, y1, x2, y2);
    s.addColorStop(0, 'rgba(0,0,0,0.4)'); s.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = s; g.fillRect(x, y, w, h);
  };
  edge(0, 0, aw, 12, 0, 0, 0, 12);
  edge(0, 0, 8, ah, 0, 0, 8, 0);
  edge(aw - 8, 0, 8, ah, aw, 0, aw - 8, 0);
  g.restore();

  // Walls: the same strip, turned to face in from each side.
  const side = (tx, ty, rot, L, T) => {
    g.save();
    g.beginPath();
    g.translate(tx, ty); g.rotate(rot);
    g.rect(0, 0, L, T); g.clip();
    WALL_PAINT[wall.id](g, L, T, c);
    g.fillStyle = c.lite; g.globalAlpha = 0.65; g.fillRect(0, T - 1, L, 1);    // lit inner edge
    g.fillStyle = '#000'; g.globalAlpha = 0.45; g.fillRect(0, 0, L, 1);        // dark outer edge
    g.restore();
  };
  side(0, 0, 0, W, ay);
  side(W, H, Math.PI, W, ay);
  side(0, H, -Math.PI / 2, H, ax);
  side(W, 0, Math.PI / 2, H, ax);

  // A squat tower on each corner, with a jewel in the theme's glow colour.
  const S = 20;
  for (const [x, y] of [[0, 0], [W - S, 0], [0, H - S], [W - S, H - S]]) {
    g.fillStyle = '#000'; g.fillRect(x, y, S, S);
    g.fillStyle = c.mid; g.fillRect(x + 1, y + 1, S - 2, S - 2);
    g.fillStyle = c.lite; g.fillRect(x + 1, y + 1, S - 2, 2); g.fillRect(x + 1, y + 1, 2, S - 2);
    g.fillStyle = c.dark; g.fillRect(x + 1, y + S - 3, S - 2, 2); g.fillRect(x + S - 3, y + 1, 2, S - 2);
    g.save();
    g.shadowColor = c.glow; g.shadowBlur = 6; g.fillStyle = c.glow;
    g.beginPath(); g.moveTo(x + S / 2, y + 5); g.lineTo(x + S - 5, y + S / 2); g.lineTo(x + S / 2, y + S - 5); g.lineTo(x + 5, y + S / 2); g.closePath(); g.fill();
    g.restore();
  }
}
