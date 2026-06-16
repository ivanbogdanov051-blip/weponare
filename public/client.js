'use strict';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const CANVAS_W = 480, CANVAS_H = 270;
const ARENA_X = 8, ARENA_Y = 8;
const ARENA_W = CANVAS_W - 16, ARENA_H = CANVAS_H - 16;

const PAL = {
  bg:'#0a0a14', arena:'#1a1a2e', wall:'#2a2a4a',
  p1:'#4488ff', p2:'#ff6644', monster:'#44cc44',
  xp:'#ffcc00', hp:'#ff3333', hpBg:'#330000',
  text:'#e8e8e8', white:'#ffffff',
  sword:'#c8d8e8', dagger:'#d4e8b0', axe:'#e8a040',
  spear:'#c0c8d0', bow:'#b89060', staff:'#cc66ff',
  hammer:'#aab0b8', wand:'#88ddff', crossbow:'#cc8844',
  flail:'#dd4444', greatsword:'#ddeeff',
  glaive:'#b0d8c0', katana:'#eef0ff', chakram:'#66e0c0', cannon:'#9a90a8', reaper:'#cc66aa',
  handle:'#6b3a1f', guard:'#8899aa',
};

const WEAPON_COLOR = {
  sword:PAL.sword, dagger:PAL.dagger, axe:PAL.axe, spear:PAL.spear,
  bow:PAL.bow, staff:PAL.staff, hammer:PAL.hammer, wand:PAL.wand,
  crossbow:PAL.crossbow, flail:PAL.flail, greatsword:PAL.greatsword,
  glaive:PAL.glaive, katana:PAL.katana, chakram:PAL.chakram, cannon:PAL.cannon, reaper:PAL.reaper,
};
const WEAPON_DESC = {
  sword:'Balanced blade', dagger:'Fast, low damage', axe:'Slow, heavy hit',
  spear:'Long reach', bow:'Fires arrows', staff:'AoE magic burst',
  hammer:'Crushes with force', wand:'Rapid magic bolts', crossbow:'Piercing shot',
  flail:'360° chain strike', greatsword:'Massive two-hander',
  glaive:'Sweeping polearm', katana:'Lightning-fast cuts', chakram:'Piercing ring',
  cannon:'Explosive shells', reaper:'Reaping 360° scythe',
};
// Mirror of server WEAPONS atkSpd — used for client-side attack prediction.
const WEAPON_ATKSPD = {
  sword:400, dagger:180, axe:700, spear:500, bow:600, staff:900, hammer:1000, wand:250,
  crossbow:800, flail:500, greatsword:850, glaive:820, katana:240, chakram:360, cannon:1200, reaper:920,
};

// ─── Skins ────────────────────────────────────────────────────────────────────

const SKIN_COLORS = ['#4488ff','#ff4444','#44cc44','#aa44ff','#ff8833','#44ddee','#ff44aa','#ffcc00'];
const SKIN_HATS   = ['NONE','CAP','CROWN','HORNS','SPIKY'];

function loadLocalSkin() {
  try { return JSON.parse(localStorage.getItem('weponare_skin')) || { colorIdx: 0, hatIdx: 0 }; }
  catch { return { colorIdx: 0, hatIdx: 0 }; }
}
function saveLocalSkin(s) {
  try { localStorage.setItem('weponare_skin', JSON.stringify(s)); } catch {}
}
function loadLocalXp(password) {
  if (!password) return 0;
  try { return parseInt(localStorage.getItem('weponare_xp_' + password)) || 0; }
  catch { return 0; }
}
function saveLocalXp(password, xp) {
  if (!password) return;
  try { localStorage.setItem('weponare_xp_' + password, String(xp)); } catch {}
}
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

function joinGame(mode) {
  if (window.GameAudio) { GameAudio.init(); GameAudio.resume(); }
  const raw  = document.getElementById('nameInput').value.trim().toUpperCase();
  const pass = document.getElementById('passInput').value.trim();
  pendingName = raw  || 'PLAYER';
  pendingPass = pass || '';
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

let leaving = false;
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
  if (!show) updateInventoryBar([]);
}

function connect() {
  roomWasFull = false;
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
      ws.send(JSON.stringify({ type: 'join', name: pendingName, mode: pendingMode, password: pendingPass, skin: pendingSkin, skinModified, localXp: loadLocalXp(pendingPass) }));
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
    if (msg.type === 'state') {
      if (pendingPass && msg.xp !== undefined) saveLocalXp(pendingPass, msg.xp);
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
        document.getElementById('disconnectedScreen').className = 'overlay hidden';
        document.getElementById('startScreen').className = 'overlay active';
      }, 3000);
    }
  };
  ws.onerror = () => ws.close();
}

// ─── Interpolation ────────────────────────────────────────────────────────────

function lerp(a, b, t) { return a + (b - a) * t; }

function interpState(prev, curr, t) {
  if (!prev || t >= 1) return curr;
  const ip = (a, b) => (!a || !b || b.dead) ? b : { ...b, x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
  return {
    ...curr,
    players: {
      p1: ip(prev.players?.p1, curr.players?.p1),
      p2: ip(prev.players?.p2, curr.players?.p2),
    },
    monsters: curr.monsters.map((m, i) => {
      const pm = prev.monsters?.[i];
      return pm ? { ...m, x: lerp(pm.x, m.x, t), y: lerp(pm.y, m.y, t) } : m;
    }),
    projectiles: curr.projectiles.map((p, i) => {
      const pp = prev.projectiles?.[i];
      return pp ? { ...p, x: lerp(pp.x, p.x, t), y: lerp(pp.y, p.y, t) } : p;
    }),
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
  if (gap > 36) {            // knockback / respawn / teleport → snap
    pred.x = me.x; pred.y = me.y;
  } else if (!moving) {
    pred.x += dx * 0.30; pred.y += dy * 0.30;
  } else {
    pred.x += dx * 0.05; pred.y += dy * 0.05;
  }

  // Mirror server speed modifiers so prediction matches authoritative movement.
  let spd = PLAYER_SPEED;
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
  for (const [k, ep] of Object.entries(state.players || {})) {
    if (k !== playerKey && ep && !ep.dead) {
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

function detectSlashes(prev, curr) {
  const myKey = myNum === 1 ? 'p1' : (myNum === 2 ? 'p2' : null);
  for (const key of ['p1', 'p2']) {
    const cp = curr.players?.[key], pp = prev.players?.[key];
    if (!cp || cp.dead) continue;
    const fresh = cp.swingTimer > 0 && (!pp || pp.swingTimer <= 0 || cp.swingTimer > pp.swingTimer);
    if (fresh) {
      // For the local player we already showed a predicted slash on key-press;
      // skip the (delayed) server echo so we don't draw / hear it twice.
      if (key === myKey && performance.now() - lastLocalSlashTime < 350) continue;
      if (window.GameAudio) {
        const ranged = ['bow', 'staff', 'wand', 'crossbow', 'chakram', 'cannon'].includes(cp.weaponId);
        GameAudio.sfx[ranged ? 'shoot' : 'swing']();
      }
      const angle = nearestEnemyAngle(cp, curr, key) ?? (cp.facing === 1 ? 0 : Math.PI);
      const r = cp.w + 10;
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
  }
}

function detectAudioEvents(prev, curr) {
  if (!window.GameAudio) return;
  // State transitions
  if (prev.gameState !== curr.gameState) {
    if (curr.gameState === 'WEAPON_UNLOCK') GameAudio.sfx.unlock();
  }
  GameAudio.syncMusic(curr.gameState === 'GAMEPLAY');
  if (curr.gameState !== 'GAMEPLAY') return;

  // Monster killed (array shrank)
  const pm = prev.monsters?.length || 0, cm = curr.monsters?.length || 0;
  if (cm < pm) GameAudio.sfx.death();

  // Local player took damage
  const key = myNum === 1 ? 'p1' : 'p2';
  const pme = prev.players?.[key], cme = curr.players?.[key];
  if (pme && cme && cme.hp < pme.hp) GameAudio.sfx.hit();

  // Special attack fired (new shockwave particle or new special projectile)
  const pShock = (prev.particles || []).filter(p => p.type === 'shockwave').length;
  const cShock = (curr.particles || []).filter(p => p.type === 'shockwave').length;
  const pSpec  = (prev.projectiles || []).filter(p => p.special).length;
  const cSpec  = (curr.projectiles || []).filter(p => p.special).length;
  if (cShock > pShock || cSpec > pSpec) GameAudio.sfx.special();

  // Wave cleared
  const pWc = (prev.particles || []).filter(p => p.type === 'waveclear').length;
  const cWc = (curr.particles || []).filter(p => p.type === 'waveclear').length;
  if (cWc > pWc) GameAudio.sfx.waveclear();

  // Parry triggered (new parry spark)
  const pPar = (prev.particles || []).filter(p => p.type === 'parry').length;
  const cPar = (curr.particles || []).filter(p => p.type === 'parry').length;
  if (cPar > pPar) GameAudio.sfx.parry();

  // Trap detonated
  const pTrap = (prev.particles || []).filter(p => p.type === 'trapburst').length;
  const cTrap = (curr.particles || []).filter(p => p.type === 'trapburst').length;
  if (cTrap > pTrap) GameAudio.sfx.trap();

  // Item picked up
  const pPick = (prev.particles || []).filter(p => p.type === 'pickup').length;
  const cPick = (curr.particles || []).filter(p => p.type === 'pickup').length;
  if (cPick > pPick) GameAudio.sfx.pickup();

  // Item used
  const pUse = (prev.particles || []).filter(p => p.type === 'useitem').length;
  const cUse = (curr.particles || []).filter(p => p.type === 'useitem').length;
  if (cUse > pUse) GameAudio.sfx.useitem();
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
    const isRanged = ['bow', 'staff', 'wand', 'crossbow', 'chakram', 'cannon'].includes(sl.weaponId);
    ctx.save();
    ctx.lineCap = 'round';
    if (!isRanged) {
      const r = 12 + prog * 6;
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

const PLAYER_SPEED = 3.0; // must match server makePlayer().speed

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

function currentInputs() {
  return {
    up:      !!keys['ArrowUp']    || touchKeys.up,
    down:    !!keys['ArrowDown']  || touchKeys.down,
    left:    !!keys['ArrowLeft']  || touchKeys.left,
    right:   !!keys['ArrowRight'] || touchKeys.right,
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
  localAtkCd = (WEAPON_ATKSPD[me.weaponId] || 400) * (haste ? 0.5 : 1);
  spawnLocalSlash(me, key);
}

function spawnLocalSlash(me, key) {
  const px = pred ? pred.x : me.x, py = pred ? pred.y : me.y;
  const facing = pred ? pred.facing : me.facing;
  const cp = { ...me, x: px, y: py, facing };
  if (window.GameAudio) {
    const ranged = ['bow','staff','wand','crossbow','chakram','cannon'].includes(me.weaponId);
    GameAudio.sfx[ranged ? 'shoot' : 'swing']();
  }
  const angle = nearestEnemyAngle(cp, currState, key) ?? (facing === 1 ? 0 : Math.PI);
  const r = cp.w + 10;
  slashes.push({
    x: cp.x + cp.w / 2 + Math.cos(angle) * r,
    y: cp.y + cp.h / 2 + Math.sin(angle) * r,
    angle, facing, weaponId: cp.weaponId,
    timer: 220, maxTimer: 220,
    color: WEAPON_COLOR[cp.weaponId] || PAL.white,
  });
  lastLocalSlashTime = performance.now();
}
function sendAckUnlock() { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type:'ack_unlock' })); }

// ── Tap a weapon slot to select it directly (mobile-friendly quick swap) ──
function selectWeaponIndex(idx) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'select_weapon', index: idx }));
}

function handleCanvasTap(clientX, clientY) {
  if (!currState || currState.gameState !== 'GAMEPLAY' || !weaponSlotRects.length) return false;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return false;
  const cx = (clientX - rect.left) * (CANVAS_W / rect.width);
  const cy = (clientY - rect.top)  * (CANVAS_H / rect.height);
  const pad = 6; // generous vertical hit area for fingers
  for (const s of weaponSlotRects) {
    if (cx >= s.x - pad && cx <= s.x + s.w + pad && cy >= s.y - pad && cy <= s.y + s.h + pad) {
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
  drawHatOnCtx(ux, bx, by, color, pendingSkin.hatIdx);
  ux.restore();
}

function drawHatOnCtx(ux, x, y, color, hatIdx) {
  const hat = SKIN_HATS[hatIdx] || 'NONE';
  if (hat === 'CAP') {
    ux.fillStyle = '#223344'; ux.fillRect(x - 1, y - 3, 14, 2); ux.fillRect(x + 1, y - 6, 10, 3);
    ux.fillStyle = '#334455'; ux.fillRect(x + 1, y - 6, 9, 1);
  } else if (hat === 'CROWN') {
    ux.fillStyle = '#ddaa00';
    ux.fillRect(x, y - 4, 2, 3); ux.fillRect(x + 4, y - 6, 3, 5); ux.fillRect(x + 9, y - 4, 2, 3);
    ux.fillStyle = '#ffee44';
    ux.fillRect(x + 1, y - 4, 1, 1); ux.fillRect(x + 5, y - 6, 1, 1); ux.fillRect(x + 10, y - 4, 1, 1);
  } else if (hat === 'HORNS') {
    ux.fillStyle = '#aa1111'; ux.fillRect(x + 1, y - 6, 2, 5); ux.fillRect(x + 9, y - 6, 2, 5);
    ux.fillStyle = '#ee3333'; ux.fillRect(x + 1, y - 7, 2, 1); ux.fillRect(x + 9, y - 7, 2, 1);
  } else if (hat === 'SPIKY') {
    ux.fillStyle = color;
    ux.fillRect(x + 1, y - 3, 2, 2); ux.fillRect(x + 4, y - 5, 2, 4);
    ux.fillRect(x + 7, y - 3, 2, 2); ux.fillRect(x + 10, y - 2, 2, 1);
  }
}

// ─── Screens ──────────────────────────────────────────────────────────────────

const SCREENS = ['startScreen','lobbyScreen','unlockScreen','roundScreen','disconnectedScreen','skinsScreen'];
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
    document.getElementById('xpDisplay').textContent = 'XP: ' + (state.xp || 0);
    return;
  }
  if (state.gameState === 'WEAPON_UNLOCK') {
    showScreen('unlockScreen');
    const w = state.pendingUnlock;
    if (w) {
      document.getElementById('unlockName').textContent = w.toUpperCase();
      document.getElementById('unlockDesc').textContent = WEAPON_DESC[w]||'';
      document.getElementById('unlockHint').textContent = isTouchDevice ? 'TAP TO CONTINUE' : 'PRESS SPACE TO CONTINUE';
      drawUnlockPreview(w);
    } else if (state.otherHasUnlocks) {
      document.getElementById('unlockName').textContent = '';
      document.getElementById('unlockDesc').textContent = 'Waiting for other player...';
      document.getElementById('unlockHint').textContent = '';
      const uc = document.getElementById('unlockCanvas');
      const ux = uc.getContext('2d');
      ux.clearRect(0,0,120,80);
      ux.fillStyle='#1a1a2e'; ux.fillRect(0,0,120,80);
    }
    return;
  }
  if (state.gameState === 'ROUND_OVER') {
    showScreen('roundScreen');
    const r = state.round;
    const lb = document.getElementById('leaderboardBox');
    if (state.gameMode === 'waves') {
      document.getElementById('roundTitle').innerHTML = '<span style="color:#ffcc00">WAVES OVER</span>';
      document.getElementById('roundStats').innerHTML =
        `WAVE <span style="color:#ffcc00">${state.wave?.num||0}</span> REACHED<br>XP EARNED: ${state.xp}`;
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
      document.getElementById('roundTitle').innerHTML = '<span style="color:#ffcc00">GAME OVER</span>';
      document.getElementById('roundStats').innerHTML = `WAVE ${state.wave?.num||0} REACHED<br>XP: ${state.xp}`;
    } else {
      lb.classList.add('hidden');
      const p2 = state.players.p2;
      const wn = (p2 && p2.lives <= 0) ? 1 : 2;
      const wname = wn===1 ? (state.playerNames?.p1||'P1') : (state.playerNames?.p2||'P2');
      document.getElementById('roundTitle').innerHTML = `<span class="${wn===1?'p1-color':'p2-color'}">${wname} WINS!</span>`;
      document.getElementById('roundStats').innerHTML =
        `${state.playerNames?.p1||'P1'}: ${r.p1Wins} wins &nbsp; ${state.playerNames?.p2||'P2'}: ${r.p2Wins} wins<br>XP: ${state.xp}`;
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
    updateInventoryBar([]);
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
  drawSlashes();
  drawProjectiles(state.projectiles || []);
  drawMonsters(state.monsters || []);
  const names = state.playerNames || {};
  if (state.players.p1) drawPlayer(state.players.p1, PAL.p1, names.p1 || 'P1');
  if (state.players.p2) drawPlayer(state.players.p2, PAL.p2, names.p2 || 'P2');
  drawParticles(state.particles || []);
  drawHUD(state);
  drawWeaponPanel(state);
  updateInventoryBar(state.inventory || []);
}

// ─── Traps & Items ──────────────────────────────────────────────────────────────

function drawTraps(traps) {
  const now = performance.now();
  for (const tr of traps) {
    const cx = tr.x + tr.w / 2, cy = tr.y + tr.h / 2;
    if (tr.state === 'firing') {
      ctx.save();
      ctx.globalAlpha = 0.5; ctx.fillStyle = tr.color;
      ctx.beginPath(); ctx.arc(cx, cy, tr.radius, 0, Math.PI*2); ctx.fill();
      ctx.restore();
      continue;
    }
    if (tr.state === 'arming') {
      // Telegraph: pulsing danger ring that fills up
      ctx.save();
      ctx.globalAlpha = 0.18; ctx.fillStyle = tr.color;
      ctx.beginPath(); ctx.arc(cx, cy, tr.radius, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 0.9; ctx.strokeStyle = tr.color; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy, tr.radius, -Math.PI/2, -Math.PI/2 + Math.PI*2*tr.armRatio); ctx.stroke();
      ctx.restore();
    }
    // Trap body sprite
    const x = Math.round(tr.x), y = Math.round(tr.y);
    if (tr.type === 'spike') {
      ctx.fillStyle = '#3a2a1a'; ctx.fillRect(x+2, y+10, tr.w-4, 4);
      ctx.fillStyle = tr.color;
      for (let i = 0; i < 3; i++) {
        const sx = x + 3 + i*4;
        ctx.beginPath(); ctx.moveTo(sx, y+11); ctx.lineTo(sx+2, y+3); ctx.lineTo(sx+4, y+11); ctx.fill();
      }
    } else if (tr.type === 'mine') {
      ctx.fillStyle = '#552020'; ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = tr.color;
      const blink = (Math.sin(now/180) > 0) ? 1 : 0.3;
      ctx.globalAlpha = blink; ctx.fillRect(Math.round(cx)-1, Math.round(cy)-1, 2, 2); ctx.globalAlpha = 1;
      for (let a = 0; a < 4; a++) { const an = a*Math.PI/2; ctx.fillRect(Math.round(cx+Math.cos(an)*6)-1, Math.round(cy+Math.sin(an)*6)-1, 2, 2); }
    } else if (tr.type === 'snare') {
      ctx.strokeStyle = tr.color; ctx.lineWidth = 1; ctx.globalAlpha = 0.9;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(cx, cy, 3 + i*2, 0, Math.PI*2); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(x+2, cy); ctx.lineTo(x+tr.w-2, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, y+2); ctx.lineTo(cx, y+tr.h-2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

const ITEM_ICON = { speed:'»', strength:'⚔', shield:'◆', haste:'⚡', heal:'+' };

function drawItems(items) {
  const now = performance.now();
  for (const it of items) {
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2 + Math.sin(now/300 + it.x)*1.5;
    ctx.save();
    ctx.globalAlpha = 0.35; ctx.fillStyle = it.color;
    ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = it.color;
    ctx.fillRect(Math.round(it.x), Math.round(cy - it.h/2), it.w, it.h);
    ctx.fillStyle = '#0a0a14';
    ctx.font = '9px "Courier New",monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ITEM_ICON[it.type] || '?', Math.round(cx), Math.round(cy)+1);
    ctx.restore();
  }
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

// ── Inventory bar (collected items → tappable buff buttons) ──
const ITEM_COLOR = { speed:'#44ddee', strength:'#ff5544', shield:'#ffdd44', haste:'#aa66ff', heal:'#44ff66' };
let _invSig = '';
function updateInventoryBar(inv) {
  const bar = document.getElementById('itemBar');
  if (!bar) return;
  const sig = inv.join(',');
  if (sig === _invSig) return;
  _invSig = sig;
  if (!inv.length) { bar.className = ''; bar.innerHTML = ''; return; }
  bar.className = 'visible';
  bar.innerHTML = inv.map((type, i) => {
    const col = ITEM_COLOR[type] || '#888';
    return `<button class="item-slot" style="border-color:${col};color:${col}" onclick="useItem(${i})" title="${type}">`
      + `<span class="item-ic">${ITEM_ICON[type] || '?'}</span><span class="item-key">${i + 1}</span></button>`;
  }).join('');
}
function useItem(idx) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'use_item', index: idx }));
}

function drawArena() {
  ctx.fillStyle = PAL.arena; ctx.fillRect(0,0,CANVAS_W,CANVAS_H);
  ctx.fillStyle = PAL.wall;
  ctx.fillRect(0,0,CANVAS_W,ARENA_Y); ctx.fillRect(0,CANVAS_H-ARENA_Y,CANVAS_W,ARENA_Y);
  ctx.fillRect(0,0,ARENA_X,CANVAS_H); ctx.fillRect(CANVAS_W-ARENA_X,0,ARENA_X,CANVAS_H);
  ctx.fillStyle = 'rgba(170,170,255,0.08)';
  ctx.fillRect(ARENA_X,ARENA_Y,ARENA_W,1); ctx.fillRect(ARENA_X,ARENA_Y,1,ARENA_H);
  ctx.strokeStyle='rgba(255,255,255,0.03)'; ctx.lineWidth=1;
  for(let x=ARENA_X;x<ARENA_X+ARENA_W;x+=16){ctx.beginPath();ctx.moveTo(x,ARENA_Y);ctx.lineTo(x,ARENA_Y+ARENA_H);ctx.stroke();}
  for(let y=ARENA_Y;y<ARENA_Y+ARENA_H;y+=16){ctx.beginPath();ctx.moveTo(ARENA_X,y);ctx.lineTo(ARENA_X+ARENA_W,y);ctx.stroke();}
}

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
  drawHat(x, y, skinCol, p.skin?.hatIdx);
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
  const isMe = myNum && ((label===currState?.playerNames?.p1 && myNum===1)||(label===currState?.playerNames?.p2 && myNum===2));
  ctx.save();
  ctx.font = '9px "Courier New",monospace';
  ctx.textBaseline = 'bottom'; ctx.textAlign = 'center';
  const rx = Math.round(cx);
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(rx - tw/2 - 2, bottomY - 10, tw + 4, 11);
  ctx.fillStyle = 'rgba(0,0,0,0.9)'; ctx.fillText(label, rx+1, bottomY+1);
  ctx.fillStyle = isMe ? PAL.white : color;
  ctx.fillText(label, rx, bottomY);
  ctx.restore();
}

function drawHat(x, y, color, hatIdx) {
  const hat = SKIN_HATS[hatIdx] || 'NONE';
  if (hat === 'CAP') {
    ctx.fillStyle = '#223344'; ctx.fillRect(x-1, y-3, 14, 2); ctx.fillRect(x+1, y-6, 10, 3);
    ctx.fillStyle = '#334455'; ctx.fillRect(x+1, y-6, 9, 1);
  } else if (hat === 'CROWN') {
    ctx.fillStyle = '#ddaa00';
    ctx.fillRect(x, y-4, 2, 3); ctx.fillRect(x+4, y-6, 3, 5); ctx.fillRect(x+9, y-4, 2, 3);
    ctx.fillStyle = '#ffee44';
    ctx.fillRect(x+1, y-4, 1, 1); ctx.fillRect(x+5, y-6, 1, 1); ctx.fillRect(x+10, y-4, 1, 1);
  } else if (hat === 'HORNS') {
    ctx.fillStyle = '#aa1111'; ctx.fillRect(x+1, y-6, 2, 5); ctx.fillRect(x+9, y-6, 2, 5);
    ctx.fillStyle = '#ee3333'; ctx.fillRect(x+1, y-7, 2, 1); ctx.fillRect(x+9, y-7, 2, 1);
  } else if (hat === 'SPIKY') {
    ctx.fillStyle = color;
    ctx.fillRect(x+1, y-3, 2, 2); ctx.fillRect(x+4, y-5, 2, 4);
    ctx.fillRect(x+7, y-3, 2, 2); ctx.fillRect(x+10, y-2, 2, 1);
  }
}

// ─── Weapon Sprites ───────────────────────────────────────────────────────────

function drawWeaponSprite(p, px, py) {
  const wId = p.weaponId;
  const wc = WEAPON_COLOR[wId] || PAL.white;
  const d = p.facing;
  const hx = d === 1 ? px + p.w : px; // hand attachment x
  const hy = py + 7;                    // hand attachment y
  const t = p.swingTimer > 0 ? p.swingTimer / 200 : 0;
  const swingAngle = t > 0 ? d * Math.sin(t * Math.PI) * 0.75 : 0;

  ctx.save();
  if (swingAngle !== 0) {
    ctx.translate(hx, hy); ctx.rotate(swingAngle); ctx.translate(-hx, -hy);
  }

  if (wId === 'sword') {
    // Handle
    ctx.fillStyle = PAL.handle;
    ctx.fillRect(d===1?hx:hx-4, hy-1, 4, 2);
    // Pommel
    ctx.fillStyle = PAL.guard;
    ctx.fillRect(d===1?hx-1:hx+3, hy-2, 2, 4);
    // Guard crosspiece
    ctx.fillStyle = PAL.guard;
    ctx.fillRect(d===1?hx+4:hx-6, hy-3, 2, 6);
    // Blade (wide)
    ctx.fillStyle = wc;
    ctx.fillRect(d===1?hx+6:hx-14, hy-1, 8, 2);
    // Blade shine
    ctx.fillStyle = '#ddeeff';
    ctx.fillRect(d===1?hx+6:hx-14, hy-1, 7, 1);
    // Tip (taper)
    ctx.fillStyle = wc;
    ctx.fillRect(d===1?hx+14:hx-16, hy, 2, 1);
    ctx.fillRect(d===1?hx+16:hx-18, hy, 1, 1);

  } else if (wId === 'dagger') {
    // Handle
    ctx.fillStyle = PAL.handle;
    ctx.fillRect(d===1?hx:hx-3, hy-1, 3, 2);
    ctx.fillStyle = '#4a2a10'; // wrapped grip
    ctx.fillRect(d===1?hx+1:hx-2, hy-1, 2, 2);
    // Guard
    ctx.fillStyle = PAL.guard;
    ctx.fillRect(d===1?hx+3:hx-5, hy-3, 2, 6);
    // Blade
    ctx.fillStyle = wc;
    ctx.fillRect(d===1?hx+5:hx-11, hy-1, 6, 2);
    // Blade shine
    ctx.fillStyle = '#ddeeff';
    ctx.fillRect(d===1?hx+5:hx-11, hy-1, 5, 1);
    // Sharp tip
    ctx.fillStyle = wc;
    ctx.fillRect(d===1?hx+11:hx-13, hy, 2, 1);
    ctx.fillRect(d===1?hx+13:hx-14, hy, 1, 1);

  } else if (wId === 'axe') {
    // Handle (long)
    ctx.fillStyle = PAL.handle;
    ctx.fillRect(d===1?hx:hx-6, hy-1, 6, 2);
    // Axe head socket
    ctx.fillStyle = '#555566';
    ctx.fillRect(d===1?hx+6:hx-8, hy-2, 2, 4);
    // Axe blade body
    ctx.fillStyle = wc;
    ctx.fillRect(d===1?hx+7:hx-11, hy-6, 4, 12);
    // Blade edge (wider, sharper)
    ctx.fillRect(d===1?hx+10:hx-12, hy-8, 3, 16);
    ctx.fillRect(d===1?hx+12:hx-14, hy-6, 2, 12);
    // Blade shine
    ctx.fillStyle = '#ffcc88';
    ctx.fillRect(d===1?hx+10:hx-11, hy-7, 1, 14);

  } else if (wId === 'spear') {
    // Shaft
    ctx.fillStyle = '#7a4a20';
    ctx.fillRect(d===1?hx:hx-14, hy, 14, 1);
    ctx.fillStyle = PAL.handle;
    ctx.fillRect(d===1?hx:hx-14, hy-1, 14, 2);
    // Socket
    ctx.fillStyle = '#555566';
    ctx.fillRect(d===1?hx+14:hx-16, hy-1, 2, 2);
    // Spearhead base
    ctx.fillStyle = wc;
    ctx.fillRect(d===1?hx+16:hx-20, hy-1, 4, 2);
    // Spearhead point
    ctx.beginPath();
    if (d===1) { ctx.moveTo(hx+20,hy-3); ctx.lineTo(hx+25,hy); ctx.lineTo(hx+20,hy+3); }
    else       { ctx.moveTo(hx-20,hy-3); ctx.lineTo(hx-25,hy); ctx.lineTo(hx-20,hy+3); }
    ctx.fill();
    // Shine
    ctx.fillStyle = '#ddeeff';
    ctx.fillRect(d===1?hx+16:hx-20, hy-1, 3, 1);

  } else if (wId === 'bow') {
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#8B5E3C';
    ctx.beginPath();
    ctx.arc(d===1?hx+2:hx-2, hy, 7, Math.PI*0.2, Math.PI*1.8, d===1);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#ccbb88';
    ctx.beginPath(); ctx.moveTo(d===1?hx+2:hx-2, hy-7); ctx.lineTo(d===1?hx+2:hx-2, hy+7); ctx.stroke();
    // Arrow nocked
    ctx.fillStyle = '#ccaa44';
    ctx.fillRect(d===1?hx+2:hx-8, hy, 6, 1);
    ctx.fillStyle = '#aaddff';
    ctx.fillRect(d===1?hx+8:hx-9, hy-1, 2, 3);

  } else if (wId === 'staff') {
    ctx.fillStyle = '#3a1860';
    ctx.fillRect(d===1?hx:hx-11, hy-1, 11, 2);
    ctx.fillStyle = '#5a2888';
    ctx.fillRect(d===1?hx:hx-11, hy-1, 10, 1);
    ctx.fillStyle = '#aa44ff';
    ctx.fillRect(d===1?hx+11:hx-13, hy-1, 2, 2);
    const ox = d===1?hx+15:hx-15;
    ctx.fillStyle = '#dd88ff';
    ctx.beginPath(); ctx.arc(ox, hy, 4, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#ffccff';
    ctx.beginPath(); ctx.arc(ox-1, hy-1, 1.5, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(221,136,255,0.3)';
    ctx.beginPath(); ctx.arc(ox, hy, 7, 0, Math.PI*2); ctx.fill();

  } else if (wId === 'hammer') {
    ctx.fillStyle = PAL.handle;
    ctx.fillRect(d===1?hx:hx-8, hy-1, 8, 2);
    ctx.fillStyle = '#555566';
    ctx.fillRect(d===1?hx+8:hx-10, hy-2, 2, 4);
    ctx.fillStyle = wc;
    ctx.fillRect(d===1?hx+10:hx-18, hy-5, 8, 10);
    ctx.fillStyle = '#dde0e8';
    ctx.fillRect(d===1?hx+10:hx-18, hy-5, 2, 10);

  } else if (wId === 'wand') {
    ctx.fillStyle = '#6a3010';
    ctx.fillRect(d===1?hx:hx-9, hy, 9, 1);
    ctx.fillStyle = '#9a5020';
    ctx.fillRect(d===1?hx:hx-9, hy-1, 9, 1);
    const tx = d===1?hx+11:hx-11;
    ctx.fillStyle = wc;
    ctx.fillRect(tx-1, hy-2, 3, 5); ctx.fillRect(tx-2, hy-1, 5, 3);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(tx, hy, 1, 1);
    ctx.fillStyle = 'rgba(136,221,255,0.4)';
    ctx.beginPath(); ctx.arc(tx, hy, 5, 0, Math.PI*2); ctx.fill();

  } else if (wId === 'crossbow') {
    ctx.fillStyle = PAL.handle;
    ctx.fillRect(d===1?hx:hx-9, hy-1, 9, 3);
    ctx.lineWidth = 2; ctx.strokeStyle = '#8B5E3C';
    ctx.beginPath(); ctx.arc(d===1?hx+3:hx-3, hy, 8, Math.PI*0.2, Math.PI*1.8, d===1); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = '#ccbb88';
    ctx.beginPath(); ctx.moveTo(d===1?hx+3:hx-3, hy-8); ctx.lineTo(d===1?hx+3:hx-3, hy+8); ctx.stroke();
    ctx.fillStyle = '#cc9933';
    ctx.fillRect(d===1?hx+3:hx-9, hy-1, 6, 2);
    ctx.fillStyle = '#aaddff';
    ctx.fillRect(d===1?hx+9:hx-10, hy-1, 3, 2);

  } else if (wId === 'flail') {
    ctx.fillStyle = PAL.handle;
    ctx.fillRect(d===1?hx:hx-7, hy-1, 7, 2);
    ctx.fillStyle = '#999aaa';
    for (let ci = 0; ci < 3; ci++) {
      ctx.fillRect(d===1?hx+7+ci*3:hx-10-ci*3, hy, 2, 1);
    }
    const bx = d===1?hx+18:hx-18;
    ctx.fillStyle = '#882222';
    ctx.beginPath(); ctx.arc(bx, hy, 4, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = wc;
    ctx.fillRect(bx-5, hy, 2, 1); ctx.fillRect(bx+3, hy, 2, 1);
    ctx.fillRect(bx, hy-5, 1, 2); ctx.fillRect(bx, hy+3, 1, 2);

  } else if (wId === 'greatsword') {
    ctx.fillStyle = PAL.handle;
    ctx.fillRect(d===1?hx:hx-7, hy-1, 7, 3);
    ctx.fillStyle = PAL.guard;
    ctx.fillRect(d===1?hx-2:hx+5, hy-2, 3, 5);
    ctx.fillRect(d===1?hx+7:hx-10, hy-5, 3, 10);
    ctx.fillStyle = wc;
    ctx.fillRect(d===1?hx+10:hx-22, hy-1, 12, 3);
    ctx.fillStyle = '#eef4ff';
    ctx.fillRect(d===1?hx+10:hx-22, hy-1, 11, 1);
    ctx.fillStyle = wc;
    ctx.fillRect(d===1?hx+22:hx-24, hy, 2, 1);
    ctx.fillRect(d===1?hx+24:hx-25, hy+1, 1, 1);

  } else if (wId === 'glaive') {
    // Long pole with a curved blade at the tip
    ctx.fillStyle = PAL.handle;
    ctx.fillRect(d===1?hx:hx-18, hy-1, 18, 2);
    ctx.fillStyle = '#556';
    ctx.fillRect(d===1?hx+18:hx-20, hy-1, 2, 2);
    ctx.fillStyle = wc;
    ctx.fillRect(d===1?hx+20:hx-25, hy-6, 5, 5);
    ctx.fillRect(d===1?hx+22:hx-26, hy-9, 4, 8);
    ctx.fillStyle = '#eef8f0';
    ctx.fillRect(d===1?hx+22:hx-23, hy-8, 1, 7);

  } else if (wId === 'katana') {
    // Slim straight blade, small round guard
    ctx.fillStyle = '#1a1a22';
    ctx.fillRect(d===1?hx:hx-4, hy-1, 4, 2);
    ctx.fillStyle = PAL.guard;
    ctx.fillRect(d===1?hx+4:hx-5, hy-2, 1, 4);
    ctx.fillStyle = wc;
    ctx.fillRect(d===1?hx+5:hx-18, hy-1, 13, 1);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(d===1?hx+5:hx-18, hy, 13, 1);
    ctx.fillStyle = wc;
    ctx.fillRect(d===1?hx+18:hx-20, hy-1, 2, 1);

  } else if (wId === 'chakram') {
    // Spinning ring held at side
    const ox = d===1?hx+4:hx-4;
    ctx.strokeStyle = wc; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ox, hy, 5, 0, Math.PI*2); ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
    const sp = performance.now()/60;
    for (let i=0;i<4;i++){ const a=sp+i*Math.PI/2; ctx.fillStyle='#ffffff'; ctx.fillRect(Math.round(ox+Math.cos(a)*5)-1, Math.round(hy+Math.sin(a)*5)-1, 2, 2); }

  } else if (wId === 'cannon') {
    // Stubby barrel
    ctx.fillStyle = '#3a3a44';
    ctx.fillRect(d===1?hx:hx-12, hy-3, 12, 7);
    ctx.fillStyle = wc;
    ctx.fillRect(d===1?hx+10:hx-14, hy-4, 4, 9);
    ctx.fillStyle = '#222';
    ctx.fillRect(d===1?hx+13:hx-14, hy-2, 1, 5);
    ctx.fillStyle = '#665';
    ctx.fillRect(d===1?hx:hx-12, hy-3, 12, 1);

  } else if (wId === 'reaper') {
    // Scythe: long handle, big curved blade
    ctx.fillStyle = '#2a1a12';
    ctx.fillRect(d===1?hx:hx-16, hy-1, 16, 2);
    ctx.fillStyle = wc;
    ctx.fillRect(d===1?hx+14:hx-18, hy-10, 4, 4);
    ctx.fillRect(d===1?hx+10:hx-20, hy-12, 5, 3);
    ctx.fillRect(d===1?hx+5:hx-19, hy-11, 5, 2);
    ctx.fillStyle = '#ffd0ee';
    ctx.fillRect(d===1?hx+6:hx-18, hy-11, 8, 1);
  }

  ctx.restore();
}

// ─── Monster ──────────────────────────────────────────────────────────────────

function drawMonster(m) {
  const c = m.hitFlash > 0 ? PAL.white : PAL.monster;
  const x = Math.round(m.x), y = Math.round(m.y);
  const head = Math.max(5, Math.round(m.h * 0.32));
  const eye = Math.max(2, Math.round(m.w * 0.18));
  ctx.fillStyle=c;
  ctx.fillRect(x+1,y+head-1,m.w-2,m.h-head+1); ctx.fillRect(x,y,m.w,head);
  ctx.fillRect(x-1,y+1,2,3); ctx.fillRect(x+m.w-1,y+1,2,3);
  // Eyes scale + space out with monster size
  ctx.fillStyle='#ff2222';
  ctx.fillRect(x+Math.round(m.w*0.2),y+2,eye,eye);
  ctx.fillRect(x+Math.round(m.w*0.6),y+2,eye,eye);
  drawHpBar(x-1,y-5,m.w+2,2,m.hp/m.maxHp,'#44ff44','#003300');
}
function drawMonsters(ms) { for(const m of ms) drawMonster(m); }

function drawProjectiles(projs) {
  for(const pr of projs) {
    if(pr.special) {
      const wc = WEAPON_COLOR[pr.weaponId] || PAL.white;
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
    if(pr.weaponId==='bow') {
      ctx.strokeStyle=PAL.bow; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(pr.x,pr.y); ctx.lineTo(pr.x-pr.dx*4,pr.y-pr.dy*4); ctx.stroke();
      ctx.fillStyle='#ffeeaa'; ctx.fillRect(Math.round(pr.x)-1,Math.round(pr.y)-1,2,2);
    } else if(pr.weaponId==='staff') {
      ctx.strokeStyle=PAL.staff; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(pr.x,pr.y,4,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle='rgba(170,68,255,0.5)';
      ctx.beginPath(); ctx.arc(pr.x,pr.y,6,0,Math.PI*2); ctx.fill();
    } else if(pr.weaponId==='wand') {
      ctx.fillStyle=PAL.wand;
      ctx.beginPath(); ctx.arc(pr.x,pr.y,2,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='rgba(136,221,255,0.45)';
      ctx.beginPath(); ctx.arc(pr.x,pr.y,4,0,Math.PI*2); ctx.fill();
    } else if(pr.weaponId==='crossbow') {
      ctx.strokeStyle=PAL.crossbow; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(pr.x,pr.y); ctx.lineTo(pr.x-pr.dx*5,pr.y-pr.dy*5); ctx.stroke();
      ctx.fillStyle='#ddaa55'; ctx.fillRect(Math.round(pr.x)-1,Math.round(pr.y)-1,3,2);
      ctx.fillStyle='#aaddff'; ctx.fillRect(Math.round(pr.x)+1,Math.round(pr.y)-1,2,2);
    } else if(pr.weaponId==='chakram') {
      const sp = performance.now()/40;
      ctx.strokeStyle=PAL.chakram; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(pr.x,pr.y,4,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle='#ffffff';
      for(let i=0;i<4;i++){ const a=sp+i*Math.PI/2; ctx.fillRect(Math.round(pr.x+Math.cos(a)*4)-1, Math.round(pr.y+Math.sin(a)*4)-1, 2, 2); }
    } else if(pr.weaponId==='cannon') {
      ctx.fillStyle='rgba(180,150,120,0.4)';
      ctx.beginPath(); ctx.arc(pr.x,pr.y,5,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#3a3a44';
      ctx.beginPath(); ctx.arc(pr.x,pr.y,3,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#ff9944'; ctx.fillRect(Math.round(pr.x)-1,Math.round(pr.y)-1,2,2);
    }
  }
}

function drawParticles(particles) {
  for(const p of particles) {
    if(p.type==='xp') {
      const alpha=Math.max(0,p.timer/900), rise=(1-p.timer/900)*12;
      ctx.globalAlpha=alpha; ctx.fillStyle=PAL.xp;
      pixelText(p.text,Math.round(p.x),Math.round(p.y-rise));
      ctx.globalAlpha=1;
    } else if(p.type==='aoe') {
      ctx.globalAlpha=Math.max(0,p.timer/300);
      ctx.strokeStyle=p.color||PAL.staff; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.radius||4,0,Math.PI*2); ctx.stroke();
      ctx.globalAlpha=1;
    } else if(p.type==='waveclear') {
      ctx.globalAlpha=Math.min(1,p.timer/2500*3);
      ctx.fillStyle=PAL.xp; ctx.font='12px "Courier New",monospace';
      ctx.textBaseline='middle'; ctx.textAlign='center';
      ctx.fillText(p.text,p.x,p.y); ctx.textAlign='left'; ctx.globalAlpha=1;
    } else if(p.type==='shockwave') {
      const m=p.max||420, k=1-p.timer/m, r=(p.maxR||30)*k;
      ctx.globalAlpha=Math.max(0,p.timer/m)*0.9;
      ctx.strokeStyle=p.color||PAL.white; ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.stroke();
      ctx.strokeStyle='#ffffff'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.arc(p.x,p.y,Math.max(0,r-4),0,Math.PI*2); ctx.stroke();
      ctx.globalAlpha=1;
    } else if(p.type==='parry') {
      const m=p.max||320, a=Math.max(0,p.timer/m), k=1-a;
      ctx.save();
      ctx.translate(p.x,p.y); ctx.rotate(k*0.8);
      ctx.globalAlpha=a; ctx.strokeStyle='#aee4ff'; ctx.lineWidth=2;
      const spikes=6, rr=4+k*10;
      for(let i=0;i<spikes;i++){
        const ang=(Math.PI*2/spikes)*i;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang)*2,Math.sin(ang)*2);
        ctx.lineTo(Math.cos(ang)*rr,Math.sin(ang)*rr);
        ctx.stroke();
      }
      ctx.fillStyle='#ffffff'; ctx.globalAlpha=a;
      ctx.beginPath(); ctx.arc(0,0,2,0,Math.PI*2); ctx.fill();
      ctx.restore(); ctx.globalAlpha=1;
    } else if(p.type==='trapburst') {
      const m=p.max||300, k=1-p.timer/m, r=(p.maxR||20)*k;
      ctx.globalAlpha=Math.max(0,p.timer/m);
      ctx.fillStyle=p.color||'#ff8822';
      ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.fill();
      ctx.globalAlpha=Math.max(0,p.timer/m)*0.8; ctx.strokeStyle='#ffffff'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.arc(p.x,p.y,r,0,Math.PI*2); ctx.stroke();
      ctx.globalAlpha=1;
    } else if(p.type==='pickup' || p.type==='useitem') {
      const m=p.max||600, a=Math.max(0,p.timer/m), rise=(1-a)*14;
      ctx.globalAlpha=a; ctx.fillStyle=p.color||'#44ff66';
      const yy=Math.round(p.y-rise);
      ctx.beginPath(); ctx.arc(Math.round(p.x),yy,3,0,Math.PI*2); ctx.fill();
      ctx.globalAlpha=a*0.5;
      ctx.beginPath(); ctx.arc(Math.round(p.x),yy,6,0,Math.PI*2); ctx.fill();
      ctx.globalAlpha=1;
    }
  }
}

// ─── HUD ──────────────────────────────────────────────────────────────────────

function drawHUD(state) {
  const p1 = state.players.p1, p2 = state.players.p2;
  const names = state.playerNames || {};

  ctx.fillStyle = 'rgba(0,0,0,0.70)';
  ctx.fillRect(0, 0, CANVAS_W, 26);

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
    ctx.fillStyle = '#000'; ctx.fillText(names.p2 || 'P2', CANVAS_W - 3, 3);
    ctx.fillStyle = col;    ctx.fillText(names.p2 || 'P2', CANVAS_W - 4, 2);
    ctx.textAlign = 'left';
    drawHpBar(CANVAS_W - 80, 15, 74, 5, p2.hp / p2.maxHp, col, '#330000');
    for (let i = 0; i < (p2.lives || 0); i++) { ctx.fillStyle = col; ctx.fillRect(CANVAS_W - 9 - i*7, 21, 5, 3); }
  }

  const w = state.wave;
  ctx.textAlign = 'center';
  if (w && state.gameMode !== 'pvp') {
    ctx.fillStyle = '#000'; ctx.fillText('WAVE ' + w.num, CANVAS_W/2 + 1, 3);
    ctx.fillStyle = PAL.text; ctx.fillText('WAVE ' + w.num, CANVAS_W/2, 2);
    ctx.font = '8px "Courier New",monospace';
    ctx.fillStyle = '#999'; ctx.fillText(w.monstersLeft + ' LEFT', CANVAS_W/2, 15);
    ctx.font = '10px "Courier New",monospace';
  } else if (state.gameMode === 'coop') {
    ctx.fillStyle = '#44ff88'; ctx.fillText('CO-OP', CANVAS_W/2, 7);
  }
  ctx.textAlign = 'left';

  // ── Ability cooldown bars (local player): special + parry ──
  const mp = myNum === 1 ? p1 : (myNum === 2 ? p2 : null);
  if (mp) {
    const barW = 60, barH = 4;
    const bx = myNum === 1 ? 4 : CANVAS_W - 4 - barW;
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
      ctx.fillStyle = '#000'; ctx.fillText(label, lx + 1, by - 1 + 1);
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
  ctx.fillStyle = '#000'; ctx.fillText('XP:' + state.xp, 5, CANVAS_H - 3);
  ctx.fillStyle = PAL.xp; ctx.fillText('XP:' + state.xp, 4, CANVAS_H - 4);
}

// ─── Weapon Panel ─────────────────────────────────────────────────────────────

let weaponSlotRects = []; // canvas-space hit boxes for tap-to-select

function drawWeaponPanel(state) {
  weaponSlotRects = [];
  if(!myNum) return;
  const mp = myNum===1 ? state.players?.p1 : state.players?.p2;
  if(!mp||!mp.unlockedWeapons) return;
  const weapons=mp.unlockedWeapons;
  const slotW=26, slotH=22, gap=2;
  const totalW=weapons.length*(slotW+gap)-gap;
  const panelX=Math.round((CANVAS_W-totalW)/2);
  const panelY=CANVAS_H-slotH-4;

  ctx.fillStyle='rgba(0,0,0,0.72)';
  ctx.fillRect(panelX-4,panelY-3,totalW+8,slotH+6);

  if (!isTouchDevice) {
    const hx=panelX+totalW+10, hy=panelY;
    ctx.save();
    ctx.font='8px "Courier New",monospace'; ctx.textBaseline='top'; ctx.textAlign='left';
    ctx.fillStyle='#505060'; ctx.fillText('ARROWS MOVE',hx,hy);
    ctx.fillStyle='#505060'; ctx.fillText('SPACE  ATK', hx,hy+9);
    ctx.fillStyle='#505060'; ctx.fillText('ENTER  SWAP',hx,hy+18);
    ctx.fillStyle='#8866aa'; ctx.fillText('SHIFT  SPECIAL',hx,hy+27);
    ctx.fillStyle='#3399cc'; ctx.fillText('P      PARRY',hx,hy+36);
    ctx.restore();
  }

  for(let i=0;i<weapons.length;i++) {
    const wId=weapons[i], sel=wId===mp.weaponId;
    const sx=panelX+i*(slotW+gap), sy=panelY;
    weaponSlotRects.push({ x: sx, y: sy, w: slotW, h: slotH, index: i });
    const wc=WEAPON_COLOR[wId]||PAL.white;
    ctx.fillStyle=sel?'rgba(255,255,255,0.1)':'rgba(5,5,15,0.8)';
    ctx.fillRect(sx,sy,slotW,slotH);
    ctx.strokeStyle=sel?wc:'#2a2a3a'; ctx.lineWidth=1;
    ctx.strokeRect(sx+0.5,sy+0.5,slotW-1,slotH-1);
    if(sel) {
      ctx.save(); ctx.globalAlpha=0.35; ctx.strokeStyle=wc; ctx.lineWidth=1;
      ctx.strokeRect(sx-0.5,sy-0.5,slotW+1,slotH+1); ctx.restore();
    }
    drawWeaponIconMini(wId,sx+slotW/2,sy+9,wc,sel);
    ctx.save();
    ctx.font='7px "Courier New",monospace'; ctx.textBaseline='bottom'; ctx.textAlign='center';
    ctx.fillStyle=sel?wc:'#444';
    ctx.fillText(wId.slice(0,4).toUpperCase(),sx+slotW/2,sy+slotH-1);
    ctx.restore();
  }
}

function drawWeaponIconMini(wId, cx, cy, color, bright) {
  const c=bright?color:'#404050', h=bright?PAL.handle:'#303030';
  const icx=Math.round(cx), icy=Math.round(cy);
  ctx.fillStyle=c; ctx.strokeStyle=c; ctx.lineWidth=1;
  if(wId==='sword') {
    ctx.fillStyle=h; ctx.fillRect(icx-6,icy-1,4,2);
    ctx.fillStyle=PAL.guard; ctx.fillRect(icx-2,icy-3,2,6);
    ctx.fillStyle=c; ctx.fillRect(icx,icy-1,7,2); ctx.fillRect(icx+7,icy,1,1);
  } else if(wId==='dagger') {
    ctx.fillStyle=h; ctx.fillRect(icx-5,icy-1,3,2);
    ctx.fillStyle=PAL.guard; ctx.fillRect(icx-2,icy-2,2,4);
    ctx.fillStyle=c; ctx.fillRect(icx,icy-1,5,2); ctx.fillRect(icx+5,icy,2,1);
  } else if(wId==='axe') {
    ctx.fillStyle=h; ctx.fillRect(icx-5,icy-1,5,2);
    ctx.fillStyle=c;
    ctx.fillRect(icx,icy-4,3,8); ctx.fillRect(icx+3,icy-5,3,10);
  } else if(wId==='spear') {
    ctx.fillStyle=h; ctx.fillRect(icx-8,icy,16,1); ctx.fillRect(icx-8,icy-1,14,2);
    ctx.fillStyle=c;
    ctx.beginPath(); ctx.moveTo(icx+6,icy-3); ctx.lineTo(icx+11,icy); ctx.lineTo(icx+6,icy+3); ctx.fill();
  } else if(wId==='bow') {
    ctx.lineWidth=1.5; ctx.strokeStyle=bright?'#8B5E3C':'#333';
    ctx.beginPath(); ctx.arc(icx,icy,6,Math.PI*0.3,Math.PI*1.7); ctx.stroke();
    ctx.lineWidth=1; ctx.strokeStyle=bright?'#ccbb88':'#333';
    ctx.beginPath(); ctx.moveTo(icx,icy-6); ctx.lineTo(icx,icy+6); ctx.stroke();
  } else if(wId==='staff') {
    ctx.fillStyle=bright?'#5a2888':'#303030'; ctx.fillRect(icx-6,icy-1,10,2);
    ctx.fillStyle=bright?'#dd88ff':'#404050';
    ctx.beginPath(); ctx.arc(icx+6,icy,3,0,Math.PI*2); ctx.fill();
  } else if(wId==='hammer') {
    ctx.fillStyle=h; ctx.fillRect(icx-6,icy-1,6,2);
    ctx.fillStyle=c;
    ctx.fillRect(icx,icy-4,3,8); ctx.fillRect(icx+3,icy-5,3,10);
    ctx.fillStyle='#dde0e8'; ctx.fillRect(icx,icy-4,1,8);
  } else if(wId==='wand') {
    ctx.fillStyle=h; ctx.fillRect(icx-6,icy-1,10,2);
    ctx.fillStyle=c; ctx.fillRect(icx+4,icy-2,3,5); ctx.fillRect(icx+3,icy-1,5,3);
    ctx.fillStyle=bright?'rgba(136,221,255,0.6)':'rgba(136,221,255,0.2)';
    ctx.beginPath(); ctx.arc(icx+6,icy,4,0,Math.PI*2); ctx.fill();
  } else if(wId==='crossbow') {
    ctx.fillStyle=h; ctx.fillRect(icx-6,icy-1,8,2);
    ctx.lineWidth=1.5; ctx.strokeStyle=bright?'#8B5E3C':'#333';
    ctx.beginPath(); ctx.arc(icx+2,icy,5,Math.PI*0.2,Math.PI*1.8,true); ctx.stroke();
    ctx.lineWidth=1; ctx.strokeStyle=bright?'#ccbb88':'#333';
    ctx.beginPath(); ctx.moveTo(icx+2,icy-5); ctx.lineTo(icx+2,icy+5); ctx.stroke();
  } else if(wId==='flail') {
    ctx.fillStyle=h; ctx.fillRect(icx-6,icy-1,5,2);
    ctx.fillStyle='#888';
    for(let i=0;i<3;i++) ctx.fillRect(icx-1+i*3,icy,2,1);
    ctx.fillStyle=bright?'#882222':'#333';
    ctx.beginPath(); ctx.arc(icx+8,icy,4,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=c;
    ctx.fillRect(icx+3,icy,2,1); ctx.fillRect(icx+13,icy,2,1);
    ctx.fillRect(icx+8,icy-5,1,2); ctx.fillRect(icx+8,icy+3,1,2);
  } else if(wId==='greatsword') {
    ctx.fillStyle=h; ctx.fillRect(icx-7,icy-1,5,3);
    ctx.fillStyle=PAL.guard; ctx.fillRect(icx-2,icy-4,2,8);
    ctx.fillStyle=c; ctx.fillRect(icx,icy-1,9,3); ctx.fillRect(icx+9,icy,1,1);
    ctx.fillStyle='#eef4ff'; ctx.fillRect(icx,icy-1,8,1);
  } else if(wId==='glaive') {
    ctx.fillStyle=h; ctx.fillRect(icx-8,icy,14,1); ctx.fillRect(icx-8,icy-1,12,2);
    ctx.fillStyle=c; ctx.fillRect(icx+6,icy-5,3,4); ctx.fillRect(icx+7,icy-7,2,6);
  } else if(wId==='katana') {
    ctx.fillStyle='#222'; ctx.fillRect(icx-6,icy-1,3,2);
    ctx.fillStyle=PAL.guard; ctx.fillRect(icx-3,icy-2,1,4);
    ctx.fillStyle=c; ctx.fillRect(icx-2,icy-1,9,1); ctx.fillStyle='#fff'; ctx.fillRect(icx-2,icy,9,1);
  } else if(wId==='chakram') {
    ctx.lineWidth=2; ctx.strokeStyle=c;
    ctx.beginPath(); ctx.arc(icx,icy,5,0,Math.PI*2); ctx.stroke();
    ctx.fillStyle='#fff'; for(let i=0;i<4;i++){const a=i*Math.PI/2;ctx.fillRect(Math.round(icx+Math.cos(a)*5)-1,Math.round(icy+Math.sin(a)*5)-1,1,1);}
  } else if(wId==='cannon') {
    ctx.fillStyle=bright?'#3a3a44':'#2a2a30'; ctx.fillRect(icx-6,icy-3,10,6);
    ctx.fillStyle=c; ctx.fillRect(icx+4,icy-4,3,8);
    ctx.fillStyle='#111'; ctx.fillRect(icx+6,icy-2,1,4);
  } else if(wId==='reaper') {
    ctx.fillStyle='#2a1a12'; ctx.fillRect(icx-6,icy-1,12,1);
    ctx.fillStyle=c; ctx.fillRect(icx+5,icy-5,3,3); ctx.fillRect(icx+1,icy-6,5,2);
    ctx.fillStyle='#ffd0ee'; ctx.fillRect(icx+1,icy-6,4,1);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function drawHpBar(x,y,w,h,ratio,fg,bg) {
  ctx.fillStyle=bg; ctx.fillRect(x,y,w,h);
  ctx.fillStyle=fg; ctx.fillRect(x,y,Math.round(w*Math.max(0,ratio)),h);
  ctx.strokeStyle='#000'; ctx.lineWidth=1; ctx.strokeRect(x,y,w,h);
}

function pixelText(text, x, y) {
  const saved = ctx.fillStyle;
  ctx.font = '10px "Courier New",monospace'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillText(text, x+1, y+1);
  ctx.fillStyle = saved; ctx.fillText(text, x, y);
}

// ─── Unlock Preview ───────────────────────────────────────────────────────────

function drawUnlockPreview(weaponId) {
  const uc=document.getElementById('unlockCanvas');
  const ux=uc.getContext('2d');
  ux.imageSmoothingEnabled=false;
  ux.clearRect(0,0,120,80);
  const wc=WEAPON_COLOR[weaponId]||'#ffffff';
  const cx=60,cy=40;
  ux.fillStyle='#1a1a2e'; ux.fillRect(0,0,120,80);
  ux.strokeStyle=wc; ux.lineWidth=1; ux.strokeRect(2,2,116,76);
  ux.fillStyle=wc; ux.strokeStyle=wc;
  if(weaponId==='sword'){ux.fillRect(cx-20,cy-2,40,4);ux.fillRect(cx+17,cy-8,4,16);ux.fillRect(cx-8,cy-1,6,2);}
  else if(weaponId==='dagger'){ux.fillRect(cx-14,cy-2,28,4);ux.beginPath();ux.moveTo(cx+14,cy-4);ux.lineTo(cx+22,cy);ux.lineTo(cx+14,cy+4);ux.fill();}
  else if(weaponId==='axe'){ux.fillRect(cx-5,cy-22,10,44);ux.fillRect(cx+4,cy-18,16,36);}
  else if(weaponId==='spear'){ux.fillRect(cx-28,cy-1,50,2);ux.beginPath();ux.moveTo(cx+22,cy-6);ux.lineTo(cx+34,cy);ux.lineTo(cx+22,cy+6);ux.fill();}
  else if(weaponId==='bow'){ux.lineWidth=3;ux.beginPath();ux.arc(cx,cy,20,Math.PI*0.3,Math.PI*1.7);ux.stroke();ux.lineWidth=1;ux.strokeStyle='#886633';ux.beginPath();ux.moveTo(cx,cy-20);ux.lineTo(cx,cy+20);ux.stroke();}
  else if(weaponId==='staff'){ux.fillRect(cx-30,cy-2,50,4);ux.fillStyle='#dd88ff';ux.beginPath();ux.arc(cx+26,cy,10,0,Math.PI*2);ux.fill();ux.fillStyle='rgba(221,136,255,0.4)';ux.beginPath();ux.arc(cx+26,cy,16,0,Math.PI*2);ux.fill();}
  else if(weaponId==='hammer'){
    ux.fillRect(cx-26,cy-2,26,4);
    ux.fillStyle='#555566'; ux.fillRect(cx,cy-4,4,8);
    ux.fillStyle=wc; ux.fillRect(cx+4,cy-16,14,32);
    ux.fillStyle='#dde0e8'; ux.fillRect(cx+4,cy-16,4,32);
  }
  else if(weaponId==='wand'){
    ux.fillRect(cx-28,cy-2,36,4);
    const tx=cx+12;
    ux.fillStyle=wc; ux.fillRect(tx-4,cy-8,9,16); ux.fillRect(tx-8,cy-4,17,8);
    ux.fillStyle='#ffffff'; ux.fillRect(tx-1,cy-1,3,3);
    ux.fillStyle='rgba(136,221,255,0.5)'; ux.beginPath(); ux.arc(tx,cy,14,0,Math.PI*2); ux.fill();
  }
  else if(weaponId==='crossbow'){
    ux.fillRect(cx-28,cy-3,34,6);
    ux.lineWidth=4; ux.beginPath(); ux.arc(cx+8,cy,20,Math.PI*0.25,Math.PI*1.75); ux.stroke();
    ux.lineWidth=1; ux.strokeStyle='#886633'; ux.beginPath(); ux.moveTo(cx+8,cy-20); ux.lineTo(cx+8,cy+20); ux.stroke();
    ux.fillStyle='#cc9933'; ux.fillRect(cx+8,cy-2,18,4);
    ux.fillStyle='#aaddff'; ux.fillRect(cx+22,cy-2,8,4);
  }
  else if(weaponId==='flail'){
    ux.fillRect(cx-26,cy-3,18,6);
    ux.fillStyle='#999aaa';
    for(let i=0;i<5;i++) ux.fillRect(cx-8+i*7,cy-2,5,4);
    ux.fillStyle='#882222'; ux.beginPath(); ux.arc(cx+26,cy,12,0,Math.PI*2); ux.fill();
    ux.fillStyle=wc;
    ux.fillRect(cx+12,cy-2,4,4); ux.fillRect(cx+36,cy-2,4,4);
    ux.fillRect(cx+24,cy-14,4,4); ux.fillRect(cx+24,cy+10,4,4);
  }
  else if(weaponId==='greatsword'){
    ux.fillRect(cx-34,cy-3,70,7);
    ux.fillRect(cx-34,cy-5,66,11);
    ux.fillStyle='#eef4ff'; ux.fillRect(cx-34,cy-4,64,3);
    ux.fillStyle=wc; ux.fillRect(cx+28,cy-12,8,26);
    ux.fillStyle='#8899aa'; ux.fillRect(cx-14,cy-2,8,5);
  }
  else if(weaponId==='glaive'){
    ux.fillStyle='#6b3a1f'; ux.fillRect(cx-34,cy-2,52,4);
    ux.fillStyle=wc; ux.fillRect(cx+18,cy-14,8,10); ux.fillRect(cx+22,cy-22,8,18);
    ux.fillStyle='#eef8f0'; ux.fillRect(cx+23,cy-21,2,16);
  }
  else if(weaponId==='katana'){
    ux.fillStyle='#1a1a22'; ux.fillRect(cx-30,cy-2,10,4);
    ux.fillStyle='#8899aa'; ux.fillRect(cx-20,cy-4,2,8);
    ux.fillStyle=wc; ux.fillRect(cx-18,cy-2,46,3);
    ux.fillStyle='#ffffff'; ux.fillRect(cx-18,cy-2,44,1);
    ux.fillStyle=wc; ux.fillRect(cx+28,cy-2,5,2);
  }
  else if(weaponId==='chakram'){
    ux.lineWidth=5; ux.strokeStyle=wc;
    ux.beginPath(); ux.arc(cx,cy,18,0,Math.PI*2); ux.stroke();
    ux.fillStyle='#ffffff';
    for(let i=0;i<6;i++){const a=i*Math.PI/3;ux.fillRect(Math.round(cx+Math.cos(a)*18)-2,Math.round(cy+Math.sin(a)*18)-2,4,4);}
  }
  else if(weaponId==='cannon'){
    ux.fillStyle='#3a3a44'; ux.fillRect(cx-26,cy-9,40,18);
    ux.fillStyle=wc; ux.fillRect(cx+10,cy-12,12,24);
    ux.fillStyle='#111'; ux.fillRect(cx+18,cy-6,5,12);
    ux.fillStyle='#665'; ux.fillRect(cx-26,cy-9,40,3);
    ux.fillStyle='#ff9944'; ux.beginPath(); ux.arc(cx+24,cy,4,0,Math.PI*2); ux.fill();
  }
  else if(weaponId==='reaper'){
    ux.fillStyle='#2a1a12'; ux.fillRect(cx-30,cy-2,54,4);
    ux.fillStyle=wc;
    ux.fillRect(cx+20,cy-18,6,8);
    ux.fillRect(cx+4,cy-24,18,6);
    ux.fillRect(cx-8,cy-20,14,5);
    ux.fillStyle='#ffd0ee'; ux.fillRect(cx-6,cy-19,24,2);
  }
}
