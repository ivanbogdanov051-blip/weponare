'use strict';
// The loading screens for Upgrades, Abilities, Skins, the Forge and Trade: one
// full-screen card, with a small animated scene of its own for each.
// It sits on top of the screen being opened, so that screen fills in unseen behind
// it and is simply there when the card lifts.

// These answer in milliseconds, so without a minimum the card is only a flicker.
// The first visit gets a proper look; after that it stays out of your way.
const CUST_LOAD_FIRST_MS = 900, CUST_LOAD_AGAIN_MS = 450;

const custLoad = { token: 0, t0: 0, minMs: 0, kind: null, raf: 0, last: 0, seen: {}, sparks: [], lastStrike: -1, weapons: null, icons: null, tipAt: 0 };

const CUST_SCENES = {
  shop:  { a: '#c88a0a', b: '#12b8a0', title: 'OPENING THE ARMOURY',  draw: custDrawShop,    back: () => closeShop() },
  abil:  { a: '#c81a9a', b: '#6a2aff', title: 'CHARGING YOUR POWERS', draw: custDrawAbil,    back: () => closeAbilities() },
  skin:  { a: '#ff3a8a', b: '#2ab8ff', title: 'OPENING THE WARDROBE', draw: custDrawSkin,    back: () => closeSkinsScreen() },
  forge: { a: '#d8380a', b: '#ff9a1a', title: 'HEATING THE FORGE',    draw: custDrawForge,   back: () => closeForge() },
  // A trade is already open on the server by now, so leaving has to go through it.
  trade: { a: '#0a9a6a', b: '#12b8d8', title: 'SETTING UP THE TRADE', draw: custDrawTrade,   back: null },
};

function custWeapons() {
  if (!custLoad.weapons) custLoad.weapons = Object.keys(WEAPON_ART).sort(() => Math.random() - 0.5);
  return custLoad.weapons;
}
function custCoin(g, x, y, r, t) {
  const squash = Math.abs(Math.cos(t * 5));
  g.fillStyle = '#a8680a'; g.beginPath(); g.ellipse(x, y, r * (0.2 + 0.8 * squash), r, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffd24a'; g.beginPath(); g.ellipse(x, y, Math.max(0.5, r * (0.2 + 0.8 * squash) - 2), r - 2, 0, 0, Math.PI * 2); g.fill();
}
function custHero(g, colour, hat, outfit, acc, x, y, scale, facing) {
  const spr = playerSprite(colour, hat, facing, false, outfit, acc);
  if (!spr) return;
  g.save(); g.translate(x, y); g.scale(scale, scale);
  g.drawImage(spr, -spr.width / 2, -spr.height);
  g.restore();
}
function custBackdrop(g, top, bottom) {
  const f = g.createLinearGradient(0, 0, 0, 270);
  f.addColorStop(0, top); f.addColorStop(1, bottom);
  g.fillStyle = f; g.fillRect(0, 0, 480, 270);
}

// Racks of real weapons sliding past while coins rain.
function custDrawShop(g, t) {
  custBackdrop(g, '#4a2c08', '#083a3a');
  const ids = custWeapons(), gap = 96;
  for (const [y, dir] of [[78, 1], [176, -1]]) {
    g.fillStyle = '#2a1604'; g.fillRect(0, y + 34, 480, 7);
    g.fillStyle = '#c88a2a'; g.fillRect(0, y + 34, 480, 2);
    const run = t * 44 * dir, shift = ((run % gap) + gap) % gap, first = Math.floor(run / gap);
    for (let i = -1; i < 7; i++) {
      const id = ids[((first - i + (dir > 0 ? 0 : 19)) % ids.length + ids.length) % ids.length];
      const x = i * gap + shift + 24;
      g.save();
      g.translate(x, y); g.rotate(-0.5);
      drawWeaponFitted(g, id, 0, 0, 74, 46, WEAPON_COLOR[id] || '#ccddff', true);
      g.restore();
    }
  }
  for (let i = 0; i < 14; i++) {
    const x = (i * 71 + 30) % 480, y = ((t * (70 + i * 7) + i * 53) % 310) - 20;
    custCoin(g, x, y, 7, t + i);
  }
}

// Real ability icons orbiting a charged orb.
function custDrawAbil(g, t) {
  custBackdrop(g, '#2a0a5a', '#4a0a4a');
  const cx = 240, cy = 135, pulse = 1 + 0.08 * Math.sin(t * 6);
  if (!custLoad.icons) {
    custLoad.icons = Object.keys(ABILITY_ICONS).slice(0, 8).map(id => {
      const cv = document.createElement('canvas'); cv.width = 32; cv.height = 32;
      try { drawAbilityIcon(cv.getContext('2d'), id, 32, 32); } catch {}
      return cv;
    });
  }
  g.save(); g.translate(cx, cy);
  for (const [r, w, speed, col] of [[58, 3, 1.5, '#ff5ad8'], [84, 2, -1, '#8a6aff'], [110, 3, 0.7, '#5ad8ff']]) {
    g.save(); g.rotate(t * speed); g.strokeStyle = col; g.lineWidth = w; g.setLineDash([26, 16]);
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
    g.restore();
  }
  const orb = g.createRadialGradient(0, 0, 4, 0, 0, 46 * pulse);
  orb.addColorStop(0, '#fff'); orb.addColorStop(0.35, '#ff9af0'); orb.addColorStop(1, 'rgba(160,50,255,0)');
  g.fillStyle = orb; g.beginPath(); g.arc(0, 0, 46 * pulse, 0, Math.PI * 2); g.fill();
  g.imageSmoothingEnabled = false;
  custLoad.icons.forEach((cv, i) => {
    const a = t * 0.8 + i * Math.PI * 2 / custLoad.icons.length, r = 104;
    const x = Math.cos(a) * r * 1.5, y = Math.sin(a) * r * 0.92;
    g.fillStyle = 'rgba(10,4,40,0.8)'; g.beginPath(); g.arc(x, y, 21, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffb8f0'; g.lineWidth = 2; g.stroke();
    g.drawImage(cv, x - 16, y - 16);
  });
  g.restore();
}

// You on a pedestal, trying everything on.
function custDrawSkin(g, t) {
  custBackdrop(g, '#1a0a4a', '#4a0a5a');
  g.save(); g.translate(240, 300);
  const colours = ['#ff4a6a', '#ffa52a', '#ffe84a', '#4ae88a', '#3ac8ff', '#a86aff'];
  for (let i = 0; i < 12; i++) {       // spotlight beams fanning up from the stage
    const a = -Math.PI / 2 + (i - 5.5) * 0.19 + Math.sin(t * 0.8) * 0.12;
    g.fillStyle = colours[i % colours.length]; g.globalAlpha = 0.2;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a - 0.07) * 380, Math.sin(a - 0.07) * 380); g.lineTo(Math.cos(a + 0.07) * 380, Math.sin(a + 0.07) * 380); g.closePath(); g.fill();
  }
  g.restore();
  g.fillStyle = '#ffd24a'; g.beginPath(); g.ellipse(240, 232, 92, 20, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ff5ad8'; g.beginPath(); g.ellipse(240, 228, 92, 20, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffc8f0'; g.beginPath(); g.ellipse(240, 226, 80, 15, 0, 0, Math.PI * 2); g.fill();
  const look = Math.floor(t * 2.4), fits = ['', ...Object.keys(Sprites.OUTFITS)], skin = pendingSkin || {};
  const fit = fits[look % fits.length], hat = fit ? 0 : look % 6;
  custHero(g, SKIN_COLORS[look % SKIN_COLORS.length], hat, fit, skin.accIdx || 0, 240, 228 + Math.abs(Math.sin(t * 7)) * -4, 4.2, 1);
  for (let i = 0; i < 22; i++) {
    const x = (i * 83 + 20) % 480, y = (i * 47 + 30) % 200, k = (Math.sin(t * 4 + i) + 1) / 2;
    g.fillStyle = colours[i % colours.length]; g.globalAlpha = k;
    g.fillRect(x - 1, y - 4, 2, 8); g.fillRect(x - 4, y - 1, 8, 2);
  }
  g.globalAlpha = 1;
}

// A hammer coming down on a hot weapon, a new one with every blow.
function custDrawForge(g, t, dt) {
  custBackdrop(g, '#1a0a08', '#5a1404');
  const beat = t * 1.5, strike = Math.floor(beat), p = beat - strike;
  const ids = custWeapons(), id = ids[strike % ids.length];
  // Lands at 0.78, then lingers on the metal and lifts away.
  const up = -1.25, down = 0.28;
  const ang = p < 0.6 ? down + (up - down) * Math.min(1, p / 0.3)
            : p < 0.78 ? up + (down - up) * Math.pow((p - 0.6) / 0.18, 2.4)
            : down;
  const hit = p >= 0.78 ? Math.max(0, 1 - (p - 0.78) / 0.22) : 0;
  if (hit > 0 && custLoad.lastStrike !== strike) {
    custLoad.lastStrike = strike;
    for (let i = 0; i < 26; i++) {
      const a = -Math.PI * Math.random(), v = 80 + Math.random() * 240;
      custLoad.sparks.push({ x: 244, y: 156, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.5, c: i % 3 ? '#ffb02a' : '#fff0a8' });
    }
  }
  g.save();
  if (hit > 0.5) g.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
  const fire = g.createRadialGradient(240, 300, 20, 240, 300, 260);
  fire.addColorStop(0, 'rgba(255,170,40,0.85)'); fire.addColorStop(1, 'rgba(255,60,10,0)');
  g.fillStyle = fire; g.fillRect(0, 0, 480, 270);
  for (let i = 0; i < 30; i++) {       // embers drifting up
    const x = (i * 59 + Math.sin(t + i) * 14 + 480) % 480, y = 270 - ((t * (40 + i * 3) + i * 37) % 280);
    g.fillStyle = i % 2 ? '#ff9a2a' : '#ffd84a'; g.fillRect(x, y, 3, 3);
  }
  // The anvil.
  g.fillStyle = '#20222c';
  g.beginPath(); g.moveTo(132, 172); g.lineTo(346, 172); g.lineTo(346, 188); g.lineTo(296, 198); g.lineTo(286, 226); g.lineTo(316, 246); g.lineTo(166, 246); g.lineTo(196, 226); g.lineTo(186, 198); g.lineTo(150, 190); g.closePath(); g.fill();
  g.fillStyle = '#4a4e62'; g.fillRect(132, 170, 214, 5);
  // The work, glowing.
  g.save();
  g.shadowColor = '#ff7a1a'; g.shadowBlur = 16 + hit * 26;
  drawWeaponFitted(g, id, 244, 156, 150, 36, hit > 0 ? '#fff0c8' : (WEAPON_COLOR[id] || '#ffb066'), true);
  g.restore();
  // The hammer, swinging from the shoulder.
  g.save();
  g.translate(392, 120); g.rotate(Math.PI + ang * -1 - 0.1);
  g.fillStyle = '#6a3a14'; g.fillRect(0, -5, 118, 10);
  g.fillStyle = '#a8682a'; g.fillRect(0, -5, 118, 3);
  g.fillStyle = '#3a3e50'; g.fillRect(104, -30, 46, 60);
  g.fillStyle = '#7a7e92'; g.fillRect(104, -30, 46, 8);
  g.fillStyle = '#1e202a'; g.fillRect(104, 22, 46, 8);
  g.restore();
  for (let i = custLoad.sparks.length - 1; i >= 0; i--) {
    const s = custLoad.sparks[i];
    s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 420 * dt; s.life -= dt;
    if (s.life <= 0) { custLoad.sparks.splice(i, 1); continue; }
    g.fillStyle = s.c; g.fillRect(s.x, s.y, 3, 3);
  }
  if (hit > 0.6) { g.fillStyle = 'rgba(255,240,200,' + (hit - 0.6) + ')'; g.fillRect(-10, -10, 500, 290); }
  g.restore();
}

// Two fighters, a weapon going one way and coins the other.
function custDrawTrade(g, t) {
  custBackdrop(g, '#0a4a4a', '#0a2a6a');
  for (let x = 0; x < 480; x += 40) {   // market awning
    g.fillStyle = (x / 40) % 2 ? '#fff0c8' : '#12a878';
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 40, 0); g.lineTo(x + 40, 26); g.arc(x + 20, 26, 20, 0, Math.PI); g.closePath(); g.fill();
  }
  g.fillStyle = '#6a3a14'; g.fillRect(0, 218, 480, 52);
  g.fillStyle = '#a8682a'; g.fillRect(0, 218, 480, 6);
  const skin = pendingSkin || {};
  custHero(g, SKIN_COLORS[skin.colorIdx] || '#4488ff', skin.hatIdx || 0, skin.outfit || '', skin.accIdx || 0, 92, 220, 3.2, 1);
  custHero(g, '#ff6644', 1, '', 0, 388, 220, 3.2, 0);
  const ids = custWeapons(), p = (t * 0.65) % 1, round = Math.floor(t * 0.65);
  const ease = p * p * (3 - 2 * p), lift = Math.sin(p * Math.PI) * 92;
  const id = ids[round % ids.length];
  g.save();
  g.translate(128 + ease * 224, 152 - lift); g.rotate(p * Math.PI * 2);
  drawWeaponFitted(g, id, 0, 0, 74, 42, WEAPON_COLOR[id] || '#ccddff', true);
  g.restore();
  for (let i = 0; i < 3; i++) custCoin(g, 352 - ease * 224 + i * 16 - 16, 176 + lift * 0.45 - i * 6, 9, t + i);
  g.save();
  g.translate(240, 110); g.rotate(-t * 1.5);
  g.strokeStyle = '#fff'; g.lineWidth = 5; g.lineCap = 'round';
  for (const s of [0, Math.PI]) {
    g.beginPath(); g.arc(0, 0, 22, s + 0.2, s + 2.5); g.stroke();
    const a = s + 2.5, x = Math.cos(a) * 22, y = Math.sin(a) * 22;
    g.beginPath(); g.moveTo(x - 8 * Math.cos(a - 0.7 + Math.PI / 2), y - 8 * Math.sin(a - 0.7 + Math.PI / 2)); g.lineTo(x, y); g.lineTo(x + 8 * Math.cos(a + 0.7), y + 8 * Math.sin(a + 0.7)); g.stroke();
  }
  g.restore();
}

function custLoadFrame(now) {
  custLoad.raf = 0;
  const el = document.getElementById('custLoad'), scene = CUST_SCENES[custLoad.kind];
  if (!el || !scene || !el.classList.contains('active')) return;
  const dt = custLoad.last ? Math.min(0.05, (now - custLoad.last) / 1000) : 0;
  custLoad.last = now;
  if (now >= custLoad.tipAt) {
    custLoad.tipAt = now + 3500;
    document.getElementById('custLoadTip').textContent = LOAD_TIPS[Math.floor(Math.random() * LOAD_TIPS.length)];
  }
  const g = document.getElementById('custLoadScene').getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = false;
  scene.draw(g, now / 1000, dt);
  custLoad.raf = requestAnimationFrame(custLoadFrame);
}
// Returns a token: only the load that put the card up may take it down.
function custLoadStart(kind) {
  const scene = CUST_SCENES[kind], el = document.getElementById('custLoad');
  custLoad.kind = kind; custLoad.t0 = performance.now(); custLoad.last = 0; custLoad.tipAt = 0;
  custLoad.minMs = custLoad.seen[kind] ? CUST_LOAD_AGAIN_MS : CUST_LOAD_FIRST_MS;
  custLoad.seen[kind] = true;
  el.style.setProperty('--load-a', scene.a); el.style.setProperty('--load-b', scene.b);
  document.getElementById('custLoadTitle').textContent = scene.title;
  document.getElementById('custLoadBack').style.display = scene.back ? '' : 'none';
  el.className = 'overlay active';
  if (!custLoad.raf) custLoad.raf = requestAnimationFrame(custLoadFrame);
  return ++custLoad.token;
}
function custLoadEnd(token) {
  const wait = Math.max(0, custLoad.minMs - (performance.now() - custLoad.t0));
  setTimeout(() => {
    if (token === custLoad.token) document.getElementById('custLoad').className = 'overlay hidden';
  }, wait);
}
// A sleeping server can keep the card up for a while: never trap anyone behind it.
function custLoadBack() {
  const scene = CUST_SCENES[custLoad.kind];
  custLoad.token++;
  document.getElementById('custLoad').className = 'overlay hidden';
  if (scene && scene.back) scene.back();
}
