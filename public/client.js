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
  shuriken:'#d8dde6', frostrod:'#8fe0ff', blunderbuss:'#c89a5a', lance:'#e8d8a0', stormtome:'#ffe45a',
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
  shuriken:'Rapid piercing stars', frostrod:'Ice shots slow foes',
  blunderbuss:'Close-range scattershot', lance:'Longest reach, dash special',
  stormtome:'Lightning arcs between foes',
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
  try { return { colorIdx: 0, hatIdx: 0, outfit: '', ...(JSON.parse(lsGet('weponare_skin')) || {}) }; }
  catch { return { colorIdx: 0, hatIdx: 0, outfit: '' }; }
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
// Measured, not assumed: the real gap between state messages (a 20 ms server
// timer lands every ~28 ms on Windows) and the network round-trip. Smoothing
// and prediction both key off these.
let stateIntervalMs = SERVER_TICK_MS;
let rttMs = 60;
let pingTimer = null;

let pendingName = 'PLAYER', pendingMode = 'pvp', pendingPass = '';
let roomWasFull = false;
let welcomeLeaderboard = [];
let serverPlayerSpeed = 3.6;

function readCredentials() {
  const raw  = document.getElementById('nameInput').value.trim().toUpperCase();
  const pass = document.getElementById('passInput').value.trim();
  pendingName = raw  || 'PLAYER';
  pendingPass = pass || '';
  // Remember the save slot so coins and upgrades are still reachable after a
  // reload without having to retype the password.
  lsSet('weponare_name', pendingName);
  lsSet('weponare_pass', pendingPass);
}

// Restore the remembered slot and show what is banked against it.
function restoreCredentials() {
  const n = document.getElementById('nameInput'), pw = document.getElementById('passInput');
  if (!n || !pw) return;
  const savedName = lsGet('weponare_name'), savedPass = lsGet('weponare_pass');
  if (savedName && !n.value) n.value = savedName;
  if (savedPass && !pw.value) pw.value = savedPass;
  pendingName = (n.value.trim().toUpperCase()) || 'PLAYER';
  pendingPass = pw.value.trim();
  refreshSavedBanner();
  pw.addEventListener('input', () => {
    lsSet('weponare_pass', pw.value.trim());
    clearTimeout(refreshSavedBanner._t);
    refreshSavedBanner._t = setTimeout(refreshSavedBanner, 400);
  });
  n.addEventListener('input', () => lsSet('weponare_name', n.value.trim().toUpperCase()));
}

// Title-screen readout of the progress held against the current password, so it
// is obvious the slot is saved and which slot you are on.
async function refreshSavedBanner() {
  const el = document.getElementById('savedInfo');
  if (!el) return;
  const pw = (document.getElementById('passInput')?.value || '').trim();
  if (!pw) {
    el.innerHTML = '<span style="color:#555">No password — progress will not be saved</span>';
    return;
  }
  el.innerHTML = '<span style="color:#555">Loading save...</span>';
  try {
    const res = await fetch('/api/profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw, localXp: loadLocalXp(pw), localCoins: loadLocalCoins(pw) }),
    });
    if (!res.ok) { el.innerHTML = '<span style="color:#555">Save unavailable</span>'; return; }
    const d = await res.json();
    applyCatalog(d.catalog, d.colors);
    saveLocalCoins(pw, d.coins);
    saveLocalXp(pw, d.xp);
    const upgCount = Object.values(d.upgrades || {})
      .reduce((n, lv) => n + Object.values(lv).reduce((a, b) => a + b, 0), 0);
    el.innerHTML = `<span style="color:#6a6a80">SAVE:</span> `
      + `<span style="color:var(--c-gold)">${d.coins.toLocaleString()} coins</span>`
      + ` <span style="color:#555">|</span> <span style="color:#c8c8dc">${d.xp.toLocaleString()} XP</span>`
      + ` <span style="color:#555">|</span> <span style="color:#c8c8dc">${d.weapons.length} weapons</span>`
      + (upgCount ? ` <span style="color:#555">|</span> <span style="color:#8fd8a0">${upgCount} upgrades</span>` : '')
      + (d.refunded ? `<br><span style="color:#8fd8a0">Weapons now have their own upgrades. `
                    + `Old ones were refunded: +${d.refunded.toLocaleString()} coins</span>` : '');
  } catch {
    el.innerHTML = '<span style="color:#555">Save unavailable (offline)</span>';
  }
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
  ws.onopen = () => {
    connected = true;
    clearInterval(pingTimer);
    const sock = ws;
    pingTimer = setInterval(() => {
      if (sock.readyState === 1) sock.send(JSON.stringify({ type: 'ping', t: performance.now() }));
      else clearInterval(pingTimer);
    }, 1000);
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'pong') {
      const sample = performance.now() - msg.t;
      if (sample >= 0 && sample < 2000) rttMs = rttMs * 0.7 + sample * 0.3;
      return;
    }
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
      // The server only sends a player's unlock list when it changes.
      for (const k of ['p1', 'p2']) {
        const np = msg.players?.[k], op = currState?.players?.[k];
        if (np && !np.unlockedWeapons && op?.unlockedWeapons) np.unlockedWeapons = op.unlockedWeapons;
      }
      if (currState && msg.gameState === 'GAMEPLAY') detectSlashes(currState, msg);
      if (currState) detectAudioEvents(currState, msg);
      else if (window.GameAudio) GameAudio.syncMusic(msg.gameState === 'GAMEPLAY');
      prevState = currState;
      currState = msg;
      const nowT = performance.now();
      if (stateRecvTime) {
        const gap = nowT - stateRecvTime;
        if (gap > 0 && gap < 250) stateIntervalMs = stateIntervalMs * 0.9 + gap * 0.1;
      }
      stateRecvTime = nowT;
      updateScreens(msg);
    }
  };
  ws.onclose = () => {
    connected = false;
    currState = null; prevState = null; pred = null; stateRecvTime = 0;
    clearInterval(pingTimer);
    if (window.GameAudio) GameAudio.stopMusic();
    showGameControls(false);
    if (leaving) {
      leaving = false;
      showScreen('startScreen');
      refreshSavedBanner();
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
// waiting for the server round-trip.
//
// Reconciliation compares like with like. A server position describes where our
// inputs had taken us about one round-trip ago, so it is checked against our own
// predicted position from that moment (kept in a short history), and only the
// difference is corrected. Pulling toward the raw server position instead — as
// this used to — dragged the player back onto a stale spot every frame, which is
// exactly what made movement feel delayed.

let pred = null; // { x, y, facing }
const predHist = [];          // [{ t, x, y }] — our predicted path, last second
let reconciledState = null;   // the state message last reconciled against

function predictedAt(t) {
  if (!predHist.length) return null;
  if (t <= predHist[0].t) return predHist[0];
  for (let i = predHist.length - 1; i > 0; i--) {
    const a = predHist[i - 1], b = predHist[i];
    if (t >= a.t) {
      const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
      return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) };
    }
  }
  return predHist[predHist.length - 1];
}

function updatePrediction(frameDt, now) {
  if (!currState || currState.gameState !== 'GAMEPLAY' || !myNum) { pred = null; predHist.length = 0; return; }
  const key = myNum === 1 ? 'p1' : 'p2';
  const me = currState.players?.[key];
  if (!me || me.dead) { pred = null; predHist.length = 0; return; }
  if (!pred) { pred = { x: me.x, y: me.y, facing: me.facing }; predHist.length = 0; }

  const inp = currentInputs();
  const moving = inp.left || inp.right || inp.up || inp.down;

  // Once per new server state: how far is the server from where we predicted
  // ourselves to be when it computed that position?
  if (currState !== reconciledState) {
    reconciledState = currState;
    const past = predictedAt(now - (rttMs + stateIntervalMs * 0.5));
    const ex = past ? me.x - past.x : me.x - pred.x;
    const ey = past ? me.y - past.y : me.y - pred.y;
    const err = Math.hypot(ex, ey);
    if (err > 40 || me.pulled) {
      // Knockback / grapple / dash / teleport: the server moved us — take it.
      pred.x = me.x; pred.y = me.y;
      predHist.length = 0;
    } else if (err > 0.4) {
      // Shift the whole predicted path, so the same error isn't corrected twice.
      const k = moving ? 0.2 : 0.4;
      pred.x += ex * k; pred.y += ey * k;
      for (const h of predHist) { h.x += ex * k; h.y += ey * k; }
    }
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

  predHist.push({ t: now, x: pred.x, y: pred.y });
  while (predHist.length && now - predHist[0].t > 1000) predHist.shift();
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

// A melee swing is drawn as an arc pivoting on the player at the weapon's real
// reach, so a range upgrade is immediately visible as a wider sweep. Ranged shots
// keep their burst at the muzzle.
function pushSlash(cp, angle) {
  const melee = !isRanged(cp.weaponId);
  const reach = cp.reach || 44;
  const tipR = cp.w + 12;
  slashes.push({
    px: cp.x + cp.w / 2,
    py: cp.y + cp.h / 2,
    x: cp.x + cp.w / 2 + Math.cos(angle) * tipR,
    y: cp.y + cp.h / 2 + Math.sin(angle) * tipR,
    angle,
    facing: cp.facing,
    weaponId: cp.weaponId,
    reach,
    melee,
    upg: cp.upg || null,
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

  // A spitter loosing a shot — the tell for incoming ranged damage.
  const pSpit = (prev.projectiles || []).filter(p => p.weaponId === 'spit').length;
  const cSpit = (curr.projectiles || []).filter(p => p.weaponId === 'spit').length;
  if (cSpit > pSpit) GameAudio.sfx.shoot();

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
    ['waveclear', 'waveclear'], ['newtype', 'unlock'], ['parry', 'parry'], ['trapburst', 'trap'],
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
    const u = upgScale(sl.upg);
    ctx.save();
    ctx.lineCap = 'round';

    if (sl.melee) {
      // The crescent sweeps out to the weapon's actual reach.
      const cx = Math.round(sl.px), cy = Math.round(sl.py);
      const r = sl.reach * (0.6 + 0.35 * prog);
      const aim = sl.angle ?? (sl.facing === 1 ? 0 : Math.PI);
      const span = Math.PI * 0.8;
      const heft = 2.5 * u.weight;

      ctx.globalAlpha = alpha * 0.85;
      ctx.strokeStyle = sl.color;
      ctx.lineWidth = heft;
      ctx.beginPath(); ctx.arc(cx, cy, r, aim - span / 2, aim + span / 2, false); ctx.stroke();

      // Range levels add trailing edges behind the main arc — the swing reads
      // heavier and deeper the more it has been upgraded.
      for (let i = 1; i <= u.rng; i++) {
        ctx.globalAlpha = alpha * (0.3 - i * 0.03);
        ctx.lineWidth = Math.max(0.6, heft - i * 0.3);
        ctx.beginPath();
        ctx.arc(cx, cy, r - i * 2.4, aim - span / 2 * (1 - i * 0.04), aim + span / 2 * (1 - i * 0.04), false);
        ctx.stroke();
      }

      if (alpha > 0.5) {
        ctx.globalAlpha = ((alpha - 0.5) / 0.5) * 0.65;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(0.8, 1 * u.weight);
        ctx.beginPath(); ctx.arc(cx, cy, r - heft, aim - span / 2 * 0.9, aim + span / 2 * 0.9, false); ctx.stroke();
      }
      // A damage-upgraded strike sparks at the leading tip.
      if (u.dmg >= 3) {
        const tipA = aim + span / 2;
        ctx.globalAlpha = alpha * 0.8;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx + Math.cos(tipA) * r, cy + Math.sin(tipA) * r, 1 + u.dmg * 0.14, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Muzzle burst, widened by range levels.
      const cx = Math.round(sl.x), cy = Math.round(sl.y);
      ctx.globalAlpha = alpha * 0.75;
      ctx.strokeStyle = sl.color;
      ctx.lineWidth = 1.5 * u.weight;
      const steps = sl.weaponId === 'staff' ? 8 : 6;
      for (let a = 0; a < Math.PI * 2; a += Math.PI * 2 / steps) {
        const len = (3 + prog * 6) * u.trail;
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
restoreCredentials();

// Reflect saved audio preferences on the start-screen buttons
if (window.GameAudio) {
  if (GameAudio.isMuted()) {
    const b = document.getElementById('soundBtn');
    if (b) b.innerHTML = '♪ SOUND: OFF';
  }
  updateMusicButtons(GameAudio.trackInfo());
}

// ─── Skin Screen ──────────────────────────────────────────────────────────────
// Colour and hat are free. Full-body skins are bought with coins against the
// password; the server holds ownership and strips any skin you don't own.

let skinProfile = { coins: 0, owned: [], loaded: false };
let skinBusy = false;

function skinShopList() { return (window.Sprites && Sprites.SKIN_SHOP) || []; }
function outfitHidesHat(id) { const o = window.Sprites && Sprites.OUTFITS[id]; return !!(o && o.hat === false); }

function setSkinMsg(text, isError) {
  const el = document.getElementById('skinShopMsg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'shop-msg' + (isError ? ' err' : '');
}

async function openSkinsScreen() {
  readCredentials();
  showScreen('skinsScreen');
  if (pendingSkin.outfit === undefined) pendingSkin.outfit = '';
  skinProfile = { coins: 0, owned: [], loaded: false };
  buildSkinGrids();
  renderSkinPreview();
  if (!pendingPass) {
    setSkinMsg('Enter a password on the title screen to buy skins — they are saved against it.', true);
    return;
  }
  setSkinMsg('Loading...');
  try {
    const res = await fetch('/api/profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pendingPass, localXp: loadLocalXp(pendingPass), localCoins: loadLocalCoins(pendingPass) }),
    });
    const data = await res.json();
    if (!res.ok) { setSkinMsg(data.error || 'Could not load your profile.', true); return; }
    skinProfile = { coins: data.coins, owned: data.ownedSkins || [], loaded: true };
    saveLocalCoins(pendingPass, data.coins);
    // A skin that isn't owned on this password can't be worn.
    if (pendingSkin.outfit && !skinProfile.owned.includes(pendingSkin.outfit)) {
      pendingSkin.outfit = '';
      saveLocalSkin(pendingSkin);
    }
    setSkinMsg('');
    buildSkinGrids();
    renderSkinPreview();
  } catch {
    setSkinMsg('Could not reach the server.', true);
  }
}
function closeSkinsScreen() { showScreen('startScreen'); refreshSavedBanner(); }

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

// Owned (or the default look): wear it. Otherwise: buy it.
function selectOutfit(id) {
  if (id && !skinProfile.owned.includes(id)) { buySkin(id); return; }
  pendingSkin.outfit = id;
  skinModified = true;
  saveLocalSkin(pendingSkin);
  buildSkinGrids();
  renderSkinPreview();
}

async function buySkin(id) {
  if (skinBusy) return;
  const def = skinShopList().find(s => s.id === id);
  if (!def) return;
  if (!pendingPass) { setSkinMsg('Enter a password on the title screen to buy skins.', true); return; }
  if (skinProfile.loaded && skinProfile.coins < def.price) {
    setSkinMsg(`Not enough coins — ${def.name} costs ${def.price}.`, true);
    return;
  }
  skinBusy = true;
  setSkinMsg('');
  try {
    const res = await fetch('/api/buy_skin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pendingPass, skinId: id, localCoins: loadLocalCoins(pendingPass) }),
    });
    const data = await res.json();
    if (!res.ok) { setSkinMsg(data.error || 'Purchase failed.', true); return; }
    skinProfile = { coins: data.coins, owned: data.ownedSkins || [], loaded: true };
    saveLocalCoins(pendingPass, data.coins);
    if (window.GameAudio) { GameAudio.init(); GameAudio.sfx.unlock(); }
    setSkinMsg(`${def.name} unlocked!`);
    selectOutfit(id);   // wear it straight away
  } catch {
    setSkinMsg('Could not reach the server.', true);
  } finally {
    skinBusy = false;
  }
}

function buildSkinGrids() {
  const cg = document.getElementById('colorGrid');
  if (cg) cg.innerHTML = SKIN_COLORS.map((c, i) =>
    `<div class="skin-color${i === pendingSkin.colorIdx ? ' selected' : ''}" style="background:${c}" onclick="selectSkinColor(${i})"></div>`
  ).join('');
  const hg = document.getElementById('hatGrid');
  const hatHidden = outfitHidesHat(pendingSkin.outfit);
  if (hg) {
    hg.style.opacity = hatHidden ? '0.4' : '';
    hg.title = hatHidden ? 'This skin has its own headgear' : '';
    hg.innerHTML = SKIN_HATS.map((h, i) =>
      `<div class="skin-hat${i === pendingSkin.hatIdx ? ' selected' : ''}" onclick="selectSkinHat(${i})">${h}</div>`
    ).join('');
  }
  const coinsEl = document.getElementById('skinCoins');
  if (coinsEl) coinsEl.textContent = skinProfile.loaded ? `◆ ${skinProfile.coins.toLocaleString()}` : '';

  const og = document.getElementById('outfitGrid');
  if (!og) return;
  const cur = pendingSkin.outfit || '';
  const cards = [{ id: '', name: 'DEFAULT', price: 0 }, ...skinShopList()];
  og.innerHTML = cards.map(s => {
    const owned = !s.id || skinProfile.owned.includes(s.id);
    const equipped = s.id === cur;
    const poor = !owned && skinProfile.loaded && skinProfile.coins < s.price;
    const tag = equipped ? 'WORN' : owned ? 'OWNED' : `◆${s.price}`;
    return `<div class="outfit-card${owned ? ' owned' : ''}${equipped ? ' equipped' : ''}${poor ? ' poor' : ''}"
      onclick="selectOutfit('${s.id}')" title="${owned ? 'Wear' : 'Buy'} ${s.name}">
      <canvas data-outfit="${s.id}" width="20" height="31"></canvas>
      <span>${s.name}</span><span class="outfit-tag">${tag}</span></div>`;
  }).join('');
  const color = SKIN_COLORS[pendingSkin.colorIdx] || '#4488ff';
  for (const cv of og.querySelectorAll('canvas')) {
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cv.width, cv.height);
    const spr = playerSprite(color, pendingSkin.hatIdx, 1, false, cv.dataset.outfit);
    if (spr) g.drawImage(spr, Math.floor((cv.width - spr.width) / 2), cv.height - spr.height);
  }
}

function renderSkinPreview() {
  const uc = document.getElementById('skinPreviewCanvas');
  if (!uc) return;
  const ux = uc.getContext('2d');
  ux.imageSmoothingEnabled = false;
  ux.clearRect(0, 0, uc.width, uc.height);
  ux.fillStyle = '#1a1a2e'; ux.fillRect(0, 0, uc.width, uc.height);
  const color = SKIN_COLORS[pendingSkin.colorIdx] || '#4488ff';
  const cv = playerSprite(color, pendingSkin.hatIdx, 1, false, pendingSkin.outfit || '');
  if (!cv) return;
  // Integer zoom keeps the preview as crisp as the in-game sprite.
  const z = Math.max(1, Math.floor(Math.min(uc.width / cv.width, uc.height / cv.height)));
  ux.drawImage(cv, Math.round((uc.width - cv.width * z) / 2),
                   Math.round((uc.height - cv.height * z) / 2),
                   cv.width * z, cv.height * z);
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
    setShopMsg('Enter a password on the title screen first — coins and upgrades are saved against it.', true);
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
    setShopMsg(data.refunded
      ? `Weapons now have their own upgrades. Old ones were refunded: +${data.refunded.toLocaleString()} coins.`
      : '');
    renderShop();
  } catch {
    setShopMsg('Could not reach the server.', true);
  }
}
function closeShop() { showScreen('startScreen'); refreshSavedBanner(); }

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
    // Each weapon has its own three upgrades, listed in the server catalog.
    const stats = (WEAPON_META[id]?.upgrades || ['dmg', 'spd', 'rng']).filter(k => upgradeDefs[k]);
    const rows = stats.map(stat => {
      const def = upgradeDefs[stat];
      const cur = lv[stat] || 0;
      const maxed = cur >= def.max;
      const cost = maxed ? 0 : costs[stat][cur];
      const afford = !maxed && coins >= cost;
      const pips = Array.from({ length: def.max },
        (_, i) => `<i class="${i < cur ? 'on' : ''}"></i>`).join('');
      return `<button class="up-btn${maxed ? ' maxed' : afford ? '' : ' poor'}"
        ${maxed ? 'disabled' : ''} onclick="buyUpgrade('${id}','${stat}')" title="${def.name}: ${def.desc || ''} per level">
        <span class="up-name">${def.short || def.name.slice(0, 3)}</span>
        <span class="up-pips">${pips}</span>
        <span class="up-cost">${maxed ? 'MAX' : '◆' + cost}</span></button>`;
    }).join('');
    const desc = stats.map(k => `<b>${upgradeDefs[k].short}</b> ${upgradeDefs[k].desc || ''}`).join(' · ');
    return `<div class="shop-row">
      <div class="shop-head">
        <canvas class="shop-ic" data-weapon="${id}" width="56" height="32"></canvas>
        <span class="shop-name" style="color:${col}">${name}</span>
      </div>
      <div class="shop-stats">${rows}</div>
      <div class="shop-desc">${desc}</div>
    </div>`;
  }).join('');

  for (const cv of list.querySelectorAll('canvas.shop-ic')) {
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    const id = cv.dataset.weapon;
    g.imageSmoothingEnabled = false;
    drawWeaponPixelsFitted(g, id, cv.width / 2, cv.height / 2, cv.width - 8, cv.height - 8,
                           WEAPON_COLOR[id] || '#ccc');
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
    updatePrediction(dt, now);
    // Blend over the real gap between states, so others move smoothly instead
    // of finishing early and stalling until the next message.
    const t = Math.min(1, (now - stateRecvTime) / Math.max(SERVER_TICK_MS, stateIntervalMs));
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
  drawItemBar(state.inventory || [], myNum === 1 ? state.players.p1 : myNum === 2 ? state.players.p2 : null);
  drawWeaponPanel(state);
  drawPickupBanners(state.particles);
  ctx.restore();
}

// The floor never changes, so it is painted once into an offscreen canvas and
// blitted each frame instead of re-issuing ~300 fills and line strokes.
let arenaCache = null;
function drawArena() {
  if (!arenaCache) {
    const cv = document.createElement('canvas');
    cv.width = CANVAS_W; cv.height = CANVAS_H;
    const g = cv.getContext('2d');
    if (!g) { paintArena(ctx); return; }
    paintArena(g);
    arenaCache = cv;
  }
  ctx.drawImage(arenaCache, 0, 0);
}

function paintArena(g) {
  g.fillStyle = PAL.arena; g.fillRect(0,0,CANVAS_W,CANVAS_H);
  // Floor tiles, slightly chequered so the bigger arena reads as a space.
  const T = 24;
  g.fillStyle = 'rgba(255,255,255,0.016)';
  for (let ty = 0; ty * T < ARENA_H; ty++) {
    for (let tx = (ty % 2); tx * T < ARENA_W; tx += 2) {
      g.fillRect(ARENA_X + tx*T, ARENA_Y + ty*T,
                   Math.min(T, ARENA_W - tx*T), Math.min(T, ARENA_H - ty*T));
    }
  }
  g.strokeStyle='rgba(255,255,255,0.028)'; g.lineWidth=1;
  for(let x=ARENA_X;x<=ARENA_X+ARENA_W;x+=T){g.beginPath();g.moveTo(x+0.5,ARENA_Y);g.lineTo(x+0.5,ARENA_Y+ARENA_H);g.stroke();}
  for(let y=ARENA_Y;y<=ARENA_Y+ARENA_H;y+=T){g.beginPath();g.moveTo(ARENA_X,y+0.5);g.lineTo(ARENA_X+ARENA_W,y+0.5);g.stroke();}
  // Walls
  g.fillStyle = PAL.wall;
  g.fillRect(0,0,CANVAS_W,ARENA_Y); g.fillRect(0,CANVAS_H-ARENA_Y,CANVAS_W,ARENA_Y);
  g.fillRect(0,0,ARENA_X,CANVAS_H); g.fillRect(CANVAS_W-ARENA_X,0,ARENA_X,CANVAS_H);
  g.fillStyle = 'rgba(140,140,200,0.18)';
  g.fillRect(ARENA_X-1,ARENA_Y-1,ARENA_W+2,1);
  g.fillRect(ARENA_X-1,ARENA_Y+ARENA_H,ARENA_W+2,1);
  g.fillRect(ARENA_X-1,ARENA_Y-1,1,ARENA_H+2);
  g.fillRect(ARENA_X+ARENA_W,ARENA_Y-1,1,ARENA_H+2);
}

// ─── Traps & Items ──────────────────────────────────────────────────────────────

function drawTraps(traps) {
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

    const cv = trapSprite(tr.type, tr.w, tr.state === 'arming');
    if (cv) ctx.drawImage(cv, Math.round(tr.x) - 2, Math.round(tr.y) - 2);
  }
}

function drawItems(items) {
  const now = performance.now();
  for (const it of items) {
    const s = it.w;
    const bob = Math.sin(now / 300 + it.x) * 2;
    const cx = it.x + s / 2, cy = it.y + s / 2 + bob;
    ctx.save();
    ctx.globalAlpha = 0.28; ctx.fillStyle = it.color;
    ctx.beginPath(); ctx.arc(cx, cy, s * 0.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    const cv = itemSprite(it.type, it.color);
    if (cv) ctx.drawImage(cv, Math.round(it.x), Math.round(it.y + bob));
  }
}

function drawCoins(coins) {
  const now = performance.now();
  for (const c of coins) {
    // Each coin spins from its own phase so a scattered pile does not pulse in
    // lockstep, and blinks out over its last seconds.
    const frame = Math.floor(now / 70 + c.x * 0.7) & 7;
    const blink = c.fading && Math.sin(now / 110) < -0.2;
    ctx.save();
    if (blink) ctx.globalAlpha = 0.35;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(Math.round(c.x) + 2, Math.round(c.y) + c.h - 1, c.w - 4, 2);
    const cv = coinSprite(frame);
    if (cv) ctx.drawImage(cv, Math.round(c.x), Math.round(c.y));
    ctx.restore();
  }
}

// ── Inventory (drawn inside the HUD so it always fits, whatever the screen) ──
const ITEM_COLOR = {
  speed:'#44ddee', strength:'#ff5544', shield:'#ffdd44', haste:'#aa66ff', heal:'#44ff66',
  magnet:'#ffc24a', regen:'#ff7ac8', vampire:'#d8304a', bomb:'#ff8a2a', frost:'#9fe8ff',
};
// Timed effects that come from a power-up, so the active ones can show their icon.
const EFFECT_ITEM = { speed:'speed', strength:'strength', shield:'shield', haste:'haste',
                      magnet:'magnet', regen:'regen', vampire:'vampire' };
const EFFECT_MAX = { speed:6000, strength:6000, shield:4500, haste:6000, magnet:10000, regen:8000, vampire:7000 };
// Slots are 32 HUD px and the 18px icon is drawn at 24 (exactly 2x on the
// 1.5x-scaled canvas), so collected power-ups are big, crisp and easy to tap.
const INV_SLOT = 32, INV_ICON = 24, INV_GAP = 4, INV_X = 4, INV_Y = 44;
let itemSlotRects = [];   // HUD-space hit boxes for tap-to-use

// First y at or below `y` where a box of this size overlaps no on-screen button.
function clearOfButtons(x, y, w, h) {
  for (const z of hudTouchZones()) {
    if (x < z.x + z.w && x + w > z.x && y < z.y + z.h && y + h > z.y) y = z.y + z.h + 2;
  }
  return y;
}

function drawItemBar(inv, me) {
  itemSlotRects = [];
  const onRight = myNum === 2;
  const active = me && me.effects
    ? Object.keys(me.effects).filter(k => EFFECT_ITEM[k] && me.effects[k] > 0) : [];
  if ((!inv || !inv.length) && !active.length) return;

  // A row under the ability bars on your side of the screen, nudged down if an
  // on-screen button (music / leave) happens to sit there.
  const rowW = Math.max(1, inv.length) * (INV_SLOT + INV_GAP) - INV_GAP;
  const x0 = onRight ? HUD_W - INV_X - rowW : INV_X;
  const y = clearOfButtons(x0 - 2, INV_Y - 2, rowW + 4, INV_SLOT + 4) + 2;
  ctx.save();
  if (inv.length) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x0 - 2, y - 2, rowW + 4, INV_SLOT + 4);
  }
  inv.forEach((type, i) => {
    const x = x0 + i * (INV_SLOT + INV_GAP);
    const col = ITEM_COLOR[type] || '#888';
    itemSlotRects.push({ x, y, w: INV_SLOT, h: INV_SLOT, index: i });
    ctx.fillStyle = 'rgba(8,8,18,0.9)';
    ctx.fillRect(x, y, INV_SLOT, INV_SLOT);
    ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.75, y + 0.75, INV_SLOT - 1.5, INV_SLOT - 1.5);
    const cv = itemSprite(type, col);
    if (cv) {
      const o = (INV_SLOT - INV_ICON) / 2;
      ctx.drawImage(cv, x + o, y + o - 1, INV_ICON, INV_ICON);
    }
    ctx.font = 'bold 8px "Courier New",monospace';
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#000'; ctx.fillText(String(i + 1), x + INV_SLOT - 1, y + INV_SLOT);
    ctx.fillStyle = '#d8d8ea'; ctx.fillText(String(i + 1), x + INV_SLOT - 1.5, y + INV_SLOT - 0.5);
  });

  // Active power-ups: an icon each with a draining timer bar underneath.
  const B = 16, by = y + (inv.length ? INV_SLOT + 5 : 0);
  active.forEach((k, i) => {
    const bx = onRight ? HUD_W - INV_X - (i + 1) * (B + 3) + 3 : INV_X + i * (B + 3);
    const type = EFFECT_ITEM[k], col = ITEM_COLOR[type];
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx - 1, by - 1, B + 2, B + 5);
    const cv = itemSprite(type, col);
    if (cv) ctx.drawImage(cv, bx, by, B, B);
    const left = Math.max(0, Math.min(1, me.effects[k] / (EFFECT_MAX[k] || 6000)));
    ctx.fillStyle = '#222'; ctx.fillRect(bx, by + B + 1, B, 2);
    ctx.fillStyle = col;    ctx.fillRect(bx, by + B + 1, Math.round(B * left), 2);
  });
  ctx.restore();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

// Big "you got X" banner for the local player's pickups, in HUD space.
function drawPickupBanners(particles) {
  const myKey = myNum === 1 ? 'p1' : myNum === 2 ? 'p2' : null;
  const mine = (particles || []).filter(p => p.type === 'pickup' && p.text && p.who === myKey);
  mine.slice(-3).forEach((p, i) => {
    const m = p.max || 1800, k = 1 - p.timer / m;
    // Pop in, hold, then fade.
    const a = k < 0.1 ? k / 0.1 : k > 0.75 ? Math.max(0, (1 - k) / 0.25) : 1;
    const pop = k < 0.12 ? 1 + (0.12 - k) * 3 : 1;
    const cy = 86 + i * 34;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(HUD_W / 2, cy);
    ctx.scale(pop, pop);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const title = p.text + '!';
    const hint = isTouchDevice ? 'TAP THE ICON TO USE' : 'PRESS ' + (p.slot || 1) + ' TO USE';
    const sub = (p.sub ? p.sub + ' · ' : '') + hint;
    ctx.font = '8px "Courier New",monospace';
    const subW = ctx.measureText(sub).width;
    ctx.font = 'bold 17px "Courier New",monospace';
    const w = Math.min(HUD_W - 8, Math.max(ctx.measureText(title).width + 44, subW + 44, 160));
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(-w / 2, -14, w, 30);
    ctx.fillStyle = p.color || '#fff';
    ctx.fillRect(-w / 2, -14, w, 2); ctx.fillRect(-w / 2, 14, w, 2);
    const cv = p.item ? itemSprite(p.item, p.color || '#888') : null;
    if (cv) ctx.drawImage(cv, -w / 2 + 6, -12, 24, 24);
    ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round';
    ctx.strokeText(title, 12, -3);
    ctx.fillStyle = p.color || '#fff';
    ctx.fillText(title, 12, -3);
    ctx.font = '8px "Courier New",monospace';
    ctx.fillStyle = '#e8e8f4';
    ctx.fillText(sub, 12, 9);
    ctx.restore();
  });
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
  const x = Math.round(p.x), y = Math.round(p.y);

  // Active-effect aura sits under the sprite.
  if (p.effects) {
    const active = Object.keys(p.effects).filter(k => p.effects[k] > 0);
    if (active.length) {
      const t = performance.now() / 200;
      ctx.save();
      ctx.globalAlpha = 0.25 + Math.sin(t) * 0.1;
      ctx.fillStyle = EFFECT_GLOW[active[0]] || '#ffffff';
      ctx.beginPath(); ctx.arc(x + p.w / 2, y + p.h / 2, p.w, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.fillRect(x + 1, y + p.h, p.w - 2, 2);

  const cv = playerSprite(skinCol, p.skin?.hatIdx || 0, p.facing, p.hitFlash > 0, p.skin?.outfit || '');
  if (cv) ctx.drawImage(cv, x, y - PLAYER_PAD);

  drawNametag(x + p.w / 2, y - 13, label, skinCol);
  drawWeaponSprite(p, x, y);

  if (p.parryActive) {
    const t = performance.now() / 60;
    ctx.save();
    ctx.strokeStyle = '#66ccff'; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.arc(x + p.w/2, y + p.h/2, p.w + 3, 0, Math.PI*2); ctx.stroke();
    ctx.strokeStyle = '#cceeff'; ctx.globalAlpha = 0.5;
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

// Held weapons are drawn a size up so they stay in proportion with the bigger
// 16x22 characters.
const HELD_SCALE = 1.2;

function drawWeaponSprite(p, px, py) {
  const wId = p.weaponId;
  if (!WEAPON_ART[wId]) return;
  const wc = WEAPON_COLOR[wId] || PAL.white;
  const d = p.facing;
  const hx = d === 1 ? px + p.w - 2 : px + 2;   // hand attachment (the front glove)
  const hy = py + 15;
  const prog = p.swingTimer > 0 ? 1 - Math.min(1, p.swingTimer / 200) : -1;
  const u = upgScale(p.upg);
  // Range upgrades lengthen the weapon itself, quantised so the sprite cache
  // does not grow a new bitmap for every possible level combination.
  const scale = HELD_SCALE * (1 + u.rng * 0.045);

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

  // A damage-upgraded weapon carries a hot sheen along its length.
  if (u.dmg >= 2) {
    const box = WEAPON_ART[wId].box;
    ctx.save();
    ctx.globalAlpha = Math.min(0.5, 0.1 + u.dmg * 0.035);
    ctx.fillStyle = u.dmg >= 7 ? '#ffd8a0' : '#ffffff';
    ctx.fillRect(box.x * scale, -1.2 * scale, box.w * scale, 2.4 * scale);
    ctx.restore();
  }

  drawWeaponPixels(ctx, wId, scale, wc);

  // Range trim: a notch per level on the grip, a visible tally of the upgrade.
  if (u.rng) {
    ctx.fillStyle = '#ffd24a';
    for (let i = 0; i < u.rng; i++) ctx.fillRect(1 + i * 1.6, -2.6, 1, 1.4);
  }
  ctx.restore();
}

// ─── Monsters ─────────────────────────────────────────────────────────────────

// Each monster type gets its own silhouette and palette, so what a thing is — and
// roughly how hard it hits — is readable at a glance, not just from its size.
function drawMonster(m) {
  const type = m.type || 'grunt';
  const state = m.hitFlash > 0 ? 'flash' : (m.slowed ? 'slow' : 'base');
  const x = Math.round(m.x), y = Math.round(m.y);

  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.fillRect(x + 1, y + m.h, m.w - 2, 2);

  const cv = monsterSprite(type, m.w, m.h, state);
  if (cv) {
    const pad = monsterPad(m.w, m.h);
    ctx.drawImage(cv, x - pad, y - pad);
  }
  drawMonsterArms(m, x, y);

  drawHpBar(x - 1, y - 5, m.w + 2, 2, m.hp / m.maxHp, '#44ff44', '#003300');
  // Armoured types get a marker on the bar, since their health drains slowly.
  if (m.armor > 0) {
    ctx.fillStyle = '#c9d7ea';
    ctx.fillRect(x - 1, y - 8, Math.max(2, Math.round((m.w + 2) * m.armor)), 2);
  }
}
function drawMonsters(ms) { for(const m of ms) drawMonster(m); }

// What each monster carries and how it uses it. `size` is the weapon's scale per
// 12px of monster height, `rest` the idle tilt (negative = raised), and `move`
// the attack animation: chop/slam arc over, stab/thrust lunge forward, cast
// recoils like a shot.
const MONSTER_ARMS = {
  grunt:    { art: 'm_club',     color: '#7a5230', size: 0.75, rest: -0.5,  move: 'chop'   },
  runner:   { art: 'm_shiv',     color: '#b3ad98', size: 0.8,  rest:  0.3,  move: 'stab'   },
  brute:    { art: 'm_maul',     color: '#8a867c', size: 0.66, rest: -1.0,  move: 'slam'   },
  spitter:  { art: 'm_venom',    color: '#8ee04a', size: 0.68, rest: -1.15, move: 'cast'   },
  warden:   { art: 'm_pike',     color: '#c9d4e2', size: 0.6,  rest: -0.85, move: 'thrust', shield: '#7f93b8' },
  behemoth: { art: 'm_greataxe', color: '#b3203a', size: 0.64, rest: -1.05, move: 'slam'   },
};
// Weapons grow slower than bodies, so a giant's axe stays a weapon, not scenery.
const monsterArmScale = (h, size) => Math.max(0.5, Math.round(Math.pow(h / 12, 0.65) * size * 10) / 10);
const MONSTER_SWING_MS = 320;   // mirrors the server

// Attack angle offset for a swing `prog` 0..1: a short wind-up, a fast strike
// past the rest pose, then a slower recovery.
function monsterSwingAngle(prog, amp) {
  if (prog < 0.18) return -amp * 0.55 * (prog / 0.18);
  if (prog < 0.38) return -amp * 0.55 + amp * 1.55 * ((prog - 0.18) / 0.2);
  return amp * (1 - (prog - 0.38) / 0.62);
}

function drawMonsterArms(m, x, y) {
  const arms = MONSTER_ARMS[m.type || 'grunt'];
  if (!arms) return;
  const d = m.face === -1 ? -1 : 1;
  // Weapons scale with the body, quantised so the sprite cache stays small.
  const scale = monsterArmScale(m.h, arms.size);
  const prog = m.swing > 0 ? 1 - Math.min(1, m.swing / MONSTER_SWING_MS) : -1;
  const bob = Math.sin(performance.now() / 280 + (Number(m.id) || 0)) * 0.05;
  const flash = m.hitFlash > 0 ? '#ffffff' : arms.color;

  // The warden's shield rides on its front, with the pike held over it.
  if (arms.shield) {
    ctx.save();
    ctx.translate(Math.round(x + m.w / 2 + d * m.w * 0.38), Math.round(y + m.h * 0.6));
    ctx.scale(d, 1);
    if (prog >= 0) ctx.translate(Math.sin(prog * Math.PI) * 1.5, 0);   // shield bash
    drawWeaponPixels(ctx, 'm_shield', monsterArmScale(m.h, 0.8),
                     m.hitFlash > 0 ? '#ffffff' : arms.shield);
    ctx.restore();
  }

  ctx.save();
  const hx = arms.shield ? x + m.w / 2 + d * m.w * 0.2 : (d === 1 ? x + m.w - 1 : x + 1);
  ctx.translate(Math.round(hx), Math.round(y + m.h * (arms.shield ? 0.5 : 0.55)));
  ctx.scale(d, 1);
  let ang = arms.rest + bob;
  if (prog >= 0) {
    const kick = Math.sin(prog * Math.PI);
    switch (arms.move) {
      case 'chop':   ang += monsterSwingAngle(prog, 1.3); break;
      case 'slam':   ang += monsterSwingAngle(prog, 1.9); break;
      case 'stab':   ctx.translate(kick * m.w * 0.5, 0); ang = arms.rest * (1 - kick); break;
      case 'thrust': ctx.translate(kick * m.w * 0.6, 0); ang = arms.rest * (1 - kick); break;
      case 'cast':   ctx.translate(-kick * 2, 0); ang -= kick * 0.35; break;
    }
  }
  ctx.rotate(ang);
  drawWeaponPixels(ctx, arms.art, scale, flash);
  ctx.restore();
}

// ─── Projectiles ──────────────────────────────────────────────────────────────

// A range-upgraded weapon throws a visibly bigger, longer-tailed shot; a damage
// upgrade makes it denser. Returns { size, trail, weight } multipliers.
function upgScale(upg) {
  const rng = upg?.rng || 0, dmg = upg?.dmg || 0;
  return {
    size:   1 + rng * 0.085,
    trail:  1 + rng * 0.30,
    weight: 1 + dmg * 0.055,
    rng, dmg,
  };
}

function drawProjectiles(projs) {
  const now = performance.now();
  for (const pr of projs) {
    const wc = WEAPON_COLOR[pr.weaponId] || PAL.white;
    const ang = Math.atan2(pr.dy, pr.dx);
    const u = upgScale(pr.upg);

    // Spitter venom: a monster's shot, not a player's weapon.
    if (pr.weaponId === 'spit') {
      ctx.save();
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#a65cd0';
      ctx.beginPath(); ctx.arc(pr.x - pr.dx, pr.y - pr.dy, 6, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = '#7d3fa8';
      ctx.beginPath(); ctx.arc(pr.x, pr.y, 4, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#d6ff5c';
      ctx.beginPath(); ctx.arc(pr.x - 0.8, pr.y - 1, 1.8, 0, Math.PI*2); ctx.fill();
      ctx.restore();
      continue;
    }

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
      ctx.beginPath(); ctx.arc(pr.x, pr.y, 7 * u.size, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 0.5; ctx.strokeStyle = wc; ctx.lineWidth = 2 * u.weight;
      ctx.beginPath(); ctx.moveTo(pr.x, pr.y);
      ctx.lineTo(pr.x - pr.dx*3*u.trail, pr.y - pr.dy*3*u.trail); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillStyle = wc;
      ctx.beginPath(); ctx.arc(pr.x, pr.y, 3.5 * u.size, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(pr.x-1, pr.y-1, 1.3 * u.size, 0, Math.PI*2); ctx.fill();
      // Range trim: a ring per level, so the upgrade is legible mid-flight.
      if (u.rng) {
        ctx.globalAlpha = 0.5; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(pr.x, pr.y, 5 * u.size + u.rng * 0.7, 0, Math.PI*2); ctx.stroke();
      }
      ctx.restore();
      continue;
    }

    if (pr.weaponId === 'bow' || pr.weaponId === 'crossbow') {
      const long = pr.weaponId === 'crossbow';
      ctx.save();
      ctx.translate(pr.x, pr.y); ctx.rotate(ang);
      const L = (long ? 11 : 9) * u.trail;
      ctx.fillStyle = long ? '#7a4a20' : '#8a6a3a';
      ctx.fillRect(-L, -0.6 * u.weight, L, 1.3 * u.weight);
      ctx.fillStyle = long ? '#cfd8e2' : '#aaddff';
      ctx.beginPath(); ctx.moveTo(4 * u.size, 0);
      ctx.lineTo(-1, -1.9 * u.size); ctx.lineTo(-1, 1.9 * u.size); ctx.fill();
      ctx.fillStyle = '#dfe6ee';
      ctx.beginPath(); ctx.moveTo(-L,-2.1); ctx.lineTo(-L*0.62,-0.4); ctx.lineTo(-L,0); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-L, 2.1); ctx.lineTo(-L*0.62, 0.4); ctx.lineTo(-L,0); ctx.fill();
      ctx.restore();
    } else if (pr.weaponId === 'staff') {
      ctx.save();
      ctx.globalAlpha = 0.45; ctx.fillStyle = wc;
      ctx.beginPath(); ctx.arc(pr.x,pr.y,7*u.size,0,Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = wc;
      ctx.beginPath(); ctx.arc(pr.x,pr.y,3.6*u.size*u.weight,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#ffe6ff';
      ctx.beginPath(); ctx.arc(pr.x-1,pr.y-1,1.5,0,Math.PI*2); ctx.fill();
      ctx.restore();
    } else if (pr.weaponId === 'wand') {
      ctx.save();
      ctx.globalAlpha = 0.45; ctx.fillStyle = wc;
      ctx.beginPath(); ctx.arc(pr.x,pr.y,4.5*u.size,0,Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = '#eaf9ff';
      ctx.beginPath(); ctx.arc(pr.x,pr.y,2*u.size*u.weight,0,Math.PI*2); ctx.fill();
      ctx.restore();
    } else if (pr.weaponId === 'chakram') {
      ctx.save();
      ctx.translate(pr.x, pr.y); ctx.rotate(now/40);
      ctx.strokeStyle = wc; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0,0,4.5,0,Math.PI*2); ctx.stroke();
      ctx.fillStyle = '#ffffff';
      for (let i=0;i<4;i++){ const a=i*Math.PI/2; ctx.fillRect(Math.round(Math.cos(a)*5)-1, Math.round(Math.sin(a)*5)-1, 2, 2); }
      ctx.restore();
    } else if (pr.weaponId === 'shuriken') {
      // Four-point throwing star, spinning.
      ctx.save();
      ctx.translate(Math.round(pr.x), Math.round(pr.y)); ctx.rotate(now / 35);
      ctx.fillStyle = '#6a7482';
      ctx.fillRect(-1.5, -1.5, 3, 3);
      ctx.fillStyle = wc;
      for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath(); ctx.moveTo(1, -1.5); ctx.lineTo(5.5 * u.size, 0); ctx.lineTo(1, 1.5); ctx.fill();
      }
      ctx.fillStyle = '#14141c'; ctx.fillRect(-0.5, -0.5, 1, 1);
      ctx.restore();
    } else if (pr.weaponId === 'frostrod') {
      // Ice shard with a frosty trail.
      ctx.save();
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#cfefff';
      for (let i = 1; i <= 3; i++) ctx.fillRect(Math.round(pr.x - pr.dx * i * 1.4 * u.trail) - 1, Math.round(pr.y - pr.dy * i * 1.4 * u.trail) - 1, 2, 2);
      ctx.globalAlpha = 1;
      ctx.translate(pr.x, pr.y); ctx.rotate(ang);
      ctx.fillStyle = wc;
      ctx.beginPath(); ctx.moveTo(6 * u.size, 0); ctx.lineTo(0, -2.6 * u.size); ctx.lineTo(-4, 0); ctx.lineTo(0, 2.6 * u.size); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(5 * u.size, 0); ctx.lineTo(0, -1.4 * u.size); ctx.lineTo(-1, 0); ctx.fill();
      ctx.restore();
    } else if (pr.weaponId === 'blunderbuss') {
      // Small lead pellet with a short spark streak.
      ctx.save();
      ctx.globalAlpha = 0.55; ctx.strokeStyle = '#ffcf7a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pr.x, pr.y); ctx.lineTo(pr.x - pr.dx * 1.2 * u.trail, pr.y - pr.dy * 1.2 * u.trail); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillStyle = '#3a3a44';
      ctx.fillRect(Math.round(pr.x) - 1, Math.round(pr.y) - 1, 3, 3);
      ctx.fillStyle = '#8a8a96'; ctx.fillRect(Math.round(pr.x) - 1, Math.round(pr.y) - 1, 1, 1);
      ctx.restore();
    } else if (pr.weaponId === 'stormtome') {
      // Crackling ball of lightning.
      ctx.save();
      ctx.globalAlpha = 0.35; ctx.fillStyle = wc;
      ctx.beginPath(); ctx.arc(pr.x, pr.y, 6 * u.size, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = '#fff6b0'; ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        const a = now / 60 + i * 2.1;
        ctx.beginPath(); ctx.moveTo(pr.x, pr.y);
        ctx.lineTo(pr.x + Math.cos(a) * 3, pr.y + Math.sin(a * 1.3) * 3);
        ctx.lineTo(pr.x + Math.cos(a + 0.5) * 6, pr.y + Math.sin(a + 0.5) * 6);
        ctx.stroke();
      }
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(pr.x, pr.y, 2.2 * u.size, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (pr.weaponId === 'cannon') {
      ctx.save();
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#ffb066';
      ctx.beginPath(); ctx.arc(pr.x - pr.dx*u.trail, pr.y - pr.dy*u.trail, 6*u.size, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = '#25252c';
      ctx.beginPath(); ctx.arc(pr.x,pr.y,4*u.size*u.weight,0,Math.PI*2); ctx.fill();
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
    } else if (p.type==='newtype') {
      const m=p.max||2200, a=Math.min(1, p.timer/m*2.5);
      ctx.globalAlpha=a; ctx.font='bold 13px "Courier New",monospace';
      ctx.textBaseline='middle'; ctx.textAlign='center';
      ctx.fillStyle='#000'; ctx.fillText(p.text,p.x+2,p.y+2);
      ctx.fillStyle=p.color||'#ff6644'; ctx.fillText(p.text,p.x,p.y);
      ctx.textAlign='left'; ctx.textBaseline='alphabetic'; ctx.globalAlpha=1;
    } else if (p.type==='waveclear') {
      ctx.globalAlpha=Math.min(1,p.timer/2500*3);
      ctx.fillStyle=PAL.xp; ctx.font='bold 18px "Courier New",monospace';
      ctx.textBaseline='middle'; ctx.textAlign='center';
      ctx.fillStyle='#000'; ctx.fillText(p.text,p.x+2,p.y+2);
      ctx.fillStyle=PAL.xp; ctx.fillText(p.text,p.x,p.y);
      ctx.textAlign='left'; ctx.textBaseline='alphabetic'; ctx.globalAlpha=1;
    } else if (p.type==='crit') {
      const m=p.max||600, a=Math.max(0,p.timer/m), rise=(1-a)*12;
      ctx.globalAlpha=a; ctx.fillStyle='#ff5a3a';
      pixelText(p.text||'CRIT', Math.round(p.x-8), Math.round(p.y-rise));
      ctx.globalAlpha=1;
    } else if (p.type==='bolt') {
      // Jagged lightning, re-rolled every frame so it flickers.
      const m=p.max||300, a=Math.max(0,p.timer/m);
      const segs = 7, dx=(p.x2-p.x)/segs, dy=(p.y2-p.y)/segs;
      const len = Math.hypot(p.x2-p.x, p.y2-p.y) || 1, nx = -(p.y2-p.y)/len, ny = (p.x2-p.x)/len;
      const pts = [[p.x, p.y]];
      for (let i=1;i<segs;i++) { const j=(Math.random()-0.5)*9; pts.push([p.x+dx*i+nx*j, p.y+dy*i+ny*j]); }
      pts.push([p.x2, p.y2]);
      ctx.save();
      for (const [w, c, al] of [[4, p.color||'#ffe45a', 0.35], [1.5, '#ffffff', 1]]) {
        ctx.globalAlpha = a*al; ctx.strokeStyle = c; ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
        for (const [x, y] of pts) ctx.lineTo(x, y);
        ctx.stroke();
      }
      ctx.globalAlpha = a; ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(p.x2, p.y2, 3 + (1-a)*5, 0, Math.PI*2); ctx.fill();
      ctx.restore();
    } else if (p.type==='streak') {
      // Lance dash: a fading wake along the charge line.
      const m=p.max||300, a=Math.max(0,p.timer/m);
      ctx.save();
      ctx.globalAlpha = a*0.35; ctx.strokeStyle = p.color||'#ffffff'; ctx.lineWidth = 12*a + 2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x2, p.y2); ctx.stroke();
      ctx.globalAlpha = a; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x2, p.y2); ctx.stroke();
      ctx.restore();
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
      // The power-up's name floats up from where it was picked up / used.
      if (p.text) {
        ctx.globalAlpha = Math.min(1, a * 1.6);
        ctx.font = 'bold 13px "Courier New",monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round';
        const ty = Math.round(p.y - 26 - (1 - a) * 22);   // clear of the name tag
        ctx.strokeText(p.text, Math.round(p.x), ty);
        ctx.fillStyle = p.color || '#fff';
        ctx.fillText(p.text, Math.round(p.x), ty);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      }
      ctx.globalAlpha=1;
    }
  }
}

// ─── HUD (drawn in 480×270 space) ─────────────────────────────────────────────

function drawHUD(state) {
  const p1 = state.players.p1, p2 = state.players.p2;
  const names = state.playerNames || {};
  // The right-hand readout stops short of the music / leave buttons.
  let RX = HUD_W;
  for (const z of hudTouchZones()) if (z.y < 40 && z.x > HUD_W / 2) RX = Math.min(RX, Math.max(HUD_W - 120, z.x - 2));

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
    ctx.fillStyle = '#000'; ctx.fillText(names.p2 || 'P2', RX - 3, 3);
    ctx.fillStyle = col;    ctx.fillText(names.p2 || 'P2', RX - 4, 2);
    ctx.textAlign = 'left';
    drawHpBar(RX - 80, 15, 74, 5, p2.hp / p2.maxHp, col, '#330000');
    for (let i = 0; i < (p2.lives || 0); i++) { ctx.fillStyle = col; ctx.fillRect(RX - 9 - i*7, 21, 5, 3); }
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
    const bx = myNum === 1 ? 4 : RX - 4 - barW;
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

  // XP and coins live in the top bar beside your own health, so the bottom edge
  // belongs to the weapon rack alone.
  const right = myNum === 2;
  const ax = right ? RX - 86 : 86;
  ctx.font = '8px "Courier New",monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = right ? 'right' : 'left';
  const xpT = 'XP ' + shortNum(state.xp || 0);
  ctx.fillStyle = '#000'; ctx.fillText(xpT, ax + 1, 4);
  ctx.fillStyle = PAL.xp; ctx.fillText(xpT, ax, 3);
  // A drawn coin rather than a glyph — Courier has no dependable coin character.
  const cn = shortNum(state.myCoins || 0);
  const cw = ctx.measureText(cn).width;
  const coinX = right ? ax - cw - 6 : ax + 3;
  drawCoinIcon(coinX, 18, 3);
  ctx.fillStyle = '#000';   ctx.fillText(cn, (right ? ax : ax + 9) + 1, 15);
  ctx.fillStyle = PAL.coin; ctx.fillText(cn, right ? ax : ax + 9, 14);
  ctx.textAlign = 'left'; ctx.font = '10px "Courier New",monospace';
}

// Compact numbers for the HUD (12,345 · 1.2M · 3.4B ...), so a huge XP total
// can't run into the wave counter.
function shortNum(n) {
  if (n < 100000) return Math.floor(n).toLocaleString();
  const units = [[1e18, 'Qi'], [1e15, 'Q'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [v, u] of units) {
    if (n >= v) { const x = n / v; return (x >= 100 ? Math.floor(x) : x.toFixed(1).replace(/\.0$/, '')) + u; }
  }
  return String(Math.floor(n));
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

  // The rack must fit the free strip along the bottom: the whole width on a
  // desktop, or the gap between the d-pad and the action buttons on a phone.
  // Slots shrink to fit, and wrap onto more rows only if they'd get too small.
  let L = 6, R = HUD_W - 6, bottom = HUD_H, lowestTop = HUD_H;
  for (const z of hudTouchZones()) {
    if (z.y + z.h < HUD_H - 70 || z.y > HUD_H) continue; // not over the bottom edge
    if (z.x > HUD_W || z.x + z.w < 0) continue;          // beside the canvas, not on it
    if (z.x + z.w / 2 < HUD_W / 2) L = Math.max(L, z.x + z.w + 2);
    else                           R = Math.min(R, z.x - 2);
    lowestTop = Math.min(lowestTop, z.y - 2);
  }
  // Too little room between the buttons: go full width, but sit above them
  // rather than underneath.
  if (R - L < 150) { L = 6; R = HUD_W - 6; bottom = lowestTop; }
  const avail = R - L, gap = 2, slotH = 22;
  let rows = 1, slotW = 0;
  for (; rows <= 4; rows++) {
    slotW = Math.min(26, Math.floor((avail + gap) / Math.ceil(n / rows)) - gap);
    if (slotW >= 18) break;
  }
  rows = Math.min(rows, 4);
  slotW = Math.max(14, slotW);
  const perRow = Math.ceil(n / rows);
  const rowW = (cnt) => cnt * (slotW + gap) - gap;
  const panelW = rowW(Math.min(n, perRow));
  const panelH = rows * slotH + (rows - 1) * gap;
  const midX = (L + R) / 2;
  const panelX = Math.round(midX - panelW / 2);
  const panelY = bottom - panelH - 4;

  // Never hide your own character: if you walk behind the rack, it turns
  // see-through.
  const me = myNum === 1 ? state.players?.p1 : state.players?.p2;
  let alpha = 1;
  if (me && !me.dead) {
    const px = me.x / HUD_SCALE, py = (me.y - PLAYER_PAD) / HUD_SCALE;
    const pw = me.w / HUD_SCALE, ph = (me.h + PLAYER_PAD) / HUD_SCALE;
    if (px + pw > panelX - 6 && px < panelX + panelW + 6 && py + ph > panelY - 6) alpha = 0.3;
  }
  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.fillStyle='rgba(0,0,0,0.72)';
  ctx.fillRect(panelX-4, panelY-3, panelW+8, panelH+6);

  if (!isTouchDevice) drawControlHints(panelX, panelY, panelW);

  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / perRow), col = i % perRow;
    const cnt = Math.min(perRow, n - row * perRow);
    const rx = Math.round(midX - rowW(cnt) / 2);
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
    drawWeaponPixelsFitted(ctx, wId, sx + slotW/2, sy + 8.5, slotW - 4, 13, wc);
    ctx.restore();
    ctx.save();
    ctx.font='7px "Courier New",monospace'; ctx.textBaseline='bottom'; ctx.textAlign='center';
    ctx.fillStyle = sel ? wc : '#4c4c5a';
    const label = wId.slice(0, slotW >= 22 ? 4 : 3).toUpperCase();
    ctx.fillText(label, sx + slotW/2, sy + slotH - 1);
    ctx.restore();
  }
  ctx.restore();
}

// Where the on-screen touch buttons sit, in HUD space, measured from the live
// page layout (refreshed twice a second) so the HUD can keep clear of them on
// any phone and in any orientation.
let touchZones = [], touchZonesAt = -1e9;
function hudTouchZones() {
  const now = performance.now();
  if (now - touchZonesAt < 500) return touchZones;
  touchZonesAt = now;
  touchZones = [];
  const cr = canvas.getBoundingClientRect();
  if (!cr.width || !cr.height) return touchZones;
  const sx = HUD_W / cr.width, sy = HUD_H / cr.height;
  const add = (el) => {
    const r = el && el.getBoundingClientRect();
    if (!r || !r.width || !r.height) return;
    touchZones.push({ x: (r.left - cr.left) * sx - 3, y: (r.top - cr.top) * sy - 3,
                      w: r.width * sx + 6, h: r.height * sy + 6 });
  };
  // The touch pads and action buttons (phones), and the music / leave buttons.
  const tc = document.getElementById('touchControls');
  if (tc && tc.classList.contains('visible')) {
    for (const el of tc.querySelectorAll('.dpad, .action-btns')) add(el);
  }
  const gc = document.getElementById('gameControls');
  if (gc && gc.classList.contains('visible')) add(gc);
  return touchZones;
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
  drawWeaponPixelsFitted(ux, weaponId, W/2, H/2, W-22, H-22, wc);
}
