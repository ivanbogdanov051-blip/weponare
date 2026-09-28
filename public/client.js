'use strict';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// World size. The whole arena is always on screen — the canvas backing store is
// the world, and CSS scales it down to fit the device, so a bigger map simply
// means a more zoomed-out view.
const CANVAS_W = 720, CANVAS_H = 405;
const ARENA_X = 12, ARENA_Y = 12;
const ARENA_W = CANVAS_W - ARENA_X * 2, ARENA_H = CANVAS_H - ARENA_Y * 2;

// The HUD is laid out in its own 480×270 space and drawn through a scale, so
// text and bars stay a readable size no matter how big the world gets.
const HUD_W = 480, HUD_H = 270;
const HUD_SCALE = CANVAS_W / HUD_W;

const PAL = {
  bg:'#0a0a14', arena:'#1a1a2e', wall:'#2a2a4a',
  p1:'#4488ff', p2:'#ff6644', monster:'#44cc44',
  xp:'#ffcc00', coin:'#ffd24a', hp:'#ff3333', hpBg:'#330000',
  text:'#e8e8e8', white:'#ffffff',
};

// Default colours / metadata; the server's catalog overrides these on connect.
let WEAPON_COLOR = {
  sword:'#c8d8e8', dagger:'#d4e8b0', axe:'#e8a040', spear:'#c0c8d0',
  bow:'#b89060', staff:'#cc66ff', hammer:'#aab0b8', wand:'#88ddff',
  crossbow:'#cc8844', flail:'#dd4444', greatsword:'#ddeeff',
  glaive:'#b0d8c0', katana:'#eef0ff', chakram:'#66e0c0', cannon:'#9a90a8',
  reaper:'#cc66aa', whip:'#c9a06a', grapple:'#9fb6c8', boomerang:'#d8b070',
};
const WEAPON_DESC = {
  sword:'Balanced blade', dagger:'Fast, low damage', axe:'Slow, heavy hit',
  spear:'Long reach', bow:'Fires arrows', staff:'AoE magic burst',
  hammer:'Crushes with force', wand:'Rapid magic bolts', crossbow:'Piercing shot',
  flail:'360° chain strike', greatsword:'Massive two-hander',
  glaive:'Sweeping polearm', katana:'Lightning-fast cuts', chakram:'Piercing ring',
  cannon:'Explosive shells', reaper:'Reaping 360° scythe',
  whip:'Long lashing sweep', grapple:'Hooks and reels foes in',
  boomerang:'Returns for a second hit',
};

// Filled from the server catalog: { id: {type, atkSpd, ...} }
let WEAPON_META = {};
function isRanged(id) { return WEAPON_META[id] ? WEAPON_META[id].type === 'ranged' : false; }

// ─── Skins ────────────────────────────────────────────────────────────────────

const SKIN_COLORS = ['#4488ff','#ff4444','#44cc44','#aa44ff','#ff8833','#44ddee','#ff44aa','#ffcc00'];
const SKIN_HATS   = ['NONE','CAP','CROWN','HORNS','SPIKY'];

function lsGet(k)      { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v)   { try { localStorage.setItem(k, v); } catch {} }

function loadLocalSkin() {
  try { return JSON.parse(lsGet('weponare_skin')) || { colorIdx: 0, hatIdx: 0 }; }
  catch { return { colorIdx: 0, hatIdx: 0 }; }
}
function saveLocalSkin(s)  { lsSet('weponare_skin', JSON.stringify(s)); }
function loadLocalXp(pw)   { return pw ? (parseInt(lsGet('weponare_xp_' + pw)) || 0) : 0; }
function saveLocalXp(pw, xp) { if (pw) lsSet('weponare_xp_' + pw, String(xp)); }
function loadLocalCoins(pw) { return pw ? (parseInt(lsGet('weponare_coins_' + pw)) || 0) : 0; }
function saveLocalCoins(pw, c) { if (pw) lsSet('weponare_coins_' + pw, String(c)); }

let pendingSkin = loadLocalSkin();
let skinModified = false;

function getSkinColor(p, defaultColor) {
  if (!p || !p.skin) return defaultColor;
  return SKIN_COLORS[p.skin.colorIdx] ?? defaultColor;
}

// ─── Connection ───────────────────────────────────────────────────────────────

const isLocal = ['localhost', '127.0.0.1', '10.0.2.2'].includes(location.hostname);
const wsUrl = isLocal
  ? `ws://${location.hostname}:${location.port}`
  : `wss://${location.hostname}`;

let ws = null, myNum = null, connected = false;
let prevState = null, currState = null, stateRecvTime = 0;
const SERVER_TICK_MS = 20;

let pendingName = 'PLAYER', pendingMode = 'pvp', pendingPass = '';
let roomWasFull = false;
let welcomeLeaderboard = [];
let serverPlayerSpeed = 3.6;

function readCredentials() {
  const raw  = document.getElementById('nameInput').value.trim().toUpperCase();
  const pass = document.getElementById('passInput').value.trim();
  pendingName = raw  || 'PLAYER';
  pendingPass = pass || '';
}

function joinGame(mode) {
  if (window.GameAudio) { GameAudio.init(); GameAudio.resume(); }
  readCredentials();
  pendingMode = mode;
  document.getElementById('startScreen').className = 'overlay hidden';
  setLobbyMsg('Connecting...');
  connect();
}

function toggleSound() {
  if (!window.GameAudio) return;
  GameAudio.init();
  const m = GameAudio.toggleMute();
  const btn = document.getElementById('soundBtn');
  if (btn) btn.innerHTML = '♪ SOUND: ' + (m ? 'OFF' : 'ON');
}

function updateMusicButtons(info) {
  const sb = document.getElementById('musicBtn');
  if (sb) sb.innerHTML = '♫ MUSIC: ' + (info.idx + 1) + '/' + info.count;
  const gb = document.getElementById('musicBtnGame');
  if (gb) gb.innerHTML = '♫ ' + (info.idx + 1) + '/' + info.count;
}

function cycleMusic() {
  if (!window.GameAudio) return;
  GameAudio.init();
  updateMusicButtons(GameAudio.changeTrack());
}

let leaving = false, returningToMenu = false;
function leaveGame() {
  leaving = true;
  if (window.GameAudio) GameAudio.stopMusic();
  if (ws) { try { ws.close(); } catch {} }
  showGameControls(false);
  showScreen('startScreen');
}

function showGameControls(show) {
  const el = document.getElementById('gameControls');
  if (el) el.className = show ? 'visible' : '';
}

function applyCatalog(catalog, colors) {
  if (Array.isArray(catalog)) {
    WEAPON_META = {};
    for (const w of catalog) WEAPON_META[w.id] = w;
  }
  if (colors && typeof colors === 'object') WEAPON_COLOR = { ...WEAPON_COLOR, ...colors };
}

function connect() {
  roomWasFull = false;
  returningToMenu = false;
  ws = new WebSocket(wsUrl);
  ws.onopen = () => { connected = true; };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'skin_init') {
      pendingSkin = msg.skin;
      saveLocalSkin(msg.skin);
      buildSkinGrids();
      renderSkinPreview();
    }
    if (msg.type === 'welcome') {
      myNum = msg.num;
      if (msg.leaderboard) welcomeLeaderboard = msg.leaderboard;
      if (msg.playerSpeed) serverPlayerSpeed = msg.playerSpeed;
      applyCatalog(msg.catalog, msg.colors);
      ws.send(JSON.stringify({
        type: 'join', name: pendingName, mode: pendingMode, password: pendingPass,
        skin: pendingSkin, skinModified,
        localXp: loadLocalXp(pendingPass), localCoins: loadLocalCoins(pendingPass),
      }));
      skinModified = false;
      showGameControls(true);
      const modeLabel = pendingMode === 'coop' ? 'CO-OP' : pendingMode === 'waves' ? 'WAVES' : 'PvP';
      if (pendingMode === 'waves') {
        setLobbyMsg(`<span class="p1-color">WAVES MODE</span><br><span style="color:#888">SOLO ENDLESS</span><br>Loading...`);
      } else {
        setLobbyMsg(myNum === 1
          ? `<span class="p1-color">YOU ARE PLAYER 1</span><br><span style="color:#888">${modeLabel} MODE</span><br>Waiting for opponent...`
          : `<span class="p2-color">YOU ARE PLAYER 2</span><br><span style="color:#888">${modeLabel} MODE</span><br>Game starting!`);
      }
      document.getElementById('xpDisplay').textContent = '';
    }
    if (msg.type === 'full') {
      roomWasFull = true;
      setLobbyMsg('Room is full. Try again later.');
      return;
    }
    if (msg.type === 'to_menu') {
      // A solo waves run finished — go back to the menu instead of showing an
      // error. Ignore the trailing lobby states so the menu doesn't flash.
      leaving = true;
      returningToMenu = true;
      showScreen('startScreen');
      showGameControls(false);
      if (window.GameAudio) GameAudio.stopMusic();
      return;
    }
    if (msg.type === 'state') {
      if (returningToMenu) return;
      if (pendingPass) {
        if (msg.xp !== undefined) saveLocalXp(pendingPass, msg.xp);
        if (msg.myCoins !== undefined) saveLocalCoins(pendingPass, msg.myCoins);
      }
      if (currState && msg.gameState === 'GAMEPLAY') detectSlashes(currState, msg);
      if (currState) detectAudioEvents(currState, msg);
      else if (window.GameAudio) GameAudio.syncMusic(msg.gameState === 'GAMEPLAY');
      prevState = currState;
      currState = msg;
      stateRecvTime = performance.now();
      updateScreens(msg);
    }
  };
  ws.onclose = () => {
    connected = false;
    currState = null; prevState = null; pred = null;
    if (window.GameAudio) GameAudio.stopMusic();
    showGameControls(false);
    if (leaving) {
      leaving = false;
      showScreen('startScreen');
      return;
    }
    if (roomWasFull) {
      roomWasFull = false;
      setTimeout(() => showScreen('startScreen'), 2000);
    } else {
      showScreen('disconnectedScreen');
      setTimeout(() => {
        if (document.getElementById('disconnectedScreen').className.includes('active')) {
          showScreen('startScreen');
        }
      }, 3000);
    }
  };
  ws.onerror = () => ws.close();
}

// ─── Interpolation ────────────────────────────────────────────────────────────

function lerp(a, b, t) { return a + (b - a) * t; }

// Entities are matched by id, not array position — monsters are removed from the
// middle of the list, and index matching made survivors visibly jump around.
function interpById(prevList, currList, t) {
  if (!prevList || !prevList.length) return currList;
  const byId = new Map();
  for (const e of prevList) byId.set(e.id, e);
  return currList.map(e => {
    const p = byId.get(e.id);
    return p ? { ...e, x: lerp(p.x, e.x, t), y: lerp(p.y, e.y, t) } : e;
  });
}

function interpState(prev, curr, t) {
  if (!prev || t >= 1) return curr;
  const ip = (a, b) => (!a || !b || b.dead) ? b : { ...b, x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
  return {
    ...curr,
    players: {
      p1: ip(prev.players?.p1, curr.players?.p1),
      p2: ip(prev.players?.p2, curr.players?.p2),
    },
    monsters:    interpById(prev.monsters, curr.monsters || [], t),
    projectiles: interpById(prev.projectiles, curr.projectiles || [], t),
    coins:       interpById(prev.coins, curr.coins || [], t),
  };
}

// ─── Client-side Prediction (local player) ──────────────────────────────────────
// Renders the local player using locally-applied input immediately, instead of
// waiting for the server round-trip + interpolation buffer. Reconciles toward the
// authoritative server position each frame to correct drift.

let pred = null; // { x, y, facing }

function updatePrediction(frameDt) {
  if (!currState || currState.gameState !== 'GAMEPLAY' || !myNum) { pred = null; return; }
  const key = myNum === 1 ? 'p1' : 'p2';
  const me = currState.players?.[key];
  if (!me || me.dead) { pred = null; return; }
  if (!pred) pred = { x: me.x, y: me.y, facing: me.facing };

  const inp = currentInputs();
  const moving = inp.left || inp.right || inp.up || inp.down;

  // Reconcile toward the authoritative position. While moving we only nudge very
  // gently — the server position lags by the round-trip, so pulling hard toward it
  // causes a draggy / rubber-band feel. When idle we settle firmly onto it.
  const dx = me.x - pred.x, dy = me.y - pred.y;
  const gap = Math.hypot(dx, dy);
  if (gap > 36 || me.pulled) {   // knockback / grapple / teleport / respawn → snap
    pred.x = me.x; pred.y = me.y;
  } else if (!moving) {
    pred.x += dx * 0.30; pred.y += dy * 0.30;
  } else {
    pred.x += dx * 0.05; pred.y += dy * 0.05;
  }

  // Mirror server speed modifiers so prediction matches authoritative movement.
  let spd = serverPlayerSpeed;
  if (me.effects && me.effects.speed > 0) spd *= 1.7;
  if (me.effects && me.effects.slow  > 0) spd *= 0.4;

  // Apply currently-held inputs immediately (instant response)
  let vx = 0, vy = 0;
  if (inp.left)  { vx = -spd; pred.facing = -1; }
  if (inp.right) { vx =  spd; pred.facing =  1; }
  if (inp.up)    vy = -spd;
  if (inp.down)  vy =  spd;
  if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }
  const f = frameDt / 16.67;
  pred.x = Math.max(ARENA_X + 2, Math.min(ARENA_X + ARENA_W - me.w - 2, pred.x + vx * f));
  pred.y = Math.max(ARENA_Y + 2, Math.min(ARENA_Y + ARENA_H - me.h - 2, pred.y + vy * f));
}

function applyPrediction(state) {
  if (!pred || !myNum) return state;
  const key = myNum === 1 ? 'p1' : 'p2';
  const me = state.players?.[key];
  if (!me || me.dead) return state;
  // Clone so we never mutate the stored authoritative currState.
  const players = { ...state.players };
  players[key] = { ...me, x: pred.x, y: pred.y, facing: pred.facing };
  return { ...state, players };
}

// ─── Slash Effects ────────────────────────────────────────────────────────────

const slashes = [];

function nearestEnemyAngle(cp, state, playerKey) {
  const px = cp.x + cp.w / 2, py = cp.y + cp.h / 2;
  let nearest = null, bestDist = Infinity;
  const coop = state.gameMode === 'coop';
  for (const [k, ep] of Object.entries(state.players || {})) {
    if (k !== playerKey && ep && !ep.dead && !coop) {
      const d = Math.hypot(ep.x + ep.w / 2 - px, ep.y + ep.h / 2 - py);
      if (d < bestDist) { bestDist = d; nearest = ep; }
    }
  }
  for (const m of state.monsters || []) {
    const d = Math.hypot(m.x + m.w / 2 - px, m.y + m.h / 2 - py);
    if (d < bestDist) { bestDist = d; nearest = m; }
  }
  if (!nearest) return null;
  return Math.atan2(nearest.y + nearest.h / 2 - py, nearest.x + nearest.w / 2 - px);
}

function pushSlash(cp, angle) {
  const r = cp.w + 12;
  slashes.push({
    x: cp.x + cp.w / 2 + Math.cos(angle) * r,
    y: cp.y + cp.h / 2 + Math.sin(angle) * r,
    angle,
    facing: cp.facing,
    weaponId: cp.weaponId,
    timer: 220, maxTimer: 220,
    color: WEAPON_COLOR[cp.weaponId] || PAL.white,
  });
}

function detectSlashes(prev, curr) {
  const myKey = myNum === 1 ? 'p1' : (myNum === 2 ? 'p2' : null);
  for (const key of ['p1', 'p2']) {
    const cp = curr.players?.[key], pp = prev.players?.[key];
    if (!cp || cp.dead) continue;
    const fresh = cp.swingTimer > 0 && (!pp || pp.swingTimer <= 0 || cp.swingTimer > pp.swingTimer);
    if (!fresh) continue;
    // For the local player we already showed a predicted slash on key-press;
    // skip the (delayed) server echo so we don't draw / hear it twice.
    if (key === myKey && performance.now() - lastLocalSlashTime < 350) continue;
    if (window.GameAudio) GameAudio.sfx[isRanged(cp.weaponId) ? 'shoot' : 'swing']();
    pushSlash(cp, nearestEnemyAngle(cp, curr, key) ?? (cp.facing === 1 ? 0 : Math.PI));
  }
}

function countType(list, type) {
  let n = 0;
  for (const p of list || []) if (p.type === type) n++;
  return n;
}

function detectAudioEvents(prev, curr) {
  if (!window.GameAudio) return;
  if (prev.gameState !== curr.gameState && curr.gameState === 'WEAPON_UNLOCK') GameAudio.sfx.unlock();
  GameAudio.syncMusic(curr.gameState === 'GAMEPLAY');
  if (curr.gameState !== 'GAMEPLAY') return;

  // Monster killed (array shrank)
  if ((curr.monsters?.length || 0) < (prev.monsters?.length || 0)) GameAudio.sfx.death();

  // Local player took damage
  const key = myNum === 1 ? 'p1' : 'p2';
  const pme = prev.players?.[key], cme = curr.players?.[key];
  if (pme && cme && cme.hp < pme.hp) GameAudio.sfx.hit();

  // Special attack fired (new shockwave particle or new special projectile)
  const pSpec = (prev.projectiles || []).filter(p => p.special).length;
  const cSpec = (curr.projectiles || []).filter(p => p.special).length;
  if (countType(curr.particles, 'shockwave') > countType(prev.particles, 'shockwave') || cSpec > pSpec) {
    GameAudio.sfx.special();
  }

  const evt = [
    ['waveclear', 'waveclear'], ['parry', 'parry'], ['trapburst', 'trap'],
    ['pickup', 'pickup'], ['useitem', 'useitem'], ['coin', 'xp'],
    ['teleport', 'special'], ['hookhit', 'hit'],
  ];
  for (const [ptype, sound] of evt) {
    if (countType(curr.particles, ptype) > countType(prev.particles, ptype)) GameAudio.sfx[sound]();
  }
}

function tickSlashes(dt) {
  for (let i = slashes.length - 1; i >= 0; i--) {
    slashes[i].timer -= dt;
    if (slashes[i].timer <= 0) slashes.splice(i, 1);
  }
}

function drawSlashes() {
  for (const sl of slashes) {
    const alpha = sl.timer / sl.maxTimer;
    const prog = 1 - alpha;
    const cx = Math.round(sl.x), cy = Math.round(sl.y);
    ctx.save();
    ctx.lineCap = 'round';
    if (!isRanged(sl.weaponId)) {
      const r = 13 + prog * 7;
      const aim = sl.angle ?? (sl.facing === 1 ? 0 : Math.PI);
      const span = Math.PI * 0.85;
      ctx.globalAlpha = alpha * 0.9;
      ctx.strokeStyle = sl.color;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, r, aim - span / 2, aim + span / 2, false); ctx.stroke();
      if (alpha > 0.5) {
        ctx.globalAlpha = ((alpha - 0.5) / 0.5) * 0.6;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, r - 4, aim - span / 2, aim + span / 2, false); ctx.stroke();
      }
    } else {
      ctx.globalAlpha = alpha * 0.75;
      ctx.strokeStyle = sl.color;
      ctx.lineWidth = 1.5;
      const steps = sl.weaponId === 'staff' ? 8 : 6;
      for (let a = 0; a < Math.PI * 2; a += Math.PI * 2 / steps) {
        const len = 3 + prog * 6;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 3, cy + Math.sin(a) * 3);
        ctx.lineTo(cx + Math.cos(a) * (3 + len), cy + Math.sin(a) * (3 + len));
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

// ─── Input ────────────────────────────────────────────────────────────────────

const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const keys = {};
const touchKeys = { up: false, down: false, left: false, right: false, attack: false, swap: false, special: false, parry: false };

window.addEventListener('keydown', (e) => {
  if (!keys[e.code]) { keys[e.code] = true; sendInput(); }
  if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','ShiftLeft','ShiftRight','KeyP','ControlLeft','ControlRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'Space' && currState && currState.gameState === 'WEAPON_UNLOCK' && currState.pendingUnlock) sendAckUnlock();
  if (e.code === 'KeyM') toggleSound();
  if (e.code.startsWith('Digit')) {
    const n = parseInt(e.code.slice(5));
    if (n >= 1 && n <= 4) useItem(n - 1);
  }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; sendInput(); });
// A key released while the tab was unfocused otherwise sticks down forever.
window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  for (const k in touchKeys) touchKeys[k] = false;
  sendInput();
});

function currentInputs() {
  return {
    up:      !!keys['ArrowUp']    || !!keys['KeyW'] || touchKeys.up,
    down:    !!keys['ArrowDown']  || !!keys['KeyS'] || touchKeys.down,
    left:    !!keys['ArrowLeft']  || !!keys['KeyA'] || touchKeys.left,
    right:   !!keys['ArrowRight'] || !!keys['KeyD'] || touchKeys.right,
    attack:  !!keys['Space']      || touchKeys.attack,
    swap:    !!keys['Enter']      || touchKeys.swap,
    special: !!keys['ShiftLeft'] || !!keys['ShiftRight'] || touchKeys.special,
    parry:   !!keys['KeyP'] || !!keys['ControlLeft'] || !!keys['ControlRight'] || touchKeys.parry,
  };
}

let localPrevAttack = false;
let localAtkCd = 0;          // client-mirrored attack cooldown (ms)
let lastLocalSlashTime = 0;  // suppress the server echo of a slash we already showed

function sendInput() {
  if (!ws || ws.readyState !== 1) return;
  const inp = currentInputs();
  ws.send(JSON.stringify({ type:'input', keys: inp }));
  // Predict the attack swing locally for instant feedback (rising edge only).
  if (inp.attack && !localPrevAttack) tryLocalAttack();
  localPrevAttack = inp.attack;
}

function tryLocalAttack() {
  if (!currState || currState.gameState !== 'GAMEPLAY' || !myNum) return;
  const key = myNum === 1 ? 'p1' : 'p2';
  const me = currState.players?.[key];
  if (!me || me.dead || localAtkCd > 0) return;
  const haste = me.effects && me.effects.haste > 0;
  // atkSpd comes from the server so weapon upgrades stay in sync.
  localAtkCd = (me.atkSpd || WEAPON_META[me.weaponId]?.atkSpd || 400) * (haste ? 0.5 : 1);
  spawnLocalSlash(me, key);
}

function spawnLocalSlash(me, key) {
  const px = pred ? pred.x : me.x, py = pred ? pred.y : me.y;
  const facing = pred ? pred.facing : me.facing;
  const cp = { ...me, x: px, y: py, facing };
  if (window.GameAudio) GameAudio.sfx[isRanged(me.weaponId) ? 'shoot' : 'swing']();
  pushSlash(cp, nearestEnemyAngle(cp, currState, key) ?? (facing === 1 ? 0 : Math.PI));
  lastLocalSlashTime = performance.now();
}
function sendAckUnlock() { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type:'ack_unlock' })); }

// ── Tap a weapon slot to select it directly (mobile-friendly quick swap) ──
function selectWeaponIndex(idx) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'select_weapon', index: idx }));
}

function handleCanvasTap(clientX, clientY) {
  if (!currState || currState.gameState !== 'GAMEPLAY') return false;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  // Client px → canvas px → HUD space (panels are laid out in HUD coordinates).
  const hx = (clientX - rect.left) * (CANVAS_W / rect.width)  / HUD_SCALE;
  const hy = (clientY - rect.top)  * (CANVAS_H / rect.height) / HUD_SCALE;
  const pad = 5; // generous hit area for fingers
  const inside = s => hx >= s.x - pad && hx <= s.x + s.w + pad
                   && hy >= s.y - pad && hy <= s.y + s.h + pad;
  for (const s of itemSlotRects) {
    if (inside(s)) { useItem(s.index); return true; }
  }
  for (const s of weaponSlotRects) {
    if (inside(s)) {
      selectWeaponIndex(s.index);
      if (window.GameAudio) GameAudio.sfx.swing();
      return true;
    }
  }
  return false;
}

canvas.addEventListener('pointerdown', (e) => {
  if (handleCanvasTap(e.clientX, e.clientY)) e.preventDefault();
}, { passive: false });

// ─── Touch Controls ───────────────────────────────────────────────────────────

function setupTouchControls() {
  if (!isTouchDevice) return;
  const tc = document.getElementById('touchControls');
  if (tc) tc.classList.add('visible');

  const btnMap = [
    ['btn-up','up'], ['btn-down','down'], ['btn-left','left'],
    ['btn-right','right'], ['btn-attack','attack'], ['btn-swap','swap'],
    ['btn-special','special'], ['btn-parry','parry'],
  ];
  for (const [id, key] of btnMap) {
    const el = document.getElementById(id);
    if (!el) continue;
    const press = (e) => { e.preventDefault(); touchKeys[key] = true; sendInput(); };
    const release = (e) => { e.preventDefault(); touchKeys[key] = false; sendInput(); };
    el.addEventListener('touchstart', press, { passive: false });
    el.addEventListener('touchend',   release, { passive: false });
    el.addEventListener('touchcancel',release, { passive: false });
  }

  // Tap unlock screen to continue
  const unlockOverlay = document.getElementById('unlockScreen');
  if (unlockOverlay) {
    unlockOverlay.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (currState && currState.gameState === 'WEAPON_UNLOCK' && currState.pendingUnlock) sendAckUnlock();
    }, { passive: false });
  }
}
setupTouchControls();

// Reflect saved audio preferences on the start-screen buttons
if (window.GameAudio) {
  if (GameAudio.isMuted()) {
    const b = document.getElementById('soundBtn');
    if (b) b.innerHTML = '♪ SOUND: OFF';
  }
  updateMusicButtons(GameAudio.trackInfo());
}

// ─── Skin Screen ──────────────────────────────────────────────────────────────

function openSkinsScreen() {
  showScreen('skinsScreen');
  buildSkinGrids();
  renderSkinPreview();
}
function closeSkinsScreen() { showScreen('startScreen'); }

function selectSkinColor(idx) {
  pendingSkin.colorIdx = idx;
  skinModified = true;
  saveLocalSkin(pendingSkin);
  buildSkinGrids();
  renderSkinPreview();
}
function selectSkinHat(idx) {
  pendingSkin.hatIdx = idx;
  skinModified = true;
  saveLocalSkin(pendingSkin);
  buildSkinGrids();
  renderSkinPreview();
}

function buildSkinGrids() {
  const cg = document.getElementById('colorGrid');
  if (cg) cg.innerHTML = SKIN_COLORS.map((c, i) =>
    `<div class="skin-color${i === pendingSkin.colorIdx ? ' selected' : ''}" style="background:${c}" onclick="selectSkinColor(${i})"></div>`
  ).join('');
  const hg = document.getElementById('hatGrid');
  if (hg) hg.innerHTML = SKIN_HATS.map((h, i) =>
    `<div class="skin-hat${i === pendingSkin.hatIdx ? ' selected' : ''}" onclick="selectSkinHat(${i})">${h}</div>`
  ).join('');
}

function renderSkinPreview() {
  const uc = document.getElementById('skinPreviewCanvas');
  if (!uc) return;
  const ux = uc.getContext('2d');
  ux.imageSmoothingEnabled = false;
  ux.clearRect(0, 0, 72, 80);
  ux.fillStyle = '#1a1a2e'; ux.fillRect(0, 0, 72, 80);

  const color = SKIN_COLORS[pendingSkin.colorIdx] || '#4488ff';
  ux.save();
  const sc = 3.5;
  ux.translate(36, 40 - 8 * sc / 2);
  ux.scale(sc, sc);
  const bx = -6, by = 0;
  ux.fillStyle = 'rgba(0,0,0,0.3)'; ux.fillRect(bx + 1, by + 16, 10, 2);
  ux.fillStyle = color;
  ux.fillRect(bx + 1, by + 11, 4, 5); ux.fillRect(bx + 7, by + 11, 4, 5);
  ux.fillRect(bx, by + 5, 12, 7);
  ux.fillStyle = 'rgba(0,0,0,0.25)'; ux.fillRect(bx, by + 5, 12, 2);
  ux.fillStyle = color; ux.fillRect(bx + 1, by, 10, 5);
  ux.fillStyle = '#fff'; ux.fillRect(bx + 8, by + 1, 2, 2);
  drawHatOn(ux, bx, by, color, pendingSkin.hatIdx);
  ux.restore();
}

function drawHatOn(g, x, y, color, hatIdx) {
  const hat = SKIN_HATS[hatIdx] || 'NONE';
  if (hat === 'CAP') {
    g.fillStyle = '#223344'; g.fillRect(x - 1, y - 3, 14, 2); g.fillRect(x + 1, y - 6, 10, 3);
    g.fillStyle = '#334455'; g.fillRect(x + 1, y - 6, 9, 1);
  } else if (hat === 'CROWN') {
    g.fillStyle = '#ddaa00';
    g.fillRect(x, y - 4, 2, 3); g.fillRect(x + 4, y - 6, 3, 5); g.fillRect(x + 9, y - 4, 2, 3);
    g.fillStyle = '#ffee44';
    g.fillRect(x + 1, y - 4, 1, 1); g.fillRect(x + 5, y - 6, 1, 1); g.fillRect(x + 10, y - 4, 1, 1);
  } else if (hat === 'HORNS') {
    g.fillStyle = '#aa1111'; g.fillRect(x + 1, y - 6, 2, 5); g.fillRect(x + 9, y - 6, 2, 5);
    g.fillStyle = '#ee3333'; g.fillRect(x + 1, y - 7, 2, 1); g.fillRect(x + 9, y - 7, 2, 1);
  } else if (hat === 'SPIKY') {
    g.fillStyle = color;
    g.fillRect(x + 1, y - 3, 2, 2); g.fillRect(x + 4, y - 5, 2, 4);
    g.fillRect(x + 7, y - 3, 2, 2); g.fillRect(x + 10, y - 2, 2, 1);
  }
}

// ─── Upgrade Shop ─────────────────────────────────────────────────────────────

let shopData = null;
let shopBusy = false;

function setShopMsg(text, isError) {
  const el = document.getElementById('shopMsg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'shop-msg' + (isError ? ' err' : '');
}

async function openShop() {
  readCredentials();
  showScreen('shopScreen');
  document.getElementById('shopList').innerHTML = '';
  document.getElementById('shopCoins').innerHTML = '';
  if (!pendingPass) {
    setShopMsg('Enter a password on the title screen first — upgrades and coins are saved to it.', true);
    return;
  }
  setShopMsg('Loading...');
  try {
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: pendingPass,
        localXp: loadLocalXp(pendingPass),
        localCoins: loadLocalCoins(pendingPass),
      }),
    });
    const data = await res.json();
    if (!res.ok) { setShopMsg(data.error || 'Could not load your profile.', true); return; }
    shopData = data;
    applyCatalog(data.catalog, data.colors);
    saveLocalCoins(pendingPass, data.coins);
    setShopMsg('');
    renderShop();
  } catch {
    setShopMsg('Could not reach the server.', true);
  }
}
function closeShop() { showScreen('startScreen'); }

function renderShop() {
  if (!shopData) return;
  const { coins, weapons, upgrades, upgradeDefs, costs } = shopData;
  document.getElementById('shopCoins').innerHTML =
    `<span class="coin-ic">◆</span> ${coins.toLocaleString()} COINS`;

  const list = document.getElementById('shopList');
  if (!weapons.length) {
    list.innerHTML = '<div class="shop-empty">No weapons yet — play a match to unlock some.</div>';
    return;
  }

  list.innerHTML = weapons.map(id => {
    const lv = upgrades[id] || {};
    const name = WEAPON_META[id]?.name || id.toUpperCase();
    const col = WEAPON_COLOR[id] || '#ccc';
    const rows = Object.keys(upgradeDefs).map(stat => {
      const def = upgradeDefs[stat];
      const cur = lv[stat] || 0;
      const maxed = cur >= def.max;
      const cost = maxed ? 0 : costs[stat][cur];
      const afford = !maxed && coins >= cost;
      const pips = Array.from({ length: def.max },
        (_, i) => `<i class="${i < cur ? 'on' : ''}"></i>`).join('');
      return `<button class="up-btn${maxed ? ' maxed' : afford ? '' : ' poor'}"
        ${maxed ? 'disabled' : ''} onclick="buyUpgrade('${id}','${stat}')">
        <span class="up-name">${def.name.slice(0, 3)}</span>
        <span class="up-pips">${pips}</span>
        <span class="up-cost">${maxed ? 'MAX' : '◆' + cost}</span></button>`;
    }).join('');
    return `<div class="shop-row">
      <div class="shop-head">
        <canvas class="shop-ic" data-weapon="${id}" width="56" height="32"></canvas>
        <span class="shop-name" style="color:${col}">${name}</span>
      </div>
      <div class="shop-stats">${rows}</div>
    </div>`;
  }).join('');

  for (const cv of list.querySelectorAll('canvas.shop-ic')) {
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    const id = cv.dataset.weapon;
    drawWeaponFitted(g, id, cv.width / 2, cv.height / 2, cv.width - 8, cv.height - 8,
                     WEAPON_COLOR[id] || '#ccc', false);
  }
}

async function buyUpgrade(weaponId, stat) {
  if (shopBusy || !pendingPass) return;
  shopBusy = true;
  setShopMsg('');
  try {
    const res = await fetch('/api/upgrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pendingPass, weaponId, stat }),
    });
    const data = await res.json();
    if (!res.ok) { setShopMsg(data.error || 'Upgrade failed.', true); return; }
    shopData = { ...shopData, ...data };
    saveLocalCoins(pendingPass, data.coins);
    if (window.GameAudio) { GameAudio.init(); GameAudio.sfx.unlock(); }
    renderShop();
  } catch {
    setShopMsg('Could not reach the server.', true);
  } finally {
    shopBusy = false;
  }
}

// ─── Screens ──────────────────────────────────────────────────────────────────

const SCREENS = ['startScreen','lobbyScreen','unlockScreen','roundScreen','disconnectedScreen','skinsScreen','shopScreen'];
function showScreen(id) { SCREENS.forEach(s => { const el=document.getElementById(s); if(el) el.className='overlay '+(s===id?'active':'hidden'); }); }
function hideAllScreens() { SCREENS.forEach(s => { const el=document.getElementById(s); if(el) el.className='overlay hidden'; }); }
function setLobbyMsg(html) { showScreen('lobbyScreen'); document.getElementById('lobbyMsg').innerHTML = html; }

function updateScreens(state) {
  if (state.gameState === 'LOBBY') {
    if (state.gameMode === 'waves') {
      setLobbyMsg(`<span style="color:#ffcc00">WAVES MODE</span><br><span style="color:#888">SOLO ENDLESS</span><br>Loading...`);
    } else {
      const modeStr = state.gameMode === 'coop' ? 'CO-OP MODE' : 'PvP MODE';
      setLobbyMsg(myNum
        ? (myNum===1
            ? `<span class="p1-color">${state.playerNames?.p1||'PLAYER 1'}</span> &nbsp;[${modeStr}]<br>Waiting for opponent...`
            : `<span class="p2-color">${state.playerNames?.p2||'PLAYER 2'}</span> &nbsp;[${modeStr}]<br>Waiting...`)
        : 'Waiting...');
    }
    document.getElementById('xpDisplay').innerHTML =
      `XP: ${state.xp || 0} &nbsp;&nbsp; <span style="color:${PAL.coin}">◆ ${state.myCoins || 0}</span>`;
    return;
  }
  if (state.gameState === 'WEAPON_UNLOCK') {
    showScreen('unlockScreen');
    const w = state.pendingUnlock;
    const uc = document.getElementById('unlockCanvas');
    const ux = uc.getContext('2d');
    ux.imageSmoothingEnabled = false;
    if (w) {
      document.getElementById('unlockName').textContent = (WEAPON_META[w]?.name || w).toUpperCase();
      document.getElementById('unlockDesc').textContent = WEAPON_DESC[w] || '';
      document.getElementById('unlockHint').textContent = isTouchDevice ? 'TAP TO CONTINUE' : 'PRESS SPACE TO CONTINUE';
      drawUnlockPreview(ux, w);
    } else if (state.otherHasUnlocks) {
      document.getElementById('unlockName').textContent = '';
      document.getElementById('unlockDesc').textContent = 'Waiting for other player...';
      document.getElementById('unlockHint').textContent = '';
      ux.clearRect(0,0,uc.width,uc.height);
      ux.fillStyle='#1a1a2e'; ux.fillRect(0,0,uc.width,uc.height);
    }
    return;
  }
  if (state.gameState === 'ROUND_OVER') {
    showScreen('roundScreen');
    const r = state.round;
    const lb = document.getElementById('leaderboardBox');
    const hint = document.getElementById('roundHint');
    if (state.gameMode === 'waves') {
      hint.textContent = 'RETURNING TO MENU...';
      document.getElementById('roundTitle').innerHTML = '<span style="color:#ffcc00">WAVES OVER</span>';
      document.getElementById('roundStats').innerHTML =
        `WAVE <span style="color:#ffcc00">${state.wave?.num||0}</span> REACHED<br>`
        + `XP: ${state.xp} &nbsp; <span style="color:${PAL.coin}">◆ ${state.myCoins||0}</span>`;
      if (state.leaderboard && state.leaderboard.length > 0) {
        lb.classList.remove('hidden');
        lb.innerHTML = '<div class="leaderboard-title">TOP SCORES</div>' +
          state.leaderboard.map((e,i) =>
            `<div class="lb-row${i===0?' lb-top':''}">`+
            `<span>${i+1}. ${e.name}</span>`+
            `<span>${e.waves} waves</span>`+
            `<span style="color:#555">${e.date}</span></div>`
          ).join('');
      } else {
        lb.classList.add('hidden');
      }
    } else if (state.gameMode === 'coop') {
      lb.classList.add('hidden');
      hint.textContent = 'NEXT ROUND STARTING...';
      document.getElementById('roundTitle').innerHTML = '<span style="color:#ffcc00">GAME OVER</span>';
      document.getElementById('roundStats').innerHTML =
        `WAVE ${state.wave?.num||0} REACHED<br>XP: ${state.xp} &nbsp; <span style="color:${PAL.coin}">◆ ${state.myCoins||0}</span>`;
    } else {
      lb.classList.add('hidden');
      const p1 = state.players.p1, p2 = state.players.p2;
      const p1Out = !p1 || (p1.dead && p1.lives <= 0);
      const p2Out = !p2 || (p2.dead && p2.lives <= 0);
      const nameOf = n => (n === 1 ? state.playerNames?.p1 || 'P1' : state.playerNames?.p2 || 'P2');
      if (r.matchWinner) {
        hint.textContent = 'NEW MATCH STARTING...';
        document.getElementById('roundTitle').innerHTML =
          `<span class="${r.matchWinner===1?'p1-color':'p2-color'}">${nameOf(r.matchWinner)} TAKES THE MATCH</span>`;
      } else {
        hint.textContent = 'NEXT ROUND STARTING...';
        if (p1Out && p2Out) {
          document.getElementById('roundTitle').innerHTML = '<span style="color:#ffcc00">DRAW!</span>';
        } else {
          const wn = p2Out ? 1 : 2;
          document.getElementById('roundTitle').innerHTML =
            `<span class="${wn===1?'p1-color':'p2-color'}">${nameOf(wn)} WINS THE ROUND</span>`;
        }
      }
      document.getElementById('roundStats').innerHTML =
        `${nameOf(1)} ${r.p1Wins} &nbsp;—&nbsp; ${r.p2Wins} ${nameOf(2)}`
        + `<br><span style="color:#888">FIRST TO ${r.maxWins} WINS THE MATCH</span><br>`
        + `XP: ${state.xp} &nbsp; <span style="color:${PAL.coin}">◆ ${state.myCoins||0}</span>`;
    }
    return;
  }
  if (state.gameState === 'GAMEPLAY') { hideAllScreens(); return; }
}

// ─── Render Loop ──────────────────────────────────────────────────────────────

let lastFrameTime = 0;
function renderLoop(now) {
  const dt = lastFrameTime ? Math.min(now - lastFrameTime, 100) : 16;
  lastFrameTime = now;
  tickSlashes(dt);
  if (localAtkCd > 0) localAtkCd -= dt;
  if (currState && currState.gameState === 'GAMEPLAY') {
    updatePrediction(dt);
    const t = Math.min(1, (now - stateRecvTime) / SERVER_TICK_MS);
    draw(applyPrediction(interpState(prevState, currState, t)));
  } else {
    pred = null;
    slashes.length = 0;
    itemSlotRects = [];
    weaponSlotRects = [];
  }
  requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

// ─── Draw ─────────────────────────────────────────────────────────────────────

function draw(state) {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  drawArena();
  drawTraps(state.traps || []);
  drawItems(state.items || []);
  drawCoins(state.coins || []);
  drawSlashes();
  drawChains(state.chains || []);
  drawProjectiles(state.projectiles || []);
  drawMonsters(state.monsters || []);
  const names = state.playerNames || {};
  if (state.players.p1) drawPlayer(state.players.p1, PAL.p1, names.p1 || 'P1');
  if (state.players.p2) drawPlayer(state.players.p2, PAL.p2, names.p2 || 'P2');
  drawParticles(state.particles || []);
  ctx.save();
  ctx.scale(HUD_SCALE, HUD_SCALE);
  drawHUD(state);
  drawItemBar(state.inventory || []);
  drawWeaponPanel(state);
  ctx.restore();
}

function drawArena() {
  ctx.fillStyle = PAL.arena; ctx.fillRect(0,0,CANVAS_W,CANVAS_H);
  // Floor tiles, slightly chequered so the bigger arena reads as a space.
  const T = 24;
  ctx.fillStyle = 'rgba(255,255,255,0.016)';
  for (let ty = 0; ty * T < ARENA_H; ty++) {
    for (let tx = (ty % 2); tx * T < ARENA_W; tx += 2) {
      ctx.fillRect(ARENA_X + tx*T, ARENA_Y + ty*T,
                   Math.min(T, ARENA_W - tx*T), Math.min(T, ARENA_H - ty*T));
    }
  }
  ctx.strokeStyle='rgba(255,255,255,0.028)'; ctx.lineWidth=1;
  for(let x=ARENA_X;x<=ARENA_X+ARENA_W;x+=T){ctx.beginPath();ctx.moveTo(x+0.5,ARENA_Y);ctx.lineTo(x+0.5,ARENA_Y+ARENA_H);ctx.stroke();}
  for(let y=ARENA_Y;y<=ARENA_Y+ARENA_H;y+=T){ctx.beginPath();ctx.moveTo(ARENA_X,y+0.5);ctx.lineTo(ARENA_X+ARENA_W,y+0.5);ctx.stroke();}
  // Walls
  ctx.fillStyle = PAL.wall;
  ctx.fillRect(0,0,CANVAS_W,ARENA_Y); ctx.fillRect(0,CANVAS_H-ARENA_Y,CANVAS_W,ARENA_Y);
  ctx.fillRect(0,0,ARENA_X,CANVAS_H); ctx.fillRect(CANVAS_W-ARENA_X,0,ARENA_X,CANVAS_H);
  ctx.fillStyle = 'rgba(140,140,200,0.18)';
  ctx.fillRect(ARENA_X-1,ARENA_Y-1,ARENA_W+2,1);
  ctx.fillRect(ARENA_X-1,ARENA_Y+ARENA_H,ARENA_W+2,1);
  ctx.fillRect(ARENA_X-1,ARENA_Y-1,1,ARENA_H+2);
  ctx.fillRect(ARENA_X+ARENA_W,ARENA_Y-1,1,ARENA_H+2);
}

// ─── Traps & Items ──────────────────────────────────────────────────────────────

function drawTraps(traps) {
  const now = performance.now();
  for (const tr of traps) {
    const cx = tr.x + tr.w / 2, cy = tr.y + tr.h / 2;
    if (tr.state === 'firing') {
      ctx.save();
      ctx.globalAlpha = 0.45; ctx.fillStyle = tr.color;
      ctx.beginPath(); ctx.arc(cx, cy, tr.radius, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 0.9; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, tr.radius, 0, Math.PI*2); ctx.stroke();
      ctx.restore();
      continue;
    }
    // Danger footprint, so a big trap's reach is obvious before it goes off.
    ctx.save();
    ctx.globalAlpha = tr.state === 'arming' ? 0.2 : 0.09;
    ctx.fillStyle = tr.color;
    ctx.beginPath(); ctx.arc(cx, cy, tr.radius, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = tr.state === 'arming' ? 0.95 : 0.3;
    ctx.strokeStyle = tr.color; ctx.lineWidth = tr.state === 'arming' ? 2.5 : 1;
    ctx.setLineDash(tr.state === 'arming' ? [] : [5, 5]);
    ctx.beginPath();
    if (tr.state === 'arming') ctx.arc(cx, cy, tr.radius, -Math.PI/2, -Math.PI/2 + Math.PI*2*tr.armRatio);
    else ctx.arc(cx, cy, tr.radius, 0, Math.PI*2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    const s = tr.w;             // trap bodies are square
    ctx.save();
    ctx.translate(cx, cy);
    if (tr.type === 'spike') {
      // Wooden pressure plate with iron spikes bursting out of it.
      ctx.fillStyle = '#2a1c10'; ctx.fillRect(-s/2, -s/2, s, s);
      ctx.fillStyle = '#3d2a17'; ctx.fillRect(-s/2+2, -s/2+2, s-4, s-4);
      ctx.strokeStyle = '#1a1108'; ctx.lineWidth = 1.5;
      ctx.strokeRect(-s/2+0.5, -s/2+0.5, s-1, s-1);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = '#231508';
        ctx.fillRect(-s/2+3, -s/2 + 4 + i*(s-8)/2.4, s-6, 1.5);
      }
      const up = tr.state === 'arming' ? 1 : 0.45;
      for (let ry = -1; ry <= 1; ry++) for (let rx = -1; rx <= 1; rx++) {
        const px = rx * s * 0.28, py = ry * s * 0.28;
        const hgt = s * 0.30 * up;
        ctx.fillStyle = '#20262e';
        ctx.beginPath(); ctx.moveTo(px-3.2, py+1); ctx.lineTo(px, py-hgt); ctx.lineTo(px+3.2, py+1); ctx.fill();
        ctx.fillStyle = tr.color;
        ctx.beginPath(); ctx.moveTo(px-2, py+1); ctx.lineTo(px-0.4, py-hgt+1); ctx.lineTo(px+0.8, py+1); ctx.fill();
      }
    } else if (tr.type === 'mine') {
      ctx.fillStyle = '#1b1b22';
      ctx.beginPath(); ctx.arc(0, 2, s*0.40, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#3a2226';
      ctx.beginPath(); ctx.arc(0, 0, s*0.40, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#5c2f34';
      ctx.beginPath(); ctx.arc(-s*0.10, -s*0.12, s*0.24, 0, Math.PI*2); ctx.fill();
      for (let a = 0; a < 8; a++) {               // trigger prongs
        const an = a * Math.PI / 4;
        ctx.save(); ctx.rotate(an);
        ctx.fillStyle = '#6b7078'; ctx.fillRect(s*0.36, -1.6, s*0.20, 3.2);
        ctx.fillStyle = tr.color;  ctx.fillRect(s*0.50, -2.2, 3, 4.4);
        ctx.restore();
      }
      const blink = (Math.sin(now/160) > 0) ? 1 : 0.25;
      ctx.globalAlpha = blink;
      ctx.fillStyle = tr.color;
      ctx.beginPath(); ctx.arc(0, 0, 3.2, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = blink * 0.4;
      ctx.beginPath(); ctx.arc(0, 0, 6.5, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (tr.type === 'snare') {
      // A net of rope pegged at the corners.
      ctx.strokeStyle = '#2b3d4a'; ctx.lineWidth = 3;
      ctx.strokeRect(-s/2, -s/2, s, s);
      ctx.strokeStyle = tr.color; ctx.lineWidth = 1;
      ctx.globalAlpha = 0.85;
      for (let i = 1; i < 5; i++) {
        const o = -s/2 + (s/5)*i;
        ctx.beginPath(); ctx.moveTo(o, -s/2); ctx.lineTo(o, s/2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-s/2, o); ctx.lineTo(s/2, o); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#8fa4b2';
      for (const [sx, sy] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
        ctx.fillRect(sx*s/2 - 2, sy*s/2 - 2, 4, 4);
      }
      ctx.fillStyle = tr.color;
      ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }
}

// Item symbols are drawn rather than typed: a device font may not carry »/◆/⚡,
// and shapes stay crisp at this size.
function drawItemGlyph(g, type, s, color) {
  const u = s / 2;
  g.fillStyle = color; g.strokeStyle = color;
  g.lineWidth = Math.max(1, s * 0.15);
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (type === 'speed') {                     // double chevron
    for (const off of [-u * 0.5, u * 0.25]) {
      g.beginPath();
      g.moveTo(off - u * 0.25, -u * 0.6);
      g.lineTo(off + u * 0.45, 0);
      g.lineTo(off - u * 0.25, u * 0.6);
      g.stroke();
    }
  } else if (type === 'strength') {            // flexed arm
    g.beginPath();
    g.moveTo(-u * 0.75, u * 0.55); g.lineTo(-u * 0.2, u * 0.55);
    g.lineTo(u * 0.25, -u * 0.1);  g.lineTo(u * 0.75, -u * 0.55);
    g.stroke();
    g.beginPath(); g.arc(u * 0.75, -u * 0.55, u * 0.26, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(-u * 0.75, u * 0.55, u * 0.24, 0, Math.PI * 2); g.fill();
  } else if (type === 'shield') {
    g.beginPath();
    g.moveTo(0, -u * 0.92);
    g.lineTo(u * 0.78, -u * 0.5);
    g.lineTo(u * 0.56, u * 0.42);
    g.lineTo(0, u * 0.95);
    g.lineTo(-u * 0.56, u * 0.42);
    g.lineTo(-u * 0.78, -u * 0.5);
    g.closePath(); g.fill();
  } else if (type === 'haste') {               // lightning bolt
    g.beginPath();
    g.moveTo(u * 0.32, -u * 0.95);
    g.lineTo(-u * 0.6, u * 0.12);
    g.lineTo(-u * 0.08, u * 0.12);
    g.lineTo(-u * 0.32, u * 0.95);
    g.lineTo(u * 0.62, -u * 0.18);
    g.lineTo(u * 0.08, -u * 0.18);
    g.closePath(); g.fill();
  } else if (type === 'heal') {                // cross
    const t = u * 0.3;
    g.fillRect(-t, -u * 0.88, t * 2, u * 1.76);
    g.fillRect(-u * 0.88, -t, u * 1.76, t * 2);
  } else {
    g.beginPath(); g.arc(0, 0, u * 0.5, 0, Math.PI * 2); g.fill();
  }
}

function drawItems(items) {
  const now = performance.now();
  for (const it of items) {
    const s = it.w;
    const cx = it.x + s / 2, cy = it.y + s / 2 + Math.sin(now/300 + it.x)*2;
    ctx.save();
    ctx.globalAlpha = 0.30; ctx.fillStyle = it.color;
    ctx.beginPath(); ctx.arc(cx, cy, s*0.8, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.translate(cx, cy);
    // Gem casing, then the symbol punched out of it in near-black.
    ctx.rotate(Math.PI/4);
    ctx.fillStyle = '#0d0d18'; ctx.fillRect(-s*0.42, -s*0.42, s*0.84, s*0.84);
    ctx.fillStyle = it.color;   ctx.fillRect(-s*0.36, -s*0.36, s*0.72, s*0.72);
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(-s*0.36, -s*0.36, s*0.72, s*0.18);
    ctx.rotate(-Math.PI/4);
    drawItemGlyph(ctx, it.type, s * 0.72, '#0a0a14');
    ctx.restore();
  }
}

function drawCoins(coins) {
  const now = performance.now();
  for (const c of coins) {
    const cx = c.x + c.w/2, cy = c.y + c.h/2;
    // Flatten and unflatten so they look like spinning discs.
    const spin = Math.abs(Math.cos(now/260 + c.x));
    ctx.save();
    if (c.fading && Math.sin(now/110) < -0.2) ctx.globalAlpha = 0.35;
    ctx.globalAlpha *= 0.9;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(cx, cy + c.h*0.45, c.w*0.4, 1.6, 0, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = c.fading && Math.sin(now/110) < -0.2 ? 0.4 : 1;
    ctx.fillStyle = '#8a5f10';
    ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(1, c.w*0.44*spin), c.h*0.44, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = PAL.coin;
    ctx.beginPath(); ctx.ellipse(cx, cy - 0.6, Math.max(0.8, c.w*0.36*spin), c.h*0.36, 0, 0, Math.PI*2); ctx.fill();
    if (spin > 0.55) {
      ctx.fillStyle = '#fff3b0';
      ctx.fillRect(Math.round(cx - 1), Math.round(cy - 2), 1, 3);
    }
    ctx.restore();
  }
}

// ── Inventory (drawn inside the HUD so it always fits, whatever the screen) ──
const ITEM_COLOR = { speed:'#44ddee', strength:'#ff5544', shield:'#ffdd44', haste:'#aa66ff', heal:'#44ff66' };
const INV_SLOT = 20, INV_GAP = 3, INV_X = 4, INV_Y = 44;
let itemSlotRects = [];   // HUD-space hit boxes for tap-to-use

function drawItemBar(inv) {
  itemSlotRects = [];
  if (!inv || !inv.length) return;
  const onRight = myNum === 2;
  const x = onRight ? HUD_W - INV_X - INV_SLOT : INV_X;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x - 2, INV_Y - 2, INV_SLOT + 4, inv.length * (INV_SLOT + INV_GAP) - INV_GAP + 4);
  inv.forEach((type, i) => {
    const y = INV_Y + i * (INV_SLOT + INV_GAP);
    const col = ITEM_COLOR[type] || '#888';
    itemSlotRects.push({ x, y, w: INV_SLOT, h: INV_SLOT, index: i });
    ctx.fillStyle = 'rgba(8,8,18,0.9)';
    ctx.fillRect(x, y, INV_SLOT, INV_SLOT);
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, INV_SLOT - 1, INV_SLOT - 1);
    ctx.save();
    ctx.translate(x + INV_SLOT/2, y + INV_SLOT/2 - 1);
    drawItemGlyph(ctx, type, INV_SLOT * 0.62, col);
    ctx.restore();
    ctx.font = '7px "Courier New",monospace';
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#8a8aa0';
    ctx.fillText(String(i + 1), x + INV_SLOT - 1.5, y + INV_SLOT - 0.5);
  });
  ctx.restore();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

function useItem(idx) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'use_item', index: idx }));
}

// ─── Chains (grapple / hook) ──────────────────────────────────────────────────

function drawChains(chains) {
  for (const ch of chains) {
    const dx = ch.x2 - ch.x1, dy = ch.y2 - ch.y1;
    const len = Math.hypot(dx, dy);
    if (len < 2) continue;
    const ang = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(ch.x1, ch.y1);
    ctx.rotate(ang);
    if (ch.kind === 'hook') {
      // The teleport hook trails a taut energy line rather than iron links.
      ctx.globalAlpha = 0.35; ctx.strokeStyle = WEAPON_COLOR.grapple; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(len,0); ctx.stroke();
      ctx.globalAlpha = 0.95; ctx.strokeStyle = '#eafcff'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(len,0); ctx.stroke();
    } else {
      // Interlocking links: alternating upright / flat ovals, like a real chain.
      const step = 5;
      const n = Math.max(1, Math.floor(len / step));
      ctx.lineWidth = 1.3;
      for (let i = 0; i < n; i++) {
        const x = (i + 0.5) * (len / n);
        const flat = i % 2 === 0;
        ctx.strokeStyle = flat ? '#8d97a6' : '#5d6674';
        ctx.beginPath();
        ctx.ellipse(x, 0, flat ? 2.6 : 1.5, flat ? 1.3 : 2.4, 0, 0, Math.PI*2);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(0,-0.8); ctx.lineTo(len,-0.8); ctx.stroke();
    }
    ctx.restore();
  }
}

// ─── Players ──────────────────────────────────────────────────────────────────

const EFFECT_GLOW = { speed:'#44ddee', strength:'#ff5544', shield:'#ffdd44', haste:'#aa66ff', slow:'#3366aa' };

function drawPlayer(p, baseColor, label) {
  if (p.dead) return;
  const skinCol = getSkinColor(p, baseColor);
  const c = p.hitFlash > 0 ? PAL.white : skinCol;
  const x = Math.round(p.x), y = Math.round(p.y);
  // Active-effect aura
  if (p.effects) {
    const active = Object.keys(p.effects).filter(k => p.effects[k] > 0);
    if (active.length) {
      const t = performance.now() / 200;
      const glow = EFFECT_GLOW[active[0]] || '#ffffff';
      ctx.save();
      ctx.globalAlpha = 0.25 + Math.sin(t)*0.1;
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(x + p.w/2, y + p.h/2, p.w, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x+1,y+p.h,p.w-2,2);
  ctx.fillStyle = c; ctx.fillRect(x+1,y+11,4,5); ctx.fillRect(x+7,y+11,4,5);
  ctx.fillRect(x,y+5,p.w,7);
  ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.fillRect(x,y+5,p.w,2);
  ctx.fillStyle=c; ctx.fillRect(x+1,y,p.w-2,5);
  ctx.fillStyle=PAL.white; ctx.fillRect(p.facing===1?x+8:x+2,y+1,2,2);
  drawHatOn(ctx, x, y, skinCol, p.skin?.hatIdx);
  drawNametag(x+p.w/2, y-9, label, skinCol);
  drawWeaponSprite(p, x, y);
  if (p.parryActive) {
    const t = performance.now() / 60;
    ctx.save();
    ctx.strokeStyle = '#66ccff';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.arc(x + p.w/2, y + p.h/2, p.w + 3, 0, Math.PI*2); ctx.stroke();
    ctx.strokeStyle = '#cceeff';
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(x + p.w/2, y + p.h/2, p.w + 1 + Math.sin(t)*1.5, 0, Math.PI*2); ctx.stroke();
    ctx.restore();
  }
}

function drawNametag(cx, bottomY, label, color) {
  ctx.save();
  ctx.font = '9px "Courier New",monospace';
  ctx.textBaseline = 'bottom'; ctx.textAlign = 'center';
  const rx = Math.round(cx);
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(rx - tw/2 - 2, bottomY - 10, tw + 4, 11);
  ctx.fillStyle = 'rgba(0,0,0,0.9)'; ctx.fillText(label, rx+1, bottomY+1);
  ctx.fillStyle = color;
  ctx.fillText(label, rx, bottomY);
  ctx.restore();
}

// ─── Weapon Sprite (held) ─────────────────────────────────────────────────────

function drawWeaponSprite(p, px, py) {
  const wId = p.weaponId;
  if (!WEAPON_ART[wId]) return;
  const wc = WEAPON_COLOR[wId] || PAL.white;
  const d = p.facing;
  const hx = d === 1 ? px + p.w - 1 : px + 1;   // hand attachment
  const hy = py + 8;
  const prog = p.swingTimer > 0 ? 1 - Math.min(1, p.swingTimer / 200) : -1;

  ctx.save();
  ctx.translate(hx, hy);
  ctx.scale(d, 1);   // art is authored pointing +X; mirroring handles facing
  if (prog >= 0) {
    if (isRanged(wId)) {
      ctx.translate(-Math.sin(prog * Math.PI) * 3, 0);           // recoil kick
      ctx.rotate(-Math.sin(prog * Math.PI) * 0.16);
    } else {
      ctx.rotate(-0.95 + prog * 1.55);                            // overhead chop
    }
  } else {
    ctx.rotate(0.12);  // resting tilt
  }
  drawWeaponArt(ctx, wId, 1, wc, true);
  ctx.restore();
}

// ─── Monsters ─────────────────────────────────────────────────────────────────

function drawMonster(m) {
  const c = m.hitFlash > 0 ? PAL.white : (m.slowed ? '#39a7b0' : PAL.monster);
  const x = Math.round(m.x), y = Math.round(m.y);
  const head = Math.max(5, Math.round(m.h * 0.32));
  const eye = Math.max(2, Math.round(m.w * 0.18));
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x+1, y+m.h, m.w-2, 2);
  ctx.fillStyle=c;
  ctx.fillRect(x+1,y+head-1,m.w-2,m.h-head+1); ctx.fillRect(x,y,m.w,head);
  ctx.fillRect(x-1,y+1,2,3); ctx.fillRect(x+m.w-1,y+1,2,3);
  ctx.fillStyle='rgba(0,0,0,0.22)'; ctx.fillRect(x+1,y+head-1,m.w-2,2);
  // Eyes scale + space out with monster size
  ctx.fillStyle='#ff2222';
  ctx.fillRect(x+Math.round(m.w*0.2),y+2,eye,eye);
  ctx.fillRect(x+Math.round(m.w*0.6),y+2,eye,eye);
  drawHpBar(x-1,y-5,m.w+2,2,m.hp/m.maxHp,'#44ff44','#003300');
}
function drawMonsters(ms) { for(const m of ms) drawMonster(m); }

// ─── Projectiles ──────────────────────────────────────────────────────────────

function drawProjectiles(projs) {
  const now = performance.now();
  for (const pr of projs) {
    const wc = WEAPON_COLOR[pr.weaponId] || PAL.white;
    const ang = Math.atan2(pr.dy, pr.dx);

    if (pr.hook) {
      ctx.save();
      ctx.translate(pr.x, pr.y); ctx.rotate(ang);
      ctx.globalAlpha = 0.45; ctx.fillStyle = wc;
      ctx.beginPath(); ctx.ellipse(-6, 0, 10, 3, 0, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#eafcff';
      ctx.beginPath(); ctx.moveTo(6,0); ctx.lineTo(-2,-3.2); ctx.lineTo(-2,3.2); ctx.fill();
      ctx.restore();
      continue;
    }
    if (pr.grapple) {
      ctx.save();
      ctx.translate(pr.x, pr.y); ctx.rotate(ang);
      ctx.fillStyle = '#6d7784'; ctx.fillRect(-4, -1.6, 6, 3.2);
      ctx.fillStyle = wc;
      ctx.beginPath(); ctx.moveTo(2,-1.4); ctx.lineTo(6,-5); ctx.lineTo(4.5,-1); ctx.fill();
      ctx.beginPath(); ctx.moveTo(2, 1.4); ctx.lineTo(6, 5); ctx.lineTo(4.5, 1); ctx.fill();
      ctx.fillStyle = '#eef4fb';
      ctx.beginPath(); ctx.moveTo(2,-0.9); ctx.lineTo(7,0); ctx.lineTo(2,0.9); ctx.fill();
      ctx.restore();
      continue;
    }
    if (pr.boomerang) {
      ctx.save();
      ctx.translate(pr.x, pr.y); ctx.rotate(now/55);
      ctx.globalAlpha = 0.3; ctx.strokeStyle = wc; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0,0,6,0,Math.PI*2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#6b4326';
      ctx.beginPath(); ctx.moveTo(-1,-1); ctx.lineTo(6,-6); ctx.lineTo(7.5,-4); ctx.lineTo(1,0.8); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-1,1); ctx.lineTo(6,6); ctx.lineTo(7.5,4); ctx.lineTo(1,-0.8); ctx.fill();
      ctx.fillStyle = wc;
      ctx.beginPath(); ctx.moveTo(-1,-1); ctx.lineTo(6,-6); ctx.lineTo(6.8,-5); ctx.lineTo(0,-0.3); ctx.fill();
      ctx.restore();
      continue;
    }
    if (pr.special) {
      ctx.save();
      ctx.globalAlpha = 0.4; ctx.fillStyle = wc;
      ctx.beginPath(); ctx.arc(pr.x, pr.y, 7, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 0.5; ctx.strokeStyle = wc; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(pr.x, pr.y); ctx.lineTo(pr.x - pr.dx*3, pr.y - pr.dy*3); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillStyle = wc;
      ctx.beginPath(); ctx.arc(pr.x, pr.y, 3.5, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(pr.x-1, pr.y-1, 1.3, 0, Math.PI*2); ctx.fill();
      ctx.restore();
      continue;
    }

    if (pr.weaponId === 'bow' || pr.weaponId === 'crossbow') {
      const long = pr.weaponId === 'crossbow';
      ctx.save();
      ctx.translate(pr.x, pr.y); ctx.rotate(ang);
      ctx.fillStyle = long ? '#7a4a20' : '#8a6a3a';
      ctx.fillRect(-(long?11:9), -0.6, long?11:9, 1.3);
      ctx.fillStyle = long ? '#cfd8e2' : '#aaddff';
      ctx.beginPath(); ctx.moveTo(4,0); ctx.lineTo(-1,-1.9); ctx.lineTo(-1,1.9); ctx.fill();
      ctx.fillStyle = '#dfe6ee';
      ctx.beginPath(); ctx.moveTo(-(long?11:9),-2.1); ctx.lineTo(-(long?7:6),-0.4); ctx.lineTo(-(long?11:9),0); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-(long?11:9), 2.1); ctx.lineTo(-(long?7:6), 0.4); ctx.lineTo(-(long?11:9),0); ctx.fill();
      ctx.restore();
    } else if (pr.weaponId === 'staff') {
      ctx.save();
      ctx.globalAlpha = 0.45; ctx.fillStyle = wc;
      ctx.beginPath(); ctx.arc(pr.x,pr.y,7,0,Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = wc;
      ctx.beginPath(); ctx.arc(pr.x,pr.y,3.6,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#ffe6ff';
      ctx.beginPath(); ctx.arc(pr.x-1,pr.y-1,1.5,0,Math.PI*2); ctx.fill();
      ctx.restore();
    } else if (pr.weaponId === 'wand') {
      ctx.save();
      ctx.globalAlpha = 0.45; ctx.fillStyle = wc;
      ctx.beginPath(); ctx.arc(pr.x,pr.y,4.5,0,Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = '#eaf9ff';
      ctx.beginPath(); ctx.arc(pr.x,pr.y,2,0,Math.PI*2); ctx.fill();
      ctx.restore();
    } else if (pr.weaponId === 'chakram') {
      ctx.save();
      ctx.translate(pr.x, pr.y); ctx.rotate(now/40);
      ctx.strokeStyle = wc; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0,0,4.5,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle = '#ffffff';
      for (let i=0;i<4;i++){ const a=i*Math.PI/2; ctx.fillRect(Math.round(Math.cos(a)*5)-1, Math.round(Math.sin(a)*5)-1, 2, 2); }
      ctx.restore();
    } else if (pr.weaponId === 'cannon') {
      ctx.save();
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#ffb066';
      ctx.beginPath(); ctx.arc(pr.x - pr.dx, pr.y - pr.dy, 6, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = '#25252c';
      ctx.beginPath(); ctx.arc(pr.x,pr.y,4,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#5a5a66';
      ctx.beginPath(); ctx.arc(pr.x-1,pr.y-1.2,1.6,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#ff9944';
      ctx.fillRect(Math.round(pr.x)-1, Math.round(pr.y)-5, 2, 2);
      ctx.restore();
    } else {
      ctx.fillStyle = wc;
      ctx.beginPath(); ctx.arc(pr.x, pr.y, 3, 0, Math.PI*2); ctx.fill();
    }
  }
}

// ─── Particles ────────────────────────────────────────────────────────────────

function drawParticles(particles) {
  for (const p of particles) {
    if (p.type==='xp') {
      const alpha=Math.max(0,p.timer/900), rise=(1-p.timer/900)*14;
      ctx.globalAlpha=alpha; ctx.fillStyle=PAL.xp;
      pixelText(p.text,Math.round(p.x),Math.round(p.y-rise));
      ctx.globalAlpha=1;
    } else if (p.type==='coin') {
      const m=p.max||700, a=Math.max(0,p.timer/m), rise=(1-a)*16;
      const yy = Math.round(p.y - rise);
      ctx.globalAlpha=a;
      drawCoinIcon(Math.round(p.x) + 3, yy + 5, 3);
      ctx.fillStyle=PAL.coin;
      pixelText((p.text||'').replace('+',''), Math.round(p.x) + 8, yy);
      ctx.globalAlpha=1;
    } else if (p.type==='aoe') {
      const m=p.max||320, k=1-p.timer/m, r=(p.maxR||30)*Math.min(1,k*1.4);
      ctx.globalAlpha=Math.max(0,p.timer/m);
      ctx.fillStyle=p.color||'#aa44ff'; ctx.globalAlpha*=0.35;
      ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.fill();
      ctx.globalAlpha=Math.max(0,p.timer/m);
      ctx.strokeStyle=p.color||'#aa44ff'; ctx.lineWidth=2.5;
      ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.stroke();
      ctx.globalAlpha=1;
    } else if (p.type==='waveclear') {
      ctx.globalAlpha=Math.min(1,p.timer/2500*3);
      ctx.fillStyle=PAL.xp; ctx.font='bold 18px "Courier New",monospace';
      ctx.textBaseline='middle'; ctx.textAlign='center';
      ctx.fillStyle='#000'; ctx.fillText(p.text,p.x+2,p.y+2);
      ctx.fillStyle=PAL.xp; ctx.fillText(p.text,p.x,p.y);
      ctx.textAlign='left'; ctx.textBaseline='alphabetic'; ctx.globalAlpha=1;
    } else if (p.type==='shockwave') {
      const m=p.max||420, k=1-p.timer/m, r=(p.maxR||30)*k;
      ctx.globalAlpha=Math.max(0,p.timer/m)*0.9;
      ctx.strokeStyle=p.color||PAL.white; ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.stroke();
      ctx.strokeStyle='#ffffff'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.arc(p.x,p.y,Math.max(0,r-4),0,Math.PI*2); ctx.stroke();
      ctx.globalAlpha=1;
    } else if (p.type==='parry') {
      const m=p.max||320, a=Math.max(0,p.timer/m), k=1-a;
      ctx.save();
      ctx.translate(p.x,p.y); ctx.rotate(k*0.8);
      ctx.globalAlpha=a; ctx.strokeStyle='#aee4ff'; ctx.lineWidth=2;
      const spikes=6, rr=4+k*12;
      for(let i=0;i<spikes;i++){
        const ang=(Math.PI*2/spikes)*i;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang)*2,Math.sin(ang)*2);
        ctx.lineTo(Math.cos(ang)*rr,Math.sin(ang)*rr);
        ctx.stroke();
      }
      ctx.fillStyle='#ffffff';
      ctx.beginPath(); ctx.arc(0,0,2,0,Math.PI*2); ctx.fill();
      ctx.restore(); ctx.globalAlpha=1;
    } else if (p.type==='trapburst') {
      const m=p.max||340, k=1-p.timer/m, r=(p.maxR||20)*Math.min(1,k*1.3);
      ctx.globalAlpha=Math.max(0,p.timer/m)*0.8;
      ctx.fillStyle=p.color||'#ff8822';
      ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.fill();
      ctx.globalAlpha=Math.max(0,p.timer/m); ctx.strokeStyle='#ffffff'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.stroke();
      ctx.globalAlpha=1;
    } else if (p.type==='teleport') {
      const m=p.max||340, a=Math.max(0,p.timer/m), k=1-a;
      ctx.save();
      ctx.globalAlpha=a; ctx.strokeStyle=p.color||'#88ffcc'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(p.x,p.y,4+k*18,0,Math.PI*2); ctx.stroke();
      ctx.globalAlpha=a*0.6;
      for(let i=0;i<6;i++){
        const ang=i*Math.PI/3+k*2;
        ctx.beginPath();
        ctx.moveTo(p.x+Math.cos(ang)*(3+k*10), p.y+Math.sin(ang)*(3+k*10));
        ctx.lineTo(p.x+Math.cos(ang)*(7+k*16), p.y+Math.sin(ang)*(7+k*16));
        ctx.stroke();
      }
      ctx.restore(); ctx.globalAlpha=1;
    } else if (p.type==='hookhit') {
      const m=p.max||300, a=Math.max(0,p.timer/m), k=1-a;
      ctx.save();
      ctx.globalAlpha=a; ctx.strokeStyle=p.color||'#9fb6c8'; ctx.lineWidth=1.6;
      for(let i=0;i<4;i++){
        const ang=i*Math.PI/2+0.4;
        ctx.beginPath();
        ctx.moveTo(p.x+Math.cos(ang)*(2+k*6), p.y+Math.sin(ang)*(2+k*6));
        ctx.lineTo(p.x+Math.cos(ang)*(6+k*10), p.y+Math.sin(ang)*(6+k*10));
        ctx.stroke();
      }
      ctx.restore(); ctx.globalAlpha=1;
    } else if (p.type==='pickup' || p.type==='useitem') {
      const m=p.max||600, a=Math.max(0,p.timer/m), rise=(1-a)*16;
      ctx.globalAlpha=a; ctx.fillStyle=p.color||'#44ff66';
      const yy=Math.round(p.y-rise);
      ctx.beginPath(); ctx.arc(Math.round(p.x),yy,3.5,0,Math.PI*2); ctx.fill();
      ctx.globalAlpha=a*0.5;
      ctx.beginPath(); ctx.arc(Math.round(p.x),yy,7,0,Math.PI*2); ctx.fill();
      ctx.globalAlpha=1;
    }
  }
}

// ─── HUD (drawn in 480×270 space) ─────────────────────────────────────────────

function drawHUD(state) {
  const p1 = state.players.p1, p2 = state.players.p2;
  const names = state.playerNames || {};

  ctx.fillStyle = 'rgba(0,0,0,0.70)';
  ctx.fillRect(0, 0, HUD_W, 26);

  ctx.font = '10px "Courier New",monospace';
  ctx.textBaseline = 'top';

  if (p1) {
    const col = getSkinColor(p1, PAL.p1);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#000'; ctx.fillText(names.p1 || 'P1', 5, 3);
    ctx.fillStyle = col;    ctx.fillText(names.p1 || 'P1', 4, 2);
    drawHpBar(4, 15, 74, 5, p1.hp / p1.maxHp, col, '#330000');
    for (let i = 0; i < (p1.lives || 0); i++) { ctx.fillStyle = col; ctx.fillRect(4 + i*7, 21, 5, 3); }
  }

  if (p2) {
    const col = getSkinColor(p2, PAL.p2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#000'; ctx.fillText(names.p2 || 'P2', HUD_W - 3, 3);
    ctx.fillStyle = col;    ctx.fillText(names.p2 || 'P2', HUD_W - 4, 2);
    ctx.textAlign = 'left';
    drawHpBar(HUD_W - 80, 15, 74, 5, p2.hp / p2.maxHp, col, '#330000');
    for (let i = 0; i < (p2.lives || 0); i++) { ctx.fillStyle = col; ctx.fillRect(HUD_W - 9 - i*7, 21, 5, 3); }
  }

  const w = state.wave;
  ctx.textAlign = 'center';
  if (w && state.gameMode !== 'pvp') {
    ctx.fillStyle = '#000'; ctx.fillText('WAVE ' + w.num, HUD_W/2 + 1, 3);
    ctx.fillStyle = PAL.text; ctx.fillText('WAVE ' + w.num, HUD_W/2, 2);
    ctx.font = '8px "Courier New",monospace';
    ctx.fillStyle = '#999'; ctx.fillText(Math.max(0, w.monstersLeft) + ' LEFT', HUD_W/2, 15);
    ctx.font = '10px "Courier New",monospace';
  }
  ctx.textAlign = 'left';

  // ── Ability cooldown bars (local player): special + parry ──
  const mp = myNum === 1 ? p1 : (myNum === 2 ? p2 : null);
  if (mp) {
    const barW = 60, barH = 4;
    const bx = myNum === 1 ? 4 : HUD_W - 4 - barW;
    const lx = myNum === 1 ? bx + barW + 3 : bx - 3;
    const align = myNum === 1 ? 'left' : 'right';
    ctx.textBaseline = 'top';
    ctx.textAlign = align;

    const drawBar = (by, ratio, ready, label, colReady, colCool, fillBg) => {
      ctx.fillStyle = fillBg; ctx.fillRect(bx, by, barW, barH);
      ctx.fillStyle = ready ? colReady : colCool;
      ctx.fillRect(bx, by, Math.round(barW * ratio), barH);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(bx, by, barW, barH);
      ctx.font = '7px "Courier New",monospace';
      ctx.fillStyle = '#000'; ctx.fillText(label, lx + 1, by);
      ctx.fillStyle = ready ? colReady : '#778'; ctx.fillText(label, lx, by - 1);
    };

    if (mp.specialMax > 0) {
      const ready = (mp.specialCd || 0) <= 0;
      drawBar(28, ready ? 1 : Math.max(0, 1 - mp.specialCd / mp.specialMax), ready,
              ready ? 'SPECIAL' : 'SP', '#dd88ff', '#6a3a99', '#1a0a2a');
    }
    if (mp.parryMax > 0) {
      const ready = (mp.parryCd || 0) <= 0;
      drawBar(35, ready ? 1 : Math.max(0, 1 - mp.parryCd / mp.parryMax), ready,
              ready ? 'PARRY' : 'PAR', '#66ccff', '#2a5a7a', '#0a1a2a');
    }
    ctx.textAlign = 'left';
    ctx.font = '10px "Courier New",monospace';
  }

  ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#000'; ctx.fillText('XP:' + state.xp, 5, HUD_H - 15);
  ctx.fillStyle = PAL.xp; ctx.fillText('XP:' + state.xp, 4, HUD_H - 16);
  // A drawn coin rather than a glyph — Courier has no dependable coin character.
  drawCoinIcon(8, HUD_H - 8, 3.5);
  const cn = String(state.myCoins || 0);
  ctx.fillStyle = '#000';      ctx.fillText(cn, 15, HUD_H - 3);
  ctx.fillStyle = PAL.coin;    ctx.fillText(cn, 14, HUD_H - 4);
}

function drawCoinIcon(x, y, r) {
  ctx.fillStyle = '#8a5f10';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = PAL.coin;
  ctx.beginPath(); ctx.arc(x, y - 0.4, r - 0.9, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#fff3b0';
  ctx.fillRect(x - 0.5, y - r + 1.2, 1, r * 0.9);
}

// ─── Weapon Panel ─────────────────────────────────────────────────────────────

let weaponSlotRects = []; // HUD-space hit boxes for tap-to-select

function drawWeaponPanel(state) {
  weaponSlotRects = [];
  if (!myNum) return;
  const mp = myNum===1 ? state.players?.p1 : state.players?.p2;
  if (!mp || !mp.unlockedWeapons || !mp.unlockedWeapons.length) return;
  const weapons = mp.unlockedWeapons;
  const n = weapons.length;

  // The panel has to hold every unlocked weapon on any screen, so the slots
  // shrink to fit and wrap to a second row only if they'd get unusably small.
  const avail = HUD_W - 20, gap = 2, slotH = 22;
  let rows = 1;
  let slotW = Math.min(26, Math.floor((avail + gap) / n) - gap);
  if (slotW < 17) {
    rows = 2;
    const perRow = Math.ceil(n / rows);
    slotW = Math.max(12, Math.min(26, Math.floor((avail + gap) / perRow) - gap));
  }
  const perRow = Math.ceil(n / rows);
  const rowW = (cnt) => cnt * (slotW + gap) - gap;
  const panelW = rowW(Math.min(n, perRow));
  const panelH = rows * slotH + (rows - 1) * gap;
  const panelX = Math.round((HUD_W - panelW) / 2);
  const panelY = HUD_H - panelH - 4;

  ctx.fillStyle='rgba(0,0,0,0.72)';
  ctx.fillRect(panelX-4, panelY-3, panelW+8, panelH+6);

  if (!isTouchDevice) drawControlHints(panelX, panelY, panelW);

  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / perRow), col = i % perRow;
    const cnt = Math.min(perRow, n - row * perRow);
    const rx = Math.round((HUD_W - rowW(cnt)) / 2);
    const sx = rx + col * (slotW + gap);
    const sy = panelY + row * (slotH + gap);
    const wId = weapons[i], sel = i === mp.weaponIdx;
    weaponSlotRects.push({ x: sx, y: sy, w: slotW, h: slotH, index: i });
    const wc = WEAPON_COLOR[wId] || PAL.white;
    ctx.fillStyle = sel ? 'rgba(255,255,255,0.1)' : 'rgba(5,5,15,0.8)';
    ctx.fillRect(sx, sy, slotW, slotH);
    ctx.strokeStyle = sel ? wc : '#2a2a3a'; ctx.lineWidth = 1;
    ctx.strokeRect(sx+0.5, sy+0.5, slotW-1, slotH-1);
    if (sel) {
      ctx.save(); ctx.globalAlpha=0.35; ctx.strokeStyle=wc; ctx.lineWidth=1;
      ctx.strokeRect(sx-0.5, sy-0.5, slotW+1, slotH+1); ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = sel ? 1 : 0.42;   // unselected slots dim, but still readable
    drawWeaponFitted(ctx, wId, sx + slotW/2, sy + 8.5, slotW - 4, 13, wc, false);
    ctx.restore();
    ctx.save();
    ctx.font='7px "Courier New",monospace'; ctx.textBaseline='bottom'; ctx.textAlign='center';
    ctx.fillStyle = sel ? wc : '#4c4c5a';
    const label = wId.slice(0, slotW >= 22 ? 4 : 3).toUpperCase();
    ctx.fillText(label, sx + slotW/2, sy + slotH - 1);
    ctx.restore();
  }
}

function drawControlHints(panelX, panelY, panelW) {
  ctx.save();
  ctx.font = '8px "Courier New",monospace';
  const hx = panelX + panelW + 10;
  if (hx + 62 <= HUD_W) {
    // Room beside the panel: the full stacked legend.
    ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    [['ARROWS MOVE', '#505060'], ['SPACE  ATK', '#505060'], ['ENTER  SWAP', '#505060'],
     ['SHIFT  SPECIAL', '#8866aa'], ['P      PARRY', '#3399cc'], ['1-4    ITEMS', '#505060']]
      .forEach(([t, c], i) => { ctx.fillStyle = c; ctx.fillText(t, hx, panelY - 9 + i * 9); });
  } else {
    // A full weapon rack leaves no side room — one compact line above it.
    ctx.textBaseline = 'bottom'; ctx.textAlign = 'center';
    const t = 'ARROWS MOVE · SPACE ATK · ENTER SWAP · SHIFT SPECIAL · P PARRY · 1-4 ITEMS';
    const w = ctx.measureText(t).width;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(HUD_W/2 - w/2 - 3, panelY - 14, w + 6, 11);
    ctx.fillStyle = '#6a6a80';
    ctx.fillText(t, HUD_W/2, panelY - 5);
  }
  ctx.restore();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function drawHpBar(x,y,w,h,ratio,fg,bg) {
  ctx.fillStyle=bg; ctx.fillRect(x,y,w,h);
  ctx.fillStyle=fg; ctx.fillRect(x,y,Math.round(w*Math.max(0,Math.min(1,ratio))),h);
  ctx.strokeStyle='#000'; ctx.lineWidth=1; ctx.strokeRect(x,y,w,h);
}

function pixelText(text, x, y) {
  const saved = ctx.fillStyle;
  ctx.font = '11px "Courier New",monospace'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillText(text, x+1, y+1);
  ctx.fillStyle = saved; ctx.fillText(text, x, y);
}

// ─── Unlock Preview ───────────────────────────────────────────────────────────

function drawUnlockPreview(ux, weaponId) {
  const W = 120, H = 80;
  const wc = WEAPON_COLOR[weaponId] || '#ffffff';
  ux.clearRect(0,0,W,H);
  ux.fillStyle='#14141f'; ux.fillRect(0,0,W,H);
  ux.save();
  ux.globalAlpha = 0.12; ux.fillStyle = wc;
  ux.beginPath(); ux.arc(W/2, H/2, 34, 0, Math.PI*2); ux.fill();
  ux.restore();
  ux.strokeStyle=wc; ux.lineWidth=1; ux.strokeRect(2.5,2.5,W-5,H-5);
  drawWeaponFitted(ux, weaponId, W/2, H/2, W-22, H-22, wc, true);
}
