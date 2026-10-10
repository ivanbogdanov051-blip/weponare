'use strict';

const canvas = document.getElementById('gameCanvas');
// Opaque (the floor fills every pixel) and low-latency: the browser can put frames on
// screen without waiting for the page compositor, which shaves input lag on desktop.
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true }) || canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// World size. The whole arena is always on screen — the canvas backing store is
// the world, and CSS scales it down to fit the device, so a bigger map simply
// means a more zoomed-out view.
let CANVAS_W = 720, CANVAS_H = 405;
const ARENA_X = 12, ARENA_Y = 12;
let ARENA_W = CANVAS_W - ARENA_X * 2, ARENA_H = CANVAS_H - ARENA_Y * 2;

// The HUD is laid out in its own 480×270 space and drawn through a scale, so
// text and bars stay a readable size no matter how big the world gets.
const HUD_W = 480, HUD_H = 270;
let HUD_SCALE = CANVAS_W / HUD_W;
// The room's map size (small / medium / big) sets the world; the canvas is
// resized to it and CSS fits it to the screen.
function applyWorld(world) {
  if (!world || (world.w === CANVAS_W && world.h === CANVAS_H)) return;
  CANVAS_W = world.w; CANVAS_H = world.h;
  ARENA_W = CANVAS_W - ARENA_X * 2; ARENA_H = CANVAS_H - ARENA_Y * 2;
  HUD_SCALE = CANVAS_W / HUD_W;
  canvas.width = CANVAS_W; canvas.height = CANVAS_H;
  ctx.imageSmoothingEnabled = false;
  arenaCache = null;
  pred = null;
}
const KEYS = ['p1', 'p2', 'p3', 'p4'];
const myKeyOf = () => (myNum ? 'p' + myNum : null);

const PAL = {
  bg:'#0a0a14', arena:'#1a1a2e', wall:'#2a2a4a',
  p1:'#4488ff', p2:'#ff6644', p3:'#44dd66', p4:'#ffcc33', monster:'#44cc44',
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
  fireglove:'#ff6a1a', vortex:'#7ad8ff', windwand:'#aef5dc', revolver:'#ffb347', portalwand:'#b07aff', infinitybow:'#9a5aff', endlessscythe:'#7a2aff', samuraiblade:'#ff5a5a', darklight:'#e8e8f4', starfall:'#ffe9a0',
  ghostdagger:'#a8f0ff', stormhammer:'#7ac8ff', frostscythe:'#bfefff', sunbow:'#ffd24a',
  scimitar:'#e8e0c8', slingshot:'#b08a5a', mace:'#9aa4b0', javelin:'#d8c8a0', claws:'#e0e4ec',
  emberstaff:'#ff7a2a', halberd:'#c0c8d8', frostbow:'#9fe8ff', chronostaff:'#e8c87a', voidblade:'#9a5aff',
  mindtome:'#ff5ad8', lightblade:'#fff27a',
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
  fireglove:'Rings of fire, exploding fire hands and a SUPER inferno',
  vortex:'Banks the damage you take, then pays it back',
  windwand:'Gusts that shove foes, tornadoes and a SUPER hurricane',
  revolver:'Every bullet explodes',
  portalwand:"The Portal Mage's own wand: fireballs, portal jumps and a SUPER army of your own monsters",
  infinitybow:"The Abyss's crossbows: one in your hands and two floating beside you",
  endlessscythe:"The Abyss's own scythe, won by beating him a second time",
  samuraiblade:"The samurai's own katana, deeply curved and razor bright",
  darklight:"MYTHIC. A kunai of dark and light, made from three legends",
  starfall:"MYTHIC. A staff crowned with a crescent moon and a captive star",
  ghostdagger:'The rarest weapon of all: turn invisible, throw a deadly dagger, and make it rain knives',
  stormhammer:'A war hammer full of lightning that comes back when you throw it',
  frostscythe:'A sweeping scythe of ice that freezes whatever it keeps cutting',
  sunbow:'Arrows of sunlight, a little sun that fights for you, and a beam that burns across the arena',
  scimitar:'Quick curved cuts, dash special', slingshot:'Stones that knock foes back',
  mace:'Heavy blows that stun', javelin:'Piercing long throw', claws:'Rapid slashes that heal you',
  emberstaff:'Fiery blasts that burn', halberd:'Huge reach, knockback, dash special', frostbow:'Piercing ice arrows that slow',
  chronostaff:'Bend time: freeze foes in place and rewind your own wounds',
  voidblade:'A blade of the void: waves on every swing, rift steps and a SUPER singularity',
  mindtome:'A book of mind power: set traps under your enemies, lock their minds, and take one over',
  lightblade:'A blade of pure light: dash wherever you click or tap, hunt foes in a chain of dashes, and go LIGHTSPEED',
};

// Filled from the server catalog: { id: {type, atkSpd, ...} }
let WEAPON_META = {};
let ABILITY_DEFS = [];    // from the server: { id, name, price, cd, color, desc }
function abilityDef(id) { return ABILITY_DEFS.find(a => a.id === id) || null; }
function isRanged(id) { return WEAPON_META[id] ? WEAPON_META[id].type === 'ranged' : false; }

// ─── Skins ────────────────────────────────────────────────────────────────────

const SKIN_COLORS = ['#4488ff','#ff4444','#44cc44','#aa44ff','#ff8833','#44ddee','#ff44aa','#ffcc00',
                     '#a6e22e','#14b8a6','#2a4ab0','#a02840','#ff9ec8','#7ac8ff','#8fffc0','#8a5a34',
                     '#f0f0f8','#34343e','#aab4c4','#d6249f','#808a1e','#ff6f61','#d01030','#5b3df5'];
const SKIN_HATS   = ['NONE','CAP','CROWN','HORNS','SPIKY','TOP HAT','PARTY','HALO','CHEF','COWBOY','BEANIE','ANTLERS','BUNNY','FLOWERS','HEADSET'];
const SKIN_ACCS   = ['NONE','GLASSES','SHADES','MASK','SCARF','BOWTIE','MEDAL','CAPE','WINGS','BACKPACK'];

function lsGet(k)      { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v)   { try { localStorage.setItem(k, v); } catch {} }

function loadLocalSkin() {
  try { return { colorIdx: 0, hatIdx: 0, accIdx: 0, outfit: '', ...(JSON.parse(lsGet('weponare_skin')) || {}) }; }
  catch { return { colorIdx: 0, hatIdx: 0, accIdx: 0, outfit: '' }; }
}
function saveLocalSkin(s)  { lsSet('weponare_skin', JSON.stringify(s)); }
function loadLocalXp(pw)   { return pw ? (parseInt(lsGet('weponare_xp_' + pw)) || 0) : 0; }
function saveLocalXp(pw, xp) { if (pw) lsSet('weponare_xp_' + pw, String(xp)); }
function loadLocalCoins(pw) { return pw ? (parseInt(lsGet('weponare_coins_' + pw)) || 0) : 0; }
function saveLocalCoins(pw, c) { if (pw) lsSet('weponare_coins_' + pw, String(c)); }
// A full copy of this password's save (weapons, upgrades, skins, coins, XP),
// signed by the server and kept on this device. If the server ever loses its
// save file — the host wipes it on every update — it restores from this copy.
function loadBackup(pw) { if (!pw) return null; try { return JSON.parse(lsGet('weponare_save_' + pw)); } catch { return null; } }
function storeBackup(pw, save) { if (pw && save && save.data && save.sig) lsSet('weponare_save_' + pw, JSON.stringify(save)); }

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

// Incoming snapshots wait here (raw text) until the next frame handles them.
const stateInbox = [];
let handleMessage = () => {};
let chatSolo = null;
// Shown with F3: what the connection is doing right now.
const netStats = { ping: 0, bytes: 0, dropped: 0, kbps: 0, fps: 0, frames: 0, since: 0 };
let netOverlay = (() => { try { return localStorage.getItem('weponare_fps') === '1'; } catch { return false; } })();
function toggleNetOverlay() {
  netOverlay = !netOverlay;
  try { localStorage.setItem('weponare_fps', netOverlay ? '1' : '0'); } catch {}
  syncSettings();
}
function drainStates() {
  if (!stateInbox.length) return;
  // Behind? Keep only the newest two (enough to blend between).
  const batch = stateInbox.splice(0);
  if (batch.length > 2) netStats.dropped += batch.length - 2;
  for (const raw of batch.slice(-2)) {
    let msg; try { msg = JSON.parse(raw); } catch { continue; }
    handleMessage(msg);
  }
  // Tell the server how fresh our picture is, so it never queues more than the
  // link and this page can actually take.
  if (currState && Number.isFinite(currState.st) && ws && ws.readyState === 1) {
    ws.send('{"type":"ack","st":' + currState.st + '}');
  }
}

// Snapshot timeline. Each state carries the server's clock (st); everyone but
// you is drawn a short, steady delay behind the newest one, blended between the
// two snapshots around that moment. A server or link that delivers in clumps
// (a busy shared host stalls, then sends three at once) then plays back
// smoothly instead of freezing and jumping.
const snaps = [];            // [{ s: msg, st }], oldest first
let clockOffset = null;      // local time − server time, from the least-delayed arrival
let lateMs = 0;              // how late snapshots have recently been, beyond that
let viewDelay = 60;          // smoothed render delay (ms)
function pushSnapshot(msg, nowT) {
  const st = Number.isFinite(msg.st) ? msg.st : null;
  if (st === null) { snaps.length = 0; return; }
  const off = nowT - st;
  // Track the fastest arrival; creep up slowly so a clock or route change is followed.
  if (clockOffset === null || off < clockOffset) clockOffset = off; else clockOffset += 0.05;
  const late = Math.min(250, off - clockOffset);
  lateMs = late > lateMs ? late : lateMs + (late - lateMs) * 0.03;
  if (snaps.length && st <= snaps[snaps.length - 1].st) snaps.length = 0;   // server restarted / clock jumped
  snaps.push({ s: msg, st });
  while (snaps.length > 2 && snaps[1].st < st - 1000) snaps.shift();
}
// The pair of snapshots around render time, and how far between them it is.
function timelineState(now, frameDt) {
  if (snaps.length < 2 || clockOffset === null) return interpState(prevState, currState, Math.min(1, (now - stateRecvTime) / Math.max(SERVER_TICK_MS, stateIntervalMs)));
  const want = Math.max(30, Math.min(300, stateIntervalMs + lateMs + 10));
  viewDelay += (want - viewDelay) * Math.min(1, frameDt / 400);
  const rt = now - clockOffset - viewDelay;
  let i = snaps.length - 2;
  while (i > 0 && snaps[i].st > rt) i--;
  const a = snaps[i], b = snaps[i + 1];
  const t = Math.max(0, Math.min(1, (rt - a.st) / Math.max(1, b.st - a.st)));
  return interpState(a.s, b.s, t);
}

let pendingName = 'PLAYER', pendingMode = 'pvp', pendingPass = '', pendingBotLevel = 'average';
let pendingMapSize = lsGetSafe('weponare_map') || 'medium', pendingRoom = {};
function lsGetSafe(k) { try { return localStorage.getItem(k); } catch { return null; } }
function escapeHtml(t) { return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
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
  try { return await refreshSavedBanner0(); } finally { fitMenu(); }
}
async function refreshSavedBanner0() {
  const el = document.getElementById('savedInfo');
  if (!el) return;
  const pw = (document.getElementById('passInput')?.value || '').trim();
  if (!pw) {
    menuXp = 0; syncModeLocks();
    el.innerHTML = '<span style="color:#555">No password — progress will not be saved</span>';
    return;
  }
  menuXp = loadLocalXp(pw) || 0; syncModeLocks();
  el.innerHTML = '<span style="color:#555">Loading save...</span>';
  try {
    const res = await fetch('/api/profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw, localXp: loadLocalXp(pw), localCoins: loadLocalCoins(pw), backup: loadBackup(pw) }),
    });
    if (!res.ok) { el.innerHTML = '<span style="color:#555">Save unavailable</span>'; return; }
    const d = await res.json();
    storeBackup(pw, d.save);
    applyCatalog(d.catalog, d.colors);
    saveLocalCoins(pw, d.coins);
    saveLocalXp(pw, d.xp);
    menuXp = d.xp || 0; syncModeLocks();
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
  if (mode !== 'create' && mode !== 'joinroom') pendingRoom = {};
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
  if (btn) { btn.textContent = m ? 'OFF' : 'ON'; btn.classList.toggle('on', !m); }
}

function updateMusicButtons(info) {
  const sb = document.getElementById('musicBtn');
  if (sb) sb.textContent = (info.idx + 1) + '/' + info.count + ': ' + info.name;
  const gb = document.getElementById('musicBtnGame');
  if (gb) gb.innerHTML = '♫ ' + (info.idx + 1) + '/' + info.count;
}

function cycleMusic() {
  if (!window.GameAudio) return;
  GameAudio.init();
  updateMusicButtons(GameAudio.changeTrack());
  GameAudio.preview();   // from the menu: a few seconds of the new track (no-op mid-match)
}

let leaving = false, returningToMenu = false;
function leaveGame() {
  leaving = true;
  showRareShop({ open: false });
  tutorialLeft();
  document.getElementById('tutPanel')?.classList.add('hidden');
  toggleChat(false);
  toggleSandboxPanel(false);
  if (window.GameAudio) GameAudio.stopMusic();
  if (ws) { try { ws.close(); } catch {} }
  showGameControls(false);
  showScreen('startScreen');
}

// Back to the title screen from the connecting / waiting-for-opponent screen
// or an error. Works whether the connection is still opening, open, or gone.
// ── Invite links & installing ──
// A room's link is the game's address plus ?room=<id>: opening it shows a JOIN
// button for that room (the name and password are still the visitor's own).
let invite = null;
function inviteUrl() { return location.origin + location.pathname + '?room=' + encodeURIComponent(invite.id); }
async function shareInvite() {
  if (!invite) return;
  const url = inviteUrl(), msgEl = document.getElementById('inviteMsg');
  const say = t => { if (msgEl) { msgEl.style.display = ''; msgEl.textContent = t; } };
  try {
    if (navigator.share) { await navigator.share({ title: 'WEPONARE', text: 'Join my room "' + invite.name + '" on WEPONARE!', url }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); say('LINK COPIED - SEND IT TO YOUR FRIENDS'); }
  catch { say(url); }
}
function syncInviteButton() {
  const on = !!invite && document.getElementById('lobbyScreen')?.classList.contains('active');
  const b = document.getElementById('inviteBtn');
  if (b) b.style.display = on ? '' : 'none';
  if (!on) { const m = document.getElementById('inviteMsg'); if (m) m.style.display = 'none'; }
}
setInterval(syncInviteButton, 400);

// Opened from an invite link: look the room up and offer to join it.
let invitedRoom = null;
async function checkInviteLink() {
  const id = new URLSearchParams(location.search).get('room');
  const box = document.getElementById('inviteBanner');
  if (!id || !box) return;
  try {
    const list = (await (await fetch('/api/rooms')).json()).rooms || [];
    const r = list.find(o => o.id === id);
    if (r) {
      invitedRoom = r;
      box.style.display = '';
      box.innerHTML = 'YOU WERE INVITED TO<br><b>' + escapeHtml(r.name) + '</b><br>' + r.players + '/' + r.maxPlayers + ' PLAYERS<br><button class="mode-btn btn-room" onclick="joinInvited()">JOIN THIS ROOM</button>';
    } else {
      box.style.display = '';
      box.textContent = 'THAT ROOM IS FULL OR HAS ALREADY STARTED';
    }
  } catch {}
  fitMenu();
}
function joinInvited() {
  if (!invitedRoom) return;
  history.replaceState(null, '', location.pathname);
  readCredentials();
  joinRoom(invitedRoom.id, invitedRoom.size);
}
window.addEventListener('load', checkInviteLink);

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); installPrompt = e;
  const b = document.getElementById('installBtn'); if (b) b.style.display = ''; fitMenu();
});
window.addEventListener('appinstalled', () => { installPrompt = null; const b = document.getElementById('installBtn'); if (b) b.style.display = 'none'; });
function installApp() { if (installPrompt) { installPrompt.prompt(); installPrompt = null; } }
if ('serviceWorker' in navigator && location.protocol !== 'file:' && location.hostname !== '10.0.2.2') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// ── First-time tutorial ──────────────────────────────────────────────────────
// A practice game (a gentle sandbox: can't die, weak monsters, three weapons)
// with a panel on top walking through the basics one at a time. Each step is
// ticked off by actually doing it; the explanation steps have a NEXT button.
// The controls shown match the device: keys on a computer, buttons on touch.
let pendingTutorial = false;
const tut = { on: false, i: 0, entered: false, base: null };
const TUT_DONE_KEY = 'weponare_tutorial_done';
function tutorialDone() { try { return localStorage.getItem(TUT_DONE_KEY) === '1'; } catch { return true; } }
function markTutorialDone() { try { localStorage.setItem(TUT_DONE_KEY, '1'); } catch {} }
const kb = (...k) => k.map(x => '<kbd>' + x + '</kbd>').join(' ');
const touchUi = () => isTouchDevice && !mouseAim;
const TUT_STEPS = [
  { title: 'WELCOME!', next: true,
    text: () => 'This quick practice game teaches you the basics. You <b>can\'t lose</b> here, so try everything!' },
  { title: 'MOVE',
    text: () => touchUi() ? 'Drag the <b>joystick</b> on the left of the screen to walk around.'
                          : 'Walk around with ' + kb('W', 'A', 'S', 'D') + ' or the ' + kb('&#8593;', '&#8592;', '&#8595;', '&#8594;') + ' arrow keys.',
    enter: (me) => ({ x: me.x, y: me.y }),
    done: (me, s, b) => Math.hypot(me.x - b.x, me.y - b.y) > 120 },
  { title: 'ATTACK',
    text: () => touchUi() ? 'Tap the big <b>ATK</b> button to swing your weapon.' : 'Press ' + kb('SPACE') + ' to swing your weapon.',
    done: () => currentInputs().attack },
  { title: 'DEFEAT A MONSTER',
    text: () => 'A monster appeared! Walk up to it and attack until it falls. You aim at the nearest enemy automatically.',
    enter: () => { tutSend({ type: 'sandbox', action: 'spawn', what: 'grunt', count: 1 }); return { seen: false }; },
    done: (me, s, b) => { if ((s.monsters || []).length) b.seen = true; return b.seen && !(s.monsters || []).length; } },
  { title: 'SWITCH WEAPONS',
    text: () => (touchUi() ? 'Tap the <b>&lt;</b> / <b>&gt;</b> buttons' : 'Press ' + kb('ENTER') + ' (or ' + kb('Z') + ' for the previous one)')
      + ' to change weapons. Every weapon plays differently: swords swing, bows shoot, staffs blast.',
    enter: (me) => ({ w: me.weaponId }),
    done: (me, s, b) => me.weaponId !== b.w },
  { title: 'SPECIAL ATTACK',
    text: () => (touchUi() ? 'Tap <b>SPECIAL</b>' : 'Press ' + kb('SHIFT')) + ' for your weapon\'s special move. It has to recharge after each use.',
    done: (me) => (me.specialCd || 0) > 0 },
  { title: 'PARRY',
    text: () => (touchUi() ? 'Tap <b>PARRY</b>' : 'Press ' + kb('P') + ' or ' + kb('CTRL')) + ' just before a hit lands to block it and stun the attacker.',
    done: (me) => me.parryActive || (me.parryCd || 0) > 0 },
  { title: 'ITEMS',
    text: () => 'A glowing gem dropped near you. Walk over it to pick it up, then use it: '
      + (touchUi() ? 'tap its <b>slot</b> in the item bar.' : 'press ' + kb('1') + '-' + kb('4') + ' or click its slot in the item bar.')
      + ' You can carry 4.',
    enter: () => { tutSend({ type: 'sandbox', action: 'item', what: 'speed' }); return { had: false }; },
    done: (me, s, b) => { const n = (s.inventory || []).length; if (n) b.had = true; return b.had && !n; } },
  { title: 'FIGHT A FEW MORE',
    text: () => 'Three monsters are coming. Use everything you learned!',
    enter: () => { tutSend({ type: 'sandbox', action: 'spawn', what: 'grunt', count: 3 }); return { seen: false }; },
    done: (me, s, b) => { if ((s.monsters || []).length) b.seen = true; return b.seen && !(s.monsters || []).length; } },
  { title: 'XP, COINS & UPGRADES', next: true,
    text: () => 'Defeating monsters and winning fights gives <b>XP</b> (unlocks new weapons) and <b>coins</b>, which fly to you on their own. '
      + 'Spend coins in <b>UPGRADE WEAPONS</b> and <b>ABILITIES</b>' + (touchUi() ? '' : ' (abilities go on ' + kb('Q') + ' ' + kb('E') + ')') + '. '
      + 'Set a <b>password</b> on the menu so your progress is saved.' },
  { title: 'READY TO PLAY!', next: true, last: true,
    text: () => '<b>PvP</b> or <b>rooms</b>: fight friends. <b>Bot battle</b>: fight a bot. <b>Waves</b> / <b>Extreme</b>: survive monster waves. '
      + '<b>Sandbox</b>: practise anything. You can replay this from <b>HOW TO PLAY</b>.' },
];
function tutSend(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
function startTutorial() {
  readCredentials();
  pendingTutorial = true;
  tut.on = false; tut.i = 0; tut.entered = false;
  pendingRoom = {};
  joinGame('sandbox');
}
function finishTutorial() {
  markTutorialDone();
  pendingTutorial = false;
  tut.on = false;
  document.getElementById('tutPanel')?.classList.add('hidden');
  if (ws && ws.readyState <= 1) leaveGame(); else showScreen('startScreen');
  refreshSavedBanner();
}
function skipTutorial() { finishTutorial(); }
function tutorialNext() {
  const st = TUT_STEPS[tut.i];
  if (st && st.last) { finishTutorial(); return; }
  tut.i++; tut.entered = false;
}
let tutRendered = '';
function tutorialTick() {
  const panel = document.getElementById('tutPanel');
  const s = currState;
  const active = pendingTutorial && s && s.gameState === 'GAMEPLAY' && s.sandbox && s.sandbox.tutorial;
  if (!active) {
    if (panel && !panel.classList.contains('hidden')) panel.classList.add('hidden');
    return;
  }
  const me = s.players && s.players[myKeyOf()];
  if (!me) return;
  const view = pred ? { ...me, x: pred.x, y: pred.y } : me;
  const st = TUT_STEPS[tut.i];
  if (!st) return;
  if (!tut.entered) { tut.entered = true; tut.base = st.enter ? st.enter(view, s) : null; }
  if (!st.next && st.done(view, s, tut.base)) {
    if (window.GameAudio) GameAudio.sfx.pickup();
    tut.i++; tut.entered = false;
    return;
  }
  // Only touch the DOM when what is shown changes.
  const key = tut.i + ':' + touchUi();
  if (panel.classList.contains('hidden')) panel.classList.remove('hidden');
  if (key !== tutRendered) {
    tutRendered = key;
    document.getElementById('tutStep').textContent = 'TUTORIAL ' + (tut.i + 1) + '/' + TUT_STEPS.length;
    document.getElementById('tutTitle').textContent = st.title;
    document.getElementById('tutText').innerHTML = st.text();
    const nb = document.getElementById('tutNext');
    nb.classList.toggle('hidden', !st.next);
    nb.innerHTML = st.last ? 'START PLAYING &#9654;' : 'NEXT &#9654;';
  }
}
// Leaving the tutorial any other way (EXIT, disconnect) also counts as seen.
function tutorialLeft() { if (pendingTutorial) { markTutorialDone(); pendingTutorial = false; } }

// ── Loading screen ──────────────────────────────────────────────────────────
// A short animated scene drawn with the game's own sprites: a hero cutting
// through a line of monsters while coins fly. Shown for a moment on every
// launch; on the very first visit it leads straight into the tutorial.
(function splash() {
  const el = document.getElementById('splash');
  if (!el) return;
  const cv = document.getElementById('splashScene'), g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  const fill = document.getElementById('splashFill'), tipEl = document.getElementById('splashTip');
  const TIPS = ['TIP: PARRY JUST BEFORE A HIT TO STUN THE ATTACKER', 'TIP: SET A PASSWORD TO SAVE YOUR PROGRESS',
                'TIP: COINS FLY TO YOU ON THEIR OWN', 'TIP: EVERY WEAPON HAS A SPECIAL MOVE', 'TIP: CREATE A ROOM AND INVITE YOUR FRIENDS'];
  tipEl.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  const t0 = performance.now(), MIN_MS = 1700;
  let loaded = document.readyState === 'complete';
  window.addEventListener('load', () => { loaded = true; });
  const mons = [{ t: 'grunt', x: 150, w: 23, h: 27 }, { t: 'brute', x: 185, w: 30, h: 34 }, { t: 'runner', x: 222, w: 20, h: 22 }];
  const coins = [];
  let hero = null;
  try { hero = playerSprite('#4488ff', 1, 1, false, '', 7); } catch {}
  function frame(now) {
    const t = (now - t0) / 1000;
    g.fillStyle = '#1a1a2e'; g.fillRect(0, 0, 240, 135);
    g.fillStyle = 'rgba(255,255,255,0.03)';
    for (let y = 0; y < 135; y += 12) for (let x = (y / 12) % 2 ? 12 : 0; x < 240; x += 24) g.fillRect(x, y, 12, 12);
    g.fillStyle = '#2a2a4a'; g.fillRect(0, 0, 240, 6); g.fillRect(0, 129, 240, 6);
    // hero runs right on a loop, monsters scroll toward him
    const loop = t % 4, hx = 30 + Math.sin(t * 1.3) * 6, hy = 84 + Math.abs(Math.sin(t * 9)) * -3;
    for (const m of mons) {
      const mx = ((m.x - loop * 50) % 260 + 260) % 260 - 10;
      const hit = mx - hx < 34 && mx - hx > 10;
      try {
        const sp = monsterSprite(m.t, m.w, m.h, hit ? 'flash' : 'normal');
        if (sp) g.drawImage(sp, Math.round(mx), Math.round(110 - (sp.height || m.h)));
      } catch {}
      if (hit && Math.random() < 0.15) coins.push({ x: mx + 8, y: 90, vx: -1 - Math.random(), vy: -2 - Math.random() * 1.5, life: 1 });
    }
    // Placed exactly as in the game: the body sprite sits 7px above the player's
    // box, the front hand is 14px right and 15px down, and the blade is drawn at
    // 1.2x pointing along +X, resting with a slight tilt and swinging from the hand.
    const px = Math.round(hx), py = Math.round(hy);
    if (hero) g.drawImage(hero, px, py - 7);
    const sw = (t * 2.2) % 1;
    const swing = sw < 0.45 ? -1.3 + (sw / 0.45) * 2.3 : 0.12;   // quick slash, then rest
    if (typeof drawWeaponPixels === 'function') {
      g.save(); g.translate(px + 14, py + 15); g.rotate(swing);
      try { drawWeaponPixels(g, 'sword', 1.2, '#c8d8e8'); } catch {}
      g.restore();
    }
    if (sw < 0.45) {
      g.strokeStyle = 'rgba(232,240,250,' + (0.75 - sw) + ')'; g.lineWidth = 2;
      g.beginPath(); g.arc(px + 14, py + 15, 24, -1.3 + (sw / 0.45) * 2.3 - 0.9, -1.3 + (sw / 0.45) * 2.3); g.stroke();
    }
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i]; c.x += c.vx; c.y += c.vy; c.vy += 0.15; c.life -= 0.02;
      if (c.life <= 0) { coins.splice(i, 1); continue; }
      g.fillStyle = '#ffd24a'; g.fillRect(Math.round(c.x), Math.round(c.y), 3, 3);
    }
    const p = Math.min(1, (now - t0) / MIN_MS) * (loaded ? 1 : 0.85);
    fill.style.width = Math.round(p * 100) + '%';
    if (loaded && now - t0 >= MIN_MS) {
      el.classList.add('gone');
      setTimeout(() => el.remove(), 500);
      afterSplash();
      return;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
// First visit (and not arriving on an invite link): straight into the tutorial.
function afterSplash() {
  if (tutorialDone()) return;
  if (new URLSearchParams(location.search).get('room')) return;
  document.getElementById('tutAskScreen').className = 'overlay active';
}
// YES goes straight into the tutorial; NO just removes the screen (it can
// still be played any time from HOW TO PLAY).
function tutAsk(yes) {
  document.getElementById('tutAskScreen').className = 'overlay hidden';
  if (yes) startTutorial(); else markTutorialDone();
}

// ── Settings (gear on the menu) ──
function syncSettings() {
  const f = document.getElementById('fpsBtn');
  if (f) { f.textContent = netOverlay ? 'ON' : 'OFF'; f.classList.toggle('on', netOverlay); }
}
function openSettings() { syncSettings(); showScreen('settingsScreen'); }
function closeSettings() { showScreen('startScreen'); }

// ── Modes unlock with XP ──
// You start with every multiplayer mode, Waves, Bot Battle and Sandbox;
// EXTREME and then the PORTAL MAGE open up as your saved XP grows.
const MODE_XP = { extreme: 5000, portal: 15000, abyss: 30000 };
let menuXp = 0;
function modeOpen(mode) { return menuXp >= (MODE_XP[mode] || 0); }
function syncModeLocks() {
  for (const [mode, id] of [['extreme', 'modeExtreme'], ['portal', 'modePortal'], ['abyss', 'modeAbyss']]) {
    const b = document.getElementById(id);
    if (!b) continue;
    const open = modeOpen(mode);
    b.classList.toggle('locked', !open);
    const sm = b.querySelector('small');
    if (sm) sm.innerHTML = open ? (mode === 'extreme' ? 'hardest waves' : mode === 'abyss' ? 'final boss' : 'boss fight')
                                : '&#128274; ' + MODE_XP[mode].toLocaleString() + ' XP';
  }
}
function playLocked(mode) {
  const msg = document.getElementById('lockMsg');
  if (!modeOpen(mode)) {
    const pw = (document.getElementById('passInput')?.value || '').trim();
    if (msg) {
      msg.textContent = (mode === 'extreme' ? 'EXTREME' : mode === 'abyss' ? 'THE ABYSS' : 'THE PORTAL MAGE') + ' UNLOCKS AT ' + MODE_XP[mode].toLocaleString()
        + ' XP (YOU HAVE ' + Math.floor(menuXp).toLocaleString() + ')' + (pw ? '' : ' - SET A PASSWORD TO SAVE XP');
      msg.classList.remove('flash'); void msg.offsetWidth; msg.classList.add('flash');
    }
    return;
  }
  if (msg) msg.textContent = '';
  joinGame(mode);
}
syncModeLocks();
syncSettings();

function exitToMenu() {
  tutorialLeft();
  if (ws && ws.readyState <= 1) { leaveGame(); return; }   // connecting or open: close it properly
  if (window.GameAudio) GameAudio.stopMusic();
  showGameControls(false);
  showScreen('startScreen');
  refreshSavedBanner();
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
  stateInbox.length = 0;
  // Snapshots are only queued here and handled once per frame (drainStates):
  // if the page ever falls behind, the stale ones are dropped instead of being
  // played back one by one, seconds late.
  ws.onmessage = (e) => {
    if (typeof e.data === 'string' && e.data.startsWith('{"type":"state"')) {
      netStats.bytes += e.data.length;
      stateInbox.push(e.data);
      if (stateInbox.length > 4) { netStats.dropped += stateInbox.length - 4; stateInbox.splice(0, stateInbox.length - 4); }
      return;
    }
    handleMessage(JSON.parse(e.data));
  };
  handleMessage = (msg) => {
    if (msg.type === 'pong') {
      const sample = performance.now() - msg.t;
      if (sample >= 0 && sample < 2000) rttMs = rttMs * 0.7 + sample * 0.3;
      netStats.ping = sample;
      return;
    }
    if (msg.type === 'save') storeBackup(pendingPass, msg.save);
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
      if (Array.isArray(msg.abilityDefs)) ABILITY_DEFS = msg.abilityDefs;
      if (msg.sandboxDefs) SANDBOX_DEFS = msg.sandboxDefs;
      if (Array.isArray(msg.chatLines)) { CHAT_LINES = msg.chatLines; buildChatPanel(); }
      ws.send(JSON.stringify({
        type: 'join', name: pendingName, mode: pendingMode, password: pendingPass, level: pendingBotLevel,
        size: pendingMapSize, ...pendingRoom, tutorial: pendingTutorial,
        skin: pendingSkin, skinModified,
        localXp: loadLocalXp(pendingPass), localCoins: loadLocalCoins(pendingPass), backup: loadBackup(pendingPass),
      }));
      skinModified = false;
      showGameControls(true);
      setLobbyMsg('Finding a game...');
      document.getElementById('xpDisplay').textContent = '';
    }
    // The server seats us once we've picked a mode: solo modes get a room of
    // their own; PvP / co-op pair us with someone who picked the same mode.
    if (msg.type === 'mode_locked') {
      menuXp = msg.xp || 0;
      leaveGame();
      syncModeLocks();
      playLocked(msg.mode);
      return;
    }
    if (msg.type === 'rareshop') { showRareShop(msg); return; }
    if (msg.type === 'room_gone') {
      setLobbyMsg('That room is full or has already started.');
      setTimeout(() => { leaveGame(); openRoomBrowser(); }, 1600);
    }
    if (msg.type === 'seat') {
      myNum = msg.num;
      invite = null;
      const mode = msg.mode || pendingMode;
      const modeLabel = mode === 'coop' ? 'CO-OP' : (msg.maxPlayers || 2) > 2 ? 'LAST ONE STANDING' : 'PvP';
      if (mode === 'waves') {
        setLobbyMsg(`<span class="p1-color">WAVES MODE</span><br><span style="color:#888">SOLO ENDLESS</span><br>Loading...`);
      } else if (mode === 'extreme') {
        setLobbyMsg(`<span style="color:#ff5a3a">EXTREME MODE</span><br><span style="color:#888">SOLO · STRONGEST MONSTERS · HUGE REWARDS</span><br>Loading...`);
      } else if (mode === 'portal') {
        setLobbyMsg(PORTAL_LOBBY);
      } else if (mode === 'abyss') {
        setLobbyMsg(ABYSS_LOBBY);
      } else if (mode === 'bot') {
        setLobbyMsg(BOT_LOBBY());
      } else {
        setLobbyMsg(myNum === 1
          ? `<span class="p1-color">YOU ARE PLAYER 1</span><br><span style="color:#888">${modeLabel} MODE</span><br>Waiting for opponent...`
          : `<span class="p${myNum}-color">YOU ARE PLAYER ${myNum}</span><br><span style="color:#888">${modeLabel} MODE</span><br>Joining...`);
      }
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
      applyWorld(msg.world);
      const solo = ['waves', 'extreme', 'portal', 'abyss', 'sandbox'].includes(msg.gameMode);   // nobody to talk to in the solo modes
      if (solo !== chatSolo) {
        chatSolo = solo;
        const chatBtn = document.getElementById('chatBtn');
        if (chatBtn) chatBtn.style.display = solo ? 'none' : '';
        if (solo) toggleChat(false);
      }
      for (const k of KEYS) {
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
      pushSnapshot(msg, nowT);
      syncAdminTools(msg);
      syncSandbox(msg);
      updateScreens(msg);
    }
  };
  ws.onclose = () => {
    connected = false;
    currState = null; prevState = null; pred = null; stateRecvTime = 0;
    snaps.length = 0; clockOffset = null; lateMs = 0;
    stateInbox.length = 0; chatSolo = null;
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
    players: Object.fromEntries(KEYS.map(k => [k, ip(prev.players?.[k], curr.players?.[k])])),
    monsters:    interpById(prev.monsters, curr.monsters || [], t),
    allies:      interpById(prev.allies, curr.allies || [], t),
    projectiles: interpById(prev.projectiles, curr.projectiles || [], t),
    coins:       interpById(prev.coins, curr.coins || [], t),
    fires:       interpFires(prev.fires, curr.fires || [], t),
  };
}

// Fire-glove flames also grow (r) and burn down (k) between updates.
function interpFires(prevList, currList, t) {
  if (!prevList || !prevList.length) return currList;
  const byId = new Map();
  for (const e of prevList) byId.set(e.id, e);
  return currList.map(e => {
    const p = byId.get(e.id);
    return p ? { ...e, x: lerp(p.x, e.x, t), y: lerp(p.y, e.y, t), r: lerp(p.r, e.r, t), k: lerp(p.k, e.k, t) } : e;
  });
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
  const key = myKeyOf();
  const me = currState.players?.[key];
  if (!me || me.dead || me.controlling || me.dashing) { pred = null; predHist.length = 0; return; }
  if (!pred) { pred = { x: me.x, y: me.y, facing: me.facing }; predHist.length = 0; }

  const inp = currentInputs();
  const moving = inp.left || inp.right || inp.up || inp.down;

  // Once per new server state: how far is the server from where we predicted
  // ourselves to be when it computed that position?
  if (currState !== reconciledState) {
    reconciledState = currState;
    // Server time → local time via the least-delayed arrival, then back half a
    // round trip for our inputs to have reached it. A snapshot that arrived late
    // in a clump is still compared with the right moment of our path.
    const at = Number.isFinite(currState.st) && clockOffset !== null
      ? currState.st + clockOffset - rttMs : now - (rttMs + stateIntervalMs * 0.5);
    const past = predictedAt(at);
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
  let spd = me.speed || serverPlayerSpeed;
  if (me.effects && me.effects.speed > 0) spd *= 1.7;
  if (ghostNow(me, now)) spd *= 1.75;
  if (me.lightspeed > 0) spd *= 3;            // LIGHTSPEED
  if (me.passive === 'dagger') spd *= 1.45;   // SWIFTNESS
  if (me.kspin > 0) spd *= 1.9;               // the katana's spin
  if (me.effects && me.effects.slow  > 0) spd *= 0.4;
  if (me.effects && me.effects.root  > 0) spd = 0;            // ROOT VINES

  // Apply currently-held inputs immediately (instant response)
  let vx = 0, vy = 0;
  if (inp.left)  { vx = -spd; pred.facing = -1; }
  if (inp.right) { vx =  spd; pred.facing =  1; }
  if (inp.up)    vy = -spd;
  if (inp.down)  vy =  spd;
  if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }
  if (me.effects && me.effects.confuse > 0) { vx = -vx; vy = -vy; if (vx) pred.facing = vx > 0 ? 1 : -1; }   // MIRROR RUNE
  const f = frameDt / 16.67;
  if (me.passive === 'samuraiblade' && (vx || vy)) {   // WAY OF THE BLADE (mirrors the server)
    const foe = nearestFoeForPrediction(me);
    if (foe) {
      const ax = foe.x - (pred.x + me.w / 2), ay = foe.y - (pred.y + me.h / 2), al = Math.hypot(ax, ay) || 1, vl = Math.hypot(vx, vy);
      if ((ax * vx + ay * vy) / (al * vl) > 0.5) { vx *= 1.75; vy *= 1.75; }
    }
  }
  if (me.kspin > 0) {   // gliding while spinning
    const g = Math.min(1, 0.07 * f);
    pred.kvx = (pred.kvx || 0) + (vx - (pred.kvx || 0)) * g; pred.kvy = (pred.kvy || 0) + (vy - (pred.kvy || 0)) * g;
    vx = pred.kvx; vy = pred.kvy;
  } else { pred.kvx = 0; pred.kvy = 0; }
  pred.x = Math.max(ARENA_X + 2, Math.min(ARENA_X + ARENA_W - me.w - 2, pred.x + vx * f));
  pred.y = Math.max(ARENA_Y + 2, Math.min(ARENA_Y + ARENA_H - me.h - 2, pred.y + vy * f));
  if (me.dlc) {   // chained by Darklight: can't stray from the stake
    const ddx = pred.x + me.w / 2 - me.dlc[0], ddy = pred.y + me.h / 2 - me.dlc[1], dd = Math.hypot(ddx, ddy);
    if (dd > 45) { pred.x -= ddx / dd * (dd - 45); pred.y -= ddy / dd * (dd - 45); }
  }

  predHist.push({ t: now, x: pred.x, y: pred.y });
  while (predHist.length && now - predHist[0].t > 1000) predHist.shift();
}

function nearestFoeForPrediction(me) {
  const s = currState; if (!s) return null;
  const px = (pred ? pred.x : me.x) + me.w / 2, py = (pred ? pred.y : me.y) + me.h / 2;
  let best = null, bd = Infinity;
  const consider = (x, y) => { const d = Math.hypot(x - px, y - py); if (d < bd) { bd = d; best = { x, y }; } };
  for (const m of s.monsters || []) if (!m.dead && !m.hidden && !m.ctl) consider(m.x + m.w / 2, m.y + m.h / 2);
  if (s.gameMode === 'pvp') for (const k of KEYS) { const o = s.players?.[k]; if (o && k !== myKeyOf() && !o.dead) consider(o.x + o.w / 2, o.y + o.h / 2); }
  return best;
}

function applyPrediction(state) {
  if (!pred || !myNum) return state;
  const key = myKeyOf();
  const me = state.players?.[key];
  if (!me || me.dead) return state;
  // Clone so we never mutate the stored authoritative currState.
  const players = { ...state.players };
  // The cloak shows (or drops) the moment it's predicted, not a round trip later.
  const effects = { ...(me.effects || {}) };
  if (ghostNow(me)) effects.ghost = effects.ghost || 1; else delete effects.ghost;
  players[key] = { ...me, x: pred.x, y: pred.y, facing: pred.facing, effects };
  return { ...state, players };
}

// Fires that ride on a player (barrier, hurricane, blizzard, life drain...)
// and rope chains are pinned to wherever that player is drawn this frame: the
// local prediction for you, the smoothed position for anyone else. Drawn at
// the server's position they trailed a step behind the body they belong to.
function pinToOwners(state) {
  const at = k => {
    const p = state.players?.[k];
    return p && !p.dead ? { x: p.x + p.w / 2, y: p.y + p.h / 2 } : null;
  };
  const fires = (state.fires || []).map(f => { const o = f.fo && at(f.fo); return o ? { ...f, x: o.x, y: o.y } : f; });
  const chains = (state.chains || []).map(ch => { const o = ch.o && at(ch.o); return o ? { ...ch, x1: o.x, y1: o.y } : ch; });
  return { ...state, fires, chains };
}

// The Dagger of Ghosts' cloak, predicted: it goes on (or comes off) the moment
// you press, so its 75% speed and the shimmer start at once instead of a round
// trip later (which made you crawl, then get yanked forward). The server's word
// takes over again as soon as it has had time to catch up.
let localGhost = null;   // { on, at }
function ghostNow(me, now = performance.now()) {
  if (localGhost && now - localGhost.at < rttMs + stateIntervalMs * 2 + 120) return localGhost.on;
  localGhost = null;
  return !!(me && me.effects && me.effects.ghost > 0);
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

// ─── Attack animations ────────────────────────────────────────────────────────

// How each weapon moves when it attacks. Anything unlisted falls back to a
// slash (melee) or a recoil (ranged).
const ATTACK_ANIM = {
  sword: 'slash', katana: 'slash', dagger: 'stab', spear: 'stab', lance: 'stab',
  axe: 'chop', hammer: 'chop', greatsword: 'chop', glaive: 'sweep',
  whip: 'spin', flail: 'spin', reaper: 'spin',
  bow: 'draw', crossbow: 'recoil', grapple: 'recoil', cannon: 'heavy', blunderbuss: 'heavy',
  staff: 'cast', frostrod: 'cast', wand: 'flick', stormtome: 'tome',
  chakram: 'throw', boomerang: 'throw', shuriken: 'throw',
  fireglove: 'punch', vortex: 'shieldup', windwand: 'flick', revolver: 'recoil', portalwand: 'cast', infinitybow: 'recoil', endlessscythe: 'sweep', samuraiblade: 'slash', ghostdagger: 'stab',
  stormhammer: 'chop', frostscythe: 'spin', sunbow: 'draw',
  scimitar: 'slash', slingshot: 'draw', mace: 'chop', javelin: 'throw', claws: 'stab',
  emberstaff: 'cast', halberd: 'sweep', frostbow: 'draw', chronostaff: 'cast', voidblade: 'slash', mindtome: 'tome',
  lightblade: 'slash', darklight: 'throw', starfall: 'cast',
};
const ANIM_MS = { slash: 190, stab: 170, chop: 280, sweep: 250, spin: 320, draw: 260, recoil: 180,
                  heavy: 300, cast: 270, flick: 150, tome: 300, throw: 230, punch: 240, shieldup: 320 };

function attackKind(wId) {
  if (ATTACK_ANIM[wId]) return ATTACK_ANIM[wId];
  if (WEAPON_META[wId]?.spin) return 'spin';
  return isRanged(wId) ? 'recoil' : 'slash';
}

// Per-player animation clock, started when the swing is shown (locally
// predicted for you, on the server echo for the other player) so it runs
// smoothly at frame rate instead of stepping with state updates.
const attackAnims = {};
function startAttackAnim(key, cp) {
  const kind = attackKind(cp.weaponId);
  const haste = cp.effects && cp.effects.haste > 0;
  const cd = (cp.atkSpd || WEAPON_META[cp.weaponId]?.atkSpd || 400) * (haste ? 0.5 : 1);
  // Never longer than the gap between attacks, or fast weapons would never rest.
  const dur = Math.max(90, Math.min(ANIM_MS[kind], cd * 0.9));
  attackAnims[key] = { t0: performance.now(), dur, kind, wId: cp.weaponId };
}
function attackProgress(key, wId) {
  const a = attackAnims[key];
  if (!a || a.wId !== wId) return null;
  const e = (performance.now() - a.t0) / a.dur;
  if (e >= 1) { delete attackAnims[key]; return null; }
  return { e, kind: a.kind };
}

const easeOut = t => 1 - (1 - t) * (1 - t);
const easeIn  = t => t * t;

// Where the weapon sits (in hand space, art pointing +X) at progress e.
// Returns { rot, dx, dy, alpha, glow }.
function weaponPose(kind, e) {
  const s = Math.sin(e * Math.PI);
  switch (kind) {
    case 'slash':  return { rot: -1.35 + easeOut(e) * 2.6 };
    case 'sweep':  return { rot: -1.7 + easeOut(e) * 3.3, dx: s * 3 };
    case 'chop':   // wind up high, then slam down hard
      return e < 0.35 ? { rot: 0.12 - (e / 0.35) * 2.0 }
                      : { rot: -1.88 + easeIn((e - 0.35) / 0.65) * 3.0, dy: e > 0.85 ? 1 : 0 };
    case 'stab':   // small draw-back, then a straight thrust
      return e < 0.25 ? { rot: 0, dx: -(e / 0.25) * 3 }
                      : { rot: 0, dx: -3 + Math.sin(((e - 0.25) / 0.75) * Math.PI) * 14 };
    case 'spin':   return { rot: 0.12 + easeOut(e) * Math.PI * 2 };
    case 'draw':   // pull the string back, release with a snap
      return e < 0.6 ? { rot: -0.08, dx: -(e / 0.6) * 4 } : { rot: -0.08 + (e - 0.6) * 0.3, dx: -4 + ((e - 0.6) / 0.4) * 4 };
    case 'heavy':  return { rot: -s * 0.55, dx: -s * 7, dy: -s * 1.5 };
    case 'cast':   return { rot: 0.12 - s * 1.25, dy: -s * 2, glow: s };
    case 'flick':  return { rot: 0.12 - Math.sin(e * Math.PI * 2) * 0.6, glow: s * 0.8 };
    case 'tome':   return { rot: -s * 0.3, dy: -s * 5, glow: s };
    case 'throw':  // wind back overhead, then whip forward and let go
      return e < 0.4 ? { rot: 0.12 - (e / 0.4) * 2.3 }
                     : { rot: -2.18 + easeOut((e - 0.4) / 0.6) * 3.0, alpha: e > 0.55 ? 0.25 : 1 };
    case 'punch':  // cock the fist back, then drive it forward in a blaze
      return e < 0.3 ? { rot: 0.2, dx: -(e / 0.3) * 4, glow: e }
                     : { rot: 0, dx: -4 + Math.sin(((e - 0.3) / 0.7) * Math.PI) * 12, glow: Math.sin(((e - 0.3) / 0.7) * Math.PI) };
    case 'shieldup': return { rot: -0.25 - s * 0.9, dy: -s * 4, glow: s };   // hoist the shield high
    default:       return { rot: -s * 0.16, dx: -s * 3 };   // recoil
  }
}

// A melee swing is drawn as an arc pivoting on the player at the weapon's real
// reach, so a range upgrade is immediately visible as a wider sweep. Ranged shots
// keep their burst at the muzzle.
function pushSlash(cp, angle, key) {
  const owner = key || null;
  const melee = !isRanged(cp.weaponId);
  const reach = cp.reach || 44;
  const tipR = cp.w + 12;
  if (key) startAttackAnim(key, cp);
  // The glove's ring of fire comes from the server; no swing arc to draw.
  if (attackKind(cp.weaponId) === 'punch' || attackKind(cp.weaponId) === 'shieldup') return;
  slashes.push({
    px: cp.x + cp.w / 2,
    py: cp.y + cp.h / 2,
    owner,
    x: cp.x + cp.w / 2 + Math.cos(angle) * tipR,
    y: cp.y + cp.h / 2 + Math.sin(angle) * tipR,
    angle,
    facing: cp.facing,
    weaponId: cp.weaponId,
    reach,
    melee,
    kind: attackKind(cp.weaponId),
    upg: cp.upg || null,
    // A whirl needs a beat longer to read as a full circle.
    timer: melee && attackKind(cp.weaponId) === 'spin' ? 340 : 220,
    maxTimer: melee && attackKind(cp.weaponId) === 'spin' ? 340 : 220,
    color: WEAPON_COLOR[cp.weaponId] || PAL.white,
  });
}

function detectSlashes(prev, curr) {
  const myKey = myKeyOf();
  for (const key of KEYS) {
    const cp = curr.players?.[key], pp = prev.players?.[key];
    if (!cp || cp.dead) continue;
    const fresh = cp.swingTimer > 0 && (!pp || pp.swingTimer <= 0 || cp.swingTimer > pp.swingTimer);
    if (!fresh) continue;
    // For the local player we already showed a predicted slash on key-press;
    // skip the (delayed) server echo so we don't draw / hear it twice.
    if (key === myKey && performance.now() - lastLocalSlashTime < 350) continue;
    if (window.GameAudio) GameAudio.sfx[isRanged(cp.weaponId) ? 'shoot' : 'swing']();
    pushSlash(cp, nearestEnemyAngle(cp, curr, key) ?? (cp.facing === 1 ? 0 : Math.PI), key);
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
  const monShot = p => p.weaponId === 'spit' || p.weaponId === 'hellfire';
  const pSpit = (prev.projectiles || []).filter(monShot).length;
  const cSpit = (curr.projectiles || []).filter(monShot).length;
  if (cSpit > pSpit) GameAudio.sfx.shoot();

  // Monster killed (array shrank)
  if ((curr.monsters?.length || 0) < (prev.monsters?.length || 0)) GameAudio.sfx.death();

  // Local player took damage
  const key = myKeyOf();
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

    if (sl.melee && sl.kind === 'spin') {
      drawSpinSlash(sl, alpha, prog, u);
    } else if (sl.melee && sl.kind === 'stab') {
      drawStabSlash(sl, alpha, prog, u);
    } else if (sl.melee) {
      // The crescent sweeps out to the weapon's actual reach, over the same
      // half-circle the server hits (a chop is thicker and lands with a thud).
      const cx = Math.round(sl.px), cy = Math.round(sl.py);
      const r = sl.reach * (0.6 + 0.35 * prog);
      const aim = sl.angle ?? (sl.facing === 1 ? 0 : Math.PI);
      const chop = sl.kind === 'chop';
      const span = Math.PI * (sl.kind === 'sweep' ? 1.15 : 1.05);
      const heft = (chop ? 3.6 : 2.5) * u.weight;
      if (chop && prog > 0.45) {
        // Impact: a burst of chips where the blade lands.
        const ix = cx + Math.cos(aim) * r, iy = cy + Math.sin(aim) * r;
        const k = (prog - 0.45) / 0.55;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = sl.color;
        for (let i = 0; i < 6; i++) {
          const a = aim + Math.PI + (i - 2.5) * 0.5;
          ctx.fillRect(Math.round(ix + Math.cos(a) * k * 9), Math.round(iy + Math.sin(a) * k * 9), 2, 2);
        }
        ctx.strokeStyle = '#ffffff';
        ctx.globalAlpha = alpha * 0.6;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(ix, iy, 2 + k * 7, 0, Math.PI * 2); ctx.stroke();
      }

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

// 360 weapons: a full ring at the weapon's reach, with a bright head racing
// around it — everything inside the circle gets hit.
function drawSpinSlash(sl, alpha, prog, u) {
  const cx = Math.round(sl.px), cy = Math.round(sl.py);
  const R = sl.reach;
  const aim = sl.angle ?? (sl.facing === 1 ? 0 : Math.PI);
  const dir = sl.facing === -1 ? -1 : 1;
  const sweep = Math.min(1, prog * 1.35) * Math.PI * 2;
  const head = aim + sweep * dir;
  const heft = 3 * u.weight;

  // The area: a faint disc and rim covering the whole reach.
  ctx.globalAlpha = alpha * 0.16;
  ctx.fillStyle = sl.color;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = alpha * 0.45;
  ctx.strokeStyle = sl.color;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);

  // The swept trail, thick near the head and thinning behind it.
  const segs = 10;
  for (let i = 0; i < segs; i++) {
    const a0 = aim + sweep * dir * (i / segs), a1 = aim + sweep * dir * ((i + 1) / segs);
    const k = (i + 1) / segs;
    ctx.globalAlpha = alpha * (0.2 + 0.7 * k);
    ctx.lineWidth = Math.max(0.8, heft * k);
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.9, Math.min(a0, a1), Math.max(a0, a1)); ctx.stroke();
  }
  for (let i = 1; i <= u.rng; i++) {
    ctx.globalAlpha = alpha * (0.28 - i * 0.03);
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.9 - i * 2.4, 0, Math.PI * 2); ctx.stroke();
  }
  // Head of the whirl.
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(cx + Math.cos(head) * R * 0.9, cy + Math.sin(head) * R * 0.9, 1.5 + heft * 0.4, 0, Math.PI * 2); ctx.fill();
}

// ─── Fire Glove flames ────────────────────────────────────────────────────────

// Rings of fire: the attack's quick ring (k = how burnt-out it is) and the
// SUPER's inferno, which just keeps growing. Flame tongues lick outward
// along the edge and flicker over time.
// Wind wand tornado: a funnel of spinning bands, narrow at the ground and
// flaring out above, with grit whirling round it.
function drawTornado(f, now) {
  const r = f.r || 34, fade = Math.min(1, (1 - (f.k || 0)) * 4);
  const baseY = f.y + r * 0.55;
  ctx.save();
  ctx.globalAlpha = 0.18 * fade;
  ctx.fillStyle = '#aef5dc';
  ctx.beginPath(); ctx.ellipse(f.x, baseY, r, r * 0.35, 0, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 7; i++) {
    const h = i / 6, y = baseY - h * r * 1.9;
    const w = r * (0.25 + h * 0.85) + Math.sin(now * 9 + i) * 2;
    const sway = Math.sin(now * 3 + h * 3) * r * 0.18 * h;
    ctx.globalAlpha = (0.35 + 0.4 * (1 - h)) * fade;
    ctx.strokeStyle = i % 2 ? '#e8fff6' : '#8fe0c4';
    ctx.lineWidth = 2.5;
    const a0 = (now * 8 + i * 0.9) % (Math.PI * 2);
    ctx.beginPath(); ctx.ellipse(f.x + sway, y, w, w * 0.28, 0, a0, a0 + Math.PI * 1.4); ctx.stroke();
  }
  ctx.fillStyle = '#c9b98e';
  for (let i = 0; i < 8; i++) {
    const a = now * 7 + i * 0.8, h = (i / 8);
    const rr = r * (0.3 + h * 0.8);
    ctx.globalAlpha = 0.8 * fade;
    ctx.fillRect(f.x + Math.cos(a) * rr - 1, baseY - h * r * 1.7 + Math.sin(a) * rr * 0.28 - 1, 2, 2);
  }
  ctx.restore();
}

// The Portal Mage's portals: an upright oval with a dark void, swirling arms
// and a bright rim. Red ones throw fireballs, purple ones are his teleport,
// green ones spit out monsters, and the giant ones bring the Giants.
const PORTAL_COLORS = {
  red:    ['#ff3a2a', '#ffb04a', '#2a0604'],
  purple: ['#a050ff', '#e0c8ff', '#12051f'],
  green:  ['#3aff7a', '#c8ffd8', '#04200c'],
  giant:  ['#c8e07a', '#ffffff', '#141c0a'],
};
// A player's colour: their skin colour, else the P1/P2 default.
function ownerColor(key) {
  return getSkinColor(currState?.players?.[key], PAL[key] || PAL.p1);
}
function drawPortal(f, now) {
  // Portal Wand summoning portals ('p1'/'p2') wear their caster's colour.
  const [col, hi, voidC] = /^p[1-4]$/.test(f.c) ? [ownerColor(f.c), '#ffffff', '#0a0a14']
    : PORTAL_COLORS[f.c] || PORTAL_COLORS.purple;
  const k = Math.max(0, f.k || 0);
  // Opens with a snap, holds, then pinches shut.
  const s = Math.min(1, k / 0.12) * Math.min(1, (1 - k) / 0.12);
  if (s <= 0) return;
  const rx = (f.r || 18) * s, ry = rx * 1.4;
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.ellipse(0, 0, rx * 1.7, ry * 1.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = voidC;
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const a0 = now * 4 * (i % 2 ? -1 : 1) + i * 1.6;
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = i % 2 ? hi : col;
    ctx.lineWidth = Math.max(1, rx * 0.12);
    ctx.beginPath(); ctx.ellipse(0, 0, rx * (0.35 + i * 0.15), ry * (0.35 + i * 0.15), 0, a0, a0 + 1.6); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, rx * 0.2);
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = hi; ctx.lineWidth = Math.max(1, rx * 0.07);
  ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 6; i++) {
    const a = now * 2.2 + i * 1.05, rr = 1.15 + 0.15 * Math.sin(now * 6 + i);
    ctx.fillStyle = i % 2 ? hi : col;
    ctx.fillRect(Math.cos(a) * rx * rr - 1, Math.sin(a) * ry * rr - 1, 2, 2);
  }
  ctx.restore();
}

// The mage's trap spell: a rune circle draws itself in the trap's colour,
// filling up and flashing faster until the real trap snaps into place.
function drawRuneCast(f, now) {
  const k = Math.max(0, Math.min(1, f.k || 0));
  const r = f.r || 20, col = f.c || '#ff8822';
  const blink = k > 0.7 ? (Math.floor(now * 14) % 2 ? 1 : 0.45) : 1;
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.globalAlpha = (0.15 + 0.35 * k) * blink;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(0, 0, r * (0.3 + 0.7 * k), 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.95 * blink;
  ctx.strokeStyle = col; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, k * 1.4)); ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2); ctx.stroke();
  ctx.rotate(now * 1.6);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    ctx.save(); ctx.rotate(a); ctx.translate(r * 0.8, 0);
    ctx.fillRect(-1, -2.5, 2, 5); ctx.fillRect(-2.5, -1, 5, 2);
    ctx.restore();
  }
  ctx.restore();
  // An exclamation over the spot once it's about to arm.
  if (k > 0.5) {
    ctx.save();
    ctx.globalAlpha = blink;
    ctx.font = 'bold 12px "Courier New",monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText('!', f.x, f.y);
    ctx.fillStyle = col; ctx.fillText('!', f.x, f.y);
    ctx.restore();
  }
}

// Black hole: a dark core ringed by a spinning accretion disc, with matter
// spiralling in from the edge of its pull.
function drawBlackhole(f, now) {
  const k = f.k || 0, fade = Math.min(1, k * 10 + 0.3, (1 - k) * 8);
  const R = 180;   // pull radius (mirrors the server)
  ctx.save();
  ctx.globalAlpha = 0.07 * fade;
  ctx.fillStyle = '#6a3aff';
  ctx.beginPath(); ctx.arc(f.x, f.y, R, 0, Math.PI * 2); ctx.fill();
  ctx.lineCap = 'round';
  for (let i = 0; i < 16; i++) {
    const ph = ((now * 0.55 + i / 16) % 1), rr = R * (1 - ph) + 8;
    const a = now * 3 * (1 + ph * 2) + i * 2.4 + ph * 5;
    ctx.globalAlpha = (0.2 + 0.6 * ph) * fade;
    ctx.strokeStyle = i % 3 ? '#b89aff' : '#ffffff';
    ctx.lineWidth = 1 + ph * 2;
    ctx.beginPath(); ctx.arc(f.x, f.y, rr, a, a + 0.5 + ph * 0.5); ctx.stroke();
  }
  const r = (f.r || 30) * (0.9 + 0.08 * Math.sin(now * 9));
  for (let i = 0; i < 3; i++) {
    ctx.globalAlpha = (0.55 - i * 0.15) * fade;
    ctx.strokeStyle = i === 0 ? '#ffd8ff' : i === 1 ? '#a86aff' : '#5a2aff';
    ctx.lineWidth = 3 - i * 0.7;
    ctx.beginPath(); ctx.ellipse(f.x, f.y, r + 6 + i * 4, (r + 6 + i * 4) * 0.4, now * 2 + i, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = fade;
  ctx.fillStyle = '#05020c';
  ctx.beginPath(); ctx.arc(f.x, f.y, r * 0.78, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#8a5aff'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(f.x, f.y, r * 0.78, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

// Life drain: a pulsing blood-red aura around the caster, motes streaming in.
function drawDrain(f, now) {
  const r = f.r || 95, k = f.k || 0, fade = Math.min(1, k * 10 + 0.3, (1 - k) * 6);
  ctx.save();
  ctx.globalAlpha = (0.1 + 0.05 * Math.sin(now * 8)) * fade;
  ctx.fillStyle = '#ff2a4a';
  ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.65 * fade;
  ctx.strokeStyle = '#ff5a7a'; ctx.lineWidth = 2;
  ctx.setLineDash([7, 6]); ctx.lineDashOffset = now * 40;
  ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  for (let i = 0; i < 12; i++) {
    const ph = ((now * 0.8 + i / 12) % 1), rr = r * (1 - ph) + 4;
    const a = i * 2.4 + now * 1.5;
    ctx.globalAlpha = (0.9 - ph * 0.5) * fade;
    ctx.fillStyle = i % 2 ? '#ff7a8a' : '#ffd0d8';
    ctx.fillRect(f.x + Math.cos(a) * rr - 1, f.y + Math.sin(a) * rr - 1, 2.2, 2.2);
  }
  ctx.restore();
}

// Hurricane: a wide ring of wind streaks circling the caster.
function drawHurricane(f, now) {
  const r = f.r || 115, fade = Math.min(1, (1 - (f.k || 0)) * 6, (f.k || 0) * 12 + 0.2);
  ctx.save();
  ctx.globalAlpha = 0.08 * fade;
  ctx.fillStyle = '#aef5dc';
  ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.fill();
  ctx.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    const rr = r * (0.35 + (i % 5) * 0.16);
    const a0 = now * (2.6 - (i % 5) * 0.25) + i * 1.7;
    ctx.globalAlpha = (0.35 + (i % 3) * 0.2) * fade;
    ctx.strokeStyle = i % 3 ? '#d8fff0' : '#7fd8b8';
    ctx.lineWidth = 1.5 + (i % 3);
    ctx.beginPath(); ctx.arc(f.x, f.y, rr, a0, a0 + 0.9); ctx.stroke();
  }
  ctx.globalAlpha = 0.5 * fade;
  ctx.strokeStyle = '#aef5dc'; ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]); ctx.lineDashOffset = -now * 60;
  ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

// A meteor on its way down: a pulsing target circle that fills in, and the rock
// dropping in from the upper right with a fiery tail. It lands when k hits 1.
function drawMeteor(f, now) {
  const k = Math.min(1, f.k || 0);
  ctx.save();
  ctx.globalAlpha = 0.18 + 0.22 * k;
  ctx.fillStyle = '#ff5a1a';
  ctx.beginPath(); ctx.arc(f.x, f.y, f.r * k, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.55 + 0.35 * Math.abs(Math.sin(now * 14));
  ctx.strokeStyle = '#ffb04a'; ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  const fall = 1 - k, mx = f.x + fall * 150, my = f.y - fall * 260;
  ctx.globalAlpha = 1;
  for (let i = 5; i >= 1; i--) {
    ctx.globalAlpha = 0.16 * (6 - i);
    ctx.fillStyle = i > 2 ? '#ff6a1a' : '#ffd27a';
    ctx.beginPath(); ctx.arc(mx + i * 9, my - i * 15, 9 - i, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#5a3020'; ctx.beginPath(); ctx.arc(mx, my, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8a4a2a'; ctx.beginPath(); ctx.arc(mx - 2, my - 2, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffb04a'; ctx.fillRect(mx + 2, my + 1, 3, 3);
  ctx.restore();
}

// KNIFE STORM: a pale warning ring where each knife will land, and the knife
// itself dropping point-first out of the sky.
function drawKnife(f, now) {
  const k = Math.min(1, f.k || 0);
  ctx.save();
  ctx.globalAlpha = 0.15 + 0.25 * k;
  ctx.fillStyle = '#a8f0ff';
  ctx.beginPath(); ctx.arc(f.x, f.y, f.r * k, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.6 + 0.35 * Math.abs(Math.sin(now * 16));
  ctx.strokeStyle = '#e8fcff'; ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  const my = f.y - (1 - k) * 280;
  ctx.globalAlpha = 0.35; ctx.fillStyle = '#a8f0ff';
  ctx.fillRect(f.x - 1, my - 26, 2, 16);                                    // ghostly trail
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#3a2a4a'; ctx.fillRect(f.x - 1.5, my - 12, 3, 6);       // grip
  ctx.fillStyle = '#c8a040'; ctx.fillRect(f.x - 4, my - 6, 8, 2);          // guard
  ctx.fillStyle = '#dff6ff';
  ctx.beginPath(); ctx.moveTo(f.x - 2.5, my - 4); ctx.lineTo(f.x + 2.5, my - 4); ctx.lineTo(f.x, my + 8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.fillRect(f.x - 0.5, my - 3, 1, 8);
  ctx.restore();
}

// ABSOLUTE ZERO: a frosty disc with snow whirling round it.
function drawBlizzard(f, now) {
  const k = Math.max(0, f.k || 0);
  const fade = Math.min(1, k / 0.08) * Math.min(1, (1 - k) / 0.12);
  ctx.save();
  ctx.globalAlpha = 0.16 * fade; ctx.fillStyle = '#bfefff';
  ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.5 * fade; ctx.strokeStyle = '#e8faff'; ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 5]); ctx.lineDashOffset = -now * 30;
  ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 40; i++) {
    const a = i * 2.4 + now * (1.2 + (i % 3) * 0.4), d = f.r * ((i * 53 % 97) / 97);
    ctx.globalAlpha = (0.5 + 0.5 * ((i * 31 % 7) / 7)) * fade;
    ctx.fillRect(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, i % 4 ? 1.5 : 2.5, i % 4 ? 1.5 : 2.5);
  }
  ctx.restore();
}

// The little sun of the Sunfire Longbow: a pulsing core with turning rays.
function drawSunorb(f, now) {
  const k = Math.max(0, f.k || 0);
  const fade = Math.min(1, k / 0.06) * Math.min(1, (1 - k) / 0.1);
  const pulse = 1 + 0.12 * Math.sin(now * 8);
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.globalAlpha = 0.25 * fade; ctx.fillStyle = '#ffb030';
  ctx.beginPath(); ctx.arc(0, 0, 22 * pulse, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.9 * fade; ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const a = now * 1.5 + i * Math.PI / 4;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * 11, Math.sin(a) * 11); ctx.lineTo(Math.cos(a) * 17 * pulse, Math.sin(a) * 17 * pulse); ctx.stroke();
  }
  ctx.globalAlpha = fade; ctx.fillStyle = '#ffd24a';
  ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff6c0';
  ctx.beginPath(); ctx.arc(-2, -2, 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// SUPERNOVA: a blazing beam from the archer across the arena.
function drawSunbeam(f, now) {
  const k = Math.max(0, f.k || 0);
  const fade = Math.min(1, k / 0.06) * Math.min(1, (1 - k) / 0.1);
  const L = 900, a = f.a || 0;
  ctx.save();
  ctx.beginPath(); ctx.rect(ARENA_X, ARENA_Y, ARENA_W, ARENA_H); ctx.clip();
  ctx.translate(f.x, f.y); ctx.rotate(a);
  const w = (f.r || 14) * (1 + 0.15 * Math.sin(now * 30));
  ctx.globalAlpha = 0.25 * fade; ctx.fillStyle = '#ff8a1a'; ctx.fillRect(0, -w * 1.6, L, w * 3.2);
  ctx.globalAlpha = 0.6 * fade; ctx.fillStyle = '#ffd24a'; ctx.fillRect(0, -w, L, w * 2);
  ctx.globalAlpha = 0.95 * fade; ctx.fillStyle = '#fff6d0'; ctx.fillRect(0, -w * 0.4, L, w * 0.8);
  ctx.globalAlpha = fade; ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(0, 0, w * 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ── MIND TOME ──
const MIND_COL = '#ff5ad8';
// A stylised eye: the mark of the Mind Tome.
function drawMindEye(x, y, r, t) {
  ctx.save();
  ctx.fillStyle = '#2a0820';
  ctx.beginPath(); ctx.ellipse(x, y, r * 1.6, r, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = MIND_COL; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.ellipse(x, y, r * 1.6, r, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = MIND_COL;
  ctx.beginPath(); ctx.arc(x + Math.sin(t * 2) * r * 0.5, y, r * 0.55, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(x + Math.sin(t * 2) * r * 0.5) - 1, Math.round(y) - 1, 1.5, 1.5);
  ctx.restore();
}

// The four spinning beams of the special.
function drawMindBeams(f, now) {
  const k = Math.max(0, f.k || 0);
  const fade = Math.min(1, k / 0.08) * Math.min(1, (1 - k) / 0.12);
  const a0 = f.a || 0;
  ctx.save();
  ctx.translate(f.x, f.y);
  for (let i = 0; i < 4; i++) {
    const a = a0 + i * Math.PI / 2;
    ctx.save(); ctx.rotate(a);
    const w = 5 + Math.sin(now / 60 + i) * 1.2;
    ctx.globalAlpha = 0.25 * fade; ctx.fillStyle = MIND_COL; ctx.fillRect(6, -w, f.r - 6, w * 2);
    ctx.globalAlpha = 0.75 * fade; ctx.fillStyle = '#ff9ae8'; ctx.fillRect(6, -w * 0.45, f.r - 6, w * 0.9);
    ctx.globalAlpha = 0.95 * fade; ctx.fillStyle = '#ffffff'; ctx.fillRect(6, -0.6, f.r - 6, 1.2);
    // sparks running out along the beam
    for (let s = 0; s < 3; s++) {
      const d = 10 + ((now / 4 + s * 60 + i * 30) % (f.r - 10));
      ctx.globalAlpha = fade; ctx.fillRect(d, (s - 1) * 2.5, 2, 2);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 0.9 * fade; ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Your own traps: a pink rune ring that turns, and sparkles rising out of it.
function drawMindTrapGlyph(tr, cx, cy) {
  const now = performance.now(), t = now / 1000, r = tr.w * 0.68;
  ctx.save();
  ctx.globalAlpha = 0.16 + 0.06 * Math.sin(t * 4); ctx.fillStyle = MIND_COL;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.95; ctx.strokeStyle = MIND_COL; ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]); ctx.lineDashOffset = -now / 30;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  for (let i = 0; i < 4; i++) {
    const a = t * 1.5 + i * Math.PI / 2;
    ctx.fillStyle = '#ffb8f0'; ctx.fillRect(Math.round(cx + Math.cos(a) * r) - 1, Math.round(cy + Math.sin(a) * r) - 1, 2.5, 2.5);
  }
  drawMindEye(cx, cy - tr.h / 2 - 6, 3, t);
  for (let i = 0; i < 10; i++) {
    const f = (t * 0.9 + i / 10) % 1;
    const sx = cx + Math.cos(i * 2.3) * r * 0.7, sy = cy + Math.sin(i * 2.3) * r * 0.4 - f * 16;
    ctx.globalAlpha = 0.9 * (1 - f); ctx.fillStyle = i % 2 ? '#ffffff' : MIND_COL;
    ctx.fillRect(Math.round(sx), Math.round(sy), 1.5, 1.5);
  }
  ctx.restore();
}

// Over whoever you control: the eye, a ring, and the seconds left.
function drawPuppetMark(x, y, m) {
  const t = performance.now() / 1000;
  ctx.save();
  if (m) {
    ctx.globalAlpha = 0.3 + 0.12 * Math.sin(t * 6); ctx.strokeStyle = MIND_COL; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(m.x + m.w / 2, m.y + m.h, m.w * 0.8, 4, 0, 0, Math.PI * 2); ctx.stroke();
  }
  drawMindEye(x, y - 4, 4.5, t);
  if (m && m.ctlLeft) {
    ctx.globalAlpha = 1; ctx.font = 'bold 7px "Courier New",monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = '#000'; ctx.fillText(Math.ceil(m.ctlLeft / 1000) + 's', x + 0.5, y - 11.5);
    ctx.fillStyle = '#ffb8f0'; ctx.fillText(Math.ceil(m.ctlLeft / 1000) + 's', x, y - 12);
    // Your own puppet: its ability, and whether it's ready.
    const me = currState && currState.players && currState.players['p' + myNum];
    if (me && me.pupAb && m.ctl === 'p' + myNum) {
      const ready = !(me.pupCd > 0);
      const txt = me.pupAb + (ready ? '' : ' ' + (me.pupCd / 1000).toFixed(1) + 's');
      ctx.font = 'bold 6px "Courier New",monospace';
      ctx.fillStyle = '#000'; ctx.fillText(txt, x + 0.5, y - 19.5);
      ctx.fillStyle = ready ? '#ffffff' : '#9a8aa8'; ctx.fillText(txt, x, y - 20);
    }
    ctx.textAlign = 'left';
  }
  ctx.restore();
}

// While you control someone: a faint marker where you'll come back.
function drawMindHome(p) {
  const t = performance.now() / 1000, x = p.x + p.w / 2, y = p.y + p.h / 2;
  ctx.save();
  ctx.globalAlpha = 0.35 + 0.15 * Math.sin(t * 4); ctx.strokeStyle = MIND_COL; ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.strokeRect(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5, p.w - 1, p.h - 1);
  ctx.setLineDash([]);
  drawMindEye(x, y, 3, t);
  ctx.restore();
}

// SHIFTING GROUND: seconds to the next shuffle, over your head; it grows and
// pulses for the last five.
function drawShuffleCountdown(p, x, y) {
  const secs = Math.ceil(p.shuffleIn / 1000);
  const hot = secs <= 5;
  const mx = x + p.w / 2, my = y - 24;
  ctx.save();
  ctx.font = (hot ? 'bold 10px' : 'bold 7px') + ' "Courier New",monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const pulse = hot ? 1 + 0.15 * Math.abs(Math.sin(performance.now() / 120)) : 1;
  ctx.translate(mx, my); ctx.scale(pulse, pulse);
  const txt = '⇄ ' + secs;
  const w = ctx.measureText(txt).width;
  ctx.globalAlpha = 0.7; ctx.fillStyle = '#1a0614'; ctx.fillRect(-w / 2 - 3, -6, w + 6, 12);
  ctx.globalAlpha = 1; ctx.fillStyle = hot ? '#ffffff' : MIND_COL; ctx.fillText(txt, 0, 0.5);
  ctx.restore();
}

// LANDMINES: a small disc with a lamp that blinks red once it is armed.
function drawPlayerMine(f, now) {
  const armed = (f.k || 0) > 0.025;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(f.x, f.y + 3, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3a3e46'; ctx.beginPath(); ctx.arc(f.x, f.y, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#5a606c'; ctx.beginPath(); ctx.arc(f.x - 1.5, f.y - 1.5, 3, 0, Math.PI * 2); ctx.fill();
  const on = armed && Math.floor(now / 250) % 2 === 0;
  ctx.fillStyle = armed ? (on ? '#ff3a2a' : '#7a1a10') : '#ffd84a';
  ctx.fillRect(Math.round(f.x) - 1, Math.round(f.y) - 1, 3, 3);
  ctx.globalAlpha = 0.3; ctx.strokeStyle = '#ff6a3a'; ctx.setLineDash([2, 3]);
  ctx.beginPath(); ctx.arc(f.x, f.y, 20, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  ctx.restore();
}

// BARRIER: a shimmering dome riding on its caster; it flickers as it runs out.
function drawBarrier(f, now) {
  const k = Math.max(0, f.k || 0);
  const flick = k > 0.8 ? 0.5 + 0.5 * Math.abs(Math.sin(now * 20)) : 1;
  ctx.save();
  ctx.globalAlpha = 0.14 * flick;
  ctx.fillStyle = '#7ad8ff';
  ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.8 * flick;
  ctx.strokeStyle = '#bfefff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.stroke();
  // Hexagon facets turning slowly round the rim.
  ctx.globalAlpha = 0.45 * flick; ctx.lineWidth = 1; ctx.strokeStyle = '#ffffff';
  for (let i = 0; i < 6; i++) {
    const a = now * 0.8 + i * Math.PI / 3;
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r - 3, a, a + 0.5); ctx.stroke();
  }
  ctx.restore();
}

// TOXIC CLOUD: overlapping green puffs that drift and swell, fading at the end.
function drawCloud(f, now) {
  const k = Math.max(0, f.k || 0);
  const fade = Math.min(1, k / 0.1) * Math.min(1, (1 - k) / 0.15);
  ctx.save();
  for (let i = 0; i < 9; i++) {
    const a = i * 0.7 + now * 0.4, d = f.r * (0.25 + (i % 3) * 0.22);
    const rr = f.r * (0.32 + 0.06 * Math.sin(now * 2 + i));
    ctx.globalAlpha = 0.16 * fade;
    ctx.fillStyle = i % 2 ? '#8ad048' : '#5a9a2a';
    ctx.beginPath(); ctx.arc(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d * 0.7, rr, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 0.5 * fade; ctx.fillStyle = '#d8ff9a';
  for (let i = 0; i < 6; i++) {
    const a = now * 1.3 + i * 1.05, d = f.r * 0.6 * ((i * 37 % 10) / 10);
    ctx.fillRect(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d - ((now * 12 + i * 5) % 14), 1.5, 1.5);
  }
  ctx.restore();
}

// AFTERGLOW: a glowing streak along a Light Blade dash, crackling, fading out.
function drawLightStreak(f, now) {
  const fade = 1 - Math.min(1, f.k || 0);
  const x2 = f.x + Math.cos(f.a) * f.v, y2 = f.y + Math.sin(f.a) * f.v;
  ctx.save();
  ctx.lineCap = 'round';
  for (const [w, c, al] of [[10, '#fff27a', 0.18], [5, '#fff27a', 0.45], [2, '#ffffff', 0.9]]) {
    ctx.globalAlpha = al * fade * (0.85 + 0.15 * Math.sin(now * 20 + w));
    ctx.strokeStyle = c; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(x2, y2); ctx.stroke();
  }
  // A few sparks jumping off it.
  ctx.globalAlpha = fade; ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 4; i++) {
    const k = ((now * 1.7 + i * 0.27 + f.id * 0.13) % 1);
    const sx = f.x + (x2 - f.x) * k, sy = f.y + (y2 - f.y) * k;
    const j = Math.sin(now * 30 + i * 4) * 4;
    ctx.fillRect(Math.round(sx - Math.sin(f.a) * j), Math.round(sy + Math.cos(f.a) * j), 1.5, 1.5);
  }
  ctx.restore();
}

function drawFireRings(fires) {
  if (!fires.length) return;
  const now = performance.now() / 1000;
  for (const f of fires) {
    if (f.kind === 'vortexfield') { drawVortexField(f, now); continue; }
    if (f.kind === 'ibburst') continue;
    if (f.kind === 'voidbeam') { drawVoidBeam(f, now); continue; }
    if (f.kind === 'scythewhirl') { drawScytheWhirl(f, now); continue; }
    if (f.kind === 'abyssmark') { drawAbyssMark(f, now); continue; }
    if (f.kind === 'abysscharge') { drawAbyssCharge(f, now); continue; }
    if (f.kind === 'abyssblade') {
      ctx.save(); ctx.translate(f.x, f.y);
      ctx.globalAlpha = 0.3; ctx.fillStyle = '#7a2aff'; ctx.beginPath(); ctx.arc(0, 0, f.r + 4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; ctx.rotate(now * 14 + f.id);
      for (let i = 0; i < 2; i++) { ctx.rotate(Math.PI); drawWeaponPixels(ctx, 'm_scythe', 0.9, '#c88aff'); }
      ctx.restore(); continue;
    }
    if (f.kind === 'meteor') { if ((f.k || 0) >= 0) drawMeteor(f, now); continue; }
    if (f.kind === 'knife') { if ((f.k || 0) >= 0) drawKnife(f, now); continue; }
    if (f.kind === 'tornado') { drawTornado(f, now); continue; }
    if (f.kind === 'hurricane') { drawHurricane(f, now); continue; }
    if (f.kind === 'portal') { if ((f.k || 0) >= 0) drawPortal(f, now); continue; }
    if (f.kind === 'runecast') { if ((f.k || 0) >= 0) drawRuneCast(f, now); continue; }
    if (f.kind === 'blackhole') { drawBlackhole(f, now); continue; }
    if (f.kind === 'drain') { drawDrain(f, now); continue; }
    if (f.kind === 'barrier') { drawBarrier(f, now); continue; }
    if (f.kind === 'mine') { drawPlayerMine(f, now); continue; }
    if (f.kind === 'mindbeams') { drawMindBeams(f, now); continue; }
    if (f.kind === 'lightstreak') { drawLightStreak(f, now); continue; }
    if (f.kind === 'blizzard') { drawBlizzard(f, now); continue; }
    if (f.kind === 'sunorb') { drawSunorb(f, now); continue; }
    if (f.kind === 'sunbeam') { drawSunbeam(f, now); continue; }
    if (f.kind === 'cloud') { drawCloud(f, now); continue; }
    if (f.kind === 'soundwave') {
      // Three rippling rings, fading as the wave spreads.
      const fade = Math.max(0, 1 - f.r / 420);
      ctx.save();
      for (let i = 0; i < 3; i++) {
        const rr = f.r - i * 7;
        if (rr <= 2) continue;
        ctx.globalAlpha = fade * (0.9 - i * 0.25);
        ctx.strokeStyle = i ? '#d8c89a' : '#fff4d0';
        ctx.lineWidth = i ? 2 : 3.5;
        ctx.beginPath(); ctx.arc(f.x, f.y, rr, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
      continue;
    }
    if ((f.kind !== 'ring' && f.kind !== 'inferno') || f.r <= 0) continue;
    const inferno = f.kind === 'inferno';
    const fade = inferno ? 1 : Math.max(0, 1 - Math.pow(f.k, 3));
    const band = inferno ? 13 : 8;
    ctx.save();
    ctx.lineCap = 'round';
    // Heat haze inside the band.
    ctx.globalAlpha = fade * (inferno ? 0.35 : 0.25);
    ctx.strokeStyle = '#8a1a04';
    ctx.lineWidth = band * 2.2;
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.stroke();
    // Core flame bands, dark to bright.
    ctx.globalAlpha = fade * 0.85;
    ctx.strokeStyle = '#ff5a14';
    ctx.lineWidth = band * 1.2;
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = fade * 0.9;
    ctx.strokeStyle = '#ffc23a';
    ctx.lineWidth = band * 0.45;
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.stroke();
    // Tongues of flame along the rim (capped so a huge inferno stays cheap).
    const n = Math.min(inferno ? 160 : 48, Math.max(10, Math.round(f.r * Math.PI * 2 / 9)));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (inferno ? now * 0.3 : 0);
      const flick = 0.55 + 0.45 * Math.sin(now * 14 + i * 2.7);
      const len = band * (inferno ? 1.6 : 1.3) * flick;
      const ca = Math.cos(a), sa = Math.sin(a);
      const bx = f.x + ca * (f.r + band * 0.3), by = f.y + sa * (f.r + band * 0.3);
      const w = Math.max(1.5, band * 0.45);
      ctx.globalAlpha = fade * (0.55 + 0.45 * flick);
      ctx.fillStyle = (i % 3) ? '#ff8a2a' : '#ffd84a';
      ctx.beginPath();
      ctx.moveTo(bx - sa * w, by + ca * w);
      ctx.lineTo(bx + ca * len, by + sa * len);
      ctx.lineTo(bx + sa * w, by - ca * w);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
}

// The special: a giant hand of fire reaching for its prey (a = heading).
function drawFireHands(fires) {
  const now = performance.now() / 1000;
  for (const f of fires) {
    if (f.kind !== 'hand') continue;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.a || 0);
    ctx.scale(0.95, 0.95);   // about a player's size
    // Exhaust trail streaming back from the wrist, stretching out as the hand
    // picks up speed like a missile.
    const gap = 2.5 + (f.v || 1) * 1.3;
    for (let i = 0; i < 7; i++) {
      const flick = 0.6 + 0.4 * Math.sin(now * 18 + i * 1.9);
      ctx.globalAlpha = 0.55 - i * 0.06;
      ctx.fillStyle = i % 2 ? '#ff6a1a' : '#ffb030';
      ctx.beginPath();
      ctx.arc(-12 - i * gap, Math.sin(now * 11 + i) * 2.5, (7 - i * 0.8) * flick, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#ff3a0a';
    ctx.beginPath(); ctx.arc(4, 0, 20, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.95;
    fireHandShape(1.12, '#b8260a', now);
    ctx.globalAlpha = 0.95;
    fireHandShape(1, '#ff6a1a', now);
    ctx.globalAlpha = 0.95;
    fireHandShape(0.62, '#ffc23a', now);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#fff4c0';
    ctx.beginPath(); ctx.ellipse(-1, 0, 4, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

// ─── Vortex Shield ────────────────────────────────────────────────────────────

// While the shield is up: a spinning ring of charge around the player that
// grows brighter as it banks damage. The bank floats above their head.
function drawVortexShield(p, x, y) {
  const up = p.vShield > 0, bank = p.vStore || 0;
  if (!up && !(bank > 0 && p.weaponId === 'vortex')) return;
  const cxp = x + p.w / 2, cyp = y + p.h / 2;
  const now = performance.now() / 1000;
  ctx.save();
  if (up) {
    const R = p.w + 6, fade = Math.min(1, p.vShield / 400);
    const charge = Math.min(1, bank / 150);
    ctx.globalAlpha = 0.14 * fade + charge * 0.12;
    ctx.fillStyle = '#7ad8ff';
    ctx.beginPath(); ctx.arc(cxp, cyp, R, 0, Math.PI * 2); ctx.fill();
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a0 = now * 4 + i * (Math.PI * 2 / 3);
      ctx.globalAlpha = (0.55 + charge * 0.4) * fade;
      ctx.strokeStyle = i ? '#7ad8ff' : '#e8fbff';
      ctx.lineWidth = 1.6 + charge * 1.4;
      ctx.beginPath(); ctx.arc(cxp, cyp, R, a0, a0 + 1.4); ctx.stroke();
    }
    ctx.globalAlpha = 0.35 * fade;
    ctx.strokeStyle = '#7ad8ff'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cxp, cyp, R - 3, 0, Math.PI * 2); ctx.stroke();
  }
  if (bank > 0) {
    ctx.globalAlpha = 1;
    ctx.font = 'bold 9px "Courier New",monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round';
    const t = '⚡' + bank;
    ctx.strokeText(t, cxp, y - 25);
    ctx.fillStyle = '#9fe8ff'; ctx.fillText(t, cxp, y - 25);
  }
  ctx.restore();
}

// The special: a force field of stored energy around the player — a charged
// sphere with spiral arms turning inside it, fading as its 3 s run out.
function drawVortexField(f, now) {
  const R = f.r || 42, fade = Math.min(1, (1 - (f.k || 0)) * 4);
  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.globalAlpha = 0.16 * fade; ctx.fillStyle = '#2a8ad0';
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.8 * fade; ctx.strokeStyle = '#7ad8ff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 0.5 * fade; ctx.strokeStyle = '#e8fbff'; ctx.lineWidth = 1;
  ctx.setLineDash([4, 5]); ctx.lineDashOffset = -now * 30;
  ctx.beginPath(); ctx.arc(0, 0, R - 4, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const a = now * 5 + i * Math.PI / 2;
    ctx.globalAlpha = 0.55 * fade;
    ctx.strokeStyle = i % 2 ? '#7ad8ff' : '#e8fbff';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let k = 0; k <= 10; k++) {
      const r = 6 + (k / 10) * (R - 8), aa = a + (k / 10) * 2.4;
      const px = Math.cos(aa) * r, py = Math.sin(aa) * r;
      if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// An open, grasping hand pointing along +X: palm, thumb, four clawed fingers.
function fireHandShape(s, color, now) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.ellipse(-1, 0, 8.5 * s, 9 * s, 0, 0, Math.PI * 2); ctx.fill();
  // Four fingers fanned wide open, each bending into a claw at the tip.
  const fingers = [[-6.6, -0.42, 13], [-2.2, -0.14, 16], [2.2, 0.14, 16], [6.6, 0.42, 13]];
  ctx.lineWidth = 4.4 * s;
  fingers.forEach(([y, spread, len], i) => {
    const a1 = spread + Math.sin(now * 9 + i * 1.3) * 0.07;
    const x0 = 5, x1 = x0 + Math.cos(a1) * len * 0.62, y1 = y + Math.sin(a1) * len * 0.62;
    const a2 = a1 + (y < 0 ? 0.55 : -0.55);
    const x2 = x1 + Math.cos(a2) * len * 0.42, y2 = y1 + Math.sin(a2) * len * 0.42;
    ctx.beginPath(); ctx.moveTo(x0, y * 0.8); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  });
  // Thumb, splayed out to the side.
  ctx.lineWidth = 4.8 * s;
  ctx.beginPath(); ctx.moveTo(-3, -6); ctx.lineTo(1, -14); ctx.lineTo(7, -16.5); ctx.stroke();
}

// The SUPER touch button appears only while holding a weapon that has one,
// and dims while it recharges.
// Ability touch buttons (one per slot): shown only for equipped abilities,
// dimmed while cooling.
const AB_KEYS = ['Q', 'E', 'F', 'G', 'V', 'B'];
const AB_CODES = ['KeyQ', 'KeyE', 'KeyF', 'KeyG', 'KeyV', 'KeyB'];
const abBtnState = AB_KEYS.map(() => ({ id: undefined, cooling: null }));
function syncAbilityButtons(me) {
  for (let i = 0; i < AB_KEYS.length; i++) {
    const el = document.getElementById('btn-ab' + (i + 1));
    if (!el) continue;
    const a = me && me.abil ? me.abil[i] : null;
    const id = a ? a.id : null, st = abBtnState[i];
    if (id !== st.id) {
      st.id = id;
      const def = abilityDef(id);
      const ic = el.querySelector('canvas.ab-ic');
      if (ic && def) drawAbilityIcon(ic.getContext('2d'), id, ic.width, ic.height);
      el.title = def ? def.name : '';
      if (def) el.style.setProperty('--abc', def.color); else el.style.removeProperty('--abc');
      el.classList.toggle('hidden-btn', !id);
      touchZonesAt = -1e9;
      if (!id) touchKeys['ab' + (i + 1)] = false;
    }
    const cooling = !!(a && a.cd > 0);
    if (cooling !== st.cooling) { st.cooling = cooling; el.classList.toggle('cooling', cooling); }
  }
}

let superBtnShown = null, superBtnCooling = null;
function syncSuperButton(me) {
  const el = document.getElementById('btn-super');
  if (!el) return;
  const show = !!(me && me.superMax > 0);
  if (show !== superBtnShown) {
    superBtnShown = show;
    el.classList.toggle('hidden-btn', !show);
    touchZonesAt = -1e9;   // the button column changed size: re-measure
    if (!show) touchKeys.super = false;
  }
  const cooling = show && (me.superCd || 0) > 0 && !me.controlling;
  if (cooling !== superBtnCooling) { superBtnCooling = cooling; el.classList.toggle('cooling', cooling); }
  const label = me && me.controlling ? 'LET GO' : 'SUPER';
  if (el.textContent !== label) el.textContent = label;
  // Inside a monster, SPECIAL is its own ability.
  const sp = document.getElementById('btn-special');
  if (sp) {
    const spLabel = me && me.pupAb ? me.pupAb : 'SPECIAL';
    if (sp.textContent !== spLabel) sp.textContent = spLabel;
  }
}

// Thrusting weapons: a straight lunge along the aim to the weapon's reach.
function drawStabSlash(sl, alpha, prog, u) {
  const cx = sl.px, cy = sl.py;
  const aim = sl.angle ?? (sl.facing === 1 ? 0 : Math.PI);
  const ca = Math.cos(aim), sa = Math.sin(aim);
  const r0 = 8, r1 = sl.reach * (0.55 + 0.45 * easeOut(Math.min(1, prog * 1.6)));
  const heft = 2.4 * u.weight;
  ctx.strokeStyle = sl.color;
  ctx.globalAlpha = alpha * 0.8;
  ctx.lineWidth = heft;
  ctx.beginPath(); ctx.moveTo(cx + ca * r0, cy + sa * r0); ctx.lineTo(cx + ca * r1, cy + sa * r1); ctx.stroke();
  // Side streaks give it speed.
  ctx.globalAlpha = alpha * 0.4;
  ctx.lineWidth = 1;
  for (const off of [-4, 4]) {
    const ox = -sa * off, oy = ca * off;
    ctx.beginPath();
    ctx.moveTo(cx + ca * (r0 + 6) + ox, cy + sa * (r0 + 6) + oy);
    ctx.lineTo(cx + ca * (r1 - 6) + ox, cy + sa * (r1 - 6) + oy);
    ctx.stroke();
  }
  // Glinting point.
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx + ca * (r1 + 5), cy + sa * (r1 + 5));
  ctx.lineTo(cx + ca * r1 - sa * 3, cy + sa * r1 + ca * 3);
  ctx.lineTo(cx + ca * r1 + sa * 3, cy + sa * r1 - ca * 3);
  ctx.closePath(); ctx.fill();
}

// ─── Input ────────────────────────────────────────────────────────────────────

const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const keys = {};
// Where the mouse is over the arena, in world coordinates. Only a real mouse
// counts: a tap on a phone mustn't leave a stale aim point behind.
let mouseAim = null;
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return;
  mouseAim = { x: (e.clientX - r.left) * CANVAS_W / r.width, y: (e.clientY - r.top) * CANVAS_H / r.height };
  // Holding a dash key: keep the server's aim fresh for the next dash.
  if (AB_CODES.some(c => keys[c])) sendInput();
});
canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') mouseAim = null; });

const touchKeys = { up: false, down: false, left: false, right: false, attack: false, swap: false, swapPrev: false, special: false, parry: false, super: false,
                    ab1: false, ab2: false, ab3: false, ab4: false, ab5: false, ab6: false };

window.addEventListener('keydown', (e) => {
  if (!keys[e.code]) { keys[e.code] = true; sendInput(); }
  if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','ShiftLeft','ShiftRight','KeyP','ControlLeft','ControlRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'Space' && currState && currState.gameState === 'WEAPON_UNLOCK' && currState.pendingUnlock) sendAckUnlock();
  if (e.code === 'KeyM') toggleSound();
  if (e.code === 'F3') { e.preventDefault(); toggleNetOverlay(); }
  if (e.code === 'KeyT' && currState && currState.gameState === 'GAMEPLAY' && document.activeElement?.tagName !== 'INPUT') toggleChat();
  if (e.code === 'Escape') toggleChat(false);
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
    swapPrev: !!keys['KeyZ']      || touchKeys.swapPrev,
    special: !!keys['ShiftLeft'] || !!keys['ShiftRight'] || touchKeys.special,
    parry:   !!keys['KeyP'] || !!keys['ControlLeft'] || !!keys['ControlRight'] || touchKeys.parry,
    super:   !!keys['KeyR'] || touchKeys.super,
    ab1:     !!keys['KeyQ'] || touchKeys.ab1,
    ab2:     !!keys['KeyE'] || touchKeys.ab2,
    ab3:     !!keys['KeyF'] || touchKeys.ab3,
    ab4:     !!keys['KeyG'] || touchKeys.ab4,
    ab5:     !!keys['KeyV'] || touchKeys.ab5,
    ab6:     !!keys['KeyB'] || touchKeys.ab6,
    // Mouse position in the world, for DASH (desktop only).
    aimX:    mouseAim ? Math.round(mouseAim.x) : null,
    aimY:    mouseAim ? Math.round(mouseAim.y) : null,
  };
}

let localPrevAttack = false, localPrevSwap = false, localPrevSwapPrev = false;
let localAtkCd = 0;          // client-mirrored attack cooldown (ms)
let lastLocalSlashTime = 0;  // suppress the server echo of a slash we already showed

function sendInput() {
  if (!ws || ws.readyState !== 1) return;
  const inp = currentInputs();
  ws.send(JSON.stringify({ type:'input', keys: inp }));
  // Predict the attack swing locally for instant feedback (rising edge only).
  if (inp.attack && !localPrevAttack) tryLocalAttack();
  // Swapping off the dagger drops the cloak.
  if (((inp.swap && !localPrevSwap) || (inp.swapPrev && !localPrevSwapPrev)) && localGhost?.on !== false && currState?.players) {
    const me = currState.players[myKeyOf()];
    if (me && ghostNow(me)) localGhost = { on: false, at: performance.now() };
  }
  localPrevAttack = inp.attack;
  localPrevSwap = inp.swap;
  localPrevSwapPrev = inp.swapPrev;
}

function tryLocalAttack() {
  if (!currState || currState.gameState !== 'GAMEPLAY' || !myNum) return;
  const key = myKeyOf();
  const me = currState.players?.[key];
  if (!me || me.dead || me.controlling || me.kspin > 0 || localAtkCd > 0) return;   // no swings mid-spin
  const haste = me.effects && me.effects.haste > 0;
  // atkSpd comes from the server so weapon upgrades stay in sync.
  localAtkCd = (me.atkSpd || WEAPON_META[me.weaponId]?.atkSpd || 400) * (haste ? 0.5 : 1);
  if (me.weaponId === 'ghostdagger') {
    // Out in the open the attack is the cloak itself (no stab); cloaked, it's
    // the ghost strike, which ends it.
    const was = ghostNow(me);
    localGhost = { on: !was, at: performance.now() };
    if (!was) { localAtkCd = Math.max(localAtkCd, 700); lastLocalSlashTime = performance.now(); return; }
  }
  if (me.weaponId === 'lightblade') return;   // its swipe comes at the end of the dash, from the server
  spawnLocalSlash(me, key);
}

function spawnLocalSlash(me, key) {
  const px = pred ? pred.x : me.x, py = pred ? pred.y : me.y;
  const facing = pred ? pred.facing : me.facing;
  const cp = { ...me, x: px, y: py, facing };
  if (window.GameAudio) GameAudio.sfx[isRanged(me.weaponId) ? 'shoot' : 'swing']();
  pushSlash(cp, nearestEnemyAngle(cp, currState, key) ?? (facing === 1 ? 0 : Math.PI), key);
  lastLocalSlashTime = performance.now();
}
// ── Admin tools: only shown when the server says we're an admin ──
let adminSkipShown = null;
function syncAdminTools(state) {
  const show = !!(state.isAdmin && state.gameMode !== 'pvp' && state.gameState === 'GAMEPLAY');
  if (show === adminSkipShown) return;
  adminSkipShown = show;
  const b = document.getElementById('skipWaveBtn');
  if (b) b.classList.toggle('shown', show);
  touchZonesAt = -1e9;   // the top-right buttons changed width: re-measure
}
// ── How to play ──
function openHowTo() { showScreen('howtoScreen'); }
function closeHowTo() { showScreen('startScreen'); }

// ── Sandbox tools ──
// The panel is built once from the server's lists; its buttons send
// { type: 'sandbox', action, ... } and the toggles mirror state.sandbox.
let SANDBOX_DEFS = null, sandboxBuilt = false, sandboxShown = null;
function sendSandbox(action, extra) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'sandbox', action, ...extra }));
}
function buildSandboxPanel() {
  if (sandboxBuilt || !SANDBOX_DEFS) return;
  sandboxBuilt = true;
  const btn = (attrs, label, color) =>
    `<button class="sb-btn" ${attrs} style="${color ? 'color:' + color : ''}">${label}</button>`;
  document.getElementById('sbMonsters').innerHTML = SANDBOX_DEFS.monsters.map(m =>
    btn(`data-act="spawn" data-what="${m.id}"`, (m.boss ? '&#9733; ' : '') + m.name, m.color)).join('');
  document.getElementById('sbItems').innerHTML = SANDBOX_DEFS.items.map(t =>
    btn(`data-act="item" data-what="${t.id}"`, t.name, t.color)).join('');
  document.getElementById('sbTraps').innerHTML = SANDBOX_DEFS.traps.map(t =>
    btn(`data-act="trap" data-what="${t.id}"`, t.name, t.color)).join('');
  const opts = '<option value="">- NONE -</option>' + ABILITY_DEFS.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
  for (let i = 0; i < AB_KEYS.length; i++) {
    const sel = document.getElementById('sbAb' + i);
    if (!sel) continue;
    sel.innerHTML = opts;
    sel.addEventListener('change', () => { sendSandbox('ability', { slot: i, what: sel.value || null }); sel.blur(); });
  }
  const lvl = document.getElementById('sbLevel'), lvlVal = document.getElementById('sbLevelVal');
  lvl.addEventListener('input', () => { lvlVal.textContent = lvl.value; });
  lvl.addEventListener('change', () => { sendSandbox('level', { value: Number(lvl.value) }); lvl.blur(); });
  document.getElementById('sbCount').addEventListener('change', e => e.target.blur());
  const panel = document.getElementById('sandboxPanel');
  // Buttons never take focus, so SPACE keeps attacking instead of re-clicking them.
  panel.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
  panel.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.toggle) sendSandbox('toggle', { what: b.dataset.toggle });
    else if (b.dataset.act === 'spawn') sendSandbox('spawn', { what: b.dataset.what, count: Number(document.getElementById('sbCount').value) });
    else if (b.dataset.act) sendSandbox(b.dataset.act, { what: b.dataset.what });
  });
}
function toggleSandboxPanel(show) {
  const panel = document.getElementById('sandboxPanel');
  if (!panel) return;
  const open = show === undefined ? panel.classList.contains('hidden') : show;
  if (open) buildSandboxPanel();
  panel.classList.toggle('hidden', !open);
}
function syncSandbox(state) {
  const on = state.gameMode === 'sandbox' && state.gameState === 'GAMEPLAY' && !state.sandbox?.tutorial;
  if (on !== sandboxShown) {
    sandboxShown = on;
    document.getElementById('sandboxBtn')?.classList.toggle('shown', on);
    if (!on) toggleSandboxPanel(false);
    touchZonesAt = -1e9;   // the top-right buttons changed width: re-measure
  }
  if (!on || !state.sandbox) return;
  for (const b of document.querySelectorAll('#sandboxPanel .sb-toggle')) b.classList.toggle('on', !!state.sandbox[b.dataset.toggle]);
  const me = state.players?.p1;
  for (let i = 0; i < AB_KEYS.length; i++) {
    const sel = document.getElementById('sbAb' + i);
    const want = (me && me.abil && me.abil[i] && me.abil[i].id) || '';
    if (sel && document.activeElement !== sel && sel.value !== want) sel.value = want;
  }
}

function skipWave() {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'skip_wave' }));
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
  if (handleCanvasTap(e.clientX, e.clientY)) { e.preventDefault(); return; }
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (tryBladeDash(e.clientX, e.clientY)) e.preventDefault();
}, { passive: false });

// Light Blade: clicking (or tapping) the field dashes you there.
function tryBladeDash(clientX, clientY) {
  if (!currState || currState.gameState !== 'GAMEPLAY' || !myNum || !ws || ws.readyState !== 1) return false;
  const me = currState.players?.['p' + myNum];
  if (!me || me.dead || me.controlling || me.weaponId !== 'lightblade') return false;
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  const x = Math.round((clientX - r.left) * CANVAS_W / r.width), y = Math.round((clientY - r.top) * CANVAS_H / r.height);
  ws.send(JSON.stringify({ type: 'blade_dash', x, y }));
  bladeTapMark = { x, y, at: performance.now() };
  return true;
}
let bladeTapMark = null;

// ─── Touch Controls ───────────────────────────────────────────────────────────

function setupTouchControls() {
  if (!isTouchDevice) return;
  const tc = document.getElementById('touchControls');
  if (tc) tc.classList.add('visible');

  const btnMap = [
    ['btn-up','up'], ['btn-down','down'], ['btn-left','left'],
    ['btn-right','right'], ['btn-attack','attack'], ['btn-next','swap'], ['btn-prev','swapPrev'],
    ['btn-special','special'], ['btn-parry','parry'], ['btn-super','super'],
    ['btn-ab1','ab1'], ['btn-ab2','ab2'], ['btn-ab3','ab3'], ['btn-ab4','ab4'], ['btn-ab5','ab5'], ['btn-ab6','ab6'],
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

  setupJoystick();

  // Tap unlock screen to continue
  const unlockOverlay = document.getElementById('unlockScreen');
  if (unlockOverlay) {
    unlockOverlay.addEventListener('touchend', (e) => {
      e.preventDefault();
      if (currState && currState.gameState === 'WEAPON_UNLOCK' && currState.pendingUnlock) sendAckUnlock();
    }, { passive: false });
  }
}
// Movement joystick: drag the knob; it moves you in 8 directions (the game's
// movement is digital) and springs back when you let go. The finger may wander
// outside the ring while dragging and it keeps working.
function setupJoystick() {
  const base = document.getElementById('joystick'), knob = document.getElementById('joyKnob');
  if (!base || !knob) return;
  let id = null;
  const DEAD = 0.28, AXIS = 0.38;
  const set = (u, d, l, r) => {
    if (touchKeys.up === u && touchKeys.down === d && touchKeys.left === l && touchKeys.right === r) return;
    touchKeys.up = u; touchKeys.down = d; touchKeys.left = l; touchKeys.right = r;
    sendInput();
  };
  const move = (t) => {
    const rc = base.getBoundingClientRect();
    const R = rc.width / 2;
    let dx = t.clientX - (rc.left + R), dy = t.clientY - (rc.top + R);
    const d = Math.hypot(dx, dy), max = R * 0.62;
    const k = d > max ? max / d : 1;
    knob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
    const m = Math.min(1, d / max);
    if (m < DEAD) { set(false, false, false, false); return; }
    const nx = dx / d, ny = dy / d;
    set(ny < -AXIS, ny > AXIS, nx < -AXIS, nx > AXIS);
  };
  const end = () => {
    id = null; base.classList.remove('active');
    knob.style.transform = 'translate(-50%, -50%)';
    set(false, false, false, false);
  };
  base.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (id !== null) return;
    const t = e.changedTouches[0]; id = t.identifier;
    base.classList.add('active'); move(t);
  }, { passive: false });
  window.addEventListener('touchmove', (e) => {
    if (id === null) return;
    for (const t of e.changedTouches) if (t.identifier === id) { move(t); e.preventDefault(); }
  }, { passive: false });
  const lift = (e) => { for (const t of e.changedTouches) if (t.identifier === id) end(); };
  window.addEventListener('touchend', lift);
  window.addEventListener('touchcancel', lift);
}
setupTouchControls();
restoreCredentials();

// Reflect saved audio preferences on the start-screen buttons
if (window.GameAudio) {
  const sbtn = document.getElementById('soundBtn');
  if (sbtn) { const m = GameAudio.isMuted(); sbtn.textContent = m ? 'OFF' : 'ON'; sbtn.classList.toggle('on', !m); }
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
      body: JSON.stringify({ password: pendingPass, localXp: loadLocalXp(pendingPass), localCoins: loadLocalCoins(pendingPass), backup: loadBackup(pendingPass) }),
    });
    const data = await res.json();
    storeBackup(pendingPass, data.save);
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
function selectSkinAcc(idx) {
  pendingSkin.accIdx = idx;
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
      body: JSON.stringify({ password: pendingPass, skinId: id, localCoins: loadLocalCoins(pendingPass), backup: loadBackup(pendingPass) }),
    });
    const data = await res.json();
    storeBackup(pendingPass, data.save);
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
  const ag = document.getElementById('accGrid');
  if (ag) ag.innerHTML = SKIN_ACCS.map((a, i) =>
    `<div class="skin-hat${i === (pendingSkin.accIdx | 0) ? ' selected' : ''}" onclick="selectSkinAcc(${i})">${a}</div>`
  ).join('');
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
    const spr = playerSprite(color, pendingSkin.hatIdx, 1, false, cv.dataset.outfit, pendingSkin.accIdx);
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
  const cv = playerSprite(color, pendingSkin.hatIdx, 1, false, pendingSkin.outfit || '', pendingSkin.accIdx);
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
        backup: loadBackup(pendingPass),
      }),
    });
    const data = await res.json();
    storeBackup(pendingPass, data.save);
    if (!res.ok) { setShopMsg(data.error || 'Could not load your profile.', true); return; }
    shopData = data;
    applyCatalog(data.catalog, data.colors);
    saveLocalCoins(pendingPass, data.coins);
    setShopMsg(data.refunded
      ? `Some upgrades were changed. The old levels were refunded: +${data.refunded.toLocaleString()} coins.`
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

  const perkIds = Object.keys(shopData.perks || {});
  // Parry and character first, then legendary weapons for sale, then your weapons.
  list.innerHTML = [...perkIds, '__legend__', ...weapons].map(id => {
    if (id === '__legend__') return mythicPicker(weapons) + legendaryCards(weapons, coins);
    const lv = upgrades[id] || {};
    const perk = PERK_ROWS[id];
    const name = perk ? perk.name : WEAPON_META[id]?.name || id.toUpperCase();
    const col = perk ? perk.color : WEAPON_COLOR[id] || '#ccc';
    // Each weapon has its own three upgrades, listed in the server catalog.
    const stats = (shopData.perks?.[id] || WEAPON_META[id]?.upgrades || ['dmg', 'spd', 'rng']).filter(k => upgradeDefs[k]);
    // One tap = one level (counted instantly, sent in batches); MAX buys every
    // level the coins cover. Button contents are refreshed in place by
    // refreshShopButtons, so a button is never swapped out under a finger.
    const rows = stats.map(stat => {
      const def = upgradeDefs[stat];
      return `<span class="up-grp">
        <button class="up-btn" data-w="${id}" data-s="${stat}" onclick="tapUpgrade('${id}','${stat}',1)"
          title="${def.name}: ${def.desc || ''} per level"></button>
        <button class="up-max" data-w="${id}" data-s="${stat}" onclick="tapUpgrade('${id}','${stat}','max')"
          title="Buy every ${def.name} level you can afford">MAX</button></span>`;
    }).join('');
    const desc = stats.map(k => `<b>${upgradeDefs[k].short}</b> ${upgradeDefs[k].desc || ''}`).join(' · ');
    return `<div class="shop-row">
      <div class="shop-head">
        <canvas class="shop-ic" data-weapon="${id}" width="56" height="32"></canvas>
        <span class="shop-name" style="color:${col}">${name}</span>
      </div>
      <div class="shop-stats">${rows}</div>
      <div class="shop-desc">${desc}</div>
      ${WEAPON_META[id]?.passive ? `<div class="shop-passive" data-pw="${id}" style="--pc:${WEAPON_META[id].passive.color}"></div>` : ''}
    </div>`;
  }).join('');

  for (const cv of list.querySelectorAll('canvas.shop-ic')) {
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    const id = cv.dataset.weapon;
    g.imageSmoothingEnabled = false;
    if (PERK_ROWS[id]) { PERK_ROWS[id].icon(g, cv.width, cv.height); continue; }
    drawWeaponPixelsFitted(g, id, cv.width / 2, cv.height / 2, cv.width - 8, cv.height - 8,
                           WEAPON_COLOR[id] || '#ccc');
  }
  refreshShopButtons();
}

// A legendary's passive, shown on its card before you own it.
function legendPassive(id) {
  const pv = WEAPON_META[id]?.passive;
  return pv ? `<div class="shop-passive" style="--pc:${pv.color}"><b>★ PASSIVE: ${pv.name}</b> &ndash; ${pv.desc} while you hold it. <span class="pv-state">Max every upgrade on it to unlock</span></div>` : '';
}

const LEGEND_MOVES = {
  starfall: '<b>ATK</b> a star falls on the nearest enemy (a marker shows where) · <b>SPECIAL</b> a constellation joins up to'
          + ' 5 enemies: a moment later they all take the hit, are dragged together and dazed · <b>SUPER</b> a 4s star shower'
          + ' on everything around you. Only one mythic goes into a game, and a mythic never earns you another weapon.',
  darklight: '<b>ATK</b> adds a kunai circling you (up to 10; each goes through one foe and breaks on the next) · <b>SPECIAL</b>'
           + ' every kunai flies at your enemies and chains whoever it hits to the spot for 3s, abilities or not ·'
           + ' <b>SUPER</b> a dark and a light kunai at blinding speed into one foe: a parry shatters them, otherwise it suffers'
           + ' every bad effect for 8s (only a short stun), and so does anyone who comes close. Only one mythic goes into a game, and a mythic'
           + ' never earns you another weapon.',
  mindtome:    '<b>ATK</b> (fast) a psychic trap appears right in the path of a nearby enemy: spikes, mines, ice,'
             + ' lava, gravity wells and more, and they only ever hurt YOUR enemies (up to 6 out at once) ·'
             + ' <b>SPECIAL</b> four beams of mind energy spin out from you; every enemy they touch is frozen for 5s'
             + ' (bosses and players are slowed) · <b>SUPER</b> MIND CONTROL: take over the strongest enemy on the map'
             + ' &ndash; 20s for a monster, 5s for a boss or another player. You vanish and can\'t be hurt; your moves'
             + ' drive it, your attack uses ITS attack on its own side, and you can march it into traps. Press SUPER'
             + ' again to let go. Needs the Storm Tome fully maxed and three other legendaries.',
  chronostaff: '<b>ATK</b> bolts of slowed time that drag whatever they hit to a crawl · <b>SPECIAL</b> TIME STOP:'
             + ' every foe close around you is frozen where it stands for 2s, and enemy shots nearby vanish ·'
             + ' <b>SUPER</b> REWIND: your health goes back to the best it was in the last 4s, burns and curses'
             + ' are undone, your special is ready again and you get 4s of speed and haste. Needs another legendary.',
  voidblade:   '<b>ATK</b> a heavy cut, and a piercing wave of void flies on ahead of every swing ·'
             + ' <b>SPECIAL</b> RIFT STEP: through a rift to the nearest foe, cutting and stunning everything around'
             + ' where you land · <b>SUPER</b> SINGULARITY: a huge black hole drags the whole area in for 3s, then'
             + ' collapses in a massive blast. Needs another legendary.',
  stormhammer: '<b>ATK</b> a heavy hammer blow; lightning arcs from every foe it hits on to 2 more nearby, for half'
             + ' the damage · <b>SPECIAL</b> hurl the hammer: it smashes through everything in its path, stunning'
             + ' them, then flies back to your hand and hits them again · <b>SUPER</b> THUNDER GOD: for 6s, lightning'
             + ' strikes the 3 nearest foes every 0.45s. Needs another legendary.',
  frostscythe: '<b>ATK</b> a full 360&deg; sweep; every hit adds a frostbite stack and the third freezes the target'
             + ' solid for 1.5s (bosses and players are slowed instead); stacks fade after 4s · <b>SPECIAL</b> ten'
             + ' ice shards burst out in a ring, piercing, slowing and adding frostbite · <b>SUPER</b> ABSOLUTE ZERO: a'
             + ' 5s blizzard around you that grinds and freezes everything inside, and SHATTERS frozen foes for double'
             + ' damage. Needs another legendary.',
  sunbow:      '<b>ATK</b> fast arrows of sunlight that pierce through every foe in a line and set them alight ·'
             + ' <b>SPECIAL</b> a small sun hangs in the air for 4.5s, beaming the nearest foe in reach again and again ·'
             + ' <b>SUPER</b> SUPERNOVA: a beam of sunlight right across the arena that sweeps a wide arc for 2.5s,'
             + ' burning everything it crosses. Needs another legendary.',
  ghostdagger: '<b>ATK</b> melt into the shadows: invisible to every enemy (you still see yourself) and 75% faster;'
             + ' your next attack is a double-damage ghost strike that ends it, and so does a special, a super, an'
             + ' ability or a weapon swap · <b>SPECIAL</b> throw a fan of five daggers: the middle one takes at least'
             + ' 16% of the target\'s health (32% in the back) · <b>SUPER</b> throw it skyward and it rains knives that'
             + ' hit hard where they\'re marked; a quarter of them become medkits that heal on touch.',
  lightblade: '<b>ATK</b> dash to wherever you click (or tap on a phone) &ndash; or toward the nearest foe with the'
            + ' attack key &ndash; cutting through anything in the way, then swipe all round as you land ·'
            + ' <b>SPECIAL</b> five curving dashes that hunt down your enemies (or the nearest pickup if there are none):'
            + ' anything you hit is stunned and hurled into the wall · <b>SUPER</b> LIGHTSPEED: 8s at triple speed,'
            + ' lightning zapping everything that comes close, and crash into a foe for a huge lightning blast that'
            + ' stuns everyone around for 2s.',
  samuraiblade: '<b>ATK</b> a slash wave that flies after your enemies · <b>SPECIAL</b> a quiet wave: when it reaches a foe you'
             + ' flash through them at near light speed for huge damage · <b>SUPER</b> spin for 5s, far faster and gliding, cutting and'
             + ' slowing everything you touch',
  endlessscythe: '<b>ATK</b> a scythe swipe, joined by the two scythes floating behind you · <b>SPECIAL</b> a void beam spins a full circle round you, fast, dragging everything in'
             + ' like a black hole · <b>SUPER</b> the Abyss\'s second phase: six scythes whirl round you, are flung out, then one huge slash',
  infinitybow: '<b>ATK</b> a rapid burst of void bolts from all three crossbows · <b>SPECIAL</b> the Abyss\'s massive orb gathers, then flies'
             + ' (it bursts only on impact) · <b>SUPER</b> all three shoot one spot: a black hole opens there that spits even more bolts'
             + ' and collapses for extreme damage',
  portalwand: '<b>ATK</b> small fire portals open beside you and throw exploding fireballs · <b>SPECIAL</b> jump through a portal to the safest spot on the'
            + ' field (furthest from foes, clear of shots and traps), leaving a fire portal behind that keeps shooting ·'
            + ' <b>SUPER</b> portal legion: portals in your colour pour out monsters that fight on your side for 14s.'
            + ' Never for sale.',
  fireglove: '<b>ATK</b> a ring of fire that grows for 1s · <b>SPECIAL</b> a fire hand that hunts your foe and explodes'
           + ' (hit or parry it to break it; MULTISHOT adds hands) · <b>SUPER</b> five inferno rings, one after another,'
           + ' each growing until parried',
  windwand: '<b>ATK</b> a piercing gust that shoves foes back · <b>SPECIAL</b> a tornado that drifts forward, dragging foes'
          + ' in and shredding them · <b>SUPER</b> a 5s hurricane around you that flings foes away and blows enemy shots'
          + ' out of the air. No other weapons needed.',
  revolver: '<b>ATK</b> fast bullets that explode on hit · <b>SPECIAL</b> fan the hammer: six exploding shots at once ·'
          + ' <b>SUPER</b> dead eye: an exploding bullet into every enemy on the field. No other weapons needed.',
  vortex: '<b>ATK</b> a 3s shield that blocks every hit and banks the damage it stopped · <b>SPECIAL</b> a 3s lightning'
        + ' force field around you: anything that touches it takes the whole bank · <b>SUPER</b> heals 1.5x the bank · special and super empty it.'
        + ' No other weapons needed.',
};

// Shop-only weapons (the fire glove) you don't own yet: bought with coins,
// and only once every other weapon is unlocked.
function legendaryCards(weapons, coins) {
  const all = Object.values(WEAPON_META);
  const xpIds = all.filter(w => !w.shopOnly).map(w => w.id);
  const have = xpIds.filter(id => weapons.includes(id)).length;
  return all.filter(w => w.shopOnly && !weapons.includes(w.id)).map(w => {
    const haveLegend = all.some(o => o.shopOnly && o.id !== w.id && weapons.includes(o.id));
    const legendOk = !w.needLegendary || haveLegend;
    const ready = legendOk && (w.noRequirement || have >= xpIds.length);
    const afford = coins >= w.price;
    const col = WEAPON_COLOR[w.id] || '#ff6a1a';
    if (w.mythic) {
      const up = (shopData && shopData.upgrades) || {}, defs = (shopData && shopData.upgradeDefs) || {};
      const maxed = id => weapons.includes(id) && (WEAPON_META[id]?.upgrades || []).filter(k => defs[k]).every(k => ((up[id] || {})[k] || 0) >= defs[k].max);
      const needs = (w.mythicNeeds || []).map(id => `<span class="${maxed(id) ? 'need-ok' : 'need-no'}">${maxed(id) ? '✔' : '✘'} ${WEAPON_META[id]?.name || id} maxed</span>`).join(' ');
      const kills = Math.min((shopData && shopData.mythicKills) || 0, w.mythicKills || 0);
      return `<div class="shop-row legendary mythic-row">
        <div class="shop-head">
          <canvas class="shop-ic" data-weapon="${w.id}" width="56" height="32"></canvas>
          <span class="shop-name mythic-name">${w.name}</span>
          <span class="legend-tag mythic-tag">MYTHIC</span>
        </div>
        <div class="shop-desc">${WEAPON_DESC[w.id] || ''}. ${LEGEND_MOVES[w.id] || ''}</div>${legendPassive(w.id)}
        <div class="legend-buy">
          <button class="buy-weapon poor" disabled>◆ ${w.price.toLocaleString()}</button>
          <span class="legend-need">Only sold in the <b>RARE SHOP</b> that opens after a Giant wave (WAVES, EXTREME).<br>
            ${needs} <span class="${kills >= w.mythicKills ? 'need-ok' : 'need-no'}">${kills >= w.mythicKills ? '✔' : '✘'} enemies killed ${kills.toLocaleString()}/${(w.mythicKills || 0).toLocaleString()}</span></span>
        </div>
      </div>`;
    }
    if (w.bossReward) {
      return `<div class="shop-row legendary">
        <div class="shop-head">
          <canvas class="shop-ic" data-weapon="${w.id}" width="56" height="32"></canvas>
          <span class="shop-name" style="color:${col}">${w.name}</span>
          <span class="legend-tag">LEGENDARY</span>
        </div>
        <div class="shop-desc">${WEAPON_DESC[w.id] || ''}. ${LEGEND_MOVES[w.id] || ''}</div>${legendPassive(w.id)}
        <div class="legend-buy">
          <button class="buy-weapon poor" disabled>BOSS REWARD</button>
          <span class="legend-need">${w.id === 'infinitybow' ? 'Survive the Abyss to earn it' : w.id === 'endlessscythe' ? 'Defeat the Abyss a second time to earn it' : 'Defeat the Portal Mage to earn it'}</span>
        </div>
      </div>`;
    }
    if (w.needMind) {
      const up = (shopData && shopData.upgrades && shopData.upgrades.stormtome) || {};
      const defs = (shopData && shopData.upgradeDefs) || {};
      const tStats = (WEAPON_META.stormtome?.upgrades || []).filter(k => defs[k]);
      const tDone = weapons.includes('stormtome') ? tStats.filter(k => (up[k] || 0) >= defs[k].max).length : 0;
      const legends = all.filter(o => o.shopOnly && o.id !== w.id && weapons.includes(o.id)).length;
      const ok = tDone === tStats.length && tStats.length > 0 && legends >= 3;
      const need = !weapons.includes('stormtome') ? 'Unlock the Storm Tome, max every upgrade on it, and own 3 other legendaries'
        : tDone < tStats.length ? `Max out the Storm Tome first: ${tDone}/${tStats.length} upgrades maxed &middot; legendaries ${Math.min(legends, 3)}/3`
        : legends < 3 ? `Own 3 other legendary weapons first: ${legends}/3`
        : (coins >= w.price ? 'Ready to buy!' : `Need ${(w.price - coins).toLocaleString()} more coins`);
      return `<div class="shop-row legendary mind-row">
        <div class="shop-head">
          <canvas class="shop-ic" data-weapon="${w.id}" width="56" height="32"></canvas>
          <span class="shop-name" style="color:${col}">${w.name}</span>
          <span class="legend-tag mind-tag">MIND</span>
        </div>
        <div class="shop-desc">${WEAPON_DESC[w.id] || ''}. ${LEGEND_MOVES[w.id] || ''}</div>${legendPassive(w.id)}
        <div class="legend-buy">
          <button class="buy-weapon${ok && coins >= w.price ? '' : ' poor'}" onclick="buyWeapon('${w.id}')" ${ok ? '' : 'disabled'}>BUY ◆${w.price.toLocaleString()}</button>
          <span class="legend-need">${need}</span>
        </div>
      </div>`;
    }
    if (w.needSamurai) {
      const kills = (shopData && shopData.samuraiKills) || 0, need = (shopData && shopData.samuraiNeed) || 30;
      const ok = kills >= need, afford = coins >= w.price;
      const msg = !ok ? `Defeat ${need} samurai (any runs): ${Math.min(kills, need)}/${need}`
        : afford ? 'His katana is yours to buy!' : `Need ${(w.price - coins).toLocaleString()} more coins`;
      return `<div class="shop-row legendary samurai-row">
        <div class="shop-head">
          <canvas class="shop-ic" data-weapon="${w.id}" width="56" height="32"></canvas>
          <span class="shop-name" style="color:${col}">${w.name}</span>
          <span class="legend-tag samurai-tag">LEGENDARY</span>
        </div>
        <div class="shop-desc">${WEAPON_DESC[w.id] || ''}. ${LEGEND_MOVES[w.id] || ''}</div>${legendPassive(w.id)}
        <div class="legend-buy">
          <button class="buy-weapon${ok && afford ? '' : ' poor'}" onclick="buyWeapon('${w.id}')" ${ok && afford ? '' : 'disabled'}>◆ ${w.price.toLocaleString()}</button>
          <span class="legend-need">${msg}</span>
        </div>
      </div>`;
    }
    if (w.needLight) {
      const kills = (shopData && shopData.lightKills) || 0;
      const maxed = (shopData && shopData.lightMaxed) || 0, needMax = (shopData && shopData.lightMaxedNeed) || 0;
      const ok = kills >= 3 && maxed >= needMax;
      const need = ok ? 'The light is yours - claim it!'
        : `Beat Light ${Math.min(kills, 3)}/3 times (any runs) &middot; weapons fully maxed ${maxed}/${needMax}`;
      return `<div class="shop-row legendary light-row">
        <div class="shop-head">
          <canvas class="shop-ic" data-weapon="${w.id}" width="56" height="32"></canvas>
          <span class="shop-name" style="color:${col}">${w.name}</span>
          <span class="legend-tag light-tag">LIGHT</span>
        </div>
        <div class="shop-desc">${WEAPON_DESC[w.id] || ''}. ${LEGEND_MOVES[w.id] || ''}</div>${legendPassive(w.id)}
        <div class="legend-buy">
          <button class="buy-weapon${ok ? '' : ' poor'}" onclick="buyWeapon('${w.id}')" ${ok ? '' : 'disabled'}>CLAIM</button>
          <span class="legend-need">${need}</span>
        </div>
      </div>`;
    }
    if (w.needAll) {
      const left = all.filter(o => o.id !== w.id && !o.mythic && !weapons.includes(o.id)).length;
      return `<div class="shop-row legendary ghost-row">
        <div class="shop-head">
          <canvas class="shop-ic" data-weapon="${w.id}" width="56" height="32"></canvas>
          <span class="shop-name" style="color:${col}">${w.name}</span>
          <span class="legend-tag ghost-tag">RAREST</span>
        </div>
        <div class="shop-desc">${WEAPON_DESC[w.id] || ''}. ${LEGEND_MOVES[w.id] || ''}</div>${legendPassive(w.id)}
        <div class="legend-buy">
          <button class="buy-weapon${left ? ' poor' : ''}" onclick="buyWeapon('${w.id}')" ${left ? 'disabled' : ''}>CLAIM</button>
          <span class="legend-need">${left ? `Own every other weapon in the game first: ${left} to go` : 'Every weapon is yours - claim it!'}</span>
        </div>
      </div>`;
    }
    const need = !legendOk ? 'Own at least one other legendary weapon first'
      : ready ? (afford ? 'Ready to buy!' : `Need ${(w.price - coins).toLocaleString()} more coins`)
      : `Unlock every other weapon first: ${have}/${xpIds.length}`;
    return `<div class="shop-row legendary">
      <div class="shop-head">
        <canvas class="shop-ic" data-weapon="${w.id}" width="56" height="32"></canvas>
        <span class="shop-name" style="color:${col}">${w.name}</span>
        <span class="legend-tag">LEGENDARY</span>
      </div>
      <div class="shop-desc">${WEAPON_DESC[w.id] || ''}. ${LEGEND_MOVES[w.id] || ''}</div>${legendPassive(w.id)}
      <div class="legend-buy">
        <button class="buy-weapon${ready && afford ? '' : ' poor'}" onclick="buyWeapon('${w.id}')"
          ${ready ? '' : 'disabled'}>BUY ◆${w.price.toLocaleString()}</button>
        <span class="legend-need">${need}</span>
      </div>
    </div>`;
  }).join('');
}

async function buyWeapon(id) {
  if (!pendingPass || !shopData || shopBusy) return;
  const w = WEAPON_META[id];
  if (!w) return;
  if (shopData.coins < w.price) { setShopMsg(`Not enough coins — ${w.name} costs ${w.price.toLocaleString()}.`, true); return; }
  shopBusy = true;
  try {
    const res = await fetch('/api/buy_weapon', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pendingPass, weaponId: id,
                             localXp: loadLocalXp(pendingPass), localCoins: loadLocalCoins(pendingPass), backup: loadBackup(pendingPass) }),
    });
    const data = await res.json();
    storeBackup(pendingPass, data.save);
    if (!res.ok) { setShopMsg(data.error || 'Purchase failed.', true); return; }
    shopData = { ...shopData, ...data };
    saveLocalCoins(pendingPass, data.coins);
    if (window.GameAudio) { GameAudio.init(); GameAudio.sfx.unlock(); }
    renderShop();
    setShopMsg(`${w.name} unlocked! Press R (or the SUPER button) in game for its super.`);
  } catch {
    setShopMsg('Could not reach the server.', true);
  } finally {
    shopBusy = false;
  }
}

// Upgrade rows that aren't weapons: how they're labelled and drawn in the shop.
const PERK_ROWS = {
  _parry: { name: 'PARRY', color: '#66ccff', icon(g, w, h) {
    // The parry flash: a ring with spikes, as it appears in game.
    const x = w / 2, y = h / 2;
    g.strokeStyle = '#66ccff'; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#cceeff'; g.lineWidth = 1.5;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      g.beginPath(); g.moveTo(x + Math.cos(a) * 11, y + Math.sin(a) * 11); g.lineTo(x + Math.cos(a) * 15, y + Math.sin(a) * 15); g.stroke();
    }
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x, y, 2.5, 0, Math.PI * 2); g.fill();
  } },
  _hero: { name: 'CHARACTER', color: '#ffcc55', icon(g, w, h) {
    // Your own character, in your chosen skin.
    const skin = pendingSkin || {};
    const spr = playerSprite(SKIN_COLORS[skin.colorIdx] || '#4488ff', skin.hatIdx || 0, 1, false, skin.outfit || '', skin.accIdx || 0);
    if (spr) g.drawImage(spr, Math.floor((w - spr.width) / 2), Math.floor((h - spr.height) / 2));
  } },
};

// Update every upgrade button's pips, price and state in place.
function refreshShopButtons() {
  if (!shopData) return;
  const { coins, upgrades, upgradeDefs, costs } = shopData;
  document.getElementById('shopCoins').innerHTML =
    `<span class="coin-ic">◆</span> ${coins.toLocaleString()} COINS`;
  // Each passive line shows how close its weapon is to unlocking it.
  for (const el of document.querySelectorAll('#shopList .shop-passive[data-pw]')) {
    const id = el.dataset.pw, pv = WEAPON_META[id]?.passive;
    const stats = (WEAPON_META[id]?.upgrades || []).filter(k => upgradeDefs[k]);
    const done = stats.filter(k => (upgrades[id]?.[k] || 0) >= upgradeDefs[k].max).length;
    const on = done === stats.length;
    el.classList.toggle('on', on);
    el.innerHTML = `<b>★ PASSIVE: ${pv.name}</b> &ndash; ${pv.desc} while you hold it. `
      + (on ? '<span class="pv-state">UNLOCKED</span>'
            : `<span class="pv-state">Max every upgrade to unlock (${done}/${stats.length} maxed)</span>`);
  }
  for (const b of document.querySelectorAll('#shopList .up-btn, #shopList .up-max')) {
    const id = b.dataset.w, stat = b.dataset.s, def = upgradeDefs[stat];
    if (!def) continue;
    const cur = upgrades[id]?.[stat] || 0;
    const maxed = cur >= def.max;
    const cost = maxed ? 0 : costs[stat][cur];
    const afford = !maxed && coins >= cost;
    b.disabled = maxed;
    b.classList.toggle('maxed', maxed);
    b.classList.toggle('poor', !maxed && !afford);
    if (b.classList.contains('up-max')) { b.style.display = maxed ? 'none' : ''; continue; }
    const pips = Array.from({ length: def.max }, (_, i) => `<i class="${i < cur ? 'on' : ''}"></i>`).join('');
    b.innerHTML = `<span class="up-name">${def.short || def.name.slice(0, 3)}</span>`
      + `<span class="up-pips">${pips}</span>`
      + `<span class="up-cost">${maxed ? 'MAX' : '◆' + cost}</span>`;
  }
}

// Taps are applied to the display at once and queued; the queue goes to the
// server as one request per upgrade, so fast tapping never loses a tap.
const upgradeQueue = new Map();   // "weapon|stat" -> levels still to send

function tapUpgrade(weaponId, stat, count) {
  if (!pendingPass || !shopData) return;
  const def = shopData.upgradeDefs[stat];
  if (!def) return;
  const lv = shopData.upgrades[weaponId] || (shopData.upgrades[weaponId] = {});
  const want = count === 'max' ? def.max : count;
  let bought = 0;
  while ((lv[stat] || 0) < def.max && bought < want) {
    const cost = shopData.costs[stat][lv[stat] || 0];
    if (shopData.coins < cost) break;
    shopData.coins -= cost;
    lv[stat] = (lv[stat] || 0) + 1;
    bought++;
  }
  if (!bought) {
    setShopMsg((lv[stat] || 0) >= def.max ? 'Already at max level.' : 'Not enough coins.', true);
    return;
  }
  setShopMsg('');
  if (window.GameAudio) { GameAudio.init(); GameAudio.sfx.unlock(); }
  refreshShopButtons();
  const key = weaponId + '|' + stat;
  upgradeQueue.set(key, (upgradeQueue.get(key) || 0) + bought);
  flushUpgrades();
}

async function flushUpgrades() {
  if (shopBusy) return;
  const next = upgradeQueue.entries().next();
  if (next.done) return;
  const [key, count] = next.value;
  upgradeQueue.delete(key);
  const [weaponId, stat] = key.split('|');
  shopBusy = true;
  let server = null;
  try {
    const res = await fetch('/api/upgrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pendingPass, weaponId, stat, count, backup: loadBackup(pendingPass) }),
    });
    const data = await res.json();
    storeBackup(pendingPass, data.save);
    if (!res.ok) setShopMsg(data.error || 'Upgrade failed.', true);
    else server = data;
  } catch {
    setShopMsg('Could not reach the server.', true);
  } finally {
    shopBusy = false;
  }
  if (server) saveLocalCoins(pendingPass, server.coins);
  if (upgradeQueue.size) { flushUpgrades(); return; }
  // Queue drained: adopt the server's numbers (they only differ if something
  // failed or coins changed elsewhere).
  if (server) {
    const same = server.coins === shopData.coins
      && JSON.stringify(server.upgrades) === JSON.stringify(shopData.upgrades);
    shopData = { ...shopData, ...server };
    if (!same) refreshShopButtons();
  } else {
    openShop();   // something went wrong: reload the true state
  }
}

// ─── Screens ──────────────────────────────────────────────────────────────────

// ─── Abilities screen ─────────────────────────────────────────────────────────
// Buy an ability once (it's yours for good), then put it on Q or E.

let abilData = null, abilBusy = false;

function setAbilMsg(text, isError) {
  const el = document.getElementById('abilMsg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'shop-msg' + (isError ? ' err' : '');
}

async function abilPost(url, body) {
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pendingPass, localXp: loadLocalXp(pendingPass), localCoins: loadLocalCoins(pendingPass),
                           backup: loadBackup(pendingPass), ...body }),
  });
  const data = await res.json();
  storeBackup(pendingPass, data.save);
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  saveLocalCoins(pendingPass, data.coins);
  return data;
}

async function openAbilities() {
  readCredentials();
  showScreen('abilitiesScreen');
  document.getElementById('abilList').innerHTML = '';
  document.getElementById('abilCoins').innerHTML = '';
  if (!pendingPass) {
    setAbilMsg('Enter a password on the title screen first — abilities are saved against it.', true);
    return;
  }
  setAbilMsg('Loading...');
  try {
    abilData = await abilPost('/api/profile', {});
    if (Array.isArray(abilData.abilityDefs)) ABILITY_DEFS = abilData.abilityDefs;
    setAbilMsg('');
    renderAbilities();
  } catch (e) {
    setAbilMsg(e.message === 'Failed to fetch' ? 'Could not reach the server.' : e.message, true);
  }
}
function closeAbilities() { showScreen('startScreen'); refreshSavedBanner(); }

function renderAbilities() {
  if (!abilData) return;
  const { coins, abilities = [], abilitySlots = [null, null], nextSlotPrice = 0 } = abilData;
  const slotIdx = abilitySlots.map((_, i) => i);
  document.getElementById('abilCoins').innerHTML = `<span class="coin-ic">◆</span> ${coins.toLocaleString()} COINS`;
  const slotName = id => { const d = abilityDef(id); return d ? d.name : 'EMPTY'; };
  // Your slots, then (while there are more to buy) the next one up for sale.
  document.getElementById('abilSlots').innerHTML = slotIdx.map(i =>
    `<div class="abil-slot${abilitySlots[i] ? '' : ' empty'}"><span class="abil-key">${AB_KEYS[i]}</span>${slotName(abilitySlots[i])}</div>`).join('')
    + (nextSlotPrice
      ? `<button class="abil-slot abil-buyslot${coins >= nextSlotPrice ? '' : ' poor'}" onclick="buyAbilitySlot()">`
        + `<span class="abil-key">+${AB_KEYS[abilitySlots.length]}</span>NEW SLOT ◆${nextSlotPrice.toLocaleString()}</button>`
      : '');

  document.getElementById('abilList').innerHTML = ABILITY_DEFS.map(a => {
    const owned = abilities.includes(a.id);
    const slot = abilitySlots.indexOf(a.id);
    const cd = (a.cd / 1000).toFixed(a.cd % 1000 ? 1 : 0) + 's';
    let actions;
    if (!owned) {
      const afford = coins >= a.price;
      actions = `<button class="buy-weapon${afford ? '' : ' poor'}" onclick="buyAbility('${a.id}')">BUY ◆${a.price.toLocaleString()}</button>`
        + (afford ? '' : `<span class="legend-need">Need ${(a.price - coins).toLocaleString()} more coins</span>`);
    } else {
      actions = slotIdx.map(i => slot === i
        ? `<button class="abil-equip on" onclick="equipAbility('', ${i})">ON ${AB_KEYS[i]} ✓</button>`
        : `<button class="abil-equip" onclick="equipAbility('${a.id}', ${i})">${slotIdx.length > 2 ? '' : 'PUT ON '}${AB_KEYS[i]}</button>`).join('');
    }
    return `<div class="shop-row abil-row${owned ? ' owned' : ''}">
      <div class="shop-head">
        <canvas class="shop-ic" data-ability="${a.id}" width="32" height="32"></canvas>
        <span class="shop-name" style="color:${a.color}">${a.name}</span>
        ${owned ? '<span class="abil-tag">OWNED</span>' : ''}
      </div>
      <div class="shop-desc">${a.desc} · <b>cooldown ${cd}</b></div>
      <div class="legend-buy">${actions}</div>
    </div>`;
  }).join('');
  for (const cv of document.querySelectorAll('#abilList canvas[data-ability]')) drawAbilityIcon(cv.getContext('2d'), cv.dataset.ability, cv.width, cv.height);
}

async function buyAbility(id) {
  if (abilBusy || !abilData) return;
  const def = abilityDef(id);
  if (def && abilData.coins < def.price) { setAbilMsg(`Not enough coins — ${def.name} costs ${def.price.toLocaleString()}.`, true); return; }
  abilBusy = true;
  try {
    abilData = { ...abilData, ...(await abilPost('/api/buy_ability', { abilityId: id })) };
    if (window.GameAudio) { GameAudio.init(); GameAudio.sfx.unlock(); }
    const slot = abilData.abilitySlots.indexOf(id);
    setAbilMsg(`${def ? def.name : id} is yours forever!` + (slot >= 0 ? ` Press ${AB_KEYS[slot]} in a match to use it.` : ' Put it in a slot to use it.'));
    renderAbilities();
  } catch (e) {
    setAbilMsg(e.message === 'Failed to fetch' ? 'Could not reach the server.' : e.message, true);
  } finally {
    abilBusy = false;
  }
}

async function buyAbilitySlot() {
  if (abilBusy || !abilData || !abilData.nextSlotPrice) return;
  if (abilData.coins < abilData.nextSlotPrice) {
    setAbilMsg(`Not enough coins — the next slot costs ${abilData.nextSlotPrice.toLocaleString()}.`, true);
    return;
  }
  abilBusy = true;
  try {
    const r = await abilPost('/api/buy_slot', {});
    abilData = { ...abilData, ...r };
    if (window.GameAudio) { GameAudio.init(); GameAudio.sfx.unlock(); }
    setAbilMsg(`New ability slot! Use it with ${r.newKey} (or its button on a touch screen).`);
    renderAbilities();
  } catch (e) {
    setAbilMsg(e.message === 'Failed to fetch' ? 'Could not reach the server.' : e.message, true);
  } finally {
    abilBusy = false;
  }
}

async function equipAbility(id, slot) {
  if (abilBusy || !abilData) return;
  abilBusy = true;
  try {
    abilData = { ...abilData, ...(await abilPost('/api/equip_ability', { abilityId: id, slot })) };
    setAbilMsg('');
    renderAbilities();
  } catch (e) {
    setAbilMsg(e.message === 'Failed to fetch' ? 'Could not reach the server.' : e.message, true);
  } finally {
    abilBusy = false;
  }
}

// Small pixel icons for the ability cards.
function drawAbilityIcon(g, id, w, h) {
  const def = abilityDef(id), col = def ? def.color : '#ccc';
  const x = w / 2, y = h / 2;
  g.clearRect(0, 0, w, h);
  g.imageSmoothingEnabled = false;
  g.lineCap = 'round';
  if (id === 'dash') {
    g.strokeStyle = col;
    for (let i = 0; i < 3; i++) { g.lineWidth = 2; g.globalAlpha = 0.4 + i * 0.3; g.beginPath(); g.moveTo(4 + i * 3, 9 + i * 7); g.lineTo(14 + i * 3, 9 + i * 7); g.stroke(); }
    g.globalAlpha = 1; g.fillStyle = col;
    g.beginPath(); g.moveTo(17, 7); g.lineTo(28, 16); g.lineTo(17, 25); g.closePath(); g.fill();
  } else if (id === 'heal') {
    g.fillStyle = '#1a3a24'; g.fillRect(x - 11, y - 11, 22, 22);
    g.fillStyle = col; g.fillRect(x - 3, y - 9, 6, 18); g.fillRect(x - 9, y - 3, 18, 6);
    g.fillStyle = '#d8ffe6'; g.fillRect(x - 2, y - 8, 2, 6);
  } else if (id === 'frost') {
    g.strokeStyle = col; g.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI / 3;
      g.beginPath(); g.moveTo(x - Math.cos(a) * 12, y - Math.sin(a) * 12); g.lineTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12); g.stroke();
    }
    g.strokeStyle = '#e8faff'; g.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3, px = x + Math.cos(a) * 8, py = y + Math.sin(a) * 8;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a + 0.8) * 4, py + Math.sin(a + 0.8) * 4); g.stroke();
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a - 0.8) * 4, py + Math.sin(a - 0.8) * 4); g.stroke();
    }
  } else if (id === 'rage') {
    g.fillStyle = '#ff9a3a';
    g.beginPath(); g.moveTo(x, 2); g.lineTo(x + 9, y + 2); g.lineTo(x + 5, h - 3); g.lineTo(x - 5, h - 3); g.lineTo(x - 9, y + 2); g.closePath(); g.fill();
    g.fillStyle = col;
    g.beginPath(); g.moveTo(x, 9); g.lineTo(x + 5, y + 4); g.lineTo(x + 2, h - 5); g.lineTo(x - 2, h - 5); g.lineTo(x - 5, y + 4); g.closePath(); g.fill();
    g.fillStyle = '#ffe08a'; g.fillRect(x - 1, y + 3, 2, 6);
  } else if (id === 'meteor') {
    for (let i = 4; i >= 1; i--) { g.globalAlpha = 0.2 * (5 - i); g.fillStyle = i > 2 ? '#ff6a1a' : '#ffd27a'; g.beginPath(); g.arc(12 + i * 4, 20 - i * 4, 7 - i, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
    g.fillStyle = '#5a3020'; g.beginPath(); g.arc(11, 21, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#8a4a2a'; g.beginPath(); g.arc(9, 19, 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = col; g.fillRect(12, 22, 3, 2);
  } else if (id === 'aegis') {
    g.fillStyle = '#7a5a10';
    g.beginPath(); g.moveTo(x, 3); g.lineTo(x + 11, 8); g.lineTo(x + 9, 21); g.lineTo(x, 29); g.lineTo(x - 9, 21); g.lineTo(x - 11, 8); g.closePath(); g.fill();
    g.fillStyle = col;
    g.beginPath(); g.moveTo(x, 5.5); g.lineTo(x + 8.5, 9.5); g.lineTo(x + 7, 20); g.lineTo(x, 26); g.lineTo(x - 7, 20); g.lineTo(x - 8.5, 9.5); g.closePath(); g.fill();
    g.fillStyle = '#fff6c0'; g.fillRect(x - 1, 9, 2, 12); g.fillRect(x - 5, 13, 10, 2);
  } else if (id === 'warp') {
    g.strokeStyle = col; g.lineWidth = 2.2;
    g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#ffffff'; g.lineWidth = 1.8;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 8); g.stroke();
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6, y + 3); g.stroke();
    g.fillStyle = col;
    for (let i = 0; i < 12; i += 3) g.fillRect(x + Math.cos(i * Math.PI / 6) * 9.5 - 1, y + Math.sin(i * Math.PI / 6) * 9.5 - 1, 2, 2);
  } else if (id === 'storm') {
    g.fillStyle = '#4a5a74';
    g.beginPath(); g.arc(11, 10, 6, 0, Math.PI * 2); g.arc(19, 9, 5.5, 0, Math.PI * 2); g.arc(15, 13, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#6a7a96'; g.beginPath(); g.arc(12, 8, 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = col;
    g.beginPath(); g.moveTo(17, 14); g.lineTo(10, 23); g.lineTo(15, 23); g.lineTo(12, 30); g.lineTo(22, 19); g.lineTo(16.5, 19); g.lineTo(20, 14); g.closePath(); g.fill();
    g.fillStyle = '#ffffff'; g.fillRect(14, 16, 2, 4);
  } else if (id === 'drain') {
    g.fillStyle = '#8a1a30';
    g.beginPath(); g.moveTo(x, 3); g.bezierCurveTo(x + 14, 14, x + 12, 28, x, 28); g.bezierCurveTo(x - 12, 28, x - 14, 14, x, 3); g.fill();
    g.fillStyle = col;
    g.beginPath(); g.moveTo(x, 6); g.bezierCurveTo(x + 10, 15, x + 9, 25, x, 25); g.bezierCurveTo(x - 9, 25, x - 10, 15, x, 6); g.fill();
    g.fillStyle = '#ffc0cc'; g.beginPath(); g.ellipse(x - 3.5, y + 1, 2, 4, 0.3, 0, Math.PI * 2); g.fill();
  } else if (id === 'blackhole') {
    g.strokeStyle = '#5a2aff'; g.lineWidth = 2;
    g.beginPath(); g.ellipse(x, y, 13, 5.5, -0.5, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#c8a8ff'; g.lineWidth = 1.5;
    g.beginPath(); g.ellipse(x, y, 10, 4, -0.5, 0.4, 5.2); g.stroke();
    g.fillStyle = '#05020c'; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
    g.strokeStyle = col; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#ffffff'; g.fillRect(x + 11, y - 9, 2, 2); g.fillRect(x - 13, y + 8, 2, 2);
  } else if (ABILITY_ICONS[id]) {
    ABILITY_ICONS[id](g, x, y, col);
  }
}

// Icons for the second shelf of abilities (each drawn around the centre x, y
// of a ~32px canvas, in the ability's colour).
const ABILITY_ICONS = {
  perfectguard(g, x, y, col) {
    g.strokeStyle = col; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x - 10, y + 10); g.lineTo(x + 10, y - 10); g.stroke();
    g.beginPath(); g.moveTo(x - 10, y - 10); g.lineTo(x + 10, y + 10); g.stroke();
    g.fillStyle = '#ffe080'; for (const [a, b] of [[0, -12], [12, 0], [0, 12], [-12, 0]]) g.fillRect(x + a - 1.5, y + b - 1.5, 3, 3);
  },
  haven(g, x, y, col) {
    g.fillStyle = '#1a4a40'; g.beginPath(); g.ellipse(x, y + 8, 12, 4, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.ellipse(x, y + 8, 12, 4, 0, 0, Math.PI * 2); g.stroke();
    g.fillStyle = col; g.fillRect(x - 2, y - 10, 4, 14); g.fillRect(x - 7, y - 5, 14, 4);
  },
  flurry(g, x, y, col) {
    g.fillStyle = col;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      g.save(); g.translate(x + Math.cos(a) * 8, y + Math.sin(a) * 8); g.rotate(a);
      g.beginPath(); g.moveTo(6, 0); g.lineTo(-2, -2); g.lineTo(-2, 2); g.closePath(); g.fill(); g.restore();
    }
  },
  mines(g, x, y, col) {
    for (const [dx, dy] of [[-7, 4], [7, 4], [0, -6]]) {
      g.fillStyle = '#3a3e46'; g.beginPath(); g.arc(x + dx, y + dy, 5, 0, Math.PI * 2); g.fill();
      g.fillStyle = col; g.fillRect(x + dx - 1.5, y + dy - 1.5, 3, 3);
    }
  },
  soulchain(g, x, y, col) {
    g.strokeStyle = col; g.lineWidth = 2;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.ellipse(x - 10 + i * 6.5, y + (i % 2 ? -1 : 1) * 2, 4, 2.5, 0.6, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = '#c8d8ff'; g.beginPath(); g.arc(x + 12, y - 3, 3, 0, Math.PI * 2); g.fill();
  },
  warcry(g, x, y, col) {
    g.fillStyle = col; g.beginPath(); g.moveTo(x - 10, y - 4); g.lineTo(x - 2, y - 4); g.lineTo(x + 4, y - 10); g.lineTo(x + 4, y + 10); g.lineTo(x - 2, y + 4); g.lineTo(x - 10, y + 4); g.closePath(); g.fill();
    g.strokeStyle = col; g.lineWidth = 1.5;
    for (const r of [8, 12]) { g.beginPath(); g.arc(x + 4, y, r, -0.7, 0.7); g.stroke(); }
  },
  overcharge(g, x, y, col) {
    g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 11, 0.4, Math.PI * 2 - 0.4); g.stroke();
    g.fillStyle = col; g.beginPath(); g.moveTo(x + 2, y - 9); g.lineTo(x - 5, y + 1); g.lineTo(x, y + 1); g.lineTo(x - 2, y + 9); g.lineTo(x + 5, y - 1); g.lineTo(x, y - 1); g.closePath(); g.fill();
  },
  fireball(g, x, y, col) {
    g.fillStyle = 'rgba(255,90,26,0.35)'; g.beginPath(); g.arc(x - 4, y + 4, 10, 0, Math.PI * 2); g.fill();
    g.fillStyle = col; g.beginPath(); g.arc(x + 2, y - 2, 8, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffd84a'; g.beginPath(); g.arc(x, y - 4, 4, 0, Math.PI * 2); g.fill();
  },
  smite(g, x, y, col) {
    g.fillStyle = 'rgba(255,242,160,0.3)'; g.fillRect(x - 6, y - 14, 12, 26);
    g.fillStyle = col; g.fillRect(x - 3, y - 14, 6, 24);
    g.fillStyle = '#ffffff'; g.fillRect(x - 1, y - 14, 2, 24);
    g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath(); g.ellipse(x, y + 10, 11, 3, 0, 0, Math.PI * 2); g.stroke();
  },
  frostarmor(g, x, y, col) {
    g.fillStyle = '#2a4a5a'; g.beginPath(); g.moveTo(x, y - 12); g.lineTo(x + 10, y - 7); g.lineTo(x + 8, y + 6); g.lineTo(x, y + 12); g.lineTo(x - 8, y + 6); g.lineTo(x - 10, y - 7); g.closePath(); g.fill();
    g.strokeStyle = col; g.lineWidth = 2; g.stroke();
    g.strokeStyle = '#ffffff'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x, y + 6); g.moveTo(x - 5, y - 3); g.lineTo(x + 5, y + 3); g.moveTo(x + 5, y - 3); g.lineTo(x - 5, y + 3); g.stroke();
  },
  shadowstep(g, x, y, col) {
    g.fillStyle = '#2a2050'; g.beginPath(); g.arc(x - 6, y + 2, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = col; g.beginPath(); g.arc(x + 5, y - 2, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.fillRect(x + 3, y - 4, 2, 2); g.fillRect(x + 7, y - 4, 2, 2);
    g.strokeStyle = '#e0d8ff'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x - 13, y + 11); g.lineTo(x + 13, y - 12); g.stroke();
  },
  quake(g, x, y, col) {
    g.fillStyle = '#5a3a1a'; g.fillRect(x - 13, y + 4, 26, 9);
    g.fillStyle = col; g.fillRect(x - 13, y + 3, 26, 3);
    g.strokeStyle = '#1a0e04'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(x - 2, y + 3); g.lineTo(x + 2, y + 7); g.lineTo(x - 1, y + 9); g.lineTo(x + 3, y + 13); g.stroke();
    g.fillStyle = '#a07a4a'; g.fillRect(x - 8, y - 6, 4, 4); g.fillRect(x + 5, y - 9, 3, 3); g.fillRect(x - 1, y - 12, 3, 3);
  },
  firenova(g, x, y, col) {
    g.strokeStyle = '#8a1a04'; g.lineWidth = 5; g.beginPath(); g.arc(x, y, 10, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 10, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#ffd84a'; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, 10, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#ffd84a'; g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill();
  },
  chain(g, x, y, col) {
    g.strokeStyle = col; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x - 13, y - 8); g.lineTo(x - 5, y + 4); g.lineTo(x - 1, y - 4); g.lineTo(x + 6, y + 8); g.lineTo(x + 13, y - 6); g.stroke();
    g.fillStyle = '#ffffff';
    for (const [px, py] of [[-13, -8], [-1, -4], [13, -6]]) g.fillRect(x + px - 1.5, y + py - 1.5, 3, 3);
  },
  army(g, x, y, col) {
    for (const [dx, s] of [[-8, 0.8], [8, 0.8], [0, 1]]) {
      g.fillStyle = s < 1 ? '#3a8a6a' : col;
      g.fillRect(x + dx - 4 * s, y - 6 * s + (s < 1 ? 3 : 0), 8 * s, 12 * s);
      g.fillStyle = '#ffffff'; g.fillRect(x + dx - 2 * s, y - 3 * s + (s < 1 ? 3 : 0), 1.5, 1.5); g.fillRect(x + dx + 1 * s, y - 3 * s + (s < 1 ? 3 : 0), 1.5, 1.5);
    }
  },
  sentry(g, x, y, col) {
    g.fillStyle = 'rgba(255,58,42,0.3)'; g.beginPath(); g.ellipse(x - 3, y, 9, 12, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2a0604'; g.beginPath(); g.ellipse(x - 3, y, 5, 8, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.ellipse(x - 3, y, 6, 9, 0, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#ff5a14'; g.beginPath(); g.arc(x + 9, y - 2, 3.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffd84a'; g.beginPath(); g.arc(x + 9, y - 2, 1.8, 0, Math.PI * 2); g.fill();
  },
  cyclone(g, x, y, col) {
    g.strokeStyle = col; g.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      const w = 13 - i * 2.4, yy = y - 10 + i * 5;
      g.beginPath(); g.ellipse(x + i * 0.8, yy, w, 2.2, 0, 0, Math.PI * 2); g.stroke();
    }
  },
  vanish(g, x, y, col) {
    g.globalAlpha = 0.45; g.fillStyle = col; g.fillRect(x - 5, y - 10, 10, 20);
    g.globalAlpha = 1; g.strokeStyle = '#c8c8ff'; g.lineWidth = 1; g.setLineDash([2, 2]);
    g.strokeRect(x - 5.5, y - 10.5, 11, 21); g.setLineDash([]);
    g.fillStyle = '#ffffff'; g.fillRect(x - 3, y - 6, 2, 2); g.fillRect(x + 1, y - 6, 2, 2);
  },
  adrenaline(g, x, y, col) {
    g.strokeStyle = col; g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(x - 13, y); g.lineTo(x - 6, y); g.lineTo(x - 3, y - 9); g.lineTo(x + 2, y + 9); g.lineTo(x + 5, y); g.lineTo(x + 13, y); g.stroke();
  },
  barrier(g, x, y, col) {
    g.fillStyle = 'rgba(122,216,255,0.2)'; g.beginPath(); g.arc(x, y + 4, 12, Math.PI, 0); g.fill();
    g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(x, y + 4, 12, Math.PI, 0); g.stroke();
    g.fillStyle = col; g.fillRect(x - 13, y + 4, 26, 2);
    g.fillStyle = '#ffffff'; g.fillRect(x - 6, y - 4, 2, 2);
  },
  toxic(g, x, y, col) {
    g.fillStyle = '#5a9a2a';
    for (const [dx, dy, r] of [[-6, 2, 7], [5, 1, 8], [0, -5, 7]]) { g.beginPath(); g.arc(x + dx, y + dy, r, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = col; g.beginPath(); g.arc(x - 2, y - 2, 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1a2a0a'; g.fillRect(x - 4, y + 2, 2, 2); g.fillRect(x + 2, y + 2, 2, 2);
  },
  vampirism(g, x, y, col) {
    g.fillStyle = '#2a0a12'; g.beginPath(); g.moveTo(x - 13, y - 4); g.lineTo(x, y + 4); g.lineTo(x + 13, y - 4); g.lineTo(x + 8, y + 6); g.lineTo(x - 8, y + 6); g.closePath(); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(x - 5, y + 1); g.lineTo(x - 3, y + 9); g.lineTo(x - 1, y + 2); g.fill();
    g.beginPath(); g.moveTo(x + 1, y + 2); g.lineTo(x + 3, y + 9); g.lineTo(x + 5, y + 1); g.fill();
    g.fillStyle = col; g.fillRect(x - 3.5, y + 9, 1.5, 3);
  },
  rejuvenate(g, x, y, col) {
    g.fillStyle = '#3a8a4a'; g.beginPath(); g.ellipse(x - 4, y + 2, 5, 9, -0.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = col; g.beginPath(); g.ellipse(x + 4, y - 1, 5, 9, 0.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.fillRect(x + 8, y - 12, 2, 6); g.fillRect(x + 6, y - 10, 6, 2);
  },
  airstrike(g, x, y, col) {
    for (const [dx, dy] of [[-8, -6], [0, 0], [8, -4]]) {
      g.fillStyle = '#3a3a44'; g.beginPath(); g.ellipse(x + dx, y + dy, 2.6, 4.5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = col; g.fillRect(x + dx - 2, y + dy - 7, 4, 2);
    }
    g.fillStyle = '#ff8a2a'; g.beginPath(); g.arc(x, y + 10, 4, Math.PI, 0); g.fill();
  },
  gravity(g, x, y, col) {
    g.strokeStyle = col; g.lineWidth = 1.8;
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const ox = Math.cos(a), oy = Math.sin(a);
      g.beginPath(); g.moveTo(x + ox * 13, y + oy * 13); g.lineTo(x + ox * 5, y + oy * 5); g.stroke();
      g.beginPath(); g.moveTo(x + ox * 5 + oy * 3, y + oy * 5 - ox * 3); g.lineTo(x + ox * 5, y + oy * 5); g.lineTo(x + ox * 5 - oy * 3, y + oy * 5 + ox * 3); g.stroke();
    }
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x, y, 2.5, 0, Math.PI * 2); g.fill();
  },
  forcepush(g, x, y, col) {
    g.fillStyle = col; g.beginPath(); g.arc(x - 8, y, 4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = col; g.lineWidth = 2;
    for (let i = 0; i < 3; i++) { g.globalAlpha = 1 - i * 0.25; g.beginPath(); g.arc(x - 8, y, 8 + i * 6, -0.7, 0.7); g.stroke(); }
    g.globalAlpha = 1;
  },
  golem(g, x, y, col) {
    g.fillStyle = '#4a5a6a'; g.fillRect(x - 10, y - 6, 20, 17);
    g.fillStyle = col; g.fillRect(x - 6, y - 13, 12, 9); g.fillRect(x - 13, y - 4, 4, 11); g.fillRect(x + 9, y - 4, 4, 11);
    g.fillStyle = '#ffd84a'; g.fillRect(x - 4, y - 10, 2, 2); g.fillRect(x + 2, y - 10, 2, 2);
    g.fillStyle = '#2a3440'; g.fillRect(x - 3, y, 6, 2);
  },
  execute(g, x, y, col) {
    g.fillStyle = '#8a8a9a'; g.beginPath(); g.moveTo(x - 12, y - 2); g.lineTo(x + 2, y - 12); g.lineTo(x + 8, y - 6); g.lineTo(x - 4, y + 4); g.closePath(); g.fill();
    g.fillStyle = '#5a3a20'; g.save(); g.translate(x, y); g.rotate(0.8); g.fillRect(-2, -2, 4, 18); g.restore();
    g.fillStyle = col; g.fillRect(x - 12, y - 3, 4, 2); g.fillRect(x - 9, y + 2, 2, 4);
  },
  icelance(g, x, y, col) {
    g.fillStyle = col;
    for (let i = 0; i < 4; i++) {
      const bx = x - 12 + i * 7, h = 6 + i * 2.5;
      g.beginPath(); g.moveTo(bx, y + 10); g.lineTo(bx + 3, y + 10 - h); g.lineTo(bx + 6, y + 10); g.closePath(); g.fill();
    }
    g.fillStyle = '#ffffff'; g.fillRect(x + 9, y - 2, 1.5, 4);
  },
  phoenix(g, x, y, col) {
    g.fillStyle = '#c84a10';
    g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x - 14, y - 10); g.lineTo(x - 8, y + 2); g.lineTo(x, y + 2); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x + 14, y - 10); g.lineTo(x + 8, y + 2); g.lineTo(x, y + 2); g.closePath(); g.fill();
    g.fillStyle = col; g.beginPath(); g.ellipse(x, y, 3.5, 6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffd84a'; g.beginPath(); g.moveTo(x - 4, y + 5); g.lineTo(x, y + 13); g.lineTo(x + 4, y + 5); g.closePath(); g.fill();
    g.fillStyle = '#ffffff'; g.fillRect(x - 1, y - 4, 2, 2);
  },
};

const SCREENS = ['settingsScreen', 'startScreen','lobbyScreen','unlockScreen','roundScreen','disconnectedScreen','skinsScreen','shopScreen','abilitiesScreen','howtoScreen','botScreen','createRoomScreen','roomsScreen'];
// The main menu is shrunk to whatever the screen allows (never below 45%), so the
// name and password fields and the mode buttons are all in view on small phones
// and short windows. Re-measured on resize / rotation / when it is shown.
function fitMenu() {
  const box = document.querySelector('#startScreen > .pixel-box');
  if (!box) return;
  box.style.zoom = '';
  const scr = document.getElementById('startScreen');
  if (!scr || scr.classList.contains('hidden')) return;
  const vw = window.innerWidth - 24, vh = (window.visualViewport ? window.visualViewport.height : window.innerHeight) - 24;
  const w = box.offsetWidth, h = box.offsetHeight;
  if (!w || !h) return;
  const z = Math.max(0.45, Math.min(1, vw / w, vh / h));
  if (z < 0.999) box.style.zoom = z.toFixed(3);
}
window.addEventListener('resize', fitMenu);
window.addEventListener('orientationchange', () => setTimeout(fitMenu, 200));
if (window.visualViewport) window.visualViewport.addEventListener('resize', fitMenu);
window.addEventListener('load', fitMenu);

function showScreen(id) { SCREENS.forEach(s => { const el=document.getElementById(s); if(el) el.className='overlay '+(s===id?'active':'hidden'); }); if (id === 'startScreen') fitMenu(); }
function hideAllScreens() { SCREENS.forEach(s => { const el=document.getElementById(s); if(el && el.className!=='overlay hidden') el.className='overlay hidden'; }); }
function setLobbyMsg(html) { showScreen('lobbyScreen'); document.getElementById('lobbyMsg').innerHTML = html; }
const PORTAL_LOBBY = `<span style="color:#c8a0ff">THE PORTAL MAGE</span><br>`
  + `<span style="color:#888">SOLO BOSS FIGHT · WIN 50,000 COINS + 50,000 XP</span><br>Opening the portal...`;

const ABYSS_LOBBY = `<span style="color:#b07aff">THE ABYSS</span><br>`
  + `<span style="color:#888">FINAL BOSS · WIN 100,000 COINS + THE CROSSBOWS OF INFINITY</span><br>Something stirs below...`;
const BOT_LOBBY = () => `<span style="color:#ff9a5a">BOT BATTLE</span><br><span style="color:#888">PvP VS A ${(pendingBotLevel || 'average').toUpperCase()} BOT</span><br>Loading...`;

// ── Map size (all modes) ──
function pickMapSize(size) {
  pendingMapSize = size;
  try { localStorage.setItem('weponare_map', size); } catch {}
  for (const b of document.querySelectorAll('.map-btn')) b.classList.toggle('on', b.dataset.size === size);
}
pickMapSize(['small', 'medium', 'big'].includes(pendingMapSize) ? pendingMapSize : 'medium');

// ── Rooms: create one, or browse and join someone else's ──
let roomDraft = { maxPlayers: 2, size: 'medium' };
function pickRoomPlayers(n) {
  roomDraft.maxPlayers = n;
  for (const b of document.querySelectorAll('#roomPlayersOpts .room-opt')) b.classList.toggle('on', Number(b.dataset.n) === n);
}
function pickRoomSize(size) {
  roomDraft.size = size;
  for (const b of document.querySelectorAll('#roomSizeOpts .room-opt')) b.classList.toggle('on', b.dataset.size === size);
}
function openCreateRoom() {
  readCredentials();
  pickRoomPlayers(roomDraft.maxPlayers);
  pickRoomSize(pendingMapSize || 'medium');
  const inp = document.getElementById('roomNameInput');
  if (inp && !inp.value) inp.value = ((pendingName && pendingName !== 'PLAYER' ? pendingName : 'MY') + "'S ROOM").slice(0, 20);
  showScreen('createRoomScreen');
}
function createRoomGo() {
  const name = (document.getElementById('roomNameInput')?.value || '').trim().slice(0, 20) || 'ROOM';
  pendingMapSize = roomDraft.size;
  pendingRoom = { roomName: name, maxPlayers: roomDraft.maxPlayers };
  document.getElementById('createRoomScreen').className = 'overlay hidden';
  joinGame('create');
}
let roomPoll = null;
async function refreshRoomList() {
  const el = document.getElementById('roomList');
  if (!el) return;
  try {
    const res = await fetch('/api/rooms');
    const list = (await res.json()).rooms || [];
    el.innerHTML = list.length ? list.map(r => `<div class="room-row">
        <div class="room-info">
          <div class="room-name">${escapeHtml(r.name)}</div>
          <div class="room-meta">HOST ${escapeHtml(r.host)} &middot; ${r.players}/${r.maxPlayers} PLAYERS &middot; ${r.maxPlayers > 2 ? 'LAST ONE STANDING' : 'DUEL'} &middot; ${String(r.size).toUpperCase()} MAP</div>
          <div class="room-who">${r.names.map(escapeHtml).join(', ')}</div>
        </div>
        <button onclick="joinRoom('${r.id}', '${r.size}')">JOIN</button>
      </div>`).join('')
      : '<div class="room-empty">No open rooms right now &ndash; create one!</div>';
  } catch {
    el.innerHTML = '<div class="room-empty">Could not reach the server.</div>';
  }
}
function openRoomBrowser() {
  readCredentials();
  showScreen('roomsScreen');
  document.getElementById('roomList').innerHTML = '<div class="room-empty">Looking for rooms...</div>';
  refreshRoomList();
  clearInterval(roomPoll);
  roomPoll = setInterval(refreshRoomList, 2000);
}
function closeRoomBrowser() { clearInterval(roomPoll); roomPoll = null; showScreen('startScreen'); }
function joinRoom(id, size) {
  clearInterval(roomPoll); roomPoll = null;
  pendingRoom = { roomId: id };
  pendingMapSize = size;
  document.getElementById('roomsScreen').className = 'overlay hidden';
  joinGame('joinroom');
}

// ── Safe chat: a fixed list of friendly lines (from the server) ──
let CHAT_LINES = [];
function buildChatPanel() {
  const el = document.getElementById('chatPanel');
  if (el) el.innerHTML = CHAT_LINES.map((t, i) => `<button onclick="sendChat(${i})">${escapeHtml(t)}</button>`).join('');
}
function toggleChat(show) {
  const el = document.getElementById('chatPanel');
  if (!el) return;
  const on = show ?? el.classList.contains('hidden');
  if (on && !el.children.length) buildChatPanel();
  el.classList.toggle('hidden', !on);
}
function sendChat(i) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'chat', id: i }));
  toggleChat(false);
}
// A speech bubble over whoever spoke, fading out.
function drawChatBubbles(state) {
  for (const c of state.chats || []) {
    const p = state.players?.[c.key], text = CHAT_LINES[c.id];
    if (!p || p.dead || !text || (p.effects && (p.effects.vanish > 0 || p.effects.ghost > 0) && c.key !== myKeyOf())) continue;
    const age = (c.age || 0) + (performance.now() - stateRecvTime);
    const a = Math.max(0, Math.min(1, (3500 - age) / 500));
    if (a <= 0) continue;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = 'bold 8px "Courier New",monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = Math.ceil(ctx.measureText(text).width) + 8, h = 12;
    const x = Math.round(p.x + p.w / 2), y = Math.round(p.y - 30 - Math.min(4, age / 60));
    ctx.fillStyle = 'rgba(250, 250, 255, 0.95)';
    ctx.fillRect(x - w / 2, y - h / 2, w, h);
    ctx.beginPath(); ctx.moveTo(x - 3, y + h / 2); ctx.lineTo(x + 3, y + h / 2); ctx.lineTo(x, y + h / 2 + 4); ctx.fill();
    ctx.strokeStyle = PAL[c.key] || '#888'; ctx.lineWidth = 1;
    ctx.strokeRect(x - w / 2 + 0.5, y - h / 2 + 0.5, w - 1, h - 1);
    ctx.fillStyle = '#111'; ctx.fillText(text, x, y + 0.5);
    ctx.restore();
  }
}

// BOT BATTLE: pick the bot's level, then it's a PvP match against it.
function openBotPicker() { readCredentials(); showScreen('botScreen'); }
function closeBotPicker() { showScreen('startScreen'); }
function pickBotLevel(level) {
  pendingBotLevel = level;
  document.getElementById('botScreen').className = 'overlay hidden';
  joinGame('bot');
}

function sendRematch() { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'rematch' })); }

function updateScreens(state) {
  if (state.gameState === 'LOBBY') {
    if (state.bot) {
      setLobbyMsg(BOT_LOBBY());
    } else if (state.gameMode === 'waves') {
      setLobbyMsg(`<span style="color:#ffcc00">WAVES MODE</span><br><span style="color:#888">SOLO ENDLESS</span><br>Loading...`);
    } else if (state.gameMode === 'extreme') {
      setLobbyMsg(`<span style="color:#ff5a3a">EXTREME MODE</span><br><span style="color:#888">SOLO · STRONGEST MONSTERS</span><br>Loading...`);
    } else if (state.gameMode === 'portal') {
      setLobbyMsg(PORTAL_LOBBY);
    } else if (state.gameMode === 'abyss') {
      setLobbyMsg(ABYSS_LOBBY);
    } else if (state.gameMode === 'sandbox' && pendingTutorial) {
      setLobbyMsg(`<span style="color:#7affc8">TUTORIAL</span><br><span style="color:#888">LEARN THE BASICS</span><br>Loading...`);
    } else if (state.gameMode === 'sandbox') {
      setLobbyMsg(`<span style="color:#9fffd0">SANDBOX</span><br><span style="color:#888">SOLO PRACTICE · NOTHING IS SAVED</span><br>Loading...`);
    } else {
      const modeStr = state.gameMode === 'coop' ? 'CO-OP MODE' : state.maxPlayers > 2 ? 'LAST ONE STANDING' : 'PvP MODE';
      const k = myKeyOf();
      if (state.roomId && state.gameState === 'LOBBY') invite = { id: state.roomId, name: state.roomName };
      const head = state.roomName ? `<span style="color:#ffe45a">${escapeHtml(state.roomName)}</span><br>` : '';
      const who = KEYS.slice(0, state.maxPlayers || 2).map(q => state.playerNames?.[q] && (state.seated || 0) > KEYS.indexOf(q)
        ? `<span class="${q}-color">${escapeHtml(state.playerNames[q])}</span>` : '<span style="color:#555">· empty ·</span>').join(' &nbsp; ');
      setLobbyMsg(myNum
        ? `${head}<span class="${k}-color">${escapeHtml(state.playerNames?.[k] || 'PLAYER')}</span> &nbsp;[${modeStr} · ${(state.world?.size || 'medium').toUpperCase()} MAP]<br>`
          + `${who}<br>Waiting for players... ${state.seated || 1}/${state.maxPlayers || 2}`
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
    document.getElementById('matchChoice')?.classList.add('hidden');
    const lb = document.getElementById('leaderboardBox');
    const hint = document.getElementById('roundHint');
    if (state.gameMode === 'abyss') {
      lb.classList.add('hidden');
      hint.textContent = 'RETURNING TO MENU...';
      const ab = (state.monsters || []).find(m => m.abyss);
      document.getElementById('roundTitle').innerHTML = state.victory
        ? '<span style="color:#7aff9a">VICTORY!</span>' : '<span style="color:#ff5a6a">DEFEATED</span>';
      document.getElementById('roundStats').innerHTML = state.victory
        ? `YOU SURVIVED THE ABYSS<br><span style="color:${PAL.coin}">+100,000 COINS</span> &nbsp; <span style="color:${PAL.xp}">+75,000 XP</span>`
          + (state.noDrop ? ` &nbsp; <span style="color:#888">NO WEAPON: A MYTHIC WAS IN HAND</span>`
             : ` &nbsp; <span style="color:#b07aff">+ ${state.bossDrop === 'endlessscythe' ? 'THE ENDLESS SCYTHE' : 'THE CROSSBOWS OF INFINITY'}</span>`)
          + `<br>XP: ${state.xp} &nbsp; <span style="color:${PAL.coin}">◆ ${state.myCoins||0}</span>`
        : `THE ABYSS SWALLOWS YOU<br>`
          + (ab ? (ab.p3 ? `ONLY <span style="color:#ff7ad8">${ab.p3}s</span> LEFT TO SURVIVE<br>`
                 : `HE HAD <span style="color:#c8a0ff">${Math.ceil(ab.hp).toLocaleString()}</span> HP LEFT (PHASE ${ab.phase || 1})<br>`) : '')
          + `XP: ${state.xp} &nbsp; <span style="color:${PAL.coin}">◆ ${state.myCoins||0}</span>`;
    } else if (state.gameMode === 'portal') {
      lb.classList.add('hidden');
      hint.textContent = 'RETURNING TO MENU...';
      const mage = (state.monsters || []).find(m => m.mage);
      document.getElementById('roundTitle').innerHTML = state.victory
        ? '<span style="color:#7aff9a">VICTORY!</span>'
        : '<span style="color:#ff5a6a">DEFEATED</span>';
      document.getElementById('roundStats').innerHTML = state.victory
        ? `THE PORTAL MAGE HAS FALLEN<br><span style="color:${PAL.coin}">+50,000 COINS</span> &nbsp; <span style="color:${PAL.xp}">+50,000 XP</span>`
          + (state.noDrop ? ` &nbsp; <span style="color:#888">NO WEAPON: A MYTHIC WAS IN HAND</span>` : ` &nbsp; <span style="color:#b07aff">+ THE PORTAL WAND</span>`)
          + `<br>XP: ${state.xp} &nbsp; <span style="color:${PAL.coin}">◆ ${state.myCoins||0}</span>`
        : `THE PORTAL MAGE WINS THIS TIME<br>`
          + (mage ? `HE HAD <span style="color:#c8a0ff">${Math.ceil(mage.hp).toLocaleString()}</span> HP LEFT${mage.phase === 2 ? ' (PHASE 2)' : ''}<br>` : '')
          + `XP: ${state.xp} &nbsp; <span style="color:${PAL.coin}">◆ ${state.myCoins||0}</span>`;
    } else if (state.gameMode === 'waves' || state.gameMode === 'extreme') {
      const ext = state.gameMode === 'extreme';
      hint.textContent = 'RETURNING TO MENU...';
      document.getElementById('roundTitle').innerHTML = ext
        ? '<span style="color:#ff5a3a">EXTREME OVER</span>'
        : '<span style="color:#ffcc00">WAVES OVER</span>';
      document.getElementById('roundStats').innerHTML =
        `WAVE <span style="color:#ffcc00">${state.wave?.num||0}</span> REACHED<br>`
        + `XP: ${state.xp} &nbsp; <span style="color:${PAL.coin}">◆ ${state.myCoins||0}</span>`;
      if (state.leaderboard && state.leaderboard.length > 0) {
        lb.classList.remove('hidden');
        lb.innerHTML = `<div class="leaderboard-title">${ext ? 'EXTREME TOP SCORES' : 'TOP SCORES'}</div>` +
          state.leaderboard.map((e,i) =>
            `<div class="lb-row${i===0?' lb-top':''}">`+
            `<span>${i+1}. ${e.name}</span>`+
            `<span>${e.waves} waves</span>`+
            `<span style="color:#555">${e.date}</span></div>`
          ).join('');
      } else {
        lb.classList.add('hidden');
      }
    } else if (state.gameMode === 'coop' && state.victory) {
      lb.classList.add('hidden');
      hint.textContent = 'NEW GAME STARTING...';
      document.getElementById('roundTitle').innerHTML = '<span style="color:#7aff9a">VICTORY!</span>';
      document.getElementById('roundStats').innerHTML =
        `THE GIANT HAS FALLEN<br>ALL ${state.finalWave || 10} WAVES CLEARED<br>XP: ${state.xp} &nbsp; <span style="color:${PAL.coin}">◆ ${state.myCoins||0}</span>`;
    } else if (state.gameMode === 'coop') {
      lb.classList.add('hidden');
      hint.textContent = 'NEXT ROUND STARTING...';
      document.getElementById('roundTitle').innerHTML = '<span style="color:#ffcc00">GAME OVER</span>';
      document.getElementById('roundStats').innerHTML =
        `WAVE ${state.wave?.num||0} REACHED<br>XP: ${state.xp} &nbsp; <span style="color:${PAL.coin}">◆ ${state.myCoins||0}</span>`;
    } else {
      lb.classList.add('hidden');
      const nameOf = n => state.playerNames?.['p' + n] || 'P' + n;
      const fighters = KEYS.filter(k => state.players[k]);
      if (r.matchWinner) {
        const voted = (state.rematch || []).includes(myKeyOf());
        hint.textContent = voted ? 'WAITING FOR THE OTHERS...' : 'PLAY AGAIN?';
        const rb = document.getElementById('rematchBtn'); if (rb) { rb.disabled = voted; rb.textContent = voted ? 'WAITING...' : 'RESTART'; }
        document.getElementById('matchChoice').classList.remove('hidden');
        document.getElementById('roundTitle').innerHTML =
          `<span class="p${r.matchWinner}-color">${nameOf(r.matchWinner)} TAKES THE MATCH</span>`;
      } else {
        hint.textContent = 'NEXT ROUND STARTING...';
        const wn = r.roundWinner || 0;
        document.getElementById('roundTitle').innerHTML = !wn ? '<span style="color:#ffcc00">DRAW!</span>'
          : `<span class="p${wn}-color">${nameOf(wn)} ${fighters.length > 2 ? 'IS THE LAST ONE STANDING' : 'WINS THE ROUND'}</span>`;
      }
      document.getElementById('roundStats').innerHTML =
        fighters.map(k => `<span class="${k}-color">${nameOf(Number(k.slice(1)))}</span> ${(r.wins || {})[k] || 0}`).join(' &nbsp;—&nbsp; ')
        + `<br><span style="color:#888">FIRST TO ${r.maxWins} WINS THE MATCH</span><br>`
        + `XP: ${state.xp} &nbsp; <span style="color:${PAL.coin}">◆ ${state.myCoins||0}</span>`;
    }
    return;
  }
  if (state.gameState === 'GAMEPLAY') { hideAllScreens(); return; }
}

// ─── Render Loop ──────────────────────────────────────────────────────────────

let lastFrameTime = 0;
// Draw at most ~60 times a second: a 120/144 Hz screen would otherwise redraw the
// whole scene twice as often as anyone can see, doubling heat and battery use.
// (12 ms, not 16, so a 144 Hz screen still lands on 72 rather than dropping to 48.)
const MIN_FRAME_MS = 12;
function renderLoop(now) {
  if (lastFrameTime && now - lastFrameTime < MIN_FRAME_MS) { requestAnimationFrame(renderLoop); return; }
  const dt = lastFrameTime ? Math.min(now - lastFrameTime, 100) : 16;
  lastFrameTime = now;
  drainStates();
  tutorialTick();
  netStats.frames++;
  if (now - netStats.since >= 1000) {
    netStats.fps = Math.round(netStats.frames * 1000 / (now - netStats.since || 1000));
    netStats.kbps = Math.round(netStats.bytes / 1024 * 1000 / (now - netStats.since || 1000));
    netStats.frames = 0; netStats.bytes = 0; netStats.since = now;
  }
  tickSlashes(dt);
  if (localAtkCd > 0) localAtkCd -= dt;
  if (currState && currState.gameState === 'GAMEPLAY') {
    updatePrediction(dt, now);
    // Blend over the real gap between states, so others move smoothly instead
    // of finishing early and stalling until the next message.
    draw(pinToOwners(applyPrediction(timelineState(now, dt))));
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
  for (const sl of slashes) {
    const o = sl.owner && state.players[sl.owner];
    if (!o || o.dead) continue;
    const dx = o.x + o.w / 2 - sl.px, dy = o.y + o.h / 2 - sl.py;
    sl.px += dx; sl.py += dy; sl.x += dx; sl.y += dy;
  }
  drawSlashes();
  drawFireRings(state.fires || []);
  if (state.rareShop) drawRareShop(state.rareShop);
  drawConstellations(state.constels || []);
  drawStars(state.stars || []);
  drawChains(state.chains || []);
  drawProjectiles(state.projectiles || []);
  drawMonsters(state.monsters || []);
  drawAllies(state.allies || []);
  const names = state.playerNames || {};
  for (const k of KEYS) if (state.players[k]) drawPlayer(state.players[k], PAL[k], names[k] || k.toUpperCase(), k);
  drawChatBubbles(state);
  drawFireHands(state.fires || []);
  const meP = state.players[myKeyOf()] || null;
  syncSuperButton(meP);
  syncAbilityButtons(meP);
  drawParticles(state.particles || []);
  ctx.save();
  ctx.scale(HUD_SCALE, HUD_SCALE);
  drawHUD(state);
  drawBossBar(state.monsters);
  drawItemBar(state.inventory || [], meP);
  drawWeaponPanel(state);
  drawPickupBanners(state.particles);
  ctx.restore();
  if (netOverlay) drawNetOverlay();
}

function drawNetOverlay() {
  const lines = [
    'FPS ' + netStats.fps,
    'PING ' + Math.round(netStats.ping) + ' ms',
    'VIEW DELAY ' + Math.round(viewDelay) + ' ms (late ' + Math.round(lateMs) + ')',
    'DOWN ' + netStats.kbps + ' KB/s',
    'DROPPED ' + netStats.dropped,
  ];
  ctx.save();
  ctx.font = '12px monospace';
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(4, 4, 210, lines.length * 15 + 8);
  ctx.fillStyle = '#7aff9a';
  lines.forEach((l, i) => ctx.fillText(l, 10, 18 + i * 15));
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
    if (tr.state === 'firing' && (tr.type === 'saw' || tr.type === 'gravity' || tr.type === 'healspring')) {
      const t = performance.now() / 1000;
      const cv0 = trapSprite(tr.type, tr.w, true);
      ctx.save();
      ctx.globalAlpha = 0.14; ctx.fillStyle = tr.color;
      ctx.beginPath(); ctx.arc(cx, cy, tr.radius, 0, Math.PI * 2); ctx.fill();
      if (tr.type === 'gravity') {       // rings sliding inward
        ctx.strokeStyle = tr.color; ctx.lineWidth = 1.5;
        for (let i = 0; i < 4; i++) {
          const k = 1 - ((t * 0.8 + i / 4) % 1);
          ctx.globalAlpha = 0.6 * (1 - k * 0.5);
          ctx.beginPath(); ctx.arc(cx, cy, tr.radius * k, 0, Math.PI * 2); ctx.stroke();
        }
      } else if (tr.type === 'healspring') {   // green motes rising
        ctx.fillStyle = '#9affc0';
        for (let i = 0; i < 12; i++) {
          const a = i * 2.4, rr = tr.radius * ((i * 37 % 100) / 100);
          const py = cy + Math.sin(a) * rr * 0.7 - ((t * 20 + i * 9) % 24);
          ctx.globalAlpha = 0.7; ctx.fillRect(Math.round(cx + Math.cos(a) * rr), Math.round(py), 2, 2);
        }
      } else {                             // blades whirling round the pit
        ctx.strokeStyle = '#eef4fb'; ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          const a = t * 9 + i * 2.1;
          ctx.globalAlpha = 0.8;
          ctx.beginPath(); ctx.arc(cx, cy, tr.radius * 0.6, a, a + 0.7); ctx.stroke();
        }
      }
      ctx.globalAlpha = 0.6; ctx.strokeStyle = tr.color; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(cx, cy, tr.radius, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
      if (cv0) ctx.drawImage(cv0, Math.round(tr.x) - 2, Math.round(tr.y) - 2);
      continue;
    }
    if (tr.state === 'firing' && tr.type === 'poison') {
      // A lingering toxic cloud: drifting dithered puffs over the pool.
      const cv0 = trapSprite(tr.type, tr.w, true);
      if (cv0) ctx.drawImage(cv0, Math.round(tr.x) - 2, Math.round(tr.y) - 2);
      const t = performance.now() / 1000;
      ctx.save();
      ctx.globalAlpha = 0.16; ctx.fillStyle = tr.color;
      ctx.beginPath(); ctx.arc(cx, cy, tr.radius, 0, Math.PI*2); ctx.fill();
      for (let i = 0; i < 9; i++) {
        const a = i * 0.7 + t * (0.3 + (i % 3) * 0.15);
        const rr = tr.radius * (0.25 + (i % 4) * 0.18);
        const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a * 1.3) * rr * 0.7 - (t * 8 + i * 5) % 10;
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = i % 2 ? '#8ad048' : '#b8f070';
        ctx.fillRect(Math.round(px) - 5, Math.round(py) - 3, 10, 6);
        ctx.fillRect(Math.round(px) - 3, Math.round(py) - 5, 6, 10);
      }
      ctx.globalAlpha = 0.7; ctx.strokeStyle = tr.color; ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(cx, cy, tr.radius, 0, Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      continue;
    }
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
    if (tr.o) drawMindTrapGlyph(tr, cx, cy);
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
  thorns:'#7ac850', cloak:'#8a8ab8', zap:'#ffe45a', turret:'#ff5a3a', egg:'#7affc8',
  frenzy:'#ff3a8a', ironskin:'#a8b4c4', hourglass:'#e8c87a', goldrush:'#ffd84a', elixir:'#ff4ab8',
};
// Timed effects that come from a power-up, so the active ones can show their icon.
const EFFECT_ITEM = { speed:'speed', strength:'strength', shield:'shield', haste:'haste',
                      magnet:'magnet', regen:'regen', vampire:'vampire',
                      thorns:'thorns', ironskin:'ironskin', gold:'goldrush' };
const EFFECT_MAX = { speed:6000, strength:6000, shield:4500, haste:6000, magnet:10000, regen:8000, vampire:7000,
                     thorns:8000, ironskin:8000, gold:12000 };
// A compact row tucked into the corner under the cooldown bars. Slots are a
// little bigger on touch screens so they stay easy to tap.
const INV_SLOT = isTouchDevice ? 24 : 20, INV_ICON = INV_SLOT - 6, INV_GAP = 2, INV_X = 3, INV_Y = 43;
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
  const onRight = myNum % 2 === 0;
  const active = me && me.effects
    ? Object.keys(me.effects).filter(k => EFFECT_ITEM[k] && me.effects[k] > 0) : [];
  if ((!inv || !inv.length) && !active.length) return;

  // A row under the ability bars on your side of the screen, nudged down if an
  // on-screen button (music / leave) happens to sit there.
  const rowW = Math.max(1, inv.length) * (INV_SLOT + INV_GAP) - INV_GAP;
  const x0 = onRight ? HUD_W - INV_X - rowW : INV_X;
  // Below the SUPER and ability bars.
  const top = INV_Y + (me && me.superMax > 0 ? 7 : 0) + ((me && me.abil) || []).filter(Boolean).length * 7;
  let y = clearOfButtons(x0 - 2, top - 2, rowW + 4, INV_SLOT + 4) + 2;
  if (y + INV_SLOT + 8 > HUD_H) y = top;
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
    ctx.font = 'bold 6px "Courier New",monospace';
    ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#000'; ctx.fillText(String(i + 1), x + INV_SLOT - 0.5, y + INV_SLOT + 0.5);
    ctx.fillStyle = '#d8d8ea'; ctx.fillText(String(i + 1), x + INV_SLOT - 1, y + INV_SLOT);
  });

  // Active power-ups: an icon each with a draining timer bar underneath.
  const B = 12, by = y + (inv.length ? INV_SLOT + 4 : 0);
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
  const myKey = myKeyOf();
  const mine = (particles || []).filter(p => p.type === 'pickup' && p.text && p.who === myKey);
  mine.slice(-3).forEach((p, i) => {
    const m = p.max || 1800, k = 1 - p.timer / m;
    // Pop in, hold, then fade.
    const a = k < 0.1 ? k / 0.1 : k > 0.75 ? Math.max(0, (1 - k) / 0.25) : 1;
    const pop = k < 0.12 ? 1 + (0.12 - k) * 3 : 1;
    const cy = 112 + i * 34;   // below the weapon rack at the top
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
    if (ch.kind === 'dark') {   // the leash: how far a Darklight chain lets them go
      ctx.save(); ctx.globalAlpha = 0.45; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#f4f4fa'; ctx.beginPath(); ctx.arc(ch.x1, ch.y1, 45, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#15151c'; ctx.lineDashOffset = 3.5; ctx.beginPath(); ctx.arc(ch.x1, ch.y1, 45, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    const dx = ch.x2 - ch.x1, dy = ch.y2 - ch.y1;
    const len = Math.hypot(dx, dy);
    if (len < 2) continue;
    const ang = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(ch.x1, ch.y1);
    ctx.rotate(ang);
    if (ch.kind === 'dark') {
      // Darklight's chain: black and white links with a faint glow.
      ctx.globalAlpha = 0.25; ctx.strokeStyle = '#b8a0ff'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 1.4;
      const n = Math.max(1, Math.floor(len / 5));
      for (let i = 0; i < n; i++) {
        const x = (i + 0.5) * (len / n), flat = i % 2 === 0;
        ctx.strokeStyle = flat ? '#f4f4fa' : '#15151c';
        ctx.beginPath(); ctx.ellipse(x, 0, flat ? 2.6 : 1.5, flat ? 1.3 : 2.4, 0, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = '#f4f4fa'; ctx.beginPath(); ctx.arc(0, 0, 2.4, 0, Math.PI * 2); ctx.fill();   // the stake
      ctx.fillStyle = '#15151c'; ctx.beginPath(); ctx.arc(0, 0, 1.2, 0, Math.PI * 2); ctx.fill();
    } else if (ch.kind === 'hook') {
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

const EFFECT_GLOW = { speed:'#44ddee', strength:'#ff5544', shield:'#ffdd44', haste:'#aa66ff', slow:'#3366aa',
                      burn:'#ff6a1a', poison:'#8ad048', magnet:'#ffc24a', regen:'#ff7ac8', vampire:'#d8304a',
                      vanish:'#6a6a9a', phoenix:'#ffa03a', ghost:'#a8f0ff', thunder:'#7ac8ff',
                      thorns:'#7ac850', ironskin:'#a8b4c4', gold:'#ffd84a', frostarmor:'#9fe8ff',
                      root:'#5aa83a', confuse:'#ff7ac8', silence:'#9a9ab8' };

// Flickering pixel flames over something that's on fire.
function drawFlames(x, y, w, h) {
  const t = performance.now() / 90;
  ctx.save();
  for (let i = 0; i < 5; i++) {
    const fx = x + (w * (i + 0.5)) / 5 + Math.sin(t + i * 1.7) * 1.5;
    const fh = 4 + ((Math.sin(t * 1.3 + i * 2.1) + 1) * 3);
    const fy = y + h * 0.35 - (i % 2) * 3;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#ff5a1a'; ctx.fillRect(Math.round(fx) - 1, Math.round(fy - fh), 3, Math.round(fh));
    ctx.fillStyle = '#ffc030'; ctx.fillRect(Math.round(fx), Math.round(fy - fh * 0.6), 1, Math.round(fh * 0.6));
  }
  ctx.restore();
}

function drawPlayer(p, baseColor, label, key) {
  if (p.dead) return;
  if (p.controlling) { if (key === 'p' + myNum) drawMindHome(p); return; }
  // VANISH / ghost cloak: gone for everyone else; a faint shimmer for you.
  const unseen = p.effects && (p.effects.vanish > 0 || p.effects.ghost > 0);
  if (unseen && key !== 'p' + myNum) return;
  if (unseen) { ctx.save(); ctx.globalAlpha = 0.35 + 0.1 * Math.sin(performance.now() / 120); }
  drawPlayerBody(p, baseColor, label, key);
  if (unseen) ctx.restore();
}
// ── Weapon passives, made visible ──
// Every active passive gets a pulsing aura in its colour, plus its own touch:
// SWIFTNESS trails wind streaks while you run, BERSERKER burns hotter the more
// hurt you are, FROST AURA shows its reach, EMBER SKIN sheds embers, and so on.
// Puffs (streaks, embers, petals) live per player and are stepped per frame.
const passiveTrack = {};
function drawPassiveFx(p, key, x, y) {
  const pv = p.passive && WEAPON_META[p.passive]?.passive;
  if (!pv) { delete passiveTrack[key]; return; }
  const now = performance.now(), col = pv.color, id = p.passive;
  const mx = x + p.w / 2, my = y + p.h / 2;
  let tr = passiveTrack[key];
  if (!tr || tr.id !== id) tr = passiveTrack[key] = { id, x: mx, y: my, t: now, vx: 0, vy: 0, puffs: [], acc: 0 };
  const dt = Math.min(50, Math.max(1, now - tr.t));
  tr.vx = tr.vx * 0.75 + ((mx - tr.x) / dt * 16) * 0.25;
  tr.vy = tr.vy * 0.75 + ((my - tr.y) / dt * 16) * 0.25;
  tr.x = mx; tr.y = my; tr.t = now;
  const spd = Math.hypot(tr.vx, tr.vy);
  const rnd = Math.random;

  // New puffs.
  tr.acc += dt;
  const every = id === 'dagger' ? 28 : id === 'fireglove' ? 70 : id === 'katana' ? 160 : id === 'revolver' ? 140 : 0;
  while (every && tr.acc >= every) {
    tr.acc -= every;
    if (id === 'dagger' && spd > 0.6) {
      // Streaks start just behind you and blow back the way you came.
      const ux = tr.vx / spd, uy = tr.vy / spd;
      const side = (rnd() - 0.5) * p.h * 1.1;
      tr.puffs.push({ x: mx - ux * p.w * 0.6 - uy * side, y: my - uy * p.w * 0.6 + ux * side,
                      vx: -ux * 1.2, vy: -uy * 1.2, len: 6 + rnd() * 8, ux, uy, life: 320, max: 320 });
    } else if (id === 'fireglove') {
      tr.puffs.push({ x: mx + (rnd() - 0.5) * p.w, y: y + p.h - rnd() * 4, vx: (rnd() - 0.5) * 0.3, vy: -0.6 - rnd() * 0.5, life: 650, max: 650 });
    } else if (id === 'revolver') {
      tr.puffs.push({ x: mx + (rnd() - 0.5) * p.w, y: y + 2, vx: (rnd() - 0.5) * 0.2, vy: -0.35, life: 900, max: 900, r: 1.5 + rnd() * 1.5 });
    } else if (id === 'katana') {
      tr.puffs.push({ x: mx + (rnd() - 0.5) * p.w * 2, y: y - 4, vx: (rnd() - 0.5) * 0.4, vy: 0.35 + rnd() * 0.2, life: 1100, max: 1100, spin: rnd() * 6 });
    }
  }
  if (!every) tr.acc = 0;
  for (const f of tr.puffs) { f.x += f.vx * dt / 16; f.y += f.vy * dt / 16; f.life -= dt; }
  tr.puffs = tr.puffs.filter(f => f.life > 0).slice(-60);

  ctx.save();
  // The aura: a soft disc that breathes, brighter for BERSERKER at low health.
  const hurt = p.maxHp ? 1 - p.hp / p.maxHp : 0;
  const pulse = 0.5 + 0.5 * Math.sin(now / (id === 'axe' ? 220 - hurt * 140 : 260));
  const base = id === 'axe' ? 0.12 + hurt * 0.3 : 0.16;
  ctx.globalAlpha = base + 0.1 * pulse; ctx.fillStyle = col;
  ctx.beginPath(); ctx.ellipse(mx, my, p.w * 1.05 + pulse * 2, p.h * 0.85 + pulse * 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.45 + 0.25 * pulse; ctx.strokeStyle = col; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(mx, y + p.h, p.w * 0.75, 3, 0, 0, Math.PI * 2); ctx.stroke();

  // Each passive's own touch.
  if (id === 'dagger') {
    ctx.lineWidth = 1.2; ctx.lineCap = 'round';
    for (const f of tr.puffs) {
      const k = f.life / f.max;
      ctx.globalAlpha = 0.75 * k; ctx.strokeStyle = k > 0.6 ? '#ffffff' : col;
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x - f.ux * f.len, f.y - f.uy * f.len); ctx.stroke();
    }
  } else if (id === 'fireglove') {
    for (const f of tr.puffs) {
      const k = f.life / f.max;
      ctx.globalAlpha = k; ctx.fillStyle = k > 0.5 ? '#ffd84a' : col;
      ctx.fillRect(Math.round(f.x), Math.round(f.y), 1.5, 1.5);
    }
  } else if (id === 'katana') {
    for (const f of tr.puffs) {
      const k = f.life / f.max;
      ctx.globalAlpha = Math.min(1, k * 2) * 0.9; ctx.fillStyle = col;
      ctx.save(); ctx.translate(f.x + Math.sin(now / 300 + f.spin) * 3, f.y); ctx.rotate(now / 400 + f.spin);
      ctx.fillRect(-1.5, -0.8, 3, 1.6); ctx.restore();
    }
  } else if (id === 'frostrod') {
    ctx.globalAlpha = 0.35; ctx.strokeStyle = col; ctx.setLineDash([3, 5]); ctx.lineDashOffset = -now / 60;
    ctx.beginPath(); ctx.arc(mx, my, 115, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 10; i++) {
      const a = i * 0.63 + now / 1400, d = 30 + ((i * 37) % 80);
      ctx.globalAlpha = 0.5 + 0.4 * Math.sin(now / 300 + i);
      ctx.fillRect(Math.round(mx + Math.cos(a) * d), Math.round(my + Math.sin(a) * d), 1.5, 1.5);
    }
  } else if (id === 'revolver') {
    // Gun smoke curling up, with the odd spark.
    for (const f of tr.puffs) {
      const k = f.life / f.max;
      ctx.globalAlpha = 0.35 * k; ctx.fillStyle = '#b8b0a8';
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r + (1 - k) * 3, 0, Math.PI * 2); ctx.fill();
    }
    if (Math.floor(now / 120) % 5 === 0) { ctx.globalAlpha = 1; ctx.fillStyle = '#ffd84a'; ctx.fillRect(Math.round(mx + (rnd() - 0.5) * p.w * 1.6), Math.round(my + (rnd() - 0.5) * p.h), 1.5, 1.5); }
  } else if (id === 'vortex') {
    // AEGIS: a turning hex of shield plates while it's ready; faint while it recharges.
    const ready = p.aegis !== false;
    ctx.globalAlpha = ready ? 0.85 : 0.2; ctx.strokeStyle = col; ctx.lineWidth = ready ? 1.5 : 1;
    const r = p.w * 1.15;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) {
      const a = now / 900 + i * Math.PI / 3;
      const px = mx + Math.cos(a) * r, py = my + Math.sin(a) * r * 0.8;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.stroke();
  } else if (id === 'windwand') {
    // GALE GUARD: wind arcs whirling round you.
    ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a = now / 260 + i * Math.PI * 2 / 3, r = p.w * (1.1 + 0.15 * Math.sin(now / 300 + i));
      ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.ellipse(mx, my, r, r * 0.75, 0, a, a + 1.1); ctx.stroke();
    }
  } else if (id === 'portalwand') {
    // ESCAPE PORTAL: a small portal turning under your feet.
    const fy = y + p.h;
    ctx.globalAlpha = 0.3; ctx.fillStyle = '#12051f';
    ctx.beginPath(); ctx.ellipse(mx, fy, p.w * 0.9, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.85; ctx.strokeStyle = col; ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 3]); ctx.lineDashOffset = -now / 40;
    ctx.beginPath(); ctx.ellipse(mx, fy, p.w * 0.9, 4, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  } else if (id === 'sunbow') {
    // SUNLIT: slow-turning rays of sunlight behind you.
    ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    for (let i = 0; i < 8; i++) {
      const a = now / 1500 + i * Math.PI / 4;
      ctx.globalAlpha = 0.35 + 0.2 * Math.sin(now / 200 + i);
      ctx.beginPath(); ctx.moveTo(mx + Math.cos(a) * p.w * 0.8, my + Math.sin(a) * p.w * 0.8);
      ctx.lineTo(mx + Math.cos(a) * p.w * 1.4, my + Math.sin(a) * p.w * 1.4); ctx.stroke();
    }
  } else if (id === 'stormtome' || id === 'stormhammer') {
    ctx.strokeStyle = col; ctx.lineWidth = 1;
    if (Math.floor(now / 90) % 3 === 0) {
      const a = rnd() * Math.PI * 2, r0 = p.w * 0.7, r1 = p.w * 1.3;
      ctx.globalAlpha = 0.9; ctx.beginPath();
      ctx.moveTo(mx + Math.cos(a) * r0, my + Math.sin(a) * r0);
      ctx.lineTo(mx + Math.cos(a + 0.3) * (r0 + r1) / 2 + 2, my + Math.sin(a + 0.3) * (r0 + r1) / 2);
      ctx.lineTo(mx + Math.cos(a) * r1, my + Math.sin(a) * r1); ctx.stroke();
    }
  } else {
    // Orbiting motes: sword sparkles, bow glints, staff runes, reaper souls.
    const n = id === 'reaper' || id === 'ghostdagger' ? 2 : 3, r = p.w * 1.1;
    for (let i = 0; i < n; i++) {
      const a = now / (id === 'reaper' || id === 'ghostdagger' ? 500 : 700) + i * Math.PI * 2 / n;
      const ox = mx + Math.cos(a) * r, oy = my + Math.sin(a) * r * 0.55;
      ctx.globalAlpha = 0.85; ctx.fillStyle = col;
      if (id === 'staff') ctx.fillRect(Math.round(ox) - 1.5, Math.round(oy) - 1.5, 3, 3);
      else if (id === 'frostscythe') {
        ctx.beginPath(); ctx.moveTo(ox, oy - 3); ctx.lineTo(ox + 1.8, oy); ctx.lineTo(ox, oy + 3); ctx.lineTo(ox - 1.8, oy); ctx.closePath(); ctx.fill();
      }
      else if (id === 'reaper' || id === 'ghostdagger') {
        ctx.beginPath(); ctx.arc(ox, oy, 2, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.35; ctx.fillRect(Math.round(ox - Math.sin(a) * 4) - 1, Math.round(oy) - 1, 2, 2);
      } else {
        ctx.fillRect(Math.round(ox) - 0.5, Math.round(oy) - 2, 1, 4);
        ctx.fillRect(Math.round(ox) - 2, Math.round(oy) - 0.5, 4, 1);
      }
    }
  }
  ctx.restore();
}

// Curses and buffs from the 10 update, drawn on the player so they read at a glance.
function drawStatusMarks(p, x, y) {
  const e = p.effects; if (!e) return;
  const now = performance.now(), mx = x + p.w / 2;
  ctx.save();
  if (e.root > 0) {            // vines wound round the legs
    ctx.strokeStyle = '#3a8a2a'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(x + 2 + i * 6, y + p.h + 2);
      ctx.quadraticCurveTo(x + i * 6 + 6, y + p.h - 6, x + 4 + i * 5, y + p.h - 10); ctx.stroke();
    }
    ctx.fillStyle = '#7ad85a'; ctx.fillRect(x + 3, y + p.h - 8, 2, 2); ctx.fillRect(x + p.w - 5, y + p.h - 5, 2, 2);
  }
  if (e.confuse > 0) {         // a spinning question mark
    ctx.fillStyle = '#ff7ac8'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
    ctx.globalAlpha = 0.9;
    ctx.fillText('?', mx + Math.sin(now / 150) * 5, y - 16);
    ctx.textAlign = 'left';
  }
  if (e.silence > 0) {         // a struck-through spark
    const sx = mx + 10, sy = y - 14;
    ctx.strokeStyle = '#c8c8e0'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx - 3, sy + 3); ctx.lineTo(sx + 3, sy - 3); ctx.stroke();
  }
  if (e.thorns > 0) {          // a ring of thorns
    ctx.fillStyle = '#7ac850';
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + now / 2000, r = p.w * 0.95;
      const tx = mx + Math.cos(a) * r, ty = y + p.h / 2 + Math.sin(a) * r * 0.8;
      ctx.beginPath(); ctx.moveTo(tx + Math.cos(a) * 4, ty + Math.sin(a) * 4);
      ctx.lineTo(tx + Math.cos(a + 1.6) * 1.5, ty + Math.sin(a + 1.6) * 1.5); ctx.lineTo(tx - Math.cos(a + 1.6) * 1.5, ty - Math.sin(a + 1.6) * 1.5); ctx.fill();
    }
  }
  if (e.frostarmor > 0 || e.ironskin > 0) {   // plated outline
    ctx.globalAlpha = 0.7; ctx.strokeStyle = e.frostarmor > 0 ? '#bfefff' : '#c8d0dc'; ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 2, y - 2, p.w + 4, p.h + 4);
    ctx.globalAlpha = 0.25; ctx.fillStyle = ctx.strokeStyle; ctx.fillRect(x - 2, y - 2, p.w + 4, p.h + 4);
  }
  if (e.gold > 0 && Math.floor(now / 140) % 3 === 0) {
    ctx.globalAlpha = 1; ctx.fillStyle = '#ffd84a';
    ctx.fillRect(Math.round(mx + (Math.random() - 0.5) * p.w * 1.6), Math.round(y + Math.random() * p.h), 2, 2);
  }
  ctx.restore();
}

function drawPlayerBody(p, baseColor, label, key) {
  const skinCol = getSkinColor(p, baseColor);
  const x = Math.round(p.x), y = Math.round(p.y);
  drawPassiveFx(p, key, x, y);

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

  const cv = playerSprite(skinCol, p.skin?.hatIdx || 0, p.facing, p.hitFlash > 0, p.skin?.outfit || '', p.skin?.accIdx || 0);
  if (cv) drawLightRunner(p, key, x, y, cv);
  if (cv) ctx.drawImage(cv, x, y - PLAYER_PAD);
  if (p.lightspeed > 0) drawLightspeedFx(p, x, y);

  drawNametag(x + p.w / 2, y - 13, label, skinCol);
  if (key === 'p2' && currState?.bot && currState.botReward) drawBounty(x + p.w / 2, y - 25, currState.botReward);
  if (!(p.kspin > 0)) drawWeaponSprite(p, x, y, key);
  if (p.weaponId === 'infinitybow' && !p.dead) drawInfinityFloaters(p, x, y);
  if (p.weaponId === 'endlessscythe' && !p.dead) drawEndlessFloaters(p, x, y, key);
  if (p.kspin > 0 && !p.dead) drawKatanaSpin(p, x, y);
  if (p.dk && !p.dead) drawDarklightOrbit(p, x, y);
  if (p.curse > 0 && !p.dead) drawCurseFx(p, x, y);
  if (p.srain > 0 && !p.dead) drawStarRainAura(p, x, y);
  drawStatusMarks(p, x, y);
  if (p.puppet) drawPuppetMark(x + p.w / 2, y - 6, null);
  if (p.shuffleIn != null && key === 'p' + myNum) drawShuffleCountdown(p, x, y);
  drawVortexShield(p, x, y);
  if (p.effects && p.effects.burn > 0) drawFlames(x, y, p.w, p.h);

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

// ── Light Blade ──
// Dashing or at LIGHTSPEED you leave glowing afterimages and streaks of light.
const lightRun = {};
function drawLightRunner(p, key, x, y, cv) {
  const now = performance.now();
  let tr = lightRun[key];
  if (!tr) tr = lightRun[key] = { pts: [] };
  const fast = p.dashing || p.lightspeed > 0;
  if (fast) {
    const last = tr.pts[tr.pts.length - 1];
    if (!last || Math.hypot(last.x - x, last.y - y) > 3) tr.pts.push({ x, y, t: now });
  }
  while (tr.pts.length && (now - tr.pts[0].t > 220 || tr.pts.length > 14)) tr.pts.shift();
  if (key === 'p' + myNum && bladeTapMark && now - bladeTapMark.at < 350) {
    const k = (now - bladeTapMark.at) / 350;
    ctx.save();
    ctx.globalAlpha = 0.8 * (1 - k); ctx.strokeStyle = '#fff27a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(bladeTapMark.x, bladeTapMark.y, 4 + k * 10, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  if (!tr.pts.length) return;
  ctx.save();
  // A streak of light along the path…
  ctx.lineCap = 'round';
  for (const [w, c, al] of [[p.w * 0.9, '#fff27a', 0.22], [3, '#ffffff', 0.6]]) {
    ctx.strokeStyle = c; ctx.lineWidth = w;
    ctx.beginPath();
    tr.pts.forEach((q, i) => {
      ctx.globalAlpha = al;
      if (i === 0) ctx.moveTo(q.x + p.w / 2, q.y + p.h / 2); else ctx.lineTo(q.x + p.w / 2, q.y + p.h / 2);
    });
    ctx.lineTo(x + p.w / 2, y + p.h / 2);
    ctx.stroke();
  }
  // …and fading copies of you along it.
  for (const q of tr.pts) {
    const k = 1 - (now - q.t) / 220;
    if (k <= 0 || (Math.abs(q.x - x) < 2 && Math.abs(q.y - y) < 2)) continue;
    ctx.globalAlpha = 0.35 * k;
    ctx.drawImage(cv, q.x, q.y - PLAYER_PAD);
  }
  ctx.restore();
}

// LIGHTSPEED: crackling lightning round you, beams of light flaring out,
// and speed lines streaming off behind.
function drawLightspeedFx(p, x, y) {
  const now = performance.now(), mx = x + p.w / 2, my = y + p.h / 2;
  const fadeOut = Math.min(1, p.lightspeed / 600);
  ctx.save();
  // Aura reach.
  ctx.globalAlpha = (0.12 + 0.06 * Math.sin(now / 60)) * fadeOut; ctx.fillStyle = '#fff27a';
  ctx.beginPath(); ctx.arc(mx, my, 80, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.35 * fadeOut; ctx.strokeStyle = '#fff27a'; ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]); ctx.lineDashOffset = -now / 20;
  ctx.beginPath(); ctx.arc(mx, my, 80, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  // Beams of light flaring out and turning.
  for (let i = 0; i < 6; i++) {
    const a = now / 400 + i * Math.PI / 3, len = 26 + 14 * Math.sin(now / 90 + i * 2);
    const g = ctx.createLinearGradient(mx, my, mx + Math.cos(a) * len, my + Math.sin(a) * len);
    g.addColorStop(0, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,242,122,0)');
    ctx.globalAlpha = fadeOut; ctx.strokeStyle = g; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + Math.cos(a) * len, my + Math.sin(a) * len); ctx.stroke();
  }
  // Little jagged bolts crackling round your body, re-rolled every frame.
  for (let b = 0; b < 3; b++) {
    const a0 = Math.random() * Math.PI * 2, r0 = p.w * 0.5, r1 = p.w * (1.1 + Math.random() * 0.9);
    let px = mx + Math.cos(a0) * r0, py = my + Math.sin(a0) * r0;
    ctx.globalAlpha = 0.9 * fadeOut; ctx.strokeStyle = b % 2 ? '#ffffff' : '#fff27a'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(px, py);
    for (let s = 1; s <= 4; s++) {
      const rr = r0 + (r1 - r0) * s / 4, aa = a0 + (Math.random() - 0.5) * 0.7;
      px = mx + Math.cos(aa) * rr; py = my + Math.sin(aa) * rr; ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  // Speed lines and sparks.
  for (let i = 0; i < 8; i++) {
    const k = (now / 260 + i / 8) % 1;
    const sx = mx - (p.facing || 1) * (6 + k * 26), sy = my - p.h / 2 + ((i * 37) % p.h) + 2;
    ctx.globalAlpha = (1 - k) * 0.8 * fadeOut; ctx.fillStyle = i % 3 ? '#fff27a' : '#ffffff';
    ctx.fillRect(Math.round(sx), Math.round(sy), Math.round(6 - k * 4), 1);
  }
  ctx.restore();
}

// A bot's bounty: what beating it pays, floating over its name.
function drawBounty(cx, bottomY, coins) {
  ctx.save();
  ctx.font = 'bold 9px "Courier New",monospace';
  ctx.textBaseline = 'bottom'; ctx.textAlign = 'center';
  const label = 'BOUNTY ◆ ' + coins.toLocaleString();
  const rx = Math.round(cx), tw = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(40,24,0,0.85)'; ctx.fillRect(rx - tw/2 - 3, bottomY - 10, tw + 6, 12);
  ctx.strokeStyle = '#ffcc33'; ctx.lineWidth = 1; ctx.strokeRect(rx - tw/2 - 2.5, bottomY - 9.5, tw + 5, 11);
  ctx.fillStyle = '#ffd84a'; ctx.fillText(label, rx, bottomY);
  ctx.restore();
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
const SCYTHES = new Set(['reaper', 'frostscythe']);

function drawWeaponSprite(p, px, py, key) {
  const wId = p.weaponId;
  if (!WEAPON_ART[wId]) return;
  const wc = WEAPON_COLOR[wId] || PAL.white;
  const d = p.facing;
  const hx = d === 1 ? px + p.w - 2 : px + 2;   // hand attachment (the front glove)
  const hy = py + 15;
  const u = upgScale(p.upg);
  // Range upgrades lengthen the weapon itself, quantised so the sprite cache
  // does not grow a new bitmap for every possible level combination.
  const scale = HELD_SCALE * (1 + u.rng * 0.045);

  // Each weapon has its own move (see ATTACK_ANIM); at rest it tilts slightly.
  const anim = attackProgress(key, wId);
  const pose = anim ? weaponPose(anim.kind, anim.e) : { rot: 0.12 };

  // A scythe's blade curves to one side, and the whirl turns clockwise, so held
  // blade-up it would lead with its blunt back. For the spin it turns over (a
  // quick flip at each end) so the cutting edge always goes first.
  let flipY = 1;
  if (anim && anim.kind === 'spin' && SCYTHES.has(wId)) {
    const e = anim.e;
    flipY = e < 0.1 ? 1 - e * 20 : e > 0.9 ? -1 + (e - 0.9) * 20 : -1;
  }

  ctx.save();
  ctx.translate(hx + (pose.dx || 0) * d, hy + (pose.dy || 0));
  ctx.scale(d, flipY);   // art is authored pointing +X; mirroring handles facing
  ctx.rotate(pose.rot);
  if (pose.alpha != null) ctx.globalAlpha = pose.alpha;

  // Spell-casters light up at the tip as they cast.
  if (pose.glow > 0.05) {
    const box = WEAPON_ART[wId].box;
    const tip = (box.x + box.w) * scale;
    ctx.save();
    ctx.globalAlpha = pose.glow * 0.55;
    ctx.fillStyle = wc;
    ctx.beginPath(); ctx.arc(tip, 0, 3 + pose.glow * 4, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = pose.glow * 0.9;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(tip, 0, 1 + pose.glow * 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
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
  if (m.mage && m.hidden) return;   // gone into hiding behind his giants
  if (m.abyss) { drawAbyss(m); return; }
  const type = m.type || 'grunt';
  const state = m.hitFlash > 0 ? 'flash' : monsterBodyState(m);
  const x = Math.round(m.x), y = Math.round(m.y);
  if (m.mage) drawMageAura(m, x, y);

  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.fillRect(x + 1, y + m.h, m.w - 2, 2);

  const cv = monsterSprite(type, m.w, m.h, state);
  if (type === 'light' && cv) drawLightTrail(m, cv);
  if (cv) {
    const pad = monsterPad(m.w, m.h);
    ctx.drawImage(cv, x - pad, y - pad);
  }
  drawMonsterArms(m, x, y);
  if (m.burning) drawFlames(x, y, m.w, m.h);
  if (m.frozen) drawFreezeFx(m, x, y); else if (m.slowed) drawSlowFx(m, x, y);
  if (m.curse) drawCurseFx(m, x, y);
  if (m.ctl) drawPuppetMark(x + m.w / 2, y - 8, m);
  drawMonsterTells(m, x, y);
  if (m.boss) { drawBossMarks(m, x, y); return; }

  drawHpBar(x - 1, y - 5, m.w + 2, 2, m.hp / m.maxHp, '#44ff44', '#003300');
  // Armoured types get a marker on the bar, since their health drains slowly.
  if (m.armor > 0) {
    ctx.fillStyle = '#c9d7ea';
    ctx.fillRect(x - 1, y - 8, Math.max(2, Math.round((m.w + 2) * m.armor)), 2);
  }
}
function drawMonsters(ms) { for(const m of ms) drawMonster(m); }

// Light leaves fading afterimages wherever he has just been.
const lightTrails = new Map();
function drawLightTrail(m, cv) {
  const now = performance.now();
  let tr = lightTrails.get(m.id);
  if (!tr) { tr = []; lightTrails.set(m.id, tr); }
  const last = tr[tr.length - 1];
  if (!last || Math.hypot(last.x - m.x, last.y - m.y) > 3) tr.push({ x: m.x, y: m.y, t: now });
  while (tr.length && now - tr[0].t > 260) tr.shift();
  if (lightTrails.size > 40) for (const k of lightTrails.keys()) { if (k !== m.id) { lightTrails.delete(k); break; } }
  const pad = monsterPad(m.w, m.h);
  ctx.save();
  for (const p of tr) {
    const k = 1 - (now - p.t) / 260;
    if (k <= 0 || (Math.abs(p.x - m.x) < 2 && Math.abs(p.y - m.y) < 2)) continue;
    ctx.globalAlpha = 0.35 * k;
    ctx.drawImage(cv, Math.round(p.x) - pad, Math.round(p.y) - pad);
  }
  ctx.restore();
}

// Warnings for the monsters with tricks, so each one can be read and dodged:
// a bomber's blast ring, a charger's ram line, a necromancer's grave marks,
// a shaman's ward, and stars over a dazed charger.
const BOMB_R = 62, CHARGE_DIST = 380;   // mirror the server
function drawMonsterTells(m, x, y) {
  const now = performance.now();
  const mx = x + m.w / 2, my = y + m.h / 2;
  ctx.save();
  if (m.fuse > 0) {
    const k = 1 - Math.min(1, m.fuse / 900);
    const blink = Math.sin(now / (60 - k * 35)) > 0;
    ctx.globalAlpha = 0.10 + 0.18 * k; ctx.fillStyle = '#ff4a1a';
    ctx.beginPath(); ctx.arc(mx, my, BOMB_R, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = blink ? 0.9 : 0.4; ctx.strokeStyle = '#ffb030'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(mx, my, BOMB_R * (0.25 + 0.75 * k), 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([4, 4]); ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.arc(mx, my, BOMB_R, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    if (blink) { ctx.globalAlpha = 0.5; ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, m.w, m.h); }
  }
  if (m.samWind) {
    // The glint before he throws: red for a slash wave, white for the quiet one.
    const k = (now / 60) % 1;
    ctx.globalAlpha = 0.9; ctx.strokeStyle = m.samWind === 'dash' ? '#ffffff' : '#ff5a5a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(mx - 6 - k * 4, y - 6); ctx.lineTo(mx + 6 + k * 4, y - 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mx, y - 12 - k * 4); ctx.lineTo(mx, y); ctx.stroke();
    ctx.globalAlpha = 0.25; ctx.fillStyle = m.samWind === 'dash' ? '#ffffff' : '#ff5a5a';
    ctx.beginPath(); ctx.arc(mx, my, m.w * 0.9, 0, Math.PI * 2); ctx.fill();
  }
  if (m.samDash != null) {
    // The flash: a long bright streak trailing back from him.
    const a = m.samDash;
    ctx.globalAlpha = 0.55; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = m.h * 0.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx - Math.cos(a) * 60, my - Math.sin(a) * 60); ctx.stroke();
    ctx.globalAlpha = 0.8; ctx.strokeStyle = '#ff5a5a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx - Math.cos(a) * 80, my - Math.sin(a) * 80); ctx.stroke();
  }
  if (m.ward) {
    ctx.globalAlpha = 0.35 + 0.15 * Math.sin(now / 150); ctx.strokeStyle = '#5aff9a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(mx, my, m.w * 0.8 + 2, m.h * 0.7 + 2, 0, 0, Math.PI * 2); ctx.stroke();
  }
  if (m.charge && m.charge.wind) {
    const a = m.charge.a, L = CHARGE_DIST;
    ctx.translate(mx, my); ctx.rotate(a);
    ctx.globalAlpha = 0.18 + 0.12 * Math.sin(now / 50); ctx.fillStyle = '#ff5a3a';
    ctx.fillRect(0, -m.h / 2, L, m.h);
    ctx.globalAlpha = 0.8; ctx.strokeStyle = '#ff8a5a'; ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]); ctx.lineDashOffset = -now / 20;
    ctx.beginPath(); ctx.moveTo(0, -m.h / 2); ctx.lineTo(L, -m.h / 2); ctx.moveTo(0, m.h / 2); ctx.lineTo(L, m.h / 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ff8a5a';
    ctx.beginPath(); ctx.moveTo(L + 8, 0); ctx.lineTo(L - 4, -7); ctx.lineTo(L - 4, 7); ctx.closePath(); ctx.fill();
    ctx.restore(); ctx.save();   // back to world space
  }
  if (m.lsweep) {
    // Light's sweep: a glinting arc while he gathers, then a bright cut.
    const R = 46, a = m.lsweep.a;
    ctx.lineWidth = m.lsweep.wind ? 1.5 : 3;
    ctx.strokeStyle = m.lsweep.wind ? '#fff6a0' : '#ffffff';
    ctx.globalAlpha = m.lsweep.wind ? 0.45 + 0.35 * Math.sin(now / 40) : 0.85;
    ctx.beginPath(); ctx.arc(mx, my, R, a - 1.4, a + 1.4); ctx.stroke();
    if (m.lsweep.wind) {
      ctx.globalAlpha = 0.12; ctx.fillStyle = '#fff6a0';
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.arc(mx, my, R, a - 1.4, a + 1.4); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.9; ctx.fillStyle = '#ffffff';   // the glint on his blade
      ctx.fillRect(Math.round(mx + Math.cos(now / 60) * 4) - 1, Math.round(y - 4), 2, 2);
    }
  }
  if (m.ldash) {
    // Light's flash chain: an arrow while he lines up, pips for dashes left.
    const a = m.ldash.a;
    if (m.ldash.wind) {
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(now / 45); ctx.strokeStyle = '#fff6a0'; ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]); ctx.lineDashOffset = -now / 15;
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + Math.cos(a) * 90, my + Math.sin(a) * 90); ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.globalAlpha = 0.7; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx - Math.cos(a) * 26, my - Math.sin(a) * 26); ctx.stroke();
    }
    ctx.globalAlpha = 0.95; ctx.fillStyle = '#fff6a0';
    for (let i = 0; i < (m.ldash.n || 0); i++) ctx.fillRect(Math.round(mx - (m.ldash.n - 1) * 2 + i * 4) - 1, Math.round(y - 12), 2, 2);
  }
  if (m.dazed) {
    ctx.fillStyle = '#ffe25a'; ctx.globalAlpha = 0.9;
    for (let i = 0; i < 3; i++) {
      const a = now / 200 + i * 2.1;
      ctx.fillRect(Math.round(mx + Math.cos(a) * m.w * 0.5) - 1, Math.round(y - 5 + Math.sin(a) * 2) - 1, 2, 2);
    }
  }
  if (m.raise) {
    for (const r of m.raise) {
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(now / 80); ctx.strokeStyle = '#9aff7a'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.ellipse(r.x, r.y + 6, 9, 3.5, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.25; ctx.fillStyle = '#9aff7a';
      ctx.fillRect(r.x - 1, r.y - 10, 2, 16);
    }
    ctx.globalAlpha = 0.4; ctx.strokeStyle = '#9aff7a';
    ctx.beginPath(); ctx.arc(mx, my, m.w * 0.9, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

// Portal Wand allies: the same monsters, washed in their owner's colour, with
// a ring at their feet and a bar in that colour. They flicker as they fade.
function drawAlly(a) {
  const col = ownerColor(a.owner);
  const x = Math.round(a.x), y = Math.round(a.y);
  ctx.save();
  if (a.fade) ctx.globalAlpha = 0.45 + 0.4 * Math.abs(Math.sin(performance.now() / 90));
  ctx.strokeStyle = col; ctx.lineWidth = 1.5;
  ctx.globalAlpha *= 0.8;
  ctx.beginPath(); ctx.ellipse(x + a.w / 2, y + a.h, a.w * 0.6, 3.5, 0, 0, Math.PI * 2); ctx.stroke();
  if (a.fade) ctx.globalAlpha = 0.45 + 0.4 * Math.abs(Math.sin(performance.now() / 90));
  else ctx.globalAlpha = 1;
  const cv = monsterSprite(a.type, a.w, a.h, a.hitFlash > 0 ? 'flash' : 'ally:' + col);
  if (cv) {
    const pad = monsterPad(a.w, a.h);
    ctx.drawImage(cv, x - pad, y - pad);
  }
  drawMonsterArms(a, x, y);
  if (a.burning) drawFlames(x, y, a.w, a.h);
  ctx.restore();
  drawHpBar(x - 1, y - 5, a.w + 2, 2, a.hp / a.maxHp, col, '#111');
}
function drawAllies(as) { for (const a of as) drawAlly(a); }

// Under the Portal Mage: a slowly turning rune circle; in phase 2 it burns
// magenta and pulses.
const MAGE_CAST_COLOR = { fireportals: '#ff4a2a', teleport: '#b07aff', traps: '#ffcc33', monsterportals: '#3aff7a' };
function drawMageAura(m, x, y) {
  const now = performance.now() / 1000;
  const cxm = x + m.w / 2, fy = y + m.h - 2;
  const p2 = m.phase === 2;
  const col = m.cast ? (MAGE_CAST_COLOR[m.cast] || '#b07aff') : p2 ? '#ff4a9a' : '#8a5aff';
  ctx.save();
  ctx.globalAlpha = (p2 ? 0.35 : 0.22) + (p2 ? 0.12 * Math.sin(now * 8) : 0);
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.ellipse(cxm, fy, m.w * 0.95, m.w * 0.32, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = col; ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 3]); ctx.lineDashOffset = -now * 20;
  ctx.beginPath(); ctx.ellipse(cxm, fy, m.w * 0.95, m.w * 0.32, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

// ── Statuses, each drawn its own way ──
// Which sprite tint a monster wears: what froze or slowed it decides.
const SLOW_BODY = { chill: 'slow', time: 'slowtime', net: 'slownet', poison: 'slowpoison', mind: 'slowmind' };
const FREEZE_BODY = { ice: 'ice', timestop: 'tstop', void: 'void', holy: 'holy', shock: 'shock', mind: 'mind' };
function monsterBodyState(m) {
  if (m.frozen && FREEZE_BODY[m.fk]) return FREEZE_BODY[m.fk];
  if (m.slowed) return SLOW_BODY[m.sk] || 'slow';
  return 'base';
}

// Stuck in place: ice block, dizzy stars, jolts, rubble, a stopped clock, vines,
// chains, a halo, a rift or a struck-through spark. A poster of the lot is in HOW TO PLAY.
function drawFreezeFx(m, x, y) {
  const k = m.fk || 'ice';
  const now = performance.now(), t = now / 1000;
  const mx = x + m.w / 2, my = y + m.h / 2, top = y - 4;
  if (k === 'ice') { drawIceBlock(x, y, m.w, m.h); return; }
  ctx.save();
  if (k === 'stun') {
    // Gold stars circling the head, and a wobble line of dizziness.
    ctx.fillStyle = '#ffe25a';
    for (let i = 0; i < 4; i++) {
      const a = t * 4 + i * Math.PI / 2;
      const sx = mx + Math.cos(a) * (m.w * 0.55 + 3), sy = top - 2 + Math.sin(a) * 3;
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 9 + i);
      ctx.beginPath();
      for (let p = 0; p < 10; p++) { const r = p % 2 ? 1.3 : 3; const an = p * Math.PI / 5 - Math.PI / 2; ctx.lineTo(sx + Math.cos(an) * r, sy + Math.sin(an) * r); }
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 0.8; ctx.strokeStyle = '#fff6c0'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= 8; i++) ctx.lineTo(mx - 5 + i * 1.25, my - m.h * 0.2 + Math.sin(t * 14 + i) * 1.4);
    ctx.stroke();
  } else if (k === 'shock') {
    // Crackling blue-white arcs jumping around the body.
    ctx.strokeStyle = Math.floor(now / 70) % 2 ? '#ffffff' : '#7ac8ff'; ctx.lineWidth = 1.2;
    const seed = Math.floor(now / 60);
    for (let b = 0; b < 3; b++) {
      let px = x + ((seed * 7 + b * 13) % 10) / 10 * m.w, py = y - 2;
      ctx.beginPath(); ctx.moveTo(px, py);
      for (let i = 1; i <= 5; i++) { px += (((seed * 31 + b * 17 + i * 11) % 9) - 4) * 0.9; py = y - 2 + i * (m.h + 4) / 5; ctx.lineTo(px, py); }
      ctx.stroke();
    }
    ctx.globalAlpha = 0.25 + 0.2 * Math.sin(now / 40); ctx.fillStyle = '#9fd8ff';
    ctx.fillRect(x - 2, y - 2, m.w + 4, m.h + 4);
  } else if (k === 'quake') {
    // Rubble at the feet: a dust ring, cracks in the floor, pebbles bouncing.
    const fy = y + m.h;
    ctx.globalAlpha = 0.35; ctx.fillStyle = '#a07a4a';
    ctx.beginPath(); ctx.ellipse(mx, fy, m.w * 0.9 + Math.sin(t * 6) * 2, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.9; ctx.strokeStyle = '#2a1a0a'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(mx - m.w * 0.8, fy + 1); ctx.lineTo(mx - 3, fy + 3); ctx.lineTo(mx, fy); ctx.lineTo(mx + 4, fy + 4); ctx.lineTo(mx + m.w * 0.8, fy + 1); ctx.stroke();
    ctx.fillStyle = '#8a6a3a';
    for (let i = 0; i < 4; i++) {
      const hop = Math.abs(Math.sin(t * 7 + i * 1.7)) * 8;
      ctx.fillRect(Math.round(mx - m.w * 0.6 + i * m.w * 0.4), Math.round(fy - 2 - hop), 2, 2);
    }
    ctx.globalAlpha = 0.3; ctx.fillStyle = '#c89a5a'; ctx.fillRect(x, y + m.h * 0.7, m.w, m.h * 0.3);   // dust on the legs
  } else if (k === 'timestop') {
    // Caught in a bubble of stopped time: a gold clock face, its hand frozen, and still sparks.
    ctx.globalAlpha = 0.22; ctx.fillStyle = '#e8c87a';
    ctx.beginPath(); ctx.ellipse(mx, my, m.w * 0.85, m.h * 0.75, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.9; ctx.strokeStyle = '#e8c87a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(mx, my, m.w * 0.85, m.h * 0.75, 0, 0, Math.PI * 2); ctx.stroke();
    const cxk = mx, cyk = top - 8;
    ctx.fillStyle = '#fff6e0'; ctx.strokeStyle = '#c89a3a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cxk, cyk, 6.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#3a2a14'; ctx.lineWidth = 1;
    for (let i = 0; i < 12; i += 3) { const a = i * Math.PI / 6; ctx.beginPath(); ctx.moveTo(cxk + Math.cos(a) * 4.6, cyk + Math.sin(a) * 4.6); ctx.lineTo(cxk + Math.cos(a) * 5.8, cyk + Math.sin(a) * 5.8); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(cxk, cyk); ctx.lineTo(cxk + 0.5, cyk - 4.6); ctx.moveTo(cxk, cyk); ctx.lineTo(cxk + 3.2, cyk + 1); ctx.stroke();   // hands, stopped
    ctx.fillStyle = '#ffd24a';
    for (let i = 0; i < 4; i++) ctx.fillRect(Math.round(x + ((i * 37) % 100) / 100 * m.w), Math.round(y + ((i * 53) % 100) / 100 * m.h), 1.5, 1.5);   // sparks that never move
  } else if (k === 'root') {
    // Green vines wound up the legs, with thorns and leaves.
    const fy = y + m.h;
    ctx.strokeStyle = '#3a8a2a'; ctx.lineWidth = 1.8;
    for (let i = 0; i < 3; i++) {
      const bx = x + (i + 0.5) * m.w / 3;
      ctx.beginPath(); ctx.moveTo(bx, fy + 2);
      ctx.bezierCurveTo(bx + 5, fy - m.h * 0.2, bx - 5, fy - m.h * 0.4, bx + 2, fy - m.h * 0.65); ctx.stroke();
    }
    ctx.fillStyle = '#7ad85a';
    for (let i = 0; i < 4; i++) ctx.fillRect(Math.round(x + (i + 0.3) * m.w / 4), Math.round(fy - m.h * (0.15 + 0.15 * i)), 2.5, 1.5);
    ctx.fillStyle = '#c8a050'; ctx.fillRect(Math.round(mx - 1), Math.round(fy - m.h * 0.5), 1.5, 1.5);   // a thorn
    ctx.globalAlpha = 0.3; ctx.fillStyle = '#3a8a2a'; ctx.fillRect(x - 1, y + m.h * 0.55, m.w + 2, m.h * 0.45);
  } else if (k === 'chain') {
    // Iron chains wrapped across the body, with a padlock.
    ctx.strokeStyle = '#aab4c4'; ctx.lineWidth = 1.6;
    for (const dir of [1, -1]) {
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) { const f = i / 6; ctx.lineTo(x - 1 + f * (m.w + 2), (dir > 0 ? y : y + m.h) + dir * f * m.h); }
      ctx.stroke();
    }
    ctx.fillStyle = '#e8eef8';
    for (let i = 1; i < 6; i++) { const f = i / 6; ctx.fillRect(Math.round(x + f * m.w) - 1, Math.round(y + f * m.h) - 1, 2.5, 2.5); }
    ctx.fillStyle = '#c8a030'; ctx.fillRect(Math.round(mx) - 2, Math.round(my) - 2, 5, 4);
    ctx.strokeStyle = '#c8a030'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(mx, my - 2, 2, Math.PI, 0); ctx.stroke();
  } else if (k === 'holy') {
    // A halo over the head and a pillar of light.
    ctx.globalAlpha = 0.22 + 0.1 * Math.sin(t * 8); ctx.fillStyle = '#fff2a0';
    ctx.fillRect(mx - m.w * 0.55, y - 30, m.w * 1.1, m.h + 34);
    ctx.globalAlpha = 0.95; ctx.strokeStyle = '#ffe25a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(mx, top - 4, m.w * 0.45, 2.6, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 5; i++) ctx.fillRect(Math.round(mx - m.w * 0.5 + ((i * 41 + Math.floor(t * 6) * 13) % 100) / 100 * m.w), Math.round(y - 6 + ((i * 29) % 100) / 100 * (m.h + 6)), 1.5, 1.5);
  } else if (k === 'void') {
    // Pulled into a turning purple rift.
    ctx.translate(mx, my);
    ctx.globalAlpha = 0.55; ctx.fillStyle = '#12051f';
    ctx.beginPath(); ctx.ellipse(0, m.h * 0.35, m.w * 0.9, 4.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#c8a0ff'; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.9;
    for (let i = 0; i < 3; i++) {
      const a = t * 5 + i * 2.1;
      ctx.beginPath(); ctx.ellipse(0, 0, m.w * 0.85, m.h * 0.7, 0, a, a + 1.2); ctx.stroke();
    }
    ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(Math.cos(t * 6) * m.w * 0.6), Math.round(Math.sin(t * 6) * m.h * 0.5), 1.5, 1.5);
  } else if (k === 'mind') {
    // MIND LOCK: a pink bubble with a slowly turning eye over its head.
    ctx.globalAlpha = 0.2 + 0.08 * Math.sin(t * 5); ctx.fillStyle = '#ff5ad8';
    ctx.beginPath(); ctx.ellipse(mx, my, m.w * 0.85, m.h * 0.75, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.85; ctx.strokeStyle = '#ffb8f0'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.lineDashOffset = -now / 40;
    ctx.beginPath(); ctx.ellipse(mx, my, m.w * 0.85, m.h * 0.75, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    drawMindEye(mx, top - 6, 5, t);
  } else if (k === 'silence') {
    // A struck-through spark: no powers for a moment.
    ctx.globalAlpha = 0.85; ctx.strokeStyle = '#c8c8e0'; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.arc(mx, top - 6, 4.5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mx - 3.2, top - 2.8); ctx.lineTo(mx + 3.2, top - 9.2); ctx.stroke();
    ctx.globalAlpha = 0.3; ctx.fillStyle = '#6a6a88'; ctx.fillRect(x, y, m.w, m.h);
  } else {
    drawIceBlock(x, y, m.w, m.h);
  }
  ctx.restore();
}

// Slowed (but still moving): a hint of what is dragging it down.
function drawSlowFx(m, x, y) {
  const k = m.sk || 'chill';
  const now = performance.now(), t = now / 1000;
  const mx = x + m.w / 2;
  ctx.save();
  if (k === 'chill') {                // snowflakes drifting down
    ctx.fillStyle = '#e8faff';
    for (let i = 0; i < 4; i++) {
      const f = (t * 0.7 + i * 0.25) % 1;
      ctx.globalAlpha = 0.9 * (1 - f);
      ctx.fillRect(Math.round(x + ((i * 37) % 100) / 100 * m.w), Math.round(y - 6 + f * (m.h + 8)), 1.5, 1.5);
    }
  } else if (k === 'time') {          // a small hourglass over the head, sand falling
    const hx = mx, hy = y - 9;
    ctx.fillStyle = '#e8c87a'; ctx.strokeStyle = '#c89a3a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(hx - 3, hy - 4); ctx.lineTo(hx + 3, hy - 4); ctx.lineTo(hx, hy); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(hx - 3, hy + 4); ctx.lineTo(hx + 3, hy + 4); ctx.lineTo(hx, hy); ctx.closePath(); ctx.fill();
    ctx.fillRect(Math.round(hx), Math.round(hy - 1), 1, 3);
  } else if (k === 'net') {           // rope strands dragging at the legs
    ctx.strokeStyle = '#c9b98e'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x - 1, y + m.h * 0.6); ctx.lineTo(x + m.w + 1, y + m.h); ctx.moveTo(x + m.w + 1, y + m.h * 0.6); ctx.lineTo(x - 1, y + m.h); ctx.stroke();
  } else if (k === 'mind') {          // a small pink eye
    drawMindEye(mx, y - 8, 3.5, t);
  } else if (k === 'poison') {        // green bubbles rising
    ctx.strokeStyle = '#b8f070';
    for (let i = 0; i < 3; i++) {
      const f = (t * 0.8 + i / 3) % 1;
      ctx.globalAlpha = 0.9 * (1 - f);
      ctx.beginPath(); ctx.arc(x + ((i * 43) % 100) / 100 * m.w, y + m.h - f * (m.h + 6), 1.6, 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.restore();
}

// Frost nova: the monster sits inside a block of ice until it thaws.
function drawIceBlock(x, y, w, h) {
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = '#9fe0ff';
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = '#e4f8ff'; ctx.lineWidth = 1;
  ctx.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, 2, Math.max(3, h * 0.35));
  ctx.fillRect(x + w - 4, y + h * 0.55, 2, 3);
  // Jagged icicles hanging off the bottom and crystals on top.
  ctx.fillStyle = '#d8f4ff';
  for (let i = 0; i < 4; i++) {
    const ix = x + (i + 0.5) * w / 4;
    ctx.beginPath(); ctx.moveTo(ix - 2, y + h + 2); ctx.lineTo(ix, y + h + 2 + 3 + (i % 2) * 2); ctx.lineTo(ix + 2, y + h + 2); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.moveTo(x + w * 0.3, y - 2); ctx.lineTo(x + w * 0.38, y - 7); ctx.lineTo(x + w * 0.46, y - 2); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + w * 0.58, y - 2); ctx.lineTo(x + w * 0.68, y - 6); ctx.lineTo(x + w * 0.76, y - 2); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// ─── The Abyss ────────────────────────────────────────────────────────────────
// Drawn by hand rather than from a sprite: a hooded void body on two legs, four
// arms, and whatever they hold — void crossbows, then six scythes.
const ABYSS_HANDS = [[-0.62, -0.18], [0.62, -0.18], [-0.7, 0.14], [0.7, 0.14]];   // mirrors the server
function abyssTarget() {
  const me = currState && currState.players && currState.players[myKeyOf()];
  return me ? { x: me.x + me.w / 2, y: me.y + me.h / 2 } : null;
}
function drawAbyss(m) {
  const now = performance.now();
  const x = Math.round(m.x), y = Math.round(m.y), w = m.w, h = m.h;
  const c = { x: x + w / 2, y: y + h / 2 };
  const tgt = abyssTarget() || { x: c.x + 50, y: c.y };
  const flash = m.hitFlash > 0;
  ctx.save();
  // Aura: a slow pulse of void (a storm of it in the last stand).
  const pulse = 0.5 + 0.5 * Math.sin(now / 260);
  ctx.globalAlpha = (m.p3 ? 0.32 : 0.18) + 0.08 * pulse; ctx.fillStyle = '#5a1aaa';
  ctx.beginPath(); ctx.ellipse(c.x, c.y, w * (m.p3 ? 1.6 : 1.05) + pulse * 3, h * (m.p3 ? 1.1 : 0.75) + pulse * 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.3; ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.ellipse(c.x, y + h + 1, w * 0.45, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;

  // Legs: two, striding.
  const step = Math.sin(now / 130) * 4;
  ctx.lineCap = 'round';
  for (const [side, s] of [[-1, step], [1, -step]]) {
    const hip = { x: c.x + side * w * 0.17, y: y + h * 0.62 };
    const foot = { x: hip.x + s + side * 2, y: y + h };
    ctx.strokeStyle = '#0a0414'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(foot.x, foot.y); ctx.stroke();
    ctx.strokeStyle = flash ? '#ffffff' : '#2a1446'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(foot.x, foot.y); ctx.stroke();
    ctx.fillStyle = '#7a3aff'; ctx.fillRect(Math.round(foot.x) - 3, Math.round(foot.y) - 1, 6, 2);
  }

  // Body: a tattered void robe, ribs of violet light.
  ctx.fillStyle = '#0a0414';
  ctx.beginPath();
  ctx.moveTo(c.x - w * 0.36, y + h * 0.24); ctx.lineTo(c.x + w * 0.36, y + h * 0.24);
  ctx.lineTo(c.x + w * 0.3, y + h * 0.7); ctx.lineTo(c.x - w * 0.3, y + h * 0.7); ctx.closePath(); ctx.fill();
  ctx.fillStyle = flash ? '#ffffff' : '#1e0e36';
  ctx.beginPath();
  ctx.moveTo(c.x - w * 0.32, y + h * 0.26); ctx.lineTo(c.x + w * 0.32, y + h * 0.26);
  ctx.lineTo(c.x + w * 0.26, y + h * 0.68); ctx.lineTo(c.x - w * 0.26, y + h * 0.68); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#9a5aff'; ctx.lineWidth = 1; ctx.globalAlpha = 0.55 + 0.35 * pulse;
  for (let i = 0; i < 3; i++) {
    const ry = y + h * (0.36 + i * 0.09);
    ctx.beginPath(); ctx.moveTo(c.x - w * 0.2, ry); ctx.quadraticCurveTo(c.x, ry - 3, c.x + w * 0.2, ry); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Core: a tiny black hole in his chest.
  ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(c.x, y + h * 0.47, 3.4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#c88aff'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(c.x, y + h * 0.47, 4.4, now / 200, now / 200 + 4.5); ctx.stroke();

  // Head: a hood with three burning eyes.
  ctx.fillStyle = '#0a0414';
  ctx.beginPath(); ctx.moveTo(c.x - w * 0.24, y + h * 0.27); ctx.lineTo(c.x, y - 2); ctx.lineTo(c.x + w * 0.24, y + h * 0.27); ctx.closePath(); ctx.fill();
  ctx.fillStyle = flash ? '#ffffff' : '#160a28';
  ctx.beginPath(); ctx.ellipse(c.x, y + h * 0.15, w * 0.17, h * 0.11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = m.p3 ? '#ff7ad8' : '#e0b0ff';
  const blink = Math.sin(now / 900) > 0.97 ? 0.3 : 1;
  for (const [ex, ey, r] of [[-0.08, 0.15, 1.6], [0.08, 0.15, 1.6], [0, 0.09, 1.2]]) {
    ctx.globalAlpha = blink; ctx.beginPath(); ctx.arc(c.x + ex * w, y + ey * h, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Arms and what they hold.
  const scythes = (m.phase || 1) >= 2;
  const hands = ABYSS_HANDS.map(([ox, oy]) => ({ x: c.x + ox * w, y: c.y + oy * h }));
  const shoulders = [[-0.3, -0.2], [0.3, -0.2], [-0.3, -0.06], [0.3, -0.06]].map(([ox, oy]) => ({ x: c.x + ox * w, y: c.y + oy * h }));
  const act = m.act;
  // Six scythes whirling around him, or all six rising for the slash.
  if (scythes && act === 'spin') {
    const k = Math.min(1, (m.actT || 0) / 1500);
    for (let i = 0; i < 6; i++) {
      const a = now / (110 - k * 50) + i * Math.PI / 3;
      ctx.save(); ctx.translate(c.x + Math.cos(a) * 62, c.y + Math.sin(a) * 62); ctx.rotate(a + Math.PI / 2);
      drawWeaponPixels(ctx, 'm_scythe', 1.4, '#c88aff'); ctx.restore();
    }
    ctx.globalAlpha = 0.25; ctx.strokeStyle = '#c88aff'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(c.x, c.y, 62, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
  }
  for (let i = 0; i < 4; i++) {
    const sh = shoulders[i], hd = hands[i];
    ctx.strokeStyle = '#0a0414'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(hd.x, hd.y); ctx.stroke();
    ctx.strokeStyle = flash ? '#ffffff' : '#2a1446'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(hd.x, hd.y); ctx.stroke();
    if (scythes && act === 'spin') continue;   // the scythes are out whirling
    ctx.save(); ctx.translate(hd.x, hd.y);
    if (!scythes) {
      // Crossbows aim at you — or up at the orb gathering over his head.
      let a = Math.atan2(tgt.y - hd.y, tgt.x - hd.x);
      if (act === 'orb') a = -Math.PI / 2 + (i % 2 ? 0.35 : -0.35);
      const kick = act === 'rapid' ? Math.sin(now / 25 + i) * 1.5 : 0;
      ctx.rotate(a); if (Math.cos(a) < 0) ctx.scale(1, -1);
      ctx.translate(-kick, 0);
      drawWeaponPixels(ctx, 'm_abyssbow', 1.15, flash ? '#ffffff' : '#b07aff');
    } else {
      let a = (i % 2 ? -1 : 1) * 0 + (i % 2 === 0 ? Math.PI + 0.9 : -0.9);   // raised, outward
      let sc = 1.25;
      if (act === 'slash') {
        const t = m.actT || 0, sa = m.sa || 0;
        const grow = Math.min(1, t / 650);
        sc = 1.25 + 0.9 * (t < 950 ? grow : 0);
        a = t < 650 ? sa - 2.1 + Math.sin(now / 30) * 0.05 : sa - 1.6 + Math.min(1, (t - 650) / 220) * 3.2 + (i - 1.5) * 0.15;
      }
      ctx.rotate(a); if (Math.cos(a) < 0) ctx.scale(1, -1);
      drawWeaponPixels(ctx, 'm_scythe', Math.round(sc * 10) / 10, flash ? '#ffffff' : '#c88aff');
    }
    ctx.restore();
  }
  // The two extra scythes that follow him in phase 2.
  if (scythes && act !== 'spin') {
    for (const side of [-1, 1]) {
      const fx = c.x + side * w * 0.95, fy = y + h * 0.1 + Math.sin(now / 300 + side) * 4;
      let a = side < 0 ? Math.PI + 0.5 : -0.5, sc = 1.1;
      if (act === 'slash') { const t = m.actT || 0; sc = 1.1 + 0.9 * Math.min(1, t / 650); a = (m.sa || 0) + (t < 650 ? -2.1 : -1.6 + Math.min(1, (t - 650) / 220) * 3.2) + side * 0.3; }
      ctx.save(); ctx.translate(fx, fy); ctx.globalAlpha = 0.9;
      ctx.rotate(a); if (Math.cos(a) < 0) ctx.scale(1, -1);
      drawWeaponPixels(ctx, 'm_scythe', Math.round(sc * 10) / 10, '#c88aff');
      ctx.restore();
    }
  }
  // The big slash: a wide violet arc as it lands.
  if (scythes && act === 'slash' && (m.actT || 0) >= 650) {
    const k = Math.min(1, ((m.actT || 0) - 650) / 300), sa = m.sa || 0;
    ctx.globalAlpha = 0.55 * (1 - k * 0.7); ctx.strokeStyle = '#e0a0ff'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(c.x, c.y, 165 * 0.8, sa - 1.45, sa - 1.45 + 2.9 * Math.min(1, k * 1.6)); ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (scythes && act === 'slash') {
    // Wind-up warning: the cone it will cover.
    const sa = m.sa || 0, k = (m.actT || 0) / 650;
    ctx.globalAlpha = 0.12 + 0.12 * k; ctx.fillStyle = '#ff4a8a';
    ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.arc(c.x, c.y, 165, sa - 1.45, sa + 1.45); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // Last stand: the countdown, big, by his side.
  if (m.p3) {
    ctx.font = 'bold 22px "Courier New",monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const tx = c.x + w * 1.6, ty = c.y;
    ctx.fillStyle = '#000'; ctx.fillText(String(m.p3), tx + 2, ty + 2);
    ctx.fillStyle = m.p3 <= 3 ? '#ff5a7a' : '#ff9ae8'; ctx.fillText(String(m.p3), tx, ty);
    ctx.font = 'bold 7px "Courier New",monospace'; ctx.fillStyle = '#e0c8ff'; ctx.fillText('SURVIVE', tx, ty + 15);
  }
  ctx.restore();
}

// Endless Scythe special: a void beam spinning round its owner.
function drawVoidBeam(f, now) {
  const k = Math.max(0, f.k || 0);
  const fade = Math.min(1, k / 0.06) * Math.min(1, (1 - k) / 0.1);
  const L = 320, a = f.a || 0;
  ctx.save();
  ctx.beginPath(); ctx.rect(ARENA_X, ARENA_Y, ARENA_W, ARENA_H); ctx.clip();
  // The pull: rings sliding inward.
  ctx.strokeStyle = '#9a5aff'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) {
    const r = 240 * (1 - ((now * 0.9 + i / 3) % 1));
    ctx.globalAlpha = 0.25 * fade; ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.translate(f.x, f.y);
  // A faint afterimage behind the sweep.
  ctx.globalAlpha = 0.18 * fade; ctx.fillStyle = '#5a1aaa';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, L, a - 0.6, a); ctx.closePath(); ctx.fill();
  ctx.rotate(a);
  const w = (f.r || 12) * (1 + 0.15 * Math.sin(now * 40));
  ctx.globalAlpha = 0.3 * fade; ctx.fillStyle = '#5a1aaa'; ctx.fillRect(0, -w * 1.6, L, w * 3.2);
  ctx.globalAlpha = 0.75 * fade; ctx.fillStyle = '#12051f'; ctx.fillRect(0, -w, L, w * 2);
  ctx.globalAlpha = 0.9 * fade; ctx.fillStyle = '#c88aff'; ctx.fillRect(0, -w, L, 1.5); ctx.fillRect(0, w - 1.5, L, 1.5);
  ctx.fillStyle = '#e0c8ff'; ctx.fillRect(0, -w * 0.25, L, w * 0.5);
  ctx.globalAlpha = fade; ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(0, 0, w * 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#c88aff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, w * 1.3, now * 8, now * 8 + 4.5); ctx.stroke();
  ctx.restore();
}
// Endless Scythe super: six scythes round you, then the slash.
function drawScytheWhirl(f, now) {
  const t = (f.k || 0) * 1650;   // ms into it (life = 1200 + 450)
  ctx.save();
  if (t < 1200) {
    const sp = 1 - Math.min(1, t / 1200) * 0.5;
    for (let i = 0; i < 6; i++) {
      const a = now * (6 / sp) + i * Math.PI / 3;
      ctx.save(); ctx.translate(f.x + Math.cos(a) * 58, f.y + Math.sin(a) * 58); ctx.rotate(a + Math.PI / 2);
      drawWeaponPixels(ctx, 'endlessscythe', 0.9, WEAPON_COLOR.endlessscythe); ctx.restore();
    }
    ctx.globalAlpha = 0.22; ctx.strokeStyle = '#c88aff'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(f.x, f.y, 58, 0, Math.PI * 2); ctx.stroke();
  } else {
    const k = Math.min(1, (t - 1200) / 300);
    ctx.globalAlpha = 0.6 * (1 - k * 0.6); ctx.strokeStyle = '#e0a0ff'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(f.x, f.y, 128, (f.a || 0) - 1.45, (f.a || 0) - 1.45 + 2.9 * Math.min(1, k * 1.8)); ctx.stroke();
  }
  ctx.restore();
}

// A slash wave: a bright crescent of steel, its edge burning, ghosts trailing behind.
function drawSlashWave(pr, ang, now, edge) {
  ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(ang); ctx.scale(2, pr.owner === 'monster' ? 2 : 3.6);   // a katana's waves are wider
  for (let i = 3; i >= 0; i--) {
    ctx.save(); ctx.translate(-i * 5, 0);
    ctx.globalAlpha = i ? 0.12 * (4 - i) : 1;
    ctx.fillStyle = i ? edge : '#ffffff';
    ctx.beginPath();
    ctx.arc(-4, 0, 11, -1.15, 1.15);              // outer edge
    ctx.arc(-9, 0, 8.5, 1.05, -1.05, true);       // inner edge, making a crescent
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 0.9; ctx.strokeStyle = edge; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(-4, 0, 11, -1.1, 1.1); ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.9;
  ctx.fillRect(6, -0.5 + Math.sin(now / 40) * 4, 1.5, 1.5);
  ctx.restore();
}
// The quiet wave: a pale, rippling crescent — harmless, but it marks you.
function drawDashWave(pr, ang, now) {
  ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(ang); ctx.scale(2, pr.owner === 'monster' ? 2 : 3.6);
  const pulse = 0.5 + 0.5 * Math.sin(now / 70);
  for (let i = 0; i < 3; i++) {
    ctx.globalAlpha = (0.55 - i * 0.15) * (0.7 + 0.3 * pulse);
    ctx.strokeStyle = i ? '#9ad8ff' : '#ffffff'; ctx.lineWidth = 2 - i * 0.5;
    ctx.setLineDash([3, 2]); ctx.lineDashOffset = -now / 30;
    ctx.beginPath(); ctx.arc(-4 - i * 5, 0, 12 - i, -1.2, 1.2); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.8; ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(7, 0, 1.6 + pulse, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawVoidBolt(pr, ang) {
  ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(ang);
  ctx.globalAlpha = 0.35; ctx.fillStyle = '#7a2aff';
  ctx.beginPath(); ctx.ellipse(-5, 0, 9, 3.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#12051f'; ctx.fillRect(-9, -0.9, 10, 1.8);
  ctx.fillStyle = '#c88aff';
  ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(-1, -2.4); ctx.lineTo(-1, 2.4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.fillRect(1, -0.5, 1.5, 1);
  ctx.restore();
}
function drawAbyssOrb(x, y, r, now) {
  ctx.save();
  for (let i = 3; i >= 1; i--) {
    ctx.globalAlpha = 0.12 * i; ctx.fillStyle = '#7a2aff';
    ctx.beginPath(); ctx.arc(x, y, r + i * 4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1; ctx.fillStyle = '#12051f';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#c88aff'; ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) { const a = now / 160 + i * 2.1; ctx.beginPath(); ctx.arc(x, y, r * 0.75, a, a + 1.3); ctx.stroke(); }
  ctx.fillStyle = '#e0c8ff'; ctx.beginPath(); ctx.arc(x - r * 0.25, y - r * 0.25, Math.max(1.5, r * 0.18), 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
// Where all the bolts will meet: a closing target ring.
function drawAbyssMark(f, now) {
  const k = Math.min(1, f.k || 0);
  ctx.save(); ctx.translate(f.x, f.y);
  ctx.globalAlpha = 0.18 + 0.25 * k; ctx.fillStyle = '#5a1aaa';
  ctx.beginPath(); ctx.arc(0, 0, 14 + 8 * k, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.85; ctx.strokeStyle = '#c88aff'; ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]); ctx.lineDashOffset = -now * 20;
  ctx.beginPath(); ctx.arc(0, 0, 46 - 30 * k, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  ctx.rotate(now * 2);
  for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.fillRect(10, -0.8, 8, 1.6); }
  ctx.restore();
}
// The orb gathering: void streaks pulled into a growing sphere.
function drawAbyssCharge(f, now) {
  ctx.save();
  ctx.strokeStyle = '#b07aff'; ctx.lineWidth = 1.2;
  for (let i = 0; i < 10; i++) {
    const a = i * 0.63 + now * 3, d = 18 + f.r + ((now * 60 + i * 13) % 26);
    ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.moveTo(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d); ctx.lineTo(f.x + Math.cos(a) * (f.r + 4), f.y + Math.sin(a) * (f.r + 4)); ctx.stroke();
  }
  ctx.restore();
  drawAbyssOrb(f.x, f.y, Math.max(3, f.r), now * 1000);
}
// Crossbows of Infinity: two more crossbows floating beside you.
// Endless Scythe: two more scythes hover behind you; on every swing they join
// in like the Abyss's slash — raised back, growing, then sweeping through.
function drawEndlessFloaters(p, x, y, key) {
  const now = performance.now(), d = p.facing < 0 ? -1 : 1;
  const mx = x + p.w / 2, my = y + p.h / 2;
  const anim = attackProgress(key, 'endlessscythe');
  const e = anim ? anim.e : -1;
  for (const [oy, ph, lag] of [[-12, 0, 0], [10, 2, 0.12]]) {
    const fx = mx - d * 17, fy = my + oy + Math.sin(now / 300 + ph) * 2.5;
    let rot = -0.5, sc = 0.55;
    if (e >= 0) {
      const k = Math.max(0, Math.min(1, (e - lag) / (1 - lag)));
      // Wind back, then a fast sweep forward past the body, then settle.
      rot = k < 0.3 ? -0.5 - (k / 0.3) * 1.6 : -2.1 + Math.min(1, (k - 0.3) / 0.35) * 3.4;
      sc = 0.55 + 0.4 * Math.sin(Math.min(1, k) * Math.PI);
      if (k > 0.3 && k < 0.8) {
        ctx.save(); ctx.globalAlpha = 0.45 * (1 - (k - 0.3) / 0.5); ctx.strokeStyle = '#c88aff'; ctx.lineWidth = 3;
        ctx.beginPath();
        const a0 = d > 0 ? -2.1 : Math.PI + 2.1, a1 = d > 0 ? rot : Math.PI - rot;
        ctx.arc(fx, fy, 26 * sc, Math.min(a0, a1), Math.max(a0, a1)); ctx.stroke(); ctx.restore();
      }
    }
    ctx.save(); ctx.translate(Math.round(fx), Math.round(fy)); ctx.scale(d, 1); ctx.rotate(rot);
    ctx.globalAlpha = e >= 0 ? 1 : 0.9;
    drawWeaponPixels(ctx, 'endlessscythe', Math.round(sc * 10) / 10, WEAPON_COLOR.endlessscythe);
    ctx.restore();
  }
}

// The katana's SUPER: the blade whirling round you, ringed in red light.
function drawKatanaSpin(p, x, y) {
  const now = performance.now(), mx = x + p.w / 2, my = y + p.h / 2;
  const fade = Math.min(1, p.kspin / 400);
  ctx.save();
  ctx.globalAlpha = 0.18 * fade; ctx.fillStyle = '#ff5a5a';
  ctx.beginPath(); ctx.arc(mx, my, 48, 0, Math.PI * 2); ctx.fill();
  const a = now / 45;
  ctx.globalAlpha = 0.6 * fade; ctx.strokeStyle = '#ffd0d0'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(mx, my, 44, a - 2.2, a); ctx.stroke();
  ctx.beginPath(); ctx.arc(mx, my, 44, a + Math.PI - 2.2, a + Math.PI); ctx.stroke();
  ctx.globalAlpha = fade;
  for (const off of [0, Math.PI]) {
    ctx.save(); ctx.translate(mx, my); ctx.rotate(a + off);
    drawWeaponPixels(ctx, 'samuraiblade', 1.5, WEAPON_COLOR.samuraiblade);
    ctx.restore();
  }
  ctx.restore();
}

function drawInfinityFloaters(p, x, y) {
  const now = performance.now(), d = p.facing < 0 ? -1 : 1;
  const mx = x + p.w / 2, my = y + p.h / 2;
  for (const [ox, oy, ph] of [[-12, -19, 0], [-14, 15, 2]]) {
    const fx = mx + ox * d, fy = my + oy + Math.sin(now / 280 + ph) * 2;
    ctx.save(); ctx.translate(Math.round(fx), Math.round(fy)); ctx.scale(d, 1);
    ctx.globalAlpha = 0.25; ctx.fillStyle = '#7a2aff'; ctx.beginPath(); ctx.ellipse(6, 0, 10, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.95;
    drawWeaponPixels(ctx, 'infinitybow', 0.65, WEAPON_COLOR.infinitybow);
    ctx.restore();
  }
}

// Over the Giant: a flashing "!" while it winds up (red for the close swipe,
// yellow for the ranged slam), and circling stars while it's stunned.
function drawBossMarks(m, x, y) {
  const now = performance.now();
  const hx = x + m.w / 2, top = y - monsterPad(m.w, m.h) + 2;
  if (m.mage) {
    // Casting: a spinning sigil over his head in the spell's colour.
    if (m.cast) {
      const col = MAGE_CAST_COLOR[m.cast] || '#b07aff';
      ctx.save();
      ctx.translate(hx, top - 4);
      ctx.rotate(now / 180);
      ctx.strokeStyle = col; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI * 2 / 3 + (i >= 3 ? Math.PI / 3 : 0);
        if (i % 3 === 0) ctx.moveTo(Math.cos(a) * 7, Math.sin(a) * 7); else ctx.lineTo(Math.cos(a) * 7, Math.sin(a) * 7);
      }
      ctx.closePath(); ctx.stroke();
      ctx.restore();
    }
    return;
  }
  ctx.save();
  if (m.windup > 0 && Math.floor(now / 110) % 2 === 0) {
    ctx.font = 'bold 18px "Courier New",monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round';
    ctx.strokeText('!', hx, top);
    ctx.fillStyle = m.wind === 'slam' ? '#ffd84a' : '#ff4a3a';
    ctx.fillText('!', hx, top);
  }
  if (m.stun > 0) {
    for (let i = 0; i < 5; i++) {
      const a = now / 260 + i * (Math.PI * 2 / 5);
      const sx = hx + Math.cos(a) * m.w * 0.42, sy = top + 4 + Math.sin(a) * 5;
      ctx.fillStyle = i % 2 ? '#fff6a0' : '#ffd84a';
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? 1.4 : 3.6, aa = k * Math.PI / 5 - Math.PI / 2;
        const px = sx + Math.cos(aa) * r, py = sy + Math.sin(aa) * r;
        if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
}

// A wide boss health bar along the bottom of the screen (HUD space).
function drawBossBar(monsters) {
  const ms = monsters || [];
  // The Portal Mage's bar, or — while he hides — his giants'.
  const ab = ms.find(m => m.abyss);
  if (ab) { drawOneBossBar(ab, 0); return; }
  const mage = ms.find(m => m.mage);
  if (mage && !mage.hidden) { drawOneBossBar(mage, 0); return; }
  const giants = ms.filter(m => m.boss && !m.mage);
  giants.slice(0, 2).forEach((g, i) => drawOneBossBar(g, i));
}
function drawOneBossBar(b, row) {
  const w = Math.min(240, HUD_W * 0.5), h = 7;
  const x = Math.round(HUD_W / 2 - w / 2), y = HUD_H - (isTouchDevice ? 16 : 28) - row * 22;
  // The Abyss's last stand: the bar becomes the countdown to survive.
  const ratio = b.p3 ? b.p3 / 10 : Math.max(0, b.hp / b.maxHp);
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(x - 4, y - 12, w + 8, h + 16);
  ctx.fillStyle = '#2a0808'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = b.p3 ? '#c84aff' : b.stun > 0 ? '#ffd84a' : '#d8342a';
  ctx.fillRect(x, y, Math.round(w * ratio), h);
  ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x, y, Math.round(w * ratio), 2);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
  for (let i = 1; i < 10; i++) { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x + Math.round(w * i / 10), y, 1, h); }
  ctx.font = 'bold 8px "Courier New",monospace'; ctx.textBaseline = 'bottom';
  const label = b.abyss ? 'THE ABYSS' + (b.p3 ? ' - SURVIVE!' : b.phase === 2 ? ' - PHASE 2' : '')
    : b.mage ? 'THE PORTAL MAGE' + (b.phase === 2 ? ' - PHASE 2' : '') : 'THE GIANT';
  ctx.textAlign = 'left';  ctx.fillStyle = '#000'; ctx.fillText(label, x + 1, y - 1);
  ctx.fillStyle = b.abyss ? (b.p3 ? '#ff7ad8' : '#b07aff') : b.mage ? (b.phase === 2 ? '#ff7aaa' : '#c8a0ff') : '#c8e07a'; ctx.fillText(label, x, y - 2);
  ctx.textAlign = 'right'; ctx.fillStyle = b.stun > 0 ? '#ffd84a' : '#ccc';
  ctx.fillText(b.p3 ? b.p3 + 's LEFT' : b.stun > 0 ? 'STUNNED!' : Math.ceil(b.hp).toLocaleString() + ' / ' + b.maxHp.toLocaleString(), x + w, y - 2);
  ctx.restore();
}

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
  // EXTREME only
  titan:    { art: 'm_warhammer', color: '#8fa0b4', size: 0.62, rest: -1.1,  move: 'slam'   },
  wraith:   { art: 'm_scythe',    color: '#9a7aff', size: 0.78, rest: -0.7,  move: 'chop'   },
  infernal: { art: 'm_hellstaff', color: '#ff6a1a', size: 0.68, rest: -1.1,  move: 'cast'   },
  // Monsters with tricks (the splitter, its slimelets and the charger fight with their bodies)
  bomber:      { art: 'm_bomb',      color: '#ff9a1a', size: 0.8,  rest:  0.2,  move: 'stab'   },
  shaman:      { art: 'm_totem',     color: '#5aff9a', size: 0.68, rest: -1.1,  move: 'cast'   },
  necromancer: { art: 'm_bonestaff', color: '#9aff7a', size: 0.66, rest: -1.1,  move: 'cast'   },
  skeleton:    { art: 'm_shiv',      color: '#c8c0a8', size: 0.8,  rest:  0.3,  move: 'stab'   },
  light:       { art: 'm_scythe',    color: '#fff6a0', size: 0.8,  rest: -0.6,  move: 'chop'   },
  samurai:     { art: 'katana',      color: '#e8eef8', size: 0.72, rest: -0.35, move: 'chop'   },
  // Boss
  giant:    { art: 'm_tree',      color: '#4e8a3a', size: 0.62, rest: -0.95, move: 'giant'  },
  portalmage: { art: 'm_portalstaff', color: '#b07aff', size: 0.6, rest: -1.15, move: 'cast' },
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
  // The mage raises his staff high while a spell builds, trembling with it.
  if (m.mage && m.cast) ang = arms.rest - 0.55 + Math.sin(performance.now() / 30) * 0.05;
  // The Giant telegraphs: the tree drawn back for a swipe, hoisted high for a
  // slam (shaking as it strains), and dropped to the ground while stunned.
  if (m.boss) {
    if (m.stun > 0) ang = 1.25 + bob * 0.5;
    else if (m.windup > 0) {
      const w = 1 - m.windup / (m.wind === 'slam' ? 900 : 650);
      ang = arms.rest - (m.wind === 'slam' ? 1.5 : 1.0) * w + Math.sin(performance.now() / 35) * 0.04 * w;
    }
  }
  if (prog >= 0 && !(m.stun > 0)) {
    const kick = Math.sin(prog * Math.PI);
    switch (arms.move) {
      case 'chop':   ang += monsterSwingAngle(prog, 1.3); break;
      case 'slam':   ang += monsterSwingAngle(prog, 1.9); break;
      case 'stab':   ctx.translate(kick * m.w * 0.5, 0); ang = arms.rest * (1 - kick); break;
      case 'thrust': ctx.translate(kick * m.w * 0.6, 0); ang = arms.rest * (1 - kick); break;
      case 'cast':   ctx.translate(-kick * 2, 0); ang -= kick * 0.35; break;
      case 'giant':  ang += monsterSwingAngle(prog, 2.3); break;
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

    if (pr.weaponId === 'abyssbolt' || pr.weaponId === 'infinitybow') { drawVoidBolt(pr, ang); continue; }
    if (pr.weaponId === 'samwave') { drawSlashWave(pr, ang, now, pr.special ? '#ff5a5a' : (pr.owner === 'monster' ? '#ff4a5a' : '#ff8a8a')); continue; }
    if (pr.weaponId === 'samdashwave') { drawDashWave(pr, ang, now); continue; }
    if (pr.weaponId === 'dlkunai' || pr.weaponId === 'dlpair') { drawFlyingKunai(pr, ang, pr.weaponId === 'dlpair'); continue; }
    if (pr.weaponId === 'abyssorb') { drawAbyssOrb(pr.x, pr.y, pr.special ? 12 : 20, now); continue; }
    if (pr.weaponId === 'abyssscythe') {
      ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(now / 45);
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#7a2aff'; ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; drawWeaponPixels(ctx, 'm_scythe', 1.1, '#c88aff');
      ctx.restore(); continue;
    }
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
    // ── The 10 update ──
    if (pr.weaponId === 'slingshot') {          // a pebble
      ctx.save(); ctx.fillStyle = '#7a6a58'; ctx.beginPath(); ctx.arc(pr.x, pr.y, 2.6 * u.size, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b8a890'; ctx.fillRect(Math.round(pr.x) - 1, Math.round(pr.y) - 2, 1.5, 1.5); ctx.restore(); continue;
    }
    if (pr.weaponId === 'javelin') {            // a long spear in flight
      ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(ang);
      ctx.fillStyle = '#8a6438'; ctx.fillRect(-16, -0.8, 16, 1.6);
      ctx.fillStyle = '#d8dde6'; ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-1, -2.4); ctx.lineTo(-1, 2.4); ctx.closePath(); ctx.fill();
      ctx.restore(); continue;
    }
    if (pr.weaponId === 'emberstaff' || pr.weaponId === 'fireball') {   // a ball of flame
      const big = pr.weaponId === 'fireball' ? 2.2 : 1;
      ctx.save();
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#ff5a1a';
      ctx.beginPath(); ctx.arc(pr.x - pr.dx * 1.5, pr.y - pr.dy * 1.5, 6 * big, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = '#ff7a2a'; ctx.beginPath(); ctx.arc(pr.x, pr.y, 4 * big, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd84a'; ctx.beginPath(); ctx.arc(pr.x - big, pr.y - big, 2 * big, 0, Math.PI * 2); ctx.fill();
      ctx.restore(); continue;
    }
    if (pr.weaponId === 'frostbow') {           // an arrow of ice
      ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(ang);
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#bfefff'; ctx.fillRect(-16, -1.5, 10, 3);
      ctx.globalAlpha = 1; ctx.fillStyle = '#9fe8ff'; ctx.fillRect(-9, -0.7, 12, 1.4);
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(2, -2.6); ctx.lineTo(2, 2.6); ctx.closePath(); ctx.fill();
      ctx.restore(); continue;
    }
    if (pr.weaponId === 'chronostaff') {        // a little clock face, its hand spinning
      ctx.save();
      ctx.globalAlpha = 0.3; ctx.fillStyle = '#e8c87a'; ctx.beginPath(); ctx.arc(pr.x, pr.y, 7, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = '#e8c87a'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(pr.x, pr.y, 4, 0, Math.PI * 2); ctx.stroke();
      const ha = now / 80; ctx.beginPath(); ctx.moveTo(pr.x, pr.y); ctx.lineTo(pr.x + Math.cos(ha) * 3.5, pr.y + Math.sin(ha) * 3.5); ctx.stroke();
      ctx.restore(); continue;
    }
    if (pr.weaponId === 'voidblade') {          // a crescent of void
      ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(ang);
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#5a2aa8'; ctx.beginPath(); ctx.ellipse(-4, 0, 6, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.95; ctx.strokeStyle = '#c8a0ff'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(-4, 0, 9, -1.2, 1.2); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(-4, 0, 9, -0.8, 0.8); ctx.stroke();
      ctx.restore(); continue;
    }
    // Stormbreaker, thrown: a spinning hammer crackling with lightning.
    if (pr.weaponId === 'stormhammer') {
      ctx.save();
      ctx.translate(pr.x, pr.y); ctx.rotate(now / 50);
      ctx.fillStyle = '#5a3a20'; ctx.fillRect(-1.5, -2, 3, 12);
      ctx.fillStyle = '#5a6a7a'; ctx.fillRect(-7, -8, 14, 7);
      ctx.fillStyle = '#9fb6c8'; ctx.fillRect(-7, -8, 14, 2);
      ctx.strokeStyle = '#bfe8ff'; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.moveTo(-9, -4); ctx.lineTo(-12, -1); ctx.lineTo(-10, 1); ctx.lineTo(-13, 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(9, -6); ctx.lineTo(12, -3); ctx.lineTo(10, -1); ctx.stroke();
      ctx.restore();
      continue;
    }
    // Winter's Edge ice shard.
    if (pr.weaponId === 'frostscythe') {
      ctx.save();
      ctx.translate(pr.x, pr.y); ctx.rotate(ang);
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#bfefff'; ctx.fillRect(-12, -1.5, 9, 3);
      ctx.globalAlpha = 1; ctx.fillStyle = '#9fe0f8';
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-3, -3); ctx.lineTo(-5, 0); ctx.lineTo(-3, 3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.fillRect(-2, -1, 6, 1);
      ctx.restore();
      continue;
    }
    // Sunfire arrow: a golden shaft with a burning tip and a bright wake.
    if (pr.weaponId === 'sunbow') {
      ctx.save();
      ctx.translate(pr.x, pr.y); ctx.rotate(ang);
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#ffb030'; ctx.fillRect(-18, -2, 14, 4);
      ctx.globalAlpha = 1; ctx.fillStyle = '#ffd24a'; ctx.fillRect(-9, -0.8, 12, 1.6);
      ctx.fillStyle = '#fff6c0';
      ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(2, -2.8); ctx.lineTo(2, 2.8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff7a1a'; ctx.fillRect(-11, -2.5, 2, 1.5); ctx.fillRect(-11, 1, 2, 1.5);
      ctx.restore();
      continue;
    }
    // Dagger of Ghosts, thrown: a spinning pale blade with a ghostly wake.
    if (pr.weaponId === 'ghostdagger') {
      ctx.save();
      for (let i = 4; i >= 1; i--) {
        ctx.globalAlpha = 0.12 * (5 - i); ctx.fillStyle = '#a8f0ff';
        ctx.beginPath(); ctx.arc(pr.x - pr.dx * i * 0.9, pr.y - pr.dy * i * 0.9, 5 - i * 0.6, 0, Math.PI * 2); ctx.fill();
      }
      ctx.translate(pr.x, pr.y); ctx.rotate(now / 40);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#3a2a4a'; ctx.fillRect(-7, -1.5, 5, 3);
      ctx.fillStyle = '#c8a040'; ctx.fillRect(-2.5, -3.5, 1.5, 7);
      ctx.fillStyle = '#e8fcff';
      ctx.beginPath(); ctx.moveTo(-1, -2.5); ctx.lineTo(9, 0); ctx.lineTo(-1, 2.5); ctx.closePath(); ctx.fill();
      ctx.restore();
      continue;
    }
    // Portal Wand fireball: the mage's fire, wrapped in violet portal light.
    if (pr.weaponId === 'portalwand') {
      const t = performance.now() / 60;
      const s = (pr.special ? 1 : 1.15) * u.size;
      ctx.save();
      for (let i = 3; i >= 1; i--) {
        ctx.globalAlpha = 0.2 * (4 - i);
        ctx.fillStyle = i === 1 ? '#ff9a3a' : '#9a4aff';
        ctx.beginPath();
        ctx.arc(pr.x - pr.dx * i * 1.2, pr.y - pr.dy * i * 1.2 + Math.sin(t + i) * 0.8, (6 - i) * s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 0.5; ctx.strokeStyle = '#d8b8ff'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(pr.x, pr.y, 6.5 * s, t * 0.4, t * 0.4 + 4); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillStyle = '#ff5a14';
      ctx.beginPath(); ctx.arc(pr.x, pr.y, 4.6 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd84a';
      ctx.beginPath(); ctx.arc(pr.x, pr.y, 2.6 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff6d0';
      ctx.beginPath(); ctx.arc(pr.x - 0.8, pr.y - 0.8, 1.1 * s, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      continue;
    }
    // Infernal fireball: a burning core with a flickering tail (it sets you alight).
    if (pr.weaponId === 'hellfire') {
      const t = performance.now() / 60;
      ctx.save();
      for (let i = 3; i >= 1; i--) {
        ctx.globalAlpha = 0.18 * (4 - i);
        ctx.fillStyle = i === 1 ? '#ffb030' : '#ff4a10';
        ctx.beginPath();
        ctx.arc(pr.x - pr.dx * i * 1.3, pr.y - pr.dy * i * 1.3 + Math.sin(t + i) * 0.8, 6 - i, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.fillStyle = '#ff5a14';
      ctx.beginPath(); ctx.arc(pr.x, pr.y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd84a';
      ctx.beginPath(); ctx.arc(pr.x, pr.y, 2.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff6d0';
      ctx.beginPath(); ctx.arc(pr.x - 0.8, pr.y - 0.8, 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      continue;
    }

    // Explosive revolver round (attack, fan the hammer, dead eye): a hot
    // tracer with a glowing slug.
    if (pr.weaponId === 'revolver') {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.5; ctx.strokeStyle = '#ffd27a'; ctx.lineWidth = pr.special ? 2.5 : 1.6;
      ctx.beginPath(); ctx.moveTo(pr.x, pr.y); ctx.lineTo(pr.x - pr.dx * 1.6, pr.y - pr.dy * 1.6); ctx.stroke();
      ctx.globalAlpha = 0.45; ctx.fillStyle = '#ff7a1a';
      ctx.beginPath(); ctx.arc(pr.x, pr.y, (pr.special ? 5 : 3.8) * u.size, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = '#fff1c0';
      ctx.beginPath(); ctx.arc(pr.x, pr.y, (pr.special ? 2.4 : 1.8) * u.size, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      continue;
    }
    // Wind wand gust: a swirling pocket of air — a soft glow, three swept
    // crescents trailing behind and a few leaves caught in the flow.
    if (pr.weaponId === 'windwand') {
      ctx.save();
      ctx.translate(pr.x, pr.y); ctx.rotate(ang);
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.22; ctx.fillStyle = '#aef5dc';
      ctx.beginPath(); ctx.ellipse(-3, 0, 11 * u.size, 6.5 * u.size, 0, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 4; i++) {
        ctx.globalAlpha = 0.95 - i * 0.2;
        ctx.strokeStyle = i === 0 ? '#ffffff' : i === 1 ? '#d8fff0' : '#8fe0c4';
        ctx.lineWidth = 2.4 - i * 0.4;
        ctx.beginPath(); ctx.arc(-i * 4.5, 0, (7 - i * 0.8) * u.size, -1.2, 1.2); ctx.stroke();
      }
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        const t = now / 90 + i * 2.1;
        ctx.globalAlpha = 0.85; ctx.fillStyle = i % 2 ? '#7fd8a8' : '#c9f08a';
        ctx.fillRect(-4 - i * 5 + Math.cos(t) * 2, Math.sin(t * 1.3) * 5 - 1, 2.4, 1.6);
      }
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
      ctx.globalAlpha=alpha; ctx.fillStyle=p.color||PAL.xp;
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
    } else if (p.type==='dash') {
      // A streak from where the dash started to where it ended.
      const m=p.max||260, a=Math.max(0,p.timer/m);
      ctx.save();
      ctx.lineCap='round';
      for (const [w, c, al] of [[12, p.color||'#9fe8ff', 0.25], [5, '#ffffff', 0.7]]) {
        ctx.globalAlpha=a*al; ctx.strokeStyle=c; ctx.lineWidth=w*a+1;
        ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(p.x2,p.y2); ctx.stroke();
      }
      ctx.restore();
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
    } else if (p.type==='bladeswipe') {
      // The Light Blade's landing cut: a bright ring sweeping round from the dash direction.
      const m=p.max||280, a=Math.max(0,p.timer/m), k=1-a;
      const start = (p.a||0) - Math.PI * 0.5, sweep = Math.PI * 2 * Math.min(1, k * 1.8);
      ctx.save();
      for (const [w, c, al, rr] of [[7, p.color||'#fff27a', 0.35, 1], [3, '#ffffff', 0.95, 0.92], [1.5, p.color||'#fff27a', 0.8, 0.7]]) {
        ctx.globalAlpha = a*al; ctx.strokeStyle = c; ctx.lineWidth = w;
        ctx.beginPath(); ctx.arc(p.x, p.y, (p.r||60)*rr*(0.7+0.3*k), start, start + sweep); ctx.stroke();
      }
      ctx.globalAlpha = a; ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 6; i++) {
        const ang = start + sweep * (i / 6), rr = (p.r||60) * (0.85 + 0.25 * Math.sin(i * 7.3));
        ctx.fillRect(Math.round(p.x + Math.cos(ang)*rr) - 1, Math.round(p.y + Math.sin(ang)*rr) - 1, 2, 2);
      }
      ctx.restore();
    } else if (p.type==='giantswipe') {
      const m=p.max||320, a=Math.max(0,p.timer/m), k=1-a;
      const mid = p.face === -1 ? Math.PI : 0, span = Math.PI * (0.35 + 0.75 * Math.min(1, k * 2));
      ctx.save();
      ctx.lineCap = 'round';
      ctx.globalAlpha = a * 0.35; ctx.strokeStyle = '#4e8a3a'; ctx.lineWidth = 14;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.85, mid - span / 2, mid + span / 2); ctx.stroke();
      ctx.globalAlpha = a * 0.9; ctx.strokeStyle = '#e8f0c8'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, mid - span / 2, mid + span / 2); ctx.stroke();
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
      // Name the trap as it goes off.
      if (p.text) {
        ctx.globalAlpha = Math.min(1, (p.timer/m) * 2);
        ctx.font = 'bold 12px "Courier New",monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round';
        const ty = Math.round(p.y - 22 - k * 14);
        ctx.strokeText(p.text + '!', Math.round(p.x), ty);
        ctx.fillStyle = p.color || '#fff';
        ctx.fillText(p.text + '!', Math.round(p.x), ty);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      }
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
  // Players 3 and 4 share the middle of the bar.
  for (const [k, left] of [['p3', true], ['p4', false]]) {
    const q = state.players[k];
    if (!q) continue;
    const col = getSkinColor(q, PAL[k]), nm = (names[k] || k.toUpperCase()).slice(0, 10);
    const x0 = left ? HUD_W / 2 - 78 : HUD_W / 2 + 4;
    ctx.textAlign = 'left';
    const tx = x0;
    ctx.fillStyle = '#000'; ctx.fillText(nm, tx + 1, 3);
    ctx.fillStyle = q.dead && q.lives <= 0 ? '#555' : col; ctx.fillText(nm, tx, 2);
    ctx.textAlign = 'left';
    drawHpBar(x0, 15, 74, 5, q.hp / q.maxHp, col, '#330000');
    for (let i = 0; i < (q.lives || 0); i++) { ctx.fillStyle = col; ctx.fillRect(x0 + i*7, 21, 5, 3); }
  }

  const w = state.wave;
  ctx.textAlign = 'center';
  if (state.gameMode === 'sandbox' && state.sandbox?.tutorial) {
    ctx.fillStyle = '#000'; ctx.fillText('TUTORIAL', HUD_W/2 + 1, 3);
    ctx.fillStyle = '#7affc8'; ctx.fillText('TUTORIAL', HUD_W/2, 2);
  } else if (state.gameMode === 'sandbox') {
    const t = 'SANDBOX';
    const sub = 'LEVEL ' + (state.sandbox?.level || 1) + ' · ' + (state.monsters || []).length + ' MONSTERS'
              + (state.sandbox?.god ? ' · GOD' : '') + (state.sandbox?.freeze ? ' · FROZEN' : '');
    ctx.fillStyle = '#000'; ctx.fillText(t, HUD_W/2 + 1, 3);
    ctx.fillStyle = '#9fffd0'; ctx.fillText(t, HUD_W/2, 2);
    ctx.font = '8px "Courier New",monospace';
    ctx.fillStyle = '#999'; ctx.fillText(sub, HUD_W/2, 15);
    ctx.font = '10px "Courier New",monospace';
  } else if (state.gameMode === 'abyss') {
    const ab = (state.monsters || []).find(m => m.abyss);
    const t = 'THE ABYSS';
    const sub = !ab ? '' : ab.p3 ? 'SURVIVE ' + ab.p3 + 's' : 'PHASE ' + (ab.phase || 1);
    ctx.fillStyle = '#000'; ctx.fillText(t, HUD_W/2 + 1, 3);
    ctx.fillStyle = '#b07aff'; ctx.fillText(t, HUD_W/2, 2);
    ctx.font = '8px "Courier New",monospace';
    ctx.fillStyle = ab && ab.p3 ? '#ff7ad8' : ab && ab.phase === 2 ? '#e0a0ff' : '#999'; ctx.fillText(sub, HUD_W/2, 15);
    ctx.font = '10px "Courier New",monospace';
  } else if (state.gameMode === 'portal') {
    const mage = (state.monsters || []).find(m => m.mage);
    const t = 'THE PORTAL MAGE';
    const sub = !mage ? '' : mage.hidden ? 'SLAY HIS GIANTS!' : 'PHASE ' + (mage.phase || 1);
    ctx.fillStyle = '#000'; ctx.fillText(t, HUD_W/2 + 1, 3);
    ctx.fillStyle = '#c8a0ff'; ctx.fillText(t, HUD_W/2, 2);
    ctx.font = '8px "Courier New",monospace';
    ctx.fillStyle = mage && mage.phase === 2 ? '#ff7aaa' : '#999'; ctx.fillText(sub, HUD_W/2, 15);
    ctx.font = '10px "Courier New",monospace';
  } else if (state.bot) {
    const t = 'BOT BATTLE · ' + String(state.bot).toUpperCase();
    ctx.fillStyle = '#000'; ctx.fillText(t, HUD_W/2 + 1, 3);
    ctx.fillStyle = '#ff9a5a'; ctx.fillText(t, HUD_W/2, 2);
  } else if (w && state.gameMode !== 'pvp') {
    const wl = (state.gameMode === 'extreme' ? 'EXTREME ' : '') + 'WAVE ' + w.num + (state.finalWave ? '/' + state.finalWave : '');
    ctx.fillStyle = '#000'; ctx.fillText(wl, HUD_W/2 + 1, 3);
    ctx.fillStyle = state.gameMode === 'extreme' ? '#ff6a4a' : PAL.text; ctx.fillText(wl, HUD_W/2, 2);
    ctx.font = '8px "Courier New",monospace';
    ctx.fillStyle = '#999'; ctx.fillText(Math.max(0, w.monstersLeft) + ' LEFT', HUD_W/2, 15);
    ctx.font = '10px "Courier New",monospace';
  }
  ctx.textAlign = 'left';

  // ── Ability cooldown bars (local player): special + parry ──
  const mp = state.players[myKeyOf()] || null;
  if (mp) {
    const barW = 60, barH = 4;
    const leftSide = myNum % 2 === 1, inset = 0;
    const bx = leftSide ? 4 + inset : RX - 4 - barW - inset;
    const lx = leftSide ? bx + barW + 3 : bx - 3;
    const align = leftSide ? 'left' : 'right';
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
      const vx = mp.weaponId === 'vortex';
      drawBar(28, ready ? 1 : Math.max(0, 1 - mp.specialCd / mp.specialMax), ready,
              vx ? 'BANK ' + (mp.vStore || 0) : ready ? 'SPECIAL' : 'SP', '#dd88ff', '#6a3a99', '#1a0a2a');
    }
    if (mp.parryMax > 0) {
      const ready = (mp.parryCd || 0) <= 0;
      drawBar(35, ready ? 1 : Math.max(0, 1 - mp.parryCd / mp.parryMax), ready,
              ready ? 'PARRY' : 'PAR', '#66ccff', '#2a5a7a', '#0a1a2a');
    }
    let by = 42;
    if (mp.superMax > 0) {
      const ready = (mp.superCd || 0) <= 0;
      drawBar(by, ready ? 1 : Math.max(0, 1 - mp.superCd / mp.superMax), ready,
              ready ? 'SUPER' : 'SUP', '#ff8a2a', '#7a3a10', '#2a0e04');
      by += 7;
    }
    // Equipped abilities, labelled with their key.
    (mp.abil || []).forEach((a, i) => {
      if (!a) return;
      const def = abilityDef(a.id);
      const ready = a.cd <= 0, col = def ? def.color : '#ccc';
      const key = AB_KEYS[i] + ' ';
      drawBar(by, ready ? 1 : Math.max(0, 1 - a.cd / (a.max || 1)), ready,
              key + (ready ? (def ? def.name : a.id.toUpperCase()) : Math.ceil(a.cd / 1000) + 's'), col, '#3a4450', '#0c1016');
      by += 7;
    });
    ctx.textAlign = 'left';
    ctx.font = '10px "Courier New",monospace';
  }

  // XP and coins live in the top bar beside your own health, so the bottom edge
  // belongs to the weapon rack alone.
  const right = myNum % 2 === 0;
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
let _snIn = NaN, _snOut = '';
function shortNum(n) {
  if (n === _snIn) return _snOut;   // called every frame with the same value
  _snIn = n; _snOut = shortNum0(n);
  return _snOut;
}
function shortNum0(n) {
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
  const mp = state.players?.[myKeyOf()];
  if (!mp || !mp.unlockedWeapons || !mp.unlockedWeapons.length) return;
  const weapons = mp.unlockedWeapons;
  const n = weapons.length;

  // The rack sits at the top, just under the top bar, where no touch button
  // ever reaches. It keeps clear of your own ability bars and power-up row
  // (left for player 1, right for player 2) and of the music / leave buttons.
  // Slots are icon-only and shrink to fit, wrapping onto a second (rarely a
  // third) row only if they'd get too small; the held weapon's name sits under
  // the rack instead of a label in every slot.
  const TOP = 29, SIDE = 156;
  let L = myNum % 2 === 0 ? 6 : SIDE, R = myNum % 2 === 0 ? HUD_W - SIDE : HUD_W - 6;
  const gap = 1, slotH = isTouchDevice ? 16 : 14, minW = isTouchDevice ? 17 : 15;
  let rows, slotW, perRow, panelW, panelH, panelX;
  const rowW = (cnt) => cnt * (slotW + gap) - gap;
  const layout = () => {
    const avail = R - L;
    for (rows = 1; rows <= 3; rows++) {
      slotW = Math.min(isTouchDevice ? 20 : 18, Math.floor((avail + gap) / Math.ceil(n / rows)) - gap);
      if (slotW >= minW) break;
    }
    rows = Math.min(rows, 3);
    slotW = Math.max(12, slotW);
    perRow = Math.ceil(n / rows);
    panelW = rowW(Math.min(n, perRow));
    panelH = rows * slotH + (rows - 1) * gap;
    // Centred on the screen when it fits there, otherwise inside its lane.
    panelX = Math.round(Math.max(L, Math.min(R - panelW, HUD_W / 2 - panelW / 2)));
  };
  layout();
  // A tall column of touch buttons reaching up into the rack (short phone
  // screens, extra ability / SUPER buttons) narrows the lane instead of pushing
  // the rack down underneath it — which used to shove it off the screen.
  for (let tries = 0; tries < 3; tries++) {
    const hit = hudTouchZones().find(z => z.h > 40 && z.y < TOP + panelH + 3 && z.y + z.h > TOP - 3
                                       && z.x < panelX + panelW + 4 && z.x + z.w > panelX - 4);
    if (!hit) break;
    if (hit.x + hit.w / 2 > HUD_W / 2) R = Math.min(R, hit.x - 6);
    else L = Math.max(L, hit.x + hit.w + 6);
    if (R - L < 60) break;
    layout();
  }
  const midX = panelX + panelW / 2;
  let panelY = clearOfButtons(panelX - 4, TOP - 3, panelW + 8, panelH + 6) + 3;
  // Small nudges below the music / leave buttons are fine; never further.
  if (panelY > TOP + 24 || panelY + panelH > HUD_H - 14) panelY = TOP;

  // Never hide your own character: if you walk behind the rack, it turns
  // see-through.
  const me = state.players?.[myKeyOf()];
  let alpha = 1;
  if (me && !me.dead) {
    const px = me.x / HUD_SCALE, py = (me.y - PLAYER_PAD) / HUD_SCALE;
    const pw = me.w / HUD_SCALE, ph = (me.h + PLAYER_PAD) / HUD_SCALE;
    if (px + pw > panelX - 6 && px < panelX + panelW + 6 &&
        py < panelY + panelH + 14 && py + ph > panelY - 6) alpha = 0.25;
  }
  ctx.save();
  ctx.globalAlpha = alpha * 0.85;

  ctx.fillStyle='rgba(0,0,0,0.35)';
  ctx.fillRect(panelX-2, panelY-2, panelW+4, panelH+4);

  if (!isTouchDevice) drawControlHints();

  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / perRow), col = i % perRow;
    const cnt = Math.min(perRow, n - row * perRow);
    const rx = Math.round(midX - rowW(cnt) / 2);
    const sx = rx + col * (slotW + gap);
    const sy = panelY + row * (slotH + gap);
    const wId = weapons[i], sel = i === mp.weaponIdx;
    weaponSlotRects.push({ x: sx, y: sy, w: slotW, h: slotH, index: i });
    const wc = WEAPON_COLOR[wId] || PAL.white;
    ctx.fillStyle = sel ? 'rgba(255,255,255,0.14)' : 'rgba(5,5,15,0.35)';
    ctx.fillRect(sx, sy, slotW, slotH);
    ctx.strokeStyle = sel ? wc : '#2a2a3a'; ctx.lineWidth = 1;
    ctx.strokeRect(sx+0.5, sy+0.5, slotW-1, slotH-1);
    if (sel) {
      ctx.save(); ctx.globalAlpha=0.35; ctx.strokeStyle=wc; ctx.lineWidth=1;
      ctx.strokeRect(sx-0.5, sy-0.5, slotW+1, slotH+1); ctx.restore();
    }
    ctx.globalAlpha = (sel ? 1 : 0.5) * alpha;   // unselected slots dim, but still readable
    drawWeaponPixelsFitted(ctx, wId, sx + slotW/2, sy + slotH/2, slotW - 3, slotH - 3, wc);
    ctx.globalAlpha = alpha * 0.85;
  }
  // The held weapon's name, just under the rack.
  const held = weapons[mp.weaponIdx];
  if (held) {
    const name = (WEAPON_META[held]?.name || held).toUpperCase();
    ctx.font = '6px "Courier New",monospace'; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    ctx.fillStyle = '#000'; ctx.fillText(name, midX + 0.5, panelY + panelH + 2.5);
    ctx.fillStyle = WEAPON_COLOR[held] || PAL.white; ctx.fillText(name, midX, panelY + panelH + 2);
    // A maxed weapon's passive, named under it while it's working.
    const pv = mp.passive && WEAPON_META[mp.passive]?.passive;
    if (pv) {
      const t = '★ ' + pv.name + ' ★';
      ctx.fillStyle = '#000'; ctx.fillText(t, midX + 0.5, panelY + panelH + 10.5);
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(performance.now() / 250);
      ctx.fillStyle = pv.color; ctx.fillText(t, midX, panelY + panelH + 10);
      ctx.globalAlpha = 1;
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
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
    for (const el of tc.querySelectorAll('.dpad, .ability-btns, .action-row')) add(el);
  }
  const gc = document.getElementById('gameControls');
  if (gc && gc.classList.contains('visible')) add(gc);
  return touchZones;
}

// Keyboard legend: one faint line along the bottom edge, now that the weapon
// rack lives at the top.
function drawControlHints() {
  ctx.save();
  ctx.font = '8px "Courier New",monospace';
  ctx.textBaseline = 'bottom'; ctx.textAlign = 'center';
  const me = currState?.players?.[myKeyOf()];
  const abil = (me && me.abil) || [];
  const abKeys = abil.map((a, i) => a ? AB_KEYS[i] : '').filter(Boolean).join('/');
  const t = 'ARROWS MOVE · SPACE ATK · ENTER/Z SWAP · SHIFT SPECIAL · P PARRY · '
          + (me && me.superMax > 0 ? 'R SUPER · ' : '') + (abKeys ? abKeys + ' ABILITY · ' : '') + '1-4 ITEMS';
  const w = ctx.measureText(t).width;
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(HUD_W/2 - w/2 - 3, HUD_H - 12, w + 6, 11);
  ctx.fillStyle = '#6a6a80';
  ctx.fillText(t, HUD_W/2, HUD_H - 3);
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

// ─── Darklight ───────────────────────────────────────────────────────────────
const DL_TAU = Math.PI * 2;
// A kunai at (x, y) pointing along ang, glowing dark or light.
function drawKunai(x, y, ang, dark, scale) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.globalAlpha = dark ? 0.4 : 0.3; ctx.fillStyle = dark ? '#9a7aff' : '#ffffff';
  ctx.beginPath(); ctx.ellipse(4 * scale, 0, 16 * scale, 6 * scale, 0, 0, DL_TAU); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.translate(-16 * scale, 0);
  drawWeaponPixels(ctx, 'darklight', scale, WEAPON_COLOR.darklight || '#e8e8f4');
  ctx.restore();
}
// The kunai circling a Darklight holder.
function drawDarklightOrbit(p, x, y) {
  const n = p.dk.length, mx = x + p.w / 2, my = y + p.h / 2, base = performance.now() * 0.0055;
  ctx.save();
  ctx.globalAlpha = 0.18; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(mx, my, 40, 0, DL_TAU); ctx.stroke();
  ctx.restore();
  for (let i = 0; i < n; i++) {
    const a = base + i * DL_TAU / n;
    drawKunai(mx + Math.cos(a) * 40, my + Math.sin(a) * 40, a + Math.PI / 2, p.dk[i] === '1', 0.72);
  }
}
// A thrown kunai (the special) or one of the pair (the super, bigger, with a long streak).
function drawFlyingKunai(pr, ang, pair) {
  const dark = !!pr.special, sp = Math.hypot(pr.dx, pr.dy) || 1, len = pair ? 46 : 16;
  ctx.save();
  const g = ctx.createLinearGradient(pr.x, pr.y, pr.x - pr.dx / sp * len, pr.y - pr.dy / sp * len);
  g.addColorStop(0, dark ? 'rgba(90,40,160,0.85)' : 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.strokeStyle = g; ctx.lineWidth = pair ? 5 : 2.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(pr.x, pr.y); ctx.lineTo(pr.x - pr.dx / sp * len, pr.y - pr.dy / sp * len); ctx.stroke();
  if (pair) {
    ctx.globalAlpha = 0.35; ctx.fillStyle = dark ? '#12081f' : '#ffffff';
    ctx.beginPath(); ctx.arc(pr.x, pr.y, 9, 0, DL_TAU); ctx.fill();
  }
  ctx.restore();
  drawKunai(pr.x, pr.y, ang, dark, pair ? 1 : 0.8);
}
// Cursed by the pair: black and white wisps circling, and the ring it spreads within.
function drawCurseFx(e, x, y) {
  const now = performance.now(), mx = x + e.w / 2, my = y + e.h / 2;
  ctx.save();
  ctx.globalAlpha = 0.35; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]); ctx.lineDashOffset = -now / 40;
  ctx.beginPath(); ctx.arc(mx, my, 44, 0, DL_TAU); ctx.stroke();
  ctx.setLineDash([]);
  const r = Math.max(e.w, e.h) * 0.75;
  for (let i = 0; i < 6; i++) {
    const a = now / 260 + i * DL_TAU / 6;
    ctx.globalAlpha = 0.85; ctx.fillStyle = i % 2 ? '#15151c' : '#f4f4fa';
    ctx.beginPath(); ctx.arc(mx + Math.cos(a) * r, my + Math.sin(a) * r * 0.7, 2, 0, DL_TAU); ctx.fill();
  }
  ctx.restore();
}

// ─── The rare shop ───────────────────────────────────────────────────────────
// A merchant's stall: a black and gold awning over a counter, a glowing sign.
function drawRareShop(s) {
  const now = performance.now(), x = Math.round(s.x), y = Math.round(s.y), w = s.w, h = s.h;
  ctx.save();
  ctx.globalAlpha = 0.18 + 0.08 * Math.sin(now / 300); ctx.fillStyle = '#ffd84a';
  ctx.beginPath(); ctx.ellipse(x + w / 2, y + h, w * 1.3, 9, 0, 0, DL_TAU); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x + 1, y + h, w - 2, 3);
  ctx.fillStyle = '#5a3a1e'; ctx.fillRect(x + 2, y + 6, 2, h - 6); ctx.fillRect(x + w - 4, y + 6, 2, h - 6);   // posts
  ctx.fillStyle = '#7a4a22'; ctx.fillRect(x, y + h - 10, w, 10);                                           // counter
  ctx.fillStyle = '#9a6430'; ctx.fillRect(x, y + h - 10, w, 2);
  for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#15151c' : '#d9a520'; ctx.fillRect(x - 2 + i * (w + 4) / 6, y, (w + 4) / 6 + 0.5, 7); }   // awning
  for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#15151c' : '#d9a520'; ctx.beginPath(); ctx.arc(x - 2 + (i + 0.5) * (w + 4) / 6, y + 7, (w + 4) / 12, 0, Math.PI); ctx.fill(); }
  // A kunai on display, turning.
  ctx.save(); ctx.translate(x + w / 2, y + h - 14); ctx.rotate(Math.sin(now / 500) * 0.4 - Math.PI / 4);
  ctx.translate(-10, 0); drawWeaponPixels(ctx, 'darklight', 0.7, WEAPON_COLOR.darklight || '#e8e8f4'); ctx.restore();
  ctx.font = 'bold 8px "Courier New",monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#000'; ctx.fillText('RARE SHOP', x + w / 2 + 1, y - 3);
  ctx.fillStyle = '#ffd84a'; ctx.fillText('RARE SHOP', x + w / 2, y - 4);
  ctx.font = '7px "Courier New",monospace'; ctx.textBaseline = 'top';
  ctx.fillStyle = '#cfc59a'; ctx.fillText('LEAVES IN ' + Math.ceil(s.t / 1000) + 's', x + w / 2, y + h + 4);
  for (let i = 0; i < 3; i++) {   // sparkles
    const a = now / 700 + i * 2.1;
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(now / 150 + i);
    ctx.fillStyle = '#fff6c0'; ctx.fillRect(x + w / 2 + Math.cos(a) * (w * 0.8), y + h / 2 + Math.sin(a) * 14, 1.5, 1.5);
  }
  ctx.restore();
}
// The panel that opens when you walk up to it.
function showRareShop(msg) {
  const el = document.getElementById('rareShopPanel');
  if (!el) return;
  if (!msg.open) { el.classList.add('hidden'); return; }
  const rows = (msg.offers || []).map(o => {
    const needs = o.needs.map(n => `<span class="${n.ok ? 'need-ok' : 'need-no'}">${n.ok ? '✔' : '✘'} ${n.name} maxed</span>`).join('');
    const kills = `<span class="${o.kills >= o.killsNeed ? 'need-ok' : 'need-no'}">${o.kills >= o.killsNeed ? '✔' : '✘'} ${o.kills.toLocaleString()}/${o.killsNeed.toLocaleString()} enemies killed</span>`;
    const coins = `<span class="${o.coins >= o.price ? 'need-ok' : 'need-no'}">${o.coins >= o.price ? '✔' : '✘'} ◆ ${o.coins.toLocaleString()}/${o.price.toLocaleString()}</span>`;
    const btn = o.owned ? '<button class="rs-buy" disabled>OWNED</button>'
      : `<button class="rs-buy${o.ok ? '' : ' poor'}" ${o.ok ? '' : 'disabled'} onclick="buyMythic('${o.id}')">BUY ◆ ${o.price.toLocaleString()}</button>`;
    return `<div class="rs-row"><canvas class="rs-ic" data-weapon="${o.id}" width="64" height="34"></canvas>
      <div class="rs-info"><div class="rs-name">${o.name} <span class="legend-tag mythic-tag">MYTHIC</span></div>
      <div class="rs-needs">${needs}${kills}${coins}</div></div>${btn}</div>`;
  }).join('');
  el.innerHTML = `<div class="rs-title">✦ RARE SHOP ✦</div>
    ${msg.guest ? '<div class="rs-note bad">Play with a password to buy mythics.</div>' : ''}
    ${rows || '<div class="rs-note">Nothing for sale.</div>'}
    ${msg.note ? `<div class="rs-note${msg.bad ? ' bad' : ''}">${msg.note}</div>` : ''}
    <div class="rs-hint">Only one mythic goes into a game · walk away to close</div>`;
  for (const cv of el.querySelectorAll('canvas.rs-ic')) {
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    drawWeaponPixelsFitted(g, cv.dataset.weapon, cv.width / 2, cv.height / 2, cv.width - 6, cv.height - 6, WEAPON_COLOR[cv.dataset.weapon] || '#ccc');
  }
  el.classList.remove('hidden');
}
function buyMythic(id) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'buy_mythic', id }));
}

// ─── Starfall ────────────────────────────────────────────────────────────────
// A star on its way down: the marker on the ground tightens while the star
// streaks in from above, then it lands.
function drawStars(stars) {
  const now = performance.now();
  for (const s of stars) {
    const k = Math.min(1, s.k);
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.35 * k; ctx.strokeStyle = '#ffe9a0'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * (1 - k * 0.85), 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.12 + 0.2 * k; ctx.fillStyle = '#ffe9a0';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    // the star itself, falling at a slant
    const fx = s.x + 50 * (1 - k), fy = s.y - 160 * (1 - k);
    const g = ctx.createLinearGradient(fx, fy, fx + 18, fy - 56);
    g.addColorStop(0, 'rgba(255,240,180,0.9)'); g.addColorStop(1, 'rgba(255,240,180,0)');
    ctx.globalAlpha = 1; ctx.strokeStyle = g; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx + 18, fy - 56); ctx.stroke();
    drawStarShape(fx, fy, 5 + Math.sin(now / 60) * 0.8, '#ffffff', '#ffe9a0');
    ctx.restore();
  }
}
function drawStarShape(x, y, r, core, rim) {
  ctx.save(); ctx.translate(x, y);
  ctx.globalAlpha = 0.4; ctx.fillStyle = rim; ctx.beginPath(); ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1; ctx.fillStyle = rim;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? r * 0.35 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = core; ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
// A constellation: gold lines joining the foes, a star on each, brightening until it closes.
function drawConstellations(list) {
  const now = performance.now();
  for (const c of list) {
    if (!c.pts.length) continue;
    ctx.save();
    ctx.globalAlpha = 0.4 + 0.5 * c.k; ctx.strokeStyle = '#ffe9a0'; ctx.lineWidth = 1 + c.k * 1.5;
    ctx.setLineDash([2, 3]); ctx.lineDashOffset = -now / 30;
    ctx.beginPath();
    c.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (c.pts.length > 2) ctx.closePath();
    ctx.stroke(); ctx.setLineDash([]);
    for (const [x, y] of c.pts) drawStarShape(x, y - 2, 4 + c.k * 3, '#ffffff', '#ffe9a0');
    ctx.restore();
  }
}
// The star shower: a halo of little stars wheeling over the caster.
function drawStarRainAura(p, x, y) {
  const now = performance.now(), mx = x + p.w / 2, my = y - 6;
  for (let i = 0; i < 5; i++) {
    const a = now / 300 + i * Math.PI * 2 / 5;
    drawStarShape(mx + Math.cos(a) * 14, my + Math.sin(a) * 5, 2.5, '#ffffff', '#ffe9a0');
  }
}

// ─── Picking your mythic ─────────────────────────────────────────────────────
// Only one mythic goes into a game: with two or more, pick which.
function mythicPicker(weapons) {
  const owned = weapons.filter(id => WEAPON_META[id]?.mythic);
  if (owned.length < 2) return '';
  const pick = owned.includes(shopData?.mythicPick) ? shopData.mythicPick : owned[0];
  return `<div class="shop-row legendary mythic-row mythic-pick">
    <div class="shop-head"><span class="shop-name mythic-name">MYTHIC FOR YOUR GAMES</span><span class="legend-tag mythic-tag">PICK 1</span></div>
    <div class="mp-row">${owned.map(id => `<button class="mp-btn${id === pick ? ' on' : ''}" onclick="pickMythic('${id}')">
      <canvas class="shop-ic" data-weapon="${id}" width="56" height="32"></canvas>${WEAPON_META[id].name}</button>`).join('')}</div>
    <div class="legend-need">Only one mythic goes into a game. The other stays home.</div>
  </div>`;
}
async function pickMythic(id) {
  if (!pendingPass || shopBusy) return;
  shopBusy = true;
  try {
    const res = await fetch('/api/pick_mythic', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pendingPass, weaponId: id, backup: loadBackup(pendingPass) }) });
    const data = await res.json();
    if (!res.ok) { setShopMsg(data.error || 'Could not pick that.', true); return; }
    storeBackup(pendingPass, data.save);
    shopData = { ...shopData, ...data };
    renderShop();
    setShopMsg((WEAPON_META[id]?.name || id) + ' goes into your next games.');
  } catch { setShopMsg('Could not reach the server.', true); }
  finally { shopBusy = false; }
}
