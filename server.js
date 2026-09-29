'use strict';

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const PROGRESS_FILE = path.join(__dirname, 'progress.json');

// ─── Constants ────────────────────────────────────────────────────────────────

// World is 1.5× the old 480×270 arena. The client renders the whole world at
// 720×405 and draws its HUD in a 480×270 space scaled by 1.5, so the bigger map
// is simply zoomed out to fit the screen.
const CANVAS_W = 720, CANVAS_H = 405;
const ARENA_X = 12, ARENA_Y = 12;
const ARENA_W = CANVAS_W - ARENA_X * 2, ARENA_H = CANVAS_H - ARENA_Y * 2;
const TICK_MS = 20;

// Dev hook: start co-op/waves at a later wave so the deep-wave monster roster can
// be exercised without playing there first. Unset in production.
const START_WAVE = Math.max(1, Math.floor(Number(process.env.WEPONARE_START_WAVE) || 1));

const ADMIN_PASSWORD = '67892155';
const ADMIN_XP = 1000000000000000000; // 1e18 — unlocks everything
const ADMIN_COINS = 999999999;
function isAdminPw(pw) { return pw === ADMIN_PASSWORD; }

const PARRY_WINDOW   = 350;   // ms the parry is "active" and reflects
const PARRY_COOLDOWN = 5000;  // ms before it can be used again
const PARRY_REFLECT  = 1.5;   // reflected damage multiplier

const PLAYER_SPEED  = 3.6;    // scaled up with the bigger arena
// Characters are drawn from a 16x22 pixel sprite, so the hitbox matches it.
const PLAYER_W = 16, PLAYER_H = 22;

// ── Traps: sparse, and big enough to be a real hazard on the larger map ──
const MAX_TRAPS = 5;
const TRAP_SPAWN_MIN = 5000, TRAP_SPAWN_MAX = 11000;
const TRAP_TYPES = {
  spike: { mode: 'delayed', armTime: 750, size: 34, radius: 52, damage: 30, color: '#ff8822' },
  mine:  { mode: 'instant',              size: 30, radius: 60, damage: 46, color: '#ff3333' },
  snare: { mode: 'instant',              size: 32, radius: 46, effect: 'slow', dur: 2800, color: '#66ccff' },
};

// ── Items: collectible, grant an activatable buff ──
const MAX_ITEMS = 4;
const ITEM_SPAWN_MIN = 6000, ITEM_SPAWN_MAX = 13000;
const MAX_INVENTORY = 4;
const ITEM_SIZE = 18;
const ITEM_TYPES = {
  speed:    { effect: 'speed',    dur: 6000, color: '#44ddee' },
  strength: { effect: 'strength', dur: 6000, color: '#ff5544' },
  shield:   { effect: 'shield',   dur: 4500, color: '#ffdd44' },
  haste:    { effect: 'haste',    dur: 6000, color: '#aa66ff' },
  heal:     { effect: 'heal',     instant: true, amount: 50, color: '#44ff66' },
};

// ── Coins: drop from every kill, spent on weapon upgrades in the menu ──
const COIN_SIZE = 10;
const COIN_LIFETIME = 22000;
const COIN_MAGNET = 26;       // auto-collect radius
const COIN_ATTRACT = 95;      // coins drift toward a player from this far away
const MAX_COIN_DROPS = 6;     // entities per kill (value is stacked instead)
const MAX_COINS_ON_FLOOR = 140;

const WEAPONS = [
  { id: 'sword',      name: 'SWORD',      damage: 20, range: 48,  atkSpd: 400,  type: 'melee',  unlockXp: 0,     special: { kind: 'slam',    dmg: 45,  range: 72,  cd: 5000 } },
  { id: 'dagger',     name: 'DAGGER',     damage: 10, range: 38,  atkSpd: 180,  type: 'melee',  unlockXp: 0,     special: { kind: 'slam',    dmg: 28,  range: 54,  cd: 3500 } },
  { id: 'axe',        name: 'AXE',        damage: 38, range: 48,  atkSpd: 700,  type: 'melee',  unlockXp: 150,   special: { kind: 'slam',    dmg: 75,  range: 68,  cd: 7000 } },
  { id: 'spear',      name: 'SPEAR',      damage: 18, range: 78,  atkSpd: 500,  type: 'melee',  unlockXp: 300,   special: { kind: 'pierce',  dmg: 45,  range: 215, cd: 5000 } },
  { id: 'bow',        name: 'BOW',        damage: 15, range: 290, atkSpd: 600,  type: 'ranged', unlockXp: 500,   special: { kind: 'spread',  dmg: 22,  range: 290, cd: 6000, count: 3 } },
  { id: 'staff',      name: 'STAFF',      damage: 25, range: 260, atkSpd: 900,  type: 'ranged', unlockXp: 800,   aoeRadius: 34, special: { kind: 'aoeshot', dmg: 140, range: 315, cd: 8000, aoe: 86 } },
  { id: 'hammer',     name: 'HAMMER',     damage: 50, range: 50,  atkSpd: 1000, type: 'melee',  unlockXp: 1200,  special: { kind: 'slam',    dmg: 95,  range: 86,  cd: 9000 } },
  { id: 'wand',       name: 'WAND',       damage: 8,  range: 215, atkSpd: 250,  type: 'ranged', unlockXp: 1700,  special: { kind: 'spread',  dmg: 14,  range: 245, cd: 4500, count: 5 } },
  { id: 'whip',       name: 'WHIP',       damage: 17, range: 84,  atkSpd: 400,  type: 'melee',  unlockXp: 2000,  swing360: true, special: { kind: 'slam', dmg: 42, range: 112, cd: 6000 } },
  { id: 'crossbow',   name: 'CROSSBOW',   damage: 30, range: 315, atkSpd: 800,  type: 'ranged', unlockXp: 2400,  pierce: true, special: { kind: 'pierce', dmg: 60, range: 360, cd: 7000 } },
  { id: 'flail',      name: 'FLAIL',      damage: 22, range: 58,  atkSpd: 500,  type: 'melee',  unlockXp: 3200,  swing360: true, special: { kind: 'slam', dmg: 50, range: 80, cd: 6000 } },
  { id: 'greatsword', name: 'GREATSWORD', damage: 45, range: 80,  atkSpd: 850,  type: 'melee',  unlockXp: 4500,  special: { kind: 'slam',    dmg: 85,  range: 94,  cd: 8000 } },
  { id: 'glaive',     name: 'GLAIVE',     damage: 42, range: 92,  atkSpd: 820,  type: 'melee',  unlockXp: 5800,  special: { kind: 'slam',    dmg: 90,  range: 102, cd: 8000 } },
  { id: 'grapple',    name: 'GRAPPLE',    damage: 14, range: 190, atkSpd: 700,  type: 'ranged', unlockXp: 6500,  grapple: true, special: { kind: 'hook', dmg: 30, range: 430, cd: 5500 } },
  { id: 'katana',     name: 'KATANA',     damage: 26, range: 55,  atkSpd: 240,  type: 'melee',  unlockXp: 7200,  special: { kind: 'pierce',  dmg: 55,  range: 245, cd: 4500 } },
  { id: 'chakram',    name: 'CHAKRAM',    damage: 22, range: 330, atkSpd: 360,  type: 'ranged', unlockXp: 9000,  pierce: true, special: { kind: 'spread', dmg: 26, range: 330, cd: 6000, count: 4 } },
  { id: 'boomerang',  name: 'BOOMERANG',  damage: 24, range: 200, atkSpd: 560,  type: 'ranged', unlockXp: 10000, pierce: true, boomerang: true, special: { kind: 'spread', dmg: 30, range: 215, cd: 6500, count: 3, boomerang: true } },
  { id: 'cannon',     name: 'CANNON',     damage: 60, range: 250, atkSpd: 1200, type: 'ranged', unlockXp: 11000, aoeRadius: 40, special: { kind: 'aoeshot', dmg: 150, range: 265, cd: 9000, aoe: 100 } },
  { id: 'reaper',     name: 'REAPER',     damage: 55, range: 86,  atkSpd: 920,  type: 'melee',  unlockXp: 13500, swing360: true, special: { kind: 'slam', dmg: 110, range: 110, cd: 9500 } },
  // projSpeed: shot speed. chill: ms of slow on hit. pellets: shots per trigger
  // pull, fanned. chain: how many extra foes a hit arcs on to.
  { id: 'shuriken',    name: 'SHURIKEN',    damage: 12, range: 250, atkSpd: 260,  type: 'ranged', unlockXp: 15000, pierce: true, projSpeed: 6.4, special: { kind: 'ring',    dmg: 24,  range: 210, cd: 6000, count: 10 } },
  { id: 'frostrod',    name: 'FROST ROD',   damage: 18, range: 260, atkSpd: 620,  type: 'ranged', unlockXp: 16500, chill: 1800,    special: { kind: 'aoeshot', dmg: 60,  range: 280, cd: 7500, aoe: 92, chill: 3200 } },
  { id: 'blunderbuss', name: 'BLUNDERBUSS', damage: 11, range: 150, atkSpd: 900,  type: 'ranged', unlockXp: 18000, pellets: 5, projSpeed: 5.6, special: { kind: 'aoeshot', dmg: 120, range: 200, cd: 8000, aoe: 72 } },
  { id: 'lance',       name: 'LANCE',       damage: 34, range: 96,  atkSpd: 650,  type: 'melee',  unlockXp: 20000, special: { kind: 'dash',    dmg: 70,  range: 140, cd: 6000 } },
  { id: 'stormtome',   name: 'STORM TOME',  damage: 20, range: 240, atkSpd: 700,  type: 'ranged', unlockXp: 22000, chain: 2,  special: { kind: 'storm',   dmg: 65,  range: 260, cd: 8500, count: 5 } },
];

const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map(w => [w.id, w]));

const WEAPON_COLORS = {
  sword: '#c8d8e8', dagger: '#d4e8b0', axe: '#e8a040', spear: '#c0c8d0',
  bow: '#b89060', staff: '#cc66ff', hammer: '#aab0b8', wand: '#88ddff',
  crossbow: '#cc8844', flail: '#dd4444', greatsword: '#ddeeff',
  glaive: '#b0d8c0', katana: '#eef0ff', chakram: '#66e0c0', cannon: '#9a90a8', reaper: '#cc66aa',
  whip: '#c9a06a', grapple: '#9fb6c8', boomerang: '#d8b070',
  shuriken: '#d8dde6', frostrod: '#8fe0ff', blunderbuss: '#c89a5a', lance: '#e8d8a0', stormtome: '#ffe45a',
};

// ── Weapon upgrades bought with coins from the menu ──
// Every weapon draws three upgrades from this pool, picked to suit how it
// fights (see WEAPON_UPGRADES). `short` is the shop button label and `desc`
// the per-level effect shown under it.
const UPGRADE_STATS = {
  dmg:   { name: 'DAMAGE',    short: 'DMG', max: 10, perLevel: 0.06,  baseCost: 12, desc: '+6% damage' },
  spd:   { name: 'SPEED',     short: 'SPD', max: 10, perLevel: 0.045, baseCost: 14, desc: '-4.5% attack delay' },
  rng:   { name: 'RANGE',     short: 'RNG', max: 6,  perLevel: 0.05,  baseCost: 16, desc: '+5% range' },
  crit:  { name: 'CRITICAL',  short: 'CRT', max: 8,  perLevel: 0.04,  baseCost: 15, desc: '+4% chance of a double-damage hit' },
  life:  { name: 'LIFESTEAL', short: 'LIF', max: 6,  perLevel: 0.03,  baseCost: 18, desc: 'heal 3% of damage dealt' },
  cdr:   { name: 'COOLDOWN',  short: 'CDR', max: 8,  perLevel: 0.06,  baseCost: 14, desc: '-6% special cooldown' },
  aoe:   { name: 'BLAST',     short: 'AOE', max: 6,  perLevel: 0.10,  baseCost: 16, desc: '+10% blast / slam radius' },
  multi: { name: 'MULTISHOT', short: 'MLT', max: 3,  perLevel: 1,     baseCost: 60, desc: '+1 projectile per shot' },
  chill: { name: 'FROST',     short: 'FRZ', max: 5,  perLevel: 0.25,  baseCost: 14, desc: '+25% slow duration' },
  chain: { name: 'CHAIN',     short: 'CHN', max: 3,  perLevel: 1,     baseCost: 55, desc: 'lightning jumps to +1 foe' },
  knock: { name: 'KNOCKBACK', short: 'KNK', max: 5,  perLevel: 5,     baseCost: 12, desc: 'hits push foes +5px' },
};
const UPGRADE_KEYS = Object.keys(UPGRADE_STATS);

const WEAPON_UPGRADES = {
  sword:       ['dmg', 'crit', 'cdr'],
  dagger:      ['spd', 'crit', 'life'],
  axe:         ['dmg', 'knock', 'crit'],
  spear:       ['rng', 'dmg', 'cdr'],
  bow:         ['dmg', 'multi', 'rng'],
  staff:       ['dmg', 'aoe', 'cdr'],
  hammer:      ['dmg', 'knock', 'aoe'],
  wand:        ['spd', 'multi', 'dmg'],
  whip:        ['rng', 'spd', 'life'],
  crossbow:    ['dmg', 'rng', 'crit'],
  flail:       ['dmg', 'knock', 'rng'],
  greatsword:  ['dmg', 'crit', 'knock'],
  glaive:      ['rng', 'dmg', 'life'],
  grapple:     ['dmg', 'rng', 'cdr'],
  katana:      ['spd', 'crit', 'life'],
  chakram:     ['multi', 'spd', 'dmg'],
  boomerang:   ['dmg', 'multi', 'rng'],
  cannon:      ['dmg', 'aoe', 'knock'],
  reaper:      ['life', 'dmg', 'rng'],
  shuriken:    ['multi', 'spd', 'crit'],
  frostrod:    ['chill', 'aoe', 'dmg'],
  blunderbuss: ['multi', 'dmg', 'knock'],
  lance:       ['dmg', 'rng', 'crit'],
  stormtome:   ['chain', 'dmg', 'cdr'],
};
function upgradesFor(weaponId) { return WEAPON_UPGRADES[weaponId] || ['dmg', 'spd', 'rng']; }

// ── Skins bought with coins: full outfits drawn over the character ──
// Ownership is saved per password; a skin can only be worn once it is owned.
const SKIN_SHOP = [
  { id: 'ninja',    name: 'NINJA',    price: 120 },
  { id: 'knight',   name: 'KNIGHT',   price: 150 },
  { id: 'pirate',   name: 'PIRATE',   price: 180 },
  { id: 'wizard',   name: 'WIZARD',   price: 200 },
  { id: 'viking',   name: 'VIKING',   price: 240 },
  { id: 'skeleton', name: 'SKELETON', price: 280 },
  { id: 'robot',    name: 'ROBOT',    price: 350 },
  { id: 'shadow',   name: 'SHADOW',   price: 500 },
  { id: 'inferno',  name: 'INFERNO',  price: 650 },
  { id: 'golden',   name: 'GOLDEN',   price: 900 },
];
const SKIN_BY_ID = Object.fromEntries(SKIN_SHOP.map(s => [s.id, s]));

// Cost of buying the `nextLevel`th level — later levels cost steeply more.
function upgradeCost(stat, nextLevel) {
  const s = UPGRADE_STATS[stat];
  if (!s || nextLevel < 1 || nextLevel > s.max) return Infinity;
  return Math.round(s.baseCost * Math.pow(nextLevel, 1.55));
}
function costTable() {
  const out = {};
  for (const k of UPGRADE_KEYS) {
    out[k] = [];
    for (let lv = 1; lv <= UPGRADE_STATS[k].max; lv++) out[k].push(upgradeCost(k, lv));
  }
  return out;
}

// ── Monster types ──
// Each type is a multiplier set over the wave's base stats, so a monster's size
// follows its health and its punch follows its damage. `minWave` gates when a
// type starts appearing and `weight` is its spawn share, which is re-weighted
// toward the tougher types the deeper the wave (see pickMonsterType).
const MONSTER_TYPES = {
  grunt: {
    name: 'GRUNT',    minWave: 1,  weight: 10, hp: 1.0,  dmg: 1.0, speed: 1.0,  size: 1.0,
    color: '#44cc44', xp: 1.0, coins: 1.0,
  },
  runner: {
    name: 'RUNNER',   minWave: 2,  weight: 7,  hp: 0.55, dmg: 0.7, speed: 2.0,  size: 0.8,
    color: '#c8e04a', xp: 1.0, coins: 1.0,
  },
  brute: {
    name: 'BRUTE',    minWave: 3,  weight: 5,  hp: 2.4,  dmg: 1.9, speed: 0.62, size: 1.35,
    color: '#cc5533', xp: 1.15, coins: 1.2,
  },
  spitter: {
    name: 'SPITTER',  minWave: 5,  weight: 4,  hp: 0.9,  dmg: 1.0, speed: 0.75, size: 1.0,
    color: '#a65cd0', xp: 1.2, coins: 1.3,
    ranged: true, shotRange: 210, shotSpeed: 3.4, reload: 2100,
  },
  warden: {
    name: 'WARDEN',   minWave: 7,  weight: 3,  hp: 3.2,  dmg: 1.6, speed: 0.7,  size: 1.25,
    color: '#7f93b8', xp: 1.4, coins: 1.5, armor: 0.42,
  },
  behemoth: {
    name: 'BEHEMOTH', minWave: 10, weight: 2,  hp: 7.0,  dmg: 2.8, speed: 0.5,  size: 1.9,
    color: '#8a3a6a', xp: 2.2, coins: 2.4, armor: 0.2,
  },
};

// Size of a baseline (1.0x) monster; every type scales from this.
const MONSTER_BASE_W = 14, MONSTER_BASE_H = 17;

// Length of a monster's attack animation; mirrored by the client.
const MONSTER_SWING_MS = 320;

// Pick a type for the current wave. Eligible types are weighted by their own
// share, then biased upward with the wave number, so late waves lean on the
// tougher roster instead of still being mostly grunts.
function pickMonsterType(wave) {
  const pool = [];
  let total = 0;
  for (const [id, def] of Object.entries(MONSTER_TYPES)) {
    if (wave < def.minWave) continue;
    // The further past a type's debut, the more it crowds out the weaker ones.
    const maturity = 1 + Math.min(2.2, (wave - def.minWave) * 0.16);
    const toughness = Math.max(1, def.hp);
    pool.push([id, def.weight * maturity * Math.pow(toughness, Math.min(1.1, wave * 0.045))]);
    total += pool[pool.length - 1][1];
  }
  if (!pool.length) return 'grunt';
  let roll = Math.random() * total;
  for (const [id, w] of pool) { roll -= w; if (roll <= 0) return id; }
  return pool[pool.length - 1][0];
}

const WAVE_CONFIG = [
  { monsters: 4,  hpMult: 1.0, speedMult: 1.0  },
  { monsters: 6,  hpMult: 1.1, speedMult: 1.05 },
  { monsters: 8,  hpMult: 1.2, speedMult: 1.1  },
  { monsters: 10, hpMult: 1.4, speedMult: 1.15 },
];

// ─── Progress Persistence ─────────────────────────────────────────────────────
// Held in memory and flushed on a timer — the game loop credits XP/coins on every
// kill, and a synchronous read+write of the whole file per kill would stall it.

let progressCache = null;
let progressDirty = false;

function progress() {
  if (!progressCache) {
    let loaded = null;
    try { loaded = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch {}
    progressCache = (loaded && typeof loaded === 'object') ? loaded : {};
  }
  const d = progressCache;
  if (!d.players)     d.players = {};
  if (!d.leaderboard) d.leaderboard = [];
  if (!d.skins)       d.skins = {};
  if (!d.weapons)     d.weapons = {};
  if (!d.coins)       d.coins = {};
  if (!d.upgrades)    d.upgrades = {};
  if (!d.ownedSkins)  d.ownedSkins = {};
  return d;
}
function markDirty() { progressDirty = true; }
function flushProgress() {
  if (!progressDirty || !progressCache) return;
  progressDirty = false;
  try { fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progressCache, null, 2)); }
  catch {}
}
setInterval(flushProgress, 2000).unref?.();
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { flushProgress(); process.exit(0); });
}
process.on('exit', flushProgress);

function addLeaderboardEntry(name, waves) {
  const d = progress();
  d.leaderboard.push({ name, waves, date: new Date().toISOString().split('T')[0] });
  d.leaderboard.sort((a, b) => b.waves - a.waves);
  d.leaderboard = d.leaderboard.slice(0, 10);
  markDirty();
  return d.leaderboard;
}
function getLeaderboard() { return progress().leaderboard; }

function getUnlockedWeaponIds(xp) {
  return WEAPONS.filter(w => w.unlockXp <= xp).map(w => w.id);
}

// Order a weapon-id list by their position in WEAPONS (stable, canonical order)
function sortWeaponIds(ids) {
  const valid = (Array.isArray(ids) ? ids : []).filter(id => WEAPON_BY_ID[id]);
  return Array.from(new Set(valid)).sort(
    (a, b) => WEAPONS.findIndex(w => w.id === a) - WEAPONS.findIndex(w => w.id === b)
  );
}

function checkNewUnlocks(oldXp, newXp) {
  const was = getUnlockedWeaponIds(oldXp);
  return getUnlockedWeaponIds(newXp).filter(id => !was.includes(id));
}

function sanitizeText(v, len) {
  return String(v == null ? '' : v).trim().replace(/[<>&"']/g, '').slice(0, len);
}

// Normalise a stored upgrade map to { weaponId: { dmg, spd, rng } } with sane levels.
function normalizeUpgrades(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [wid, lv] of Object.entries(raw)) {
    if (!WEAPON_BY_ID[wid] || !lv || typeof lv !== 'object') continue;
    const e = {};
    let any = false;
    for (const k of upgradesFor(wid)) {
      const n = Math.max(0, Math.min(UPGRADE_STATS[k].max, Math.floor(Number(lv[k]) || 0)));
      if (n > 0) { e[k] = n; any = true; }
    }
    if (any) out[wid] = e;
  }
  return out;
}

// ─── Weapon stats with upgrades applied ───────────────────────────────────────

function applyUpgrades(w, levels) {
  if (!levels) return w;
  const L = k => levels[k] || 0, per = k => UPGRADE_STATS[k].perLevel;
  const dmgM  = 1 + L('dmg') * per('dmg');
  const spdM  = 1 - L('spd') * per('spd');
  const rngM  = 1 + L('rng') * per('rng');
  const cdM   = spdM * (1 - L('cdr') * per('cdr'));
  const aoeM  = rngM * (1 + L('aoe') * per('aoe'));
  const chillM = 1 + L('chill') * per('chill');
  const multi = L('multi');
  const sp = w.special;
  return {
    ...w,
    damage: Math.max(1, Math.round(w.damage * dmgM)),
    range: Math.round(w.range * rngM),
    atkSpd: Math.max(70, Math.round(w.atkSpd * spdM)),
    aoeRadius: w.aoeRadius ? Math.round(w.aoeRadius * aoeM) : w.aoeRadius,
    crit: L('crit') * per('crit'),
    lifesteal: L('life') * per('life'),
    knock: L('knock') * per('knock'),
    multi,
    chill: w.chill ? Math.round(w.chill * chillM) : w.chill,
    chain: (w.chain || 0) + L('chain'),
    special: sp ? {
      ...sp,
      dmg: Math.max(1, Math.round(sp.dmg * dmgM)),
      // A slam's range is its blast radius, so BLAST widens it too.
      range: Math.round(sp.range * (sp.kind === 'slam' ? aoeM : rngM)),
      cd: Math.max(500, Math.round(sp.cd * cdM)),
      aoe: sp.aoe ? Math.round(sp.aoe * aoeM) : sp.aoe,
      chill: sp.chill ? Math.round(sp.chill * chillM) : sp.chill,
      count: sp.count ? sp.count + multi * (sp.kind === 'ring' ? 2 : 1) : sp.count,
    } : null,
  };
}

// Recompute (and cache) the player's effective weapon. Called whenever the
// selected weapon, the unlock list or the upgrade levels change.
function refreshWeapon(p) {
  if (!p) return;
  const ids = p.unlockedWeapons || [];
  if (p.weaponIdx >= ids.length) p.weaponIdx = 0;
  const base = WEAPON_BY_ID[ids[p.weaponIdx]] || WEAPONS[0];
  p.w_ = applyUpgrades(base, p.upgrades?.[base.id]);
}
function weapon(p) { return p.w_ || WEAPONS[0]; }

// ─── Room State ───────────────────────────────────────────────────────────────

function spawnPointFor(num) {
  return {
    x: num === 1 ? ARENA_X + 56 : ARENA_X + ARENA_W - 56 - PLAYER_W,
    y: ARENA_Y + Math.round(ARENA_H / 2) - PLAYER_H / 2,
  };
}

function makePlayer(num, xp, upgrades) {
  const sp = spawnPointFor(num);
  const p = {
    num,
    x: sp.x, y: sp.y,
    w: PLAYER_W, h: PLAYER_H,
    speed: PLAYER_SPEED,
    hp: 100, maxHp: 100,
    lives: 3,
    facing: num === 1 ? 1 : -1,
    weaponIdx: 0,
    unlockedWeapons: getUnlockedWeaponIds(xp),
    upgrades: upgrades || {},
    atkCooldown: 0,
    specialCooldown: 0,
    parryCooldown: 0,
    parryTimer: 0,
    swingTimer: 0,
    invincible: 0,
    hitFlash: 0,
    dead: false,
    respawnTimer: 0,
    skin: { colorIdx: 0, hatIdx: 0, outfit: '' },
    inventory: [],
    effects: {},
    pull: null,
  };
  refreshWeapon(p);
  return p;
}

function emptyWave() { return { num: 0, monstersLeft: 0, spawnQueue: 0, spawnTimer: 0, betweenTimer: 0 }; }

const room = {
  p1: null, p2: null,
  gameState: 'LOBBY',
  gameMode: 'pvp',
  playerNames: { p1: 'PLAYER 1', p2: 'PLAYER 2' },
  passwords: { p1: '', p2: '' },
  playerXp: { p1: 0, p2: 0 },
  playerCoins: { p1: 0, p2: 0 },
  playerSkins: { p1: null, p2: null },
  playerUnlocks: { p1: null, p2: null },
  playerUpgrades: { p1: null, p2: null },
  p1Joined: false, p2Joined: false,
  players: { p1: null, p2: null },
  inputs: {
    p1: { up: false, down: false, left: false, right: false, attack: false, swap: false, special: false, parry: false },
    p2: { up: false, down: false, left: false, right: false, attack: false, swap: false, special: false, parry: false },
  },
  monsters: [],
  projectiles: [],
  particles: [],
  traps: [],
  items: [],
  coins: [],
  seenTypes: new Set(),
  trapSpawnTimer: TRAP_SPAWN_MIN,
  itemSpawnTimer: ITEM_SPAWN_MIN,
  wave: emptyWave(),
  waveHpMult: 1,
  waveSpeedMult: 1,
  unlockQueues: { p1: [], p2: [] },
  round: { p1Wins: 0, p2Wins: 0, maxWins: 3, matchWinner: 0 },
  roundOverTimer: 0,
  lastLeaderboard: [],
  attackJustPressed: { p1: false, p2: false },
  swapJustPressed: { p1: false, p2: false },
  specialJustPressed: { p1: false, p2: false },
  parryJustPressed: { p1: false, p2: false },
  prevInputs: {
    p1: { attack: false, swap: false, special: false, parry: false },
    p2: { attack: false, swap: false, special: false, parry: false },
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

let idSeq = 0;
function nextId() { return (++idSeq).toString(36); }

function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x
      && a.y < b.y + b.h && a.y + a.h > b.y;
}

function cx(e) { return e.x + e.w / 2; }
function cy(e) { return e.y + e.h / 2; }
function distBetween(a, b) { return Math.hypot(cx(a) - cx(b), cy(a) - cy(b)); }

function clampToArena(e, pad = 1) {
  e.x = Math.max(ARENA_X + pad, Math.min(ARENA_X + ARENA_W - e.w - pad, e.x));
  e.y = Math.max(ARENA_Y + pad, Math.min(ARENA_Y + ARENA_H - e.h - pad, e.y));
}

function playerKeyOf(t) {
  return t === room.players.p1 ? 'p1' : t === room.players.p2 ? 'p2' : null;
}

// Everything `pKey` is allowed to hit. In co-op the other player is an ally, so
// they are neither a target nor an obstacle for attacks and auto-aim.
function enemyTargets(pKey) {
  const out = [];
  // Monster fire only ever threatens players — a spitter must not mow down the
  // pack it spawned with.
  if (pKey === 'monster') {
    for (const k of ['p1', 'p2']) {
      const p = room.players[k];
      if (p && !p.dead) out.push(p);
    }
    return out;
  }
  for (const k of ['p1', 'p2']) {
    if (k === pKey) continue;
    if (room.gameMode === 'coop' && (pKey === 'p1' || pKey === 'p2')) continue;
    const p = room.players[k];
    if (p && !p.dead) out.push(p);
  }
  for (const m of room.monsters) if (!m.dead) out.push(m);
  return out;
}

function spawnParrySpark(x, y) {
  room.particles.push({ type: 'parry', x, y, timer: 320, max: 320 });
}

// ── Player effects ──
function hasEffect(p, name) { return !!(p.effects && (p.effects[name] || 0) > 0); }
function applyEffect(p, name, dur) {
  if (!p.effects) p.effects = {};
  p.effects[name] = Math.max(p.effects[name] || 0, dur);
}
function effectiveSpeed(p) {
  let s = p.speed;
  if (hasEffect(p, 'speed')) s *= 1.7;
  if (hasEffect(p, 'slow'))  s *= 0.4;
  return s;
}

function tooCloseToPlayers(x, y, dist) {
  for (const key of ['p1', 'p2']) {
    const p = room.players[key];
    if (p && !p.dead && Math.hypot(cx(p) - x, cy(p) - y) < dist) return true;
  }
  return false;
}

// A random spot fully inside the arena floor for an object of the given size.
function randArenaPos(w, h, inset = 6) {
  const minX = ARENA_X + inset, maxX = ARENA_X + ARENA_W - w - inset;
  const minY = ARENA_Y + inset, maxY = ARENA_Y + ARENA_H - h - inset;
  return {
    x: minX + Math.random() * Math.max(0, maxX - minX),
    y: minY + Math.random() * Math.max(0, maxY - minY),
  };
}

// Keep spawned pickups/hazards from overlapping each other.
function overlapsAny(list, box, pad = 4) {
  const grown = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
  return list.some(o => aabb(grown, o));
}

// ── Traps ──
function spawnTrap() {
  const types = Object.keys(TRAP_TYPES);
  const type = types[Math.floor(Math.random() * types.length)];
  const def = TRAP_TYPES[type];
  const size = def.size;
  let pos = randArenaPos(size, size);
  for (let i = 0; i < 16; i++) {
    pos = randArenaPos(size, size);
    const box = { x: pos.x, y: pos.y, w: size, h: size };
    if (!tooCloseToPlayers(pos.x + size / 2, pos.y + size / 2, def.radius + 40)
        && !overlapsAny(room.traps, box, 10) && !overlapsAny(room.items, box, 6)) break;
  }
  room.traps.push({
    id: nextId(),
    type, x: pos.x, y: pos.y, w: size, h: size,
    state: 'idle', armTimer: 0, fireTimer: 0,
    mode: def.mode, radius: def.radius, damage: def.damage || 0,
    effect: def.effect || null, dur: def.dur || 0, color: def.color,
  });
}

function fireTrap(tr) {
  tr.state = 'firing';
  tr.fireTimer = 280;
  const tx = tr.x + tr.w / 2, ty = tr.y + tr.h / 2;
  const targets = [room.players.p1, room.players.p2, ...room.monsters].filter(t => t && !t.dead);
  for (const t of targets) {
    if (Math.hypot(cx(t) - tx, cy(t) - ty) <= tr.radius) {
      if (tr.effect === 'slow') {
        if (t.num) applyEffect(t, 'slow', tr.dur);
        else t.slowTimer = Math.max(t.slowTimer || 0, tr.dur);
      } else {
        applyDamage(t, tr.damage, 'trap');
      }
    }
  }
  room.particles.push({ type: 'trapburst', x: tx, y: ty, maxR: tr.radius, timer: 340, max: 340, color: tr.color });
}

// ── Items ──
function spawnItem() {
  const types = Object.keys(ITEM_TYPES);
  const type = types[Math.floor(Math.random() * types.length)];
  let pos = randArenaPos(ITEM_SIZE, ITEM_SIZE);
  for (let i = 0; i < 16; i++) {
    pos = randArenaPos(ITEM_SIZE, ITEM_SIZE);
    const box = { x: pos.x, y: pos.y, w: ITEM_SIZE, h: ITEM_SIZE };
    if (!tooCloseToPlayers(pos.x + ITEM_SIZE / 2, pos.y + ITEM_SIZE / 2, 60)
        && !overlapsAny(room.traps, box, 12) && !overlapsAny(room.items, box, 8)) break;
  }
  room.items.push({ id: nextId(), type, x: pos.x, y: pos.y, w: ITEM_SIZE, h: ITEM_SIZE });
}

// ── Coins ──
function coinsForKill(target, isPlayer) {
  if (isPlayer) return 10;
  const def = MONSTER_TYPES[target.type] || MONSTER_TYPES.grunt;
  return Math.max(1, Math.round((2 + Math.floor((target.maxHp || 30) / 30)) * (def.coins || 1)));
}

function dropCoins(x, y, total) {
  const n = Math.min(MAX_COIN_DROPS, Math.max(1, total));
  const per = Math.floor(total / n), extra = total - per * n;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 0.6 + Math.random() * 1.1;
    room.coins.push({
      id: nextId(),
      x: x - COIN_SIZE / 2, y: y - COIN_SIZE / 2,
      w: COIN_SIZE, h: COIN_SIZE,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      value: per + (i < extra ? 1 : 0),
      life: COIN_LIFETIME,
    });
  }
  if (room.coins.length > MAX_COINS_ON_FLOOR) {
    room.coins.splice(0, room.coins.length - MAX_COINS_ON_FLOOR);
  }
}

function addCoins(pKey, amount) {
  if (amount <= 0) return;
  room.playerCoins[pKey] = (room.playerCoins[pKey] || 0) + amount;
  const pw = room.passwords[pKey];
  if (pw && !isAdminPw(pw)) {
    progress().coins[pw] = room.playerCoins[pKey];
    markDirty();
  }
}

function broadcast(msg) {
  const str = JSON.stringify(msg);
  if (room.p1 && room.p1.readyState === 1) room.p1.send(str);
  if (room.p2 && room.p2.readyState === 1) room.p2.send(str);
}

function spawnMonster() {
  const type = pickMonsterType(room.wave.num);
  const def = MONSTER_TYPES[type];

  // Call out a type the first time it appears in this run.
  if (!room.seenTypes.has(type)) {
    room.seenTypes.add(type);
    if (room.wave.num > 1) {
      room.particles.push({
        type: 'newtype', x: CANVAS_W / 2, y: CANVAS_H / 2 + 26,
        text: def.name + 'S INCOMING', color: def.color, timer: 2200, max: 2200,
      });
    }
  }

  // Base health grows with the wave config multiplier and the wave reached, then
  // the type's own multiplier is applied on top.
  const waveBonus = 1 + Math.max(0, room.wave.num - 1) * 0.12;
  const hp = Math.max(1, Math.round(30 * room.waveHpMult * waveBonus * def.hp));

  // Bulk follows health, but on a flattening curve inside hard limits: deep waves
  // should still read as their type rather than filling the arena, so growth tops
  // out at 1.7x and the type's own shape factor does the rest.
  const baseHp = hp / def.hp;                                     // this wave's baseline
  const waveGrowth = Math.min(1.7, Math.pow(Math.max(1, baseHp / 30), 0.28));
  const sizeScale = Math.max(0.6, Math.min(2.7, def.size * waveGrowth));
  const w = Math.max(9, Math.round(MONSTER_BASE_W * sizeScale));
  const h = Math.max(11, Math.round(MONSTER_BASE_H * sizeScale));

  // Damage follows the same shape — bulk, then type, then a slow wave ramp — and
  // is capped so even a late behemoth cannot one-shot a full-health player.
  const waveDmg = Math.min(1.8, 1 + Math.max(0, room.wave.num - 1) * 0.025);
  const atkDamage = Math.max(1, Math.min(45,
    Math.round(8 * (1 + (sizeScale - 1) * 0.7) * def.dmg * waveDmg)));

  // Spawn on a wall, fully inside the floor, and not on top of a player.
  const minX = ARENA_X + 2, maxX = ARENA_X + ARENA_W - w - 2;
  const minY = ARENA_Y + 2, maxY = ARENA_Y + ARENA_H - h - 2;
  const rand = (a, b) => a + Math.random() * Math.max(0, b - a);
  let mx = minX, my = minY;
  const startEdge = Math.floor(Math.random() * 4);
  for (let tries = 0; tries < 12; tries++) {
    const edge = (startEdge + tries) % 4;
    if (edge === 0)      { mx = rand(minX, maxX); my = minY; }
    else if (edge === 1) { mx = rand(minX, maxX); my = maxY; }
    else if (edge === 2) { mx = minX;             my = rand(minY, maxY); }
    else                 { mx = maxX;             my = rand(minY, maxY); }
    if (!tooCloseToPlayers(mx + w / 2, my + h / 2, 100)) break;
  }

  room.monsters.push({
    id: nextId(),
    type,
    x: mx, y: my, w, h,
    hp, maxHp: hp,
    // Bigger is slower, then the type's own pace on top.
    speed: (0.72 / (1 + (sizeScale - 1) * 0.35)) * def.speed * room.waveSpeedMult,
    atkCooldown: 0,
    // Cosmetic only: which way the monster holds its weapon, and how far into an
    // attack animation it is (ms left), so clients can draw the swing.
    face: 1,
    swing: 0,
    atkRange: def.ranged ? def.shotRange : 8 + w * 0.5,
    atkDamage,
    armor: def.armor || 0,
    ranged: !!def.ranged,
    hitFlash: 0,
    invincible: 0,
    slowTimer: 0,
    pull: null,
    dead: false,
  });
}

// A spitter keeps its distance and lobs corrosive shots instead of closing in.
function monsterShoot(m, target) {
  const def = MONSTER_TYPES[m.type];
  const ang = Math.atan2(cy(target) - cy(m), cx(target) - cx(m));
  const sp = def.shotSpeed || 3.4;
  room.projectiles.push({
    id: nextId(),
    x: cx(m), y: cy(m),
    dx: Math.cos(ang) * sp,
    dy: Math.sin(ang) * sp,
    damage: m.atkDamage,
    owner: 'monster',
    traveled: 0,
    maxRange: def.shotRange || 210,
    weaponId: 'spit',
    isAoe: false, aoeRadius: 0,
    pierce: false, grapple: false, boomerang: false, teleport: false,
    returning: false, life: 0, hitTargets: null,
  });
}

function startWave(num) {
  let cfg;
  if (num > WAVE_CONFIG.length) {
    const extra = num - WAVE_CONFIG.length;
    const base  = WAVE_CONFIG[WAVE_CONFIG.length - 1];
    cfg = {
      monsters:   Math.min(base.monsters + Math.floor(extra * 0.7), 28),
      hpMult:     base.hpMult    * (1 + extra * 0.15),
      speedMult:  Math.min(base.speedMult * (1 + extra * 0.04), 2.8),
    };
  } else {
    cfg = WAVE_CONFIG[num - 1];
  }
  room.wave = { num, monstersLeft: cfg.monsters, spawnQueue: cfg.monsters, spawnTimer: 500, betweenTimer: 0 };
  room.waveHpMult    = cfg.hpMult;
  room.waveSpeedMult = cfg.speedMult;
}

function clearField() {
  room.seenTypes   = new Set();
  room.monsters    = [];
  room.projectiles = [];
  room.particles   = [];
  room.traps       = [];
  room.items       = [];
  room.coins       = [];
  room.trapSpawnTimer = TRAP_SPAWN_MIN;
  room.itemSpawnTimer = ITEM_SPAWN_MIN;
}

function startGame() {
  if (room.round.matchWinner) room.round = { p1Wins: 0, p2Wins: 0, maxWins: 3, matchWinner: 0 };
  room.players.p1 = makePlayer(1, room.playerXp.p1, room.playerUpgrades.p1);
  room.players.p2 = (room.gameMode !== 'waves') ? makePlayer(2, room.playerXp.p2, room.playerUpgrades.p2) : null;
  for (const key of ['p1', 'p2']) {
    const p = room.players[key];
    if (!p) continue;
    if (room.playerSkins[key])   p.skin = room.playerSkins[key];
    if (room.playerUnlocks[key]) p.unlockedWeapons = room.playerUnlocks[key];
    refreshWeapon(p);
  }
  clearField();
  room.unlockQueues = { p1: [], p2: [] };
  room.wave = emptyWave();
  room.gameState = 'GAMEPLAY';
  if (room.gameMode !== 'pvp') startWave(START_WAVE);
}

function resetToLobby() {
  room.gameState = 'LOBBY';
  room.players = { p1: null, p2: null };
  room.wave = emptyWave();
  room.round = { p1Wins: 0, p2Wins: 0, maxWins: 3, matchWinner: 0 };
  room.roundOverTimer = 0;
  room.unlockQueues = { p1: [], p2: [] };
  clearField();
}

function applyDamage(target, dmg, attackerKey) {
  if (target.dead || target.invincible > 0) return;
  if (target.num && hasEffect(target, 'shield')) {  // shield item: ignore all incoming damage
    target.hitFlash = 80;
    return;
  }
  if (room.gameMode === 'coop' && target.num && (attackerKey === 'p1' || attackerKey === 'p2')) return;
  // Weapon upgrades on the attacking player: critical hits, lifesteal, knockback.
  const atk = (attackerKey === 'p1' || attackerKey === 'p2') ? room.players[attackerKey] : null;
  const aw = atk && atk !== target ? weapon(atk) : null;
  if (aw && aw.crit && Math.random() < aw.crit) {
    dmg *= 2;
    room.particles.push({ type: 'crit', x: cx(target), y: target.y - 4, text: 'CRIT', timer: 600, max: 600 });
  }
  // Armoured monsters shrug off a share of every hit, but never all of it.
  if (target.armor) dmg = Math.max(1, Math.round(dmg * (1 - target.armor)));
  target.hp -= dmg;
  if (aw && aw.lifesteal && !atk.dead) {
    const heal = Math.round(dmg * aw.lifesteal);
    if (heal > 0) atk.hp = Math.min(atk.maxHp, atk.hp + heal);
  }
  if (aw && aw.knock && target.hp > 0) {
    const dx = cx(target) - cx(atk), dy = cy(target) - cy(atk), d = Math.hypot(dx, dy) || 1;
    target.x += (dx / d) * aw.knock;
    target.y += (dy / d) * aw.knock;
    clampToArena(target);
  }
  target.hitFlash  = 200;
  target.invincible = target.num ? 500 : 300;
  if (target.hp <= 0) handleKill(target, attackerKey);
}

function handleKill(target, attackerKey) {
  const isPlayer = !!target.num;
  let baseGain = isPlayer ? 15 : 6;
  // Bigger (tankier) monsters reward more XP, scaled by their max HP over the base
  // 30, then again by how dangerous their type is.
  if (!isPlayer) {
    const def = MONSTER_TYPES[target.type] || MONSTER_TYPES.grunt;
    baseGain = Math.round(baseGain * Math.max(1, (target.maxHp || 30) / 30) * (def.xp || 1));
  }
  const xpGain = room.gameMode === 'waves' ? baseGain * 2 : baseGain;

  // Credit XP to attacking player
  if (attackerKey === 'p1' || attackerKey === 'p2') {
    const attacker = room.players[attackerKey];
    const pw = room.passwords[attackerKey];
    const admin = isAdminPw(pw);
    const oldXp = room.playerXp[attackerKey];
    room.playerXp[attackerKey] += xpGain;

    const newUnlocks = checkNewUnlocks(oldXp, room.playerXp[attackerKey]);
    room.unlockQueues[attackerKey].push(...newUnlocks);
    const merged = sortWeaponIds([
      ...(attacker?.unlockedWeapons || []),
      ...getUnlockedWeaponIds(room.playerXp[attackerKey]),
    ]);
    if (attacker) { attacker.unlockedWeapons = merged; refreshWeapon(attacker); }
    room.playerUnlocks[attackerKey] = merged;

    if (pw && !admin) {
      const d = progress();
      d.players[pw] = room.playerXp[attackerKey];
      d.weapons[pw] = merged;
      markDirty();
    }
  }

  // Only float the XP number when a player actually banked it — a trap or a
  // monster finishing something off earns nobody anything.
  if (attackerKey === 'p1' || attackerKey === 'p2') {
    room.particles.push({
      type: 'xp', x: cx(target), y: target.y,
      text: '+' + xpGain, timer: 900,
    });
  }

  // Coins drop on the floor for anyone to pick up. Dying to a monster or a trap
  // drops nothing — otherwise you could farm coins off your own deaths.
  const killedByRival = attackerKey === 'p1' || attackerKey === 'p2';
  if (!isPlayer || killedByRival) {
    dropCoins(cx(target), cy(target), coinsForKill(target, isPlayer));
  }

  if (isPlayer) {
    target.dead = true;
    target.pull = null;
    target.lives--;
    target.hp = 0;
    if (target.lives > 0) target.respawnTimer = 2000;
  } else {
    target.dead = true;
    room.monsters = room.monsters.filter(m => m !== target);
    room.wave.monstersLeft--;
  }
}

function respawnPlayer(p) {
  const sp = spawnPointFor(p.num);
  p.hp = p.maxHp;
  p.x  = sp.x;
  p.y  = sp.y;
  p.dead = false;
  p.pull = null;
  p.invincible = 2000;
  p.hitFlash   = 0;
}

function checkRoundEnd() {
  const p1 = room.players.p1;
  const p2 = room.players.p2;

  if (room.gameMode === 'waves') {
    if (p1 && p1.dead && p1.lives <= 0) {
      room.lastLeaderboard = addLeaderboardEntry(room.playerNames.p1, room.wave.num);
      room.gameState      = 'ROUND_OVER';
      room.roundOverTimer = 6000;
    }
    return;
  }

  if (room.gameMode === 'coop') {
    const p1Out = !p1 || (p1.dead && p1.lives <= 0);
    const p2Out = !p2 || (p2.dead && p2.lives <= 0);
    if (p1Out && p2Out) { room.gameState = 'ROUND_OVER'; room.roundOverTimer = 4000; }
  } else {
    if (!p1 || !p2) return;
    const p1Out = p1.dead && p1.lives <= 0;
    const p2Out = p2.dead && p2.lives <= 0;
    if (p1Out || p2Out) {
      // A double knock-out is a draw — neither side banks a win.
      if (p2Out && !p1Out) room.round.p1Wins++;
      if (p1Out && !p2Out) room.round.p2Wins++;
      // First to maxWins takes the match; the next round starts a fresh tally.
      const { p1Wins, p2Wins, maxWins } = room.round;
      room.round.matchWinner = p1Wins >= maxWins ? 1 : p2Wins >= maxWins ? 2 : 0;
      room.gameState      = 'ROUND_OVER';
      room.roundOverTimer = room.round.matchWinner ? 6000 : 4000;
    }
  }
}

// ─── Game Loop ────────────────────────────────────────────────────────────────

// setInterval never fires exactly on time — on Windows a 20 ms timer really lands
// every ~28 ms — so the loop is driven by the wall clock. Assuming a fixed TICK_MS
// made the whole game run in slow motion wherever the timer was coarse.
let lastTickAt = Date.now();

setInterval(() => {
  const nowMs = Date.now();
  const dt = Math.max(1, Math.min(80, nowMs - lastTickAt));
  lastTickAt = nowMs;

  if (room.gameState !== 'GAMEPLAY') {
    if (room.gameState === 'ROUND_OVER') {
      room.roundOverTimer -= dt;
      if (room.roundOverTimer <= 0) {
        const hasUnlocks = room.unlockQueues.p1.length > 0 ||
                           (room.gameMode !== 'waves' && room.unlockQueues.p2.length > 0);
        if (hasUnlocks) {
          room.gameState = 'WEAPON_UNLOCK';
        } else if (room.gameMode === 'waves') {
          endWavesRun();
        } else {
          startGame();
        }
      }
    }
    broadcastState();
    return;
  }

  const factor = dt / 16.67;

  // Detect just-pressed for attack/swap
  for (const key of ['p1', 'p2']) {
    const inp  = room.inputs[key];
    const prev = room.prevInputs[key];
    room.attackJustPressed[key]  = inp.attack  && !prev.attack;
    room.swapJustPressed[key]    = inp.swap    && !prev.swap;
    room.specialJustPressed[key] = inp.special && !prev.special;
    room.parryJustPressed[key]   = inp.parry   && !prev.parry;
    room.prevInputs[key] = { attack: inp.attack, swap: inp.swap, special: inp.special, parry: inp.parry };
  }

  // ── Move players ──
  for (const key of ['p1', 'p2']) {
    const p = room.players[key];
    if (!p || p.dead) {
      if (p && p.respawnTimer > 0) {
        p.respawnTimer -= dt;
        if (p.respawnTimer <= 0) respawnPlayer(p);
      }
      continue;
    }
    const inp = room.inputs[key];
    const spd = effectiveSpeed(p);
    let vx = 0, vy = 0;
    if (inp.left)  { vx = -spd; p.facing = -1; }
    if (inp.right) { vx =  spd; p.facing =  1; }
    if (inp.up)    vy = -spd;
    if (inp.down)  vy =  spd;
    if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }

    p.x += vx * factor;
    p.y += vy * factor;
    applyPull(p, dt);
    clampToArena(p, 2);

    // Decrement active effects
    if (p.effects) for (const k in p.effects) { p.effects[k] -= dt; if (p.effects[k] <= 0) delete p.effects[k]; }

    if (p.atkCooldown     > 0) p.atkCooldown     -= dt;
    if (p.specialCooldown > 0) p.specialCooldown -= dt;
    if (p.parryCooldown   > 0) p.parryCooldown   -= dt;
    if (p.parryTimer      > 0) p.parryTimer      -= dt;
    if (p.invincible      > 0) p.invincible      -= dt;
    if (p.hitFlash        > 0) p.hitFlash        -= dt;
    if (p.swingTimer      > 0) p.swingTimer      -= dt;

    if (room.swapJustPressed[key] && p.unlockedWeapons.length > 0) {
      p.weaponIdx = (p.weaponIdx + 1) % p.unlockedWeapons.length;
      refreshWeapon(p);
    }
    if (room.attackJustPressed[key] && p.atkCooldown <= 0) {
      doAttack(p, key);
    }
    if (room.specialJustPressed[key] && p.specialCooldown <= 0) {
      doSpecial(p, key);
    }
    if (room.parryJustPressed[key] && p.parryCooldown <= 0) {
      p.parryTimer    = PARRY_WINDOW;
      p.parryCooldown = PARRY_COOLDOWN;
      spawnParrySpark(cx(p), cy(p));
    }
  }

  // ── Monsters ──
  // Snapshot: a kill during this pass replaces room.monsters mid-iteration.
  for (const m of room.monsters.slice()) {
    if (m.dead) continue;
    let nearest = null, bestDist = Infinity;
    for (const p of [room.players.p1, room.players.p2]) {
      if (!p || p.dead) continue;
      const d = distBetween(p, m);
      if (d < bestDist) { bestDist = d; nearest = p; }
    }

    if (m.slowTimer > 0) m.slowTimer -= dt;
    if (m.atkCooldown > 0) m.atkCooldown -= dt;
    if (m.hitFlash    > 0) m.hitFlash    -= dt;
    if (m.invincible  > 0) m.invincible  -= dt;
    if (m.swing       > 0) m.swing       -= dt;

    if (nearest) {
      const def = MONSTER_TYPES[m.type] || MONSTER_TYPES.grunt;
      const dx = cx(nearest) - cx(m), dy = cy(nearest) - cy(m);
      const dist = Math.hypot(dx, dy) || 1;
      if (Math.abs(dx) > 2) m.face = dx > 0 ? 1 : -1;
      const spd = m.speed * (m.slowTimer > 0 ? 0.4 : 1);

      if (m.ranged) {
        // Hold a firing line: close if out of range, back off if crowded.
        const want = m.atkRange * 0.7;
        if (dist > want)            { m.x += (dx / dist) * spd * factor;       m.y += (dy / dist) * spd * factor; }
        else if (dist < want * 0.6) { m.x -= (dx / dist) * spd * 0.8 * factor; m.y -= (dy / dist) * spd * 0.8 * factor; }
        if (dist <= m.atkRange && m.atkCooldown <= 0) {
          monsterShoot(m, nearest);
          m.atkCooldown = def.reload || 2000;
          m.swing = MONSTER_SWING_MS;
        }
      } else {
        const reach = m.atkRange + (nearest.w + nearest.h) / 4;
        if (dist > reach) {
          m.x += (dx / dist) * spd * factor;
          m.y += (dy / dist) * spd * factor;
        }
        if (dist <= reach + 4 && m.atkCooldown <= 0) {
          if (nearest.parryTimer > 0) {
            // Parried: reflect the blow back onto the monster
            applyDamage(m, Math.round(m.atkDamage * PARRY_REFLECT) + 10, playerKeyOf(nearest));
            spawnParrySpark(cx(nearest), cy(nearest));
          } else {
            applyDamage(nearest, m.atkDamage, 'monster');
          }
          m.atkCooldown = 1200;
          m.swing = MONSTER_SWING_MS;
        }
      }
    }

    applyPull(m, dt);
    clampToArena(m);
  }
  separateMonsters(factor);

  // ── Projectiles ──
  room.projectiles = room.projectiles.filter(proj => updateProjectile(proj, factor, dt));

  // ── Wave spawner ──
  if (room.gameMode !== 'pvp') {
    if (room.wave.betweenTimer > 0) {
      room.wave.betweenTimer -= dt;
      if (room.wave.betweenTimer <= 0) startWave(room.wave.num + 1);
    } else if (room.wave.spawnQueue > 0) {
      room.wave.spawnTimer -= dt;
      if (room.wave.spawnTimer <= 0) {
        spawnMonster();
        room.wave.spawnQueue--;
        room.wave.spawnTimer = 1000;
      }
    } else if (room.wave.monstersLeft <= 0 && room.monsters.length === 0) {
      room.wave.betweenTimer = 3000;
      room.particles.push({
        type: 'waveclear', x: CANVAS_W / 2, y: CANVAS_H / 2 - 10,
        text: 'WAVE ' + room.wave.num + ' CLEAR!', timer: 2500,
      });
    }
  }

  // ── Traps ──
  room.trapSpawnTimer -= dt;
  if (room.trapSpawnTimer <= 0) {
    if (room.traps.length < MAX_TRAPS) spawnTrap();
    room.trapSpawnTimer = TRAP_SPAWN_MIN + Math.random() * (TRAP_SPAWN_MAX - TRAP_SPAWN_MIN);
  }
  room.traps = room.traps.filter(tr => {
    if (tr.state === 'idle') {
      for (const key of ['p1', 'p2']) {
        const p = room.players[key];
        if (p && !p.dead && aabb(p, tr)) {
          if (tr.mode === 'instant') fireTrap(tr);
          else { tr.state = 'arming'; tr.armTimer = TRAP_TYPES[tr.type].armTime; }
          break;
        }
      }
    } else if (tr.state === 'arming') {
      tr.armTimer -= dt;
      if (tr.armTimer <= 0) fireTrap(tr);
    } else if (tr.state === 'firing') {
      tr.fireTimer -= dt;
      if (tr.fireTimer <= 0) return false;
    }
    return true;
  });

  // ── Items ──
  room.itemSpawnTimer -= dt;
  if (room.itemSpawnTimer <= 0) {
    if (room.items.length < MAX_ITEMS) spawnItem();
    room.itemSpawnTimer = ITEM_SPAWN_MIN + Math.random() * (ITEM_SPAWN_MAX - ITEM_SPAWN_MIN);
  }
  room.items = room.items.filter(it => {
    for (const key of ['p1', 'p2']) {
      const p = room.players[key];
      if (p && !p.dead && aabb(p, it) && p.inventory.length < MAX_INVENTORY) {
        p.inventory.push(it.type);
        room.particles.push({ type: 'pickup', x: cx(it), y: it.y, timer: 600, max: 600, color: ITEM_TYPES[it.type].color });
        return false;
      }
    }
    return true;
  });

  // ── Coins ──
  room.coins = room.coins.filter(c => {
    // Drift toward the nearest player, so a kill made at bow range isn't a chore
    // to collect, then snap in once close enough.
    let near = null, nearKey = null, nearDist = Infinity;
    for (const key of ['p1', 'p2']) {
      const p = room.players[key];
      if (!p || p.dead) continue;
      const d = Math.hypot(cx(p) - cx(c), cy(p) - cy(c));
      if (d < nearDist) { nearDist = d; near = p; nearKey = key; }
    }
    if (near && nearDist <= COIN_MAGNET) {
      addCoins(nearKey, c.value);
      room.particles.push({ type: 'coin', x: cx(c), y: cy(c), text: '+' + c.value, timer: 700, max: 700 });
      return false;
    }
    if (near && nearDist > 0.01) {
      // Close by they snap in; after a few seconds on the floor they drift in from
      // anywhere, so killing at bow range doesn't forfeit the reward.
      const settled = COIN_LIFETIME - c.life > 2500;
      if (nearDist < COIN_ATTRACT || settled) {
        const pull = 0.35 * Math.max(settled ? 0.2 : 0, 1 - nearDist / COIN_ATTRACT);
        c.vx += ((cx(near) - cx(c)) / nearDist) * pull;
        c.vy += ((cy(near) - cy(c)) / nearDist) * pull;
      }
    }
    c.x += c.vx * factor;
    c.y += c.vy * factor;
    c.vx *= 0.90; c.vy *= 0.90;
    clampToArena(c, 2);
    c.life -= dt;
    return c.life > 0;
  });

  // ── Particles ──
  room.particles = room.particles.filter(p => { p.timer -= dt; return p.timer > 0; });

  checkRoundEnd();
  broadcastState();
}, TICK_MS);

// Nudge overlapping monsters apart so a wave doesn't collapse into one blob.
function separateMonsters(factor) {
  const ms = room.monsters;
  for (let i = 0; i < ms.length; i++) {
    for (let j = i + 1; j < ms.length; j++) {
      const a = ms[i], b = ms[j];
      const minDist = (a.w + b.w) / 2 + 1;
      let dx = cx(b) - cx(a), dy = cy(b) - cy(a);
      let d = Math.hypot(dx, dy);
      if (d >= minDist) continue;
      if (d < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = 0.5; }
      const push = ((minDist - d) / 2) * 0.35 * factor;
      const ux = dx / d, uy = dy / d;
      a.x -= ux * push; a.y -= uy * push;
      b.x += ux * push; b.y += uy * push;
      clampToArena(a); clampToArena(b);
    }
  }
}

// Grapple pull: a short, smooth drag toward whoever hooked you. Velocity is per
// millisecond so the drag covers the same ground whatever the tick rate.
const PULL_MS = 320;
function applyPull(e, dt) {
  if (!e.pull) return;
  const step = Math.min(dt, e.pull.timer);
  e.x += e.pull.vx * step;
  e.y += e.pull.vy * step;
  e.pull.timer -= dt;
  if (e.pull.timer <= 0) e.pull = null;
}

function startPull(target, ownerKey) {
  const o = room.players[ownerKey];
  if (!o || o.dead) return;
  const tx = cx(target), ty = cy(target);
  const ox = cx(o), oy = cy(o);
  const d = Math.hypot(ox - tx, oy - ty) || 1;
  const travel = Math.max(0, d - (o.w + target.w) / 2 - 8);
  target.pull = {
    vx: ((ox - tx) / d) * (travel / PULL_MS),
    vy: ((oy - ty) / d) * (travel / PULL_MS),
    timer: PULL_MS,
    from: ownerKey,
  };
}

// ─── Projectiles ──────────────────────────────────────────────────────────────

// Fast projectiles (the grapple hook moves ~17 units a tick) would tunnel
// straight through a small monster, so long steps are split into short ones.
function updateProjectile(proj, factor, dt) {
  const stepLen = Math.hypot(proj.dx, proj.dy) * factor;
  const subs = Math.max(1, Math.ceil(stepLen / 5));
  for (let i = 0; i < subs; i++) {
    if (!advanceProjectile(proj, factor / subs, dt / subs)) return false;
  }
  return true;
}

function advanceProjectile(proj, factor, dt) {
  const step = Math.hypot(proj.dx, proj.dy) * factor;
  proj.x += proj.dx * factor;
  proj.y += proj.dy * factor;
  proj.traveled += step;

  const outX = proj.x < ARENA_X || proj.x > ARENA_X + ARENA_W;
  const outY = proj.y < ARENA_Y || proj.y > ARENA_Y + ARENA_H;

  if (outX || outY) {
    if (proj.boomerang && !proj.returning) {
      // Bounce off the walls instead of dying.
      if (outX) proj.dx = -proj.dx;
      if (outY) proj.dy = -proj.dy;
      proj.x = Math.max(ARENA_X + 1, Math.min(ARENA_X + ARENA_W - 1, proj.x));
      proj.y = Math.max(ARENA_Y + 1, Math.min(ARENA_Y + ARENA_H - 1, proj.y));
    } else {
      const hx = Math.max(ARENA_X + 2, Math.min(ARENA_X + ARENA_W - 2, proj.x));
      const hy = Math.max(ARENA_Y + 2, Math.min(ARENA_Y + ARENA_H - 2, proj.y));
      if (proj.isAoe) detonateAoe(proj);
      if (proj.teleport) doHookTeleport(proj, hx, hy);
      return false;
    }
  }

  if (proj.boomerang) {
    proj.recycle = (proj.recycle || 0) + dt;
    if (proj.recycle > 320 && proj.hitTargets) { proj.hitTargets.clear(); proj.recycle = 0; }
    if (!proj.returning && proj.traveled >= proj.maxRange) {
      proj.returning = true;
      if (proj.hitTargets) proj.hitTargets.clear();
    }
    if (proj.returning) {
      // Home back to the thrower; vanish once it's caught.
      const o = room.players[proj.owner];
      if (!o || o.dead) return false;
      const dx = cx(o) - proj.x, dy = cy(o) - proj.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 12) return false;
      const sp = Math.hypot(proj.dx, proj.dy) || 1;
      proj.dx = (dx / d) * sp;
      proj.dy = (dy / d) * sp;
      proj.life = (proj.life ?? 4000) - dt;
      if (proj.life <= 0) return false;
    }
  } else if (proj.traveled >= proj.maxRange) {
    if (proj.isAoe) detonateAoe(proj);
    if (proj.teleport) doHookTeleport(proj, proj.x, proj.y);
    return false;
  }

  const hitBox = { x: proj.x - 4, y: proj.y - 4, w: 8, h: 8 };
  for (const t of enemyTargets(proj.owner)) {
    if (!aabb(hitBox, t)) continue;
    const tk = playerKeyOf(t);
    if (tk && t.parryTimer > 0) {
      // Parried: bounce the projectile back at its owner
      proj.dx = -proj.dx; proj.dy = -proj.dy;
      proj.owner = tk;
      proj.traveled = 0;
      proj.returning = false;
      proj.damage = Math.round(proj.damage * PARRY_REFLECT);
      // A deflected hook is just a projectile now — it reels nobody in and
      // teleports nobody, so it should stop drawing a chain too.
      proj.grapple = false;
      proj.teleport = false;
      proj.hook = false;
      if (proj.hitTargets) proj.hitTargets.clear();
      spawnParrySpark(proj.x, proj.y);
      return true;
    }
    if (proj.teleport) {
      applyDamage(t, proj.damage, proj.owner);
      doHookTeleport(proj, proj.x, proj.y);
      return false;
    }
    if (proj.isAoe) {
      detonateAoe(proj);
      return false;
    }
    if (proj.grapple) {
      applyDamage(t, proj.damage, proj.owner);
      startPull(t, proj.owner);
      room.particles.push({ type: 'hookhit', x: proj.x, y: proj.y, timer: 300, max: 300, color: WEAPON_COLORS.grapple });
      return false;
    }
    if (proj.pierce) {
      const tId = tk || t.id;
      if (proj.hitTargets && !proj.hitTargets.has(tId)) {
        proj.hitTargets.add(tId);
        applyDamage(t, proj.damage, proj.owner);
        onHitExtras(proj, t);
      }
      continue;
    }
    applyDamage(t, proj.damage, proj.owner);
    onHitExtras(proj, t);
    return false;
  }
  return true;
}

function doHookTeleport(proj, hitX, hitY) {
  const o = room.players[proj.owner];
  if (!o || o.dead) return;
  const from = { x: cx(o), y: cy(o) };
  o.x = hitX - o.w / 2;
  o.y = hitY - o.h / 2;
  clampToArena(o, 2);
  o.pull = null;
  room.particles.push({ type: 'teleport', x: from.x, y: from.y, timer: 340, max: 340, color: WEAPON_COLORS.grapple });
  room.particles.push({ type: 'teleport', x: cx(o), y: cy(o), timer: 340, max: 340, color: '#ffffff' });
}

function detonateAoe(proj) {
  for (const t of enemyTargets(proj.owner)) {
    if (Math.hypot(cx(t) - proj.x, cy(t) - proj.y) < proj.aoeRadius) {
      applyDamage(t, proj.damage, proj.owner);
      if (proj.chill) chillTarget(t, proj.chill);
    }
  }
  room.particles.push({
    type: 'aoe', x: proj.x, y: proj.y, maxR: proj.aoeRadius,
    radius: 2, timer: 320, max: 320,
    color: proj.chill ? '#8fe0ff' : (WEAPON_COLORS[proj.weaponId] || '#aa44ff'),
  });
}

// Slow a target: monsters through their slow timer, players through the same
// 'slow' effect a snare trap applies.
function chillTarget(t, ms) {
  if (t.dead) return;
  if (t.num) applyEffect(t, 'slow', ms);
  else t.slowTimer = Math.max(t.slowTimer || 0, ms);
}

// A hit that ignores projectiles but still respects a parry: the parrying
// player is untouched and the blow goes back to the attacker instead.
function strikeTarget(t, dmg, ownerKey) {
  const tk = playerKeyOf(t);
  if (tk && t.parryTimer > 0) {
    const o = room.players[ownerKey];
    if (o) applyDamage(o, Math.round(dmg * PARRY_REFLECT), tk);
    spawnParrySpark(cx(t), cy(t));
    return;
  }
  applyDamage(t, dmg, ownerKey);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const L = dx * dx + dy * dy;
  const k = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - (ax + dx * k), py - (ay + dy * k));
}

// What a projectile does beyond its damage: frost slows, storm arcs onward.
function onHitExtras(proj, t) {
  if (proj.chill) chillTarget(t, proj.chill);
  if (proj.chain > 0) {
    const hit = new Set([t]);
    let from = t;
    const dmg = Math.max(1, Math.round(proj.damage * 0.7));
    for (let i = 0; i < proj.chain; i++) {
      let best = null, bd = 95;
      for (const e of enemyTargets(proj.owner)) {
        if (hit.has(e)) continue;
        const d = distBetween(from, e);
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) break;
      room.particles.push({ type: 'bolt', x: cx(from), y: cy(from), x2: cx(best), y2: cy(best),
                            timer: 220, max: 220, color: WEAPON_COLORS[proj.weaponId] || '#ffe45a' });
      strikeTarget(best, dmg, proj.owner);
      hit.add(best);
      from = best;
    }
  }
}

// ─── Attack Logic ─────────────────────────────────────────────────────────────

function doAttack(p, pKey) {
  const w = weapon(p);
  const dmgMult = hasEffect(p, 'strength') ? 1.8 : 1;
  const cdMult  = hasEffect(p, 'haste') ? 0.5 : 1;
  p.atkCooldown = w.atkSpd * cdMult;
  p.swingTimer  = Math.min(w.atkSpd, 200);

  if (w.type === 'melee') {
    for (const t of enemyTargets(pKey)) {
      if (distBetween(t, p) <= w.range) {
        const tk = playerKeyOf(t);
        if (tk && t.parryTimer > 0) {
          // Parried: the attacker takes the (boosted) hit instead
          applyDamage(p, Math.round(w.damage * dmgMult * PARRY_REFLECT), tk);
          spawnParrySpark(cx(p), cy(p));
        } else {
          applyDamage(t, Math.round(w.damage * dmgMult), pKey);
        }
      }
    }
  } else {
    const aim = nearestTargetAngle(p, pKey);
    p.facing = Math.cos(aim) < 0 ? -1 : 1; // face the target so the weapon sprite points right way
    const speed = w.projSpeed || (w.grapple ? 6.5 : 4.4);
    // A scattergun fires several pellets in a tight fan per trigger pull.
    const pellets = (w.pellets || 1) + (w.multi || 0);
    for (let i = 0; i < pellets; i++) {
    const a = aim + (i - (pellets - 1) / 2) * 0.13 + (pellets > 1 ? (Math.random() - 0.5) * 0.06 : 0);
    room.projectiles.push({
      id: nextId(),
      x: cx(p), y: cy(p),
      dx: Math.cos(a) * speed,
      dy: Math.sin(a) * speed,
      damage: Math.round(w.damage * dmgMult),
      owner: pKey,
      traveled: 0,
      maxRange: w.range,
      weaponId: w.id,
      upg: p.upgrades?.[w.id] || null,
      isAoe: !!w.aoeRadius,
      aoeRadius: w.aoeRadius || 0,
      pierce: !!w.pierce,
      grapple: !!w.grapple,
      boomerang: !!w.boomerang,
      returning: false,
      life: w.boomerang ? 4000 : 0,
      hitTargets: (w.pierce || w.boomerang) ? new Set() : null,
      chill: w.chill || 0,
      chain: w.chain || 0,
    });
    }
  }
}

function nearestTargetAngle(p, pKey) {
  const px = cx(p), py = cy(p);
  let best = null, bd = Infinity;
  for (const t of enemyTargets(pKey)) {
    const d = Math.hypot(cx(t) - px, cy(t) - py);
    if (d < bd) { bd = d; best = t; }
  }
  if (!best) return p.facing === 1 ? 0 : Math.PI;
  return Math.atan2(cy(best) - py, cx(best) - px);
}

function doSpecial(p, pKey) {
  const w = weapon(p);
  const sp = w.special;
  if (!sp) return;
  const dmgMult = hasEffect(p, 'strength') ? 1.8 : 1;
  p.specialCooldown = sp.cd;
  p.swingTimer = Math.min(sp.cd, 300);

  const px = cx(p), py = cy(p);
  const wc = WEAPON_COLORS[w.id] || '#ffffff';
  const spDmg = Math.round(sp.dmg * dmgMult);

  if (sp.kind === 'slam') {
    for (const t of enemyTargets(pKey)) {
      if (Math.hypot(cx(t) - px, cy(t) - py) <= sp.range) applyDamage(t, spDmg, pKey);
    }
    room.particles.push({
      type: 'shockwave', x: px, y: py, maxR: sp.range,
      timer: 420, max: 420, color: wc,
    });
    return;
  }

  if (sp.kind === 'storm') {
    // Lightning from above on the nearest few foes in range.
    const foes = enemyTargets(pKey)
      .map(t => ({ t, d: Math.hypot(cx(t) - px, cy(t) - py) }))
      .filter(e => e.d <= sp.range)
      .sort((a, b) => a.d - b.d)
      .slice(0, sp.count || 5);
    for (const { t } of foes) {
      room.particles.push({ type: 'bolt', x: cx(t) + (Math.random() - 0.5) * 30, y: ARENA_Y + 4,
                            x2: cx(t), y2: cy(t), timer: 320, max: 320, color: wc });
      strikeTarget(t, spDmg, pKey);
    }
    room.particles.push({ type: 'shockwave', x: px, y: py, maxR: 26, timer: 300, max: 300, color: wc });
    return;
  }

  const aim = nearestTargetAngle(p, pKey);
  p.facing = Math.cos(aim) < 0 ? -1 : 1;

  if (sp.kind === 'dash') {
    // Lunge along the aim line, running through everything in the way.
    const sx = p.x, sy = p.y;
    p.x += Math.cos(aim) * sp.range;
    p.y += Math.sin(aim) * sp.range;
    clampToArena(p, 2);
    p.pull = null;
    const ax = sx + p.w / 2, ay = sy + p.h / 2, bx = cx(p), by = cy(p);
    for (const t of enemyTargets(pKey)) {
      if (distToSegment(cx(t), cy(t), ax, ay, bx, by) <= 12 + (t.w + t.h) / 4) strikeTarget(t, spDmg, pKey);
    }
    p.invincible = Math.max(p.invincible, 250);
    room.particles.push({ type: 'streak', x: ax, y: ay, x2: bx, y2: by, timer: 300, max: 300, color: wc });
    return;
  }

  const speed = sp.kind === 'hook' ? 14 : 5.2;
  const mkProj = (angle, extra = {}) => ({
    id: nextId(),
    x: px, y: py,
    dx: Math.cos(angle) * speed,
    dy: Math.sin(angle) * speed,
    damage: spDmg,
    owner: pKey,
    traveled: 0,
    maxRange: sp.range,
    weaponId: w.id,
    upg: p.upgrades?.[w.id] || null,
    special: true,
    isAoe: false,
    aoeRadius: 0,
    pierce: false,
    grapple: false,
    boomerang: false,
    teleport: false,
    returning: false,
    life: 0,
    hitTargets: null,
    ...extra,
  });

  if (sp.kind === 'pierce') {
    room.projectiles.push(mkProj(aim, { pierce: true, hitTargets: new Set() }));
  } else if (sp.kind === 'aoeshot') {
    room.projectiles.push(mkProj(aim, { isAoe: true, aoeRadius: sp.aoe || 40, chill: sp.chill || 0 }));
  } else if (sp.kind === 'hook') {
    // Very fast hook — wherever it lands, the thrower goes with it.
    room.projectiles.push(mkProj(aim, { teleport: true, hook: true }));
  } else if (sp.kind === 'ring') {
    // A full circle of piercing stars.
    const n = sp.count || 8;
    for (let i = 0; i < n; i++) {
      room.projectiles.push(mkProj(aim + (i / n) * Math.PI * 2, { pierce: true, hitTargets: new Set() }));
    }
  } else if (sp.kind === 'spread') {
    const n = sp.count || 3;
    const fan = 0.42;
    for (let i = 0; i < n; i++) {
      const a = aim + (i - (n - 1) / 2) * fan;
      room.projectiles.push(mkProj(a, sp.boomerang
        ? { boomerang: true, pierce: true, hitTargets: new Set(), life: 4000 }
        : {}));
    }
  }
}

// ─── State Broadcast ──────────────────────────────────────────────────────────

// Chains connect a live grapple/hook projectile — and anything currently being
// dragged — back to the player holding the other end.
function buildChains() {
  const out = [];
  for (const pr of room.projectiles) {
    if (!pr.grapple && !pr.hook) continue;
    const o = room.players[pr.owner];
    if (!o) continue;
    out.push({ x1: cx(o), y1: cy(o), x2: pr.x, y2: pr.y, kind: pr.hook ? 'hook' : 'grapple' });
  }
  for (const e of [room.players.p1, room.players.p2, ...room.monsters]) {
    if (!e || e.dead || !e.pull || !e.pull.from) continue;
    const o = room.players[e.pull.from];
    if (!o || o.dead) continue;
    out.push({ x1: cx(o), y1: cy(o), x2: cx(e), y2: cy(e), kind: 'grapple' });
  }
  return out;
}

// Positions go out 50×/s for every entity; full float precision is ~20 characters
// each and 0.1 world units is well under a screen pixel, so round them.
function r1(n) { return Math.round(n * 10) / 10; }

function playerView(p) {
  if (!p) return null;
  const w = weapon(p);
  return {
    x: r1(p.x), y: r1(p.y), w: p.w, h: p.h, hp: p.hp, maxHp: p.maxHp,
    lives: p.lives, facing: p.facing, weaponId: w.id, weaponIdx: p.weaponIdx,
    atkSpd: w.atkSpd, reach: w.range, wType: w.type,
    upg: p.upgrades?.[w.id] || null,
    hitFlash: p.hitFlash, dead: p.dead, swingTimer: p.swingTimer,
    unlockedWeapons: p.unlockedWeapons, skin: p.skin,
    specialCd: Math.max(0, p.specialCooldown), specialMax: w.special?.cd || 0,
    parryCd: Math.max(0, p.parryCooldown), parryMax: PARRY_COOLDOWN, parryActive: p.parryTimer > 0,
    effects: p.effects,
    pulled: !!p.pull,
  };
}

function buildStateMsg(playerNum) {
  const key = playerNum === 1 ? 'p1' : 'p2';
  return {
    type: 'state',
    myNum: playerNum,
    gameState: room.gameState,
    gameMode: room.gameMode,
    playerNames: room.playerNames,
    players: { p1: playerView(room.players.p1), p2: playerView(room.players.p2) },
    monsters:    room.monsters.map(m => ({ id: m.id, type: m.type, x: r1(m.x), y: r1(m.y), w: m.w, h: m.h,
                  hp: m.hp, maxHp: m.maxHp, hitFlash: m.hitFlash, slowed: (m.slowTimer || 0) > 0, armor: m.armor || 0,
                  face: m.face, swing: m.swing > 0 ? Math.round(m.swing) : 0 })),
    projectiles: room.projectiles.map(pr => ({ id: pr.id, x: r1(pr.x), y: r1(pr.y), dx: r1(pr.dx), dy: r1(pr.dy), weaponId: pr.weaponId,
                  upg: pr.upg || null, isAoe: pr.isAoe, special: !!pr.special, grapple: !!pr.grapple,
                  hook: !!pr.hook, boomerang: !!pr.boomerang })),
    chains:      buildChains().map(c => ({ x1: r1(c.x1), y1: r1(c.y1), x2: r1(c.x2), y2: r1(c.y2), kind: c.kind })),
    traps:       room.traps.map(tr => ({ x: r1(tr.x), y: r1(tr.y), w: tr.w, h: tr.h, type: tr.type, state: tr.state, radius: tr.radius, color: tr.color,
                  armRatio: tr.state === 'arming' ? r1(1 - tr.armTimer / (TRAP_TYPES[tr.type].armTime || 1)) : 0 })),
    items:       room.items.map(it => ({ x: r1(it.x), y: r1(it.y), w: it.w, h: it.h, type: it.type, color: ITEM_TYPES[it.type].color })),
    coins:       room.coins.map(c => ({ id: c.id, x: r1(c.x), y: r1(c.y), w: c.w, h: c.h, value: c.value, fading: c.life < 4000 })),
    particles:   room.particles.map(p => (p.x === undefined ? p : { ...p, x: r1(p.x), y: r1(p.y) })),
    wave:        room.wave,
    xp:          room.playerXp[key],
    myCoins:     room.playerCoins[key],
    inventory:   room.players[key] ? room.players[key].inventory : [],
    round:       room.round,
    pendingUnlock: room.unlockQueues[key][0] || null,
    otherHasUnlocks: room.unlockQueues[key === 'p1' ? 'p2' : 'p1'].length > 0,
    leaderboard: room.gameMode === 'waves' && room.gameState === 'ROUND_OVER' ? room.lastLeaderboard : null,
  };
}

function broadcastState() {
  if (room.p1 && room.p1.readyState === 1) room.p1.send(JSON.stringify(buildStateMsg(1)));
  if (room.p2 && room.p2.readyState === 1) room.p2.send(JSON.stringify(buildStateMsg(2)));
}

// A waves run is solo and ends for good — send the client back to the menu
// instead of dropping the socket and showing it a "disconnected" error.
function endWavesRun() {
  const ws = room.p1;
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify({ type: 'to_menu', reason: 'run_over' })); } catch {}
  }
  if (ws) setTimeout(() => { try { ws.close(); } catch {} }, 250);
  resetToLobby();
}

// ─── Weapon catalog for the client ────────────────────────────────────────────

function weaponCatalog() {
  return WEAPONS.map(w => ({
    id: w.id, name: w.name, type: w.type, unlockXp: w.unlockXp,
    damage: w.damage, range: w.range, atkSpd: w.atkSpd,
    special: w.special ? { kind: w.special.kind, dmg: w.special.dmg, cd: w.special.cd } : null,
    upgrades: upgradesFor(w.id),
  }));
}

function profileFor(pw, opts = {}) {
  const admin = isAdminPw(pw);
  const d = progress();

  let xp = admin ? ADMIN_XP : (d.players[pw] || 0);
  const localXp = Math.max(0, Math.floor(Number(opts.localXp) || 0));
  if (!admin && localXp > xp) { xp = localXp; d.players[pw] = xp; markDirty(); }

  let coins;
  if (admin) {
    coins = ADMIN_COINS;
  } else if (d.coins[pw] === undefined) {
    // No server record (e.g. the host's disk was wiped) — trust the client's mirror.
    coins = Math.max(0, Math.floor(Number(opts.localCoins) || 0));
    d.coins[pw] = coins;
    markDirty();
  } else {
    coins = d.coins[pw];
  }

  const weapons = sortWeaponIds([...getUnlockedWeaponIds(xp), ...(d.weapons[pw] || [])]);
  if (!admin) {
    const prev = sortWeaponIds(d.weapons[pw] || []);
    if (JSON.stringify(prev) !== JSON.stringify(weapons)) { d.weapons[pw] = weapons; markDirty(); }
  }

  let refunded = 0;
  if (!admin && d.upgrades[pw] && typeof d.upgrades[pw] === 'object') {
    for (const [wid, lv] of Object.entries(d.upgrades[pw])) {
      if (!lv || typeof lv !== 'object') continue;
      const allowed = upgradesFor(wid);
      for (const k of Object.keys(lv)) {
        if (allowed.includes(k)) continue;
        const n = Math.max(0, Math.min(UPGRADE_STATS[k]?.max || 0, Math.floor(Number(lv[k]) || 0)));
        for (let i = 1; i <= n; i++) refunded += upgradeCost(k, i);
        delete lv[k];
      }
    }
    if (refunded) { coins += refunded; d.coins[pw] = coins; markDirty(); }
  }
  const upgrades = normalizeUpgrades(d.upgrades[pw]);
  const ownedSkins = admin ? SKIN_SHOP.map(s => s.id)
    : (Array.isArray(d.ownedSkins[pw]) ? d.ownedSkins[pw].filter(id => SKIN_BY_ID[id]) : []);
  return { xp, coins, weapons, upgrades, ownedSkins, refunded };
}

// A skin is { colorIdx, hatIdx, outfit }. The outfit survives only if owned.
function cleanSkin(raw, owned) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const outfit = typeof s.outfit === 'string' && SKIN_BY_ID[s.outfit] && owned.includes(s.outfit) ? s.outfit : '';
  return {
    colorIdx: Math.max(0, Math.min(7, Number(s.colorIdx) || 0)),
    hatIdx:   Math.max(0, Math.min(4, Number(s.hatIdx)   || 0)),
    outfit,
  };
}

// ─── HTTP API (shop / upgrades) ───────────────────────────────────────────────

app.use(express.json({ limit: '8kb' }));

app.get('/api/catalog', (_req, res) => {
  res.json({ catalog: weaponCatalog(), upgradeDefs: UPGRADE_STATS, costs: costTable(), colors: WEAPON_COLORS, skinShop: SKIN_SHOP });
});

app.post('/api/profile', (req, res) => {
  const pw = sanitizeText(req.body?.password, 32);
  if (!pw) return res.status(400).json({ error: 'A password is required to save upgrades.' });
  const p = profileFor(pw, { localXp: req.body?.localXp, localCoins: req.body?.localCoins });
  res.json({ ...p, catalog: weaponCatalog(), upgradeDefs: UPGRADE_STATS, costs: costTable(), colors: WEAPON_COLORS, skinShop: SKIN_SHOP });
});

app.post('/api/upgrade', (req, res) => {
  const pw = sanitizeText(req.body?.password, 32);
  if (!pw) return res.status(400).json({ error: 'A password is required to save upgrades.' });
  const weaponId = sanitizeText(req.body?.weaponId, 24);
  const stat = sanitizeText(req.body?.stat, 8);
  if (!WEAPON_BY_ID[weaponId]) return res.status(400).json({ error: 'Unknown weapon.' });
  if (!UPGRADE_STATS[stat] || !upgradesFor(weaponId).includes(stat)) {
    return res.status(400).json({ error: 'That weapon has no such upgrade.' });
  }

  const admin = isAdminPw(pw);
  const prof = profileFor(pw, {});
  if (!prof.weapons.includes(weaponId)) {
    return res.status(400).json({ error: 'Unlock that weapon first.' });
  }

  const d = progress();
  const levels = prof.upgrades[weaponId] || {};
  const cur = levels[stat] || 0;
  if (cur >= UPGRADE_STATS[stat].max) {
    return res.status(400).json({ error: 'Already at max level.' });
  }
  const cost = upgradeCost(stat, cur + 1);
  if (!admin && prof.coins < cost) {
    return res.status(400).json({ error: 'Not enough coins.' });
  }

  if (!d.upgrades[pw]) d.upgrades[pw] = {};
  if (!d.upgrades[pw][weaponId]) d.upgrades[pw][weaponId] = {};
  d.upgrades[pw][weaponId][stat] = cur + 1;
  if (!admin) d.coins[pw] = prof.coins - cost;
  markDirty();

  // Push the new levels into a live game if this player is mid-match.
  for (const key of ['p1', 'p2']) {
    if (room.passwords[key] !== pw) continue;
    const ups = normalizeUpgrades(d.upgrades[pw]);
    room.playerUpgrades[key] = ups;
    if (!admin) room.playerCoins[key] = d.coins[pw];
    const p = room.players[key];
    if (p) { p.upgrades = ups; refreshWeapon(p); }
  }

  const next = profileFor(pw, {});
  res.json({ ...next, spent: cost });
});

app.post('/api/buy_skin', (req, res) => {
  const pw = sanitizeText(req.body?.password, 32);
  if (!pw) return res.status(400).json({ error: 'A password is required to buy skins.' });
  const skinId = sanitizeText(req.body?.skinId, 16);
  const def = SKIN_BY_ID[skinId];
  if (!def) return res.status(400).json({ error: 'Unknown skin.' });

  const admin = isAdminPw(pw);
  const prof = profileFor(pw, { localCoins: req.body?.localCoins });
  if (prof.ownedSkins.includes(skinId)) return res.status(400).json({ error: 'You already own that skin.' });
  if (!admin && prof.coins < def.price) return res.status(400).json({ error: 'Not enough coins.' });

  const d = progress();
  if (!admin) {
    d.ownedSkins[pw] = [...prof.ownedSkins, skinId];
    d.coins[pw] = prof.coins - def.price;
    markDirty();
    for (const key of ['p1', 'p2']) {
      if (room.passwords[key] === pw) room.playerCoins[key] = d.coins[pw];
    }
  }
  const next = profileFor(pw, {});
  res.json({ ...next, spent: admin ? 0 : def.price, skinShop: SKIN_SHOP });
});

// ─── WebSocket Connections ────────────────────────────────────────────────────

function clearSlot(key) {
  room[key] = null;
  room[key + 'Joined'] = false;
  room.playerNames[key] = key === 'p1' ? 'PLAYER 1' : 'PLAYER 2';
  room.passwords[key] = '';
  room.playerXp[key] = 0;
  room.playerCoins[key] = 0;
  room.playerSkins[key] = null;
  room.playerUnlocks[key] = null;
  room.playerUpgrades[key] = null;
  room.unlockQueues[key] = [];
  room.players[key] = null;
  room.inputs[key] = { up: false, down: false, left: false, right: false, attack: false, swap: false, special: false, parry: false };
  room.prevInputs[key] = { attack: false, swap: false, special: false, parry: false };
}

wss.on('connection', (ws) => {
  // Reap slots whose socket died without a close event.
  for (const key of ['p1', 'p2']) {
    if (room[key] && room[key].readyState !== 1) clearSlot(key);
  }

  if (room.p1 && room.p2) {
    ws.send(JSON.stringify({ type: 'full' }));
    ws.close();
    return;
  }

  const isP1 = !room.p1;
  if (!isP1 && room.p1Joined && room.gameMode === 'waves') {
    ws.send(JSON.stringify({ type: 'full' }));
    ws.close();
    return;
  }
  if (isP1) room.p1 = ws;
  else      room.p2 = ws;

  const myKey = isP1 ? 'p1' : 'p2';
  ws.send(JSON.stringify({
    type: 'welcome', num: isP1 ? 1 : 2,
    leaderboard: getLeaderboard(),
    world: { w: CANVAS_W, h: CANVAS_H, ax: ARENA_X, ay: ARENA_Y, aw: ARENA_W, ah: ARENA_H },
    playerSpeed: PLAYER_SPEED,
    catalog: weaponCatalog(),
    colors: WEAPON_COLORS,
  }));

  broadcastState();

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.type === 'join') {
        room.playerNames[myKey] = sanitizeText(msg.name, 12).toUpperCase() || (isP1 ? 'PLAYER 1' : 'PLAYER 2');

        const pw = sanitizeText(msg.password, 32);
        room.passwords[myKey] = pw;
        const admin = isAdminPw(pw);

        const prof = pw
          ? profileFor(pw, { localXp: msg.localXp, localCoins: msg.localCoins })
          : { xp: 0, coins: 0, weapons: getUnlockedWeaponIds(0), upgrades: {}, ownedSkins: [] };

        room.playerXp[myKey]       = prof.xp;
        room.playerCoins[myKey]    = prof.coins;
        room.playerUnlocks[myKey]  = prof.weapons;
        room.playerUpgrades[myKey] = prof.upgrades;

        // Skin: if the user explicitly changed it this session, save the new skin;
        // otherwise restore whatever this password had saved.
        const d = pw && !admin ? progress() : null;
        const rawSkin = msg.skin && typeof msg.skin === 'object' ? msg.skin : null;
        const savedSkin = d?.skins?.[pw];
        const owned = prof.ownedSkins || [];
        let skin;
        if (msg.skinModified || savedSkin === undefined) {
          skin = cleanSkin(rawSkin, owned);
          if (d) { d.skins[pw] = skin; markDirty(); }
        } else {
          skin = cleanSkin(savedSkin, owned);
        }
        room.playerSkins[myKey] = skin;

        // Tell the client which skin is active (may have been restored from the password)
        ws.send(JSON.stringify({ type: 'skin_init', skin }));

        if (isP1 && msg.mode) {
          let m = ['pvp', 'coop', 'waves'].includes(msg.mode) ? msg.mode : 'pvp';
          // Waves is solo; don't strand a player who is already connected.
          if (m === 'waves' && room.p2) m = 'pvp';
          room.gameMode = m;
        }
        room[myKey + 'Joined'] = true;

        // Start game: waves = solo (P1 only), others = need both
        const canStart = room.gameMode === 'waves'
          ? room.p1Joined
          : (room.p1Joined && room.p2Joined);

        if (canStart && room.gameState === 'LOBBY') startGame();
        broadcastState();
      }

      if (msg.type === 'input' && msg.keys && typeof msg.keys === 'object') {
        const k = msg.keys;
        room.inputs[myKey] = {
          up: !!k.up, down: !!k.down, left: !!k.left, right: !!k.right,
          attack: !!k.attack, swap: !!k.swap, special: !!k.special, parry: !!k.parry,
        };
      }

      if (msg.type === 'select_weapon') {
        const p = room.players[myKey];
        if (p && !p.dead && Array.isArray(p.unlockedWeapons)) {
          const idx = Number(msg.index);
          if (Number.isInteger(idx) && idx >= 0 && idx < p.unlockedWeapons.length) {
            p.weaponIdx = idx;
            refreshWeapon(p);
          }
        }
      }

      if (msg.type === 'use_item') {
        const p = room.players[myKey];
        if (p && !p.dead && Array.isArray(p.inventory)) {
          const idx = Number(msg.index);
          if (Number.isInteger(idx) && idx >= 0 && idx < p.inventory.length) {
            const type = p.inventory[idx];
            const def = ITEM_TYPES[type];
            if (def) {
              if (def.instant && def.effect === 'heal') {
                p.hp = Math.min(p.maxHp, p.hp + def.amount);
              } else {
                applyEffect(p, def.effect, def.dur);
              }
              p.inventory.splice(idx, 1);
              room.particles.push({ type: 'useitem', x: cx(p), y: p.y, timer: 500, max: 500, color: def.color });
            }
          }
        }
      }

      if (msg.type === 'ack_unlock' && room.gameState === 'WEAPON_UNLOCK') {
        room.unlockQueues[myKey].shift();
        const p1Done = room.unlockQueues.p1.length === 0;
        const p2Done = room.gameMode === 'waves' || !room.p2Joined || room.unlockQueues.p2.length === 0;
        if (p1Done && p2Done) {
          if (room.gameMode === 'waves') endWavesRun();
          else startGame();
        }
      }
    } catch {}
  });

  ws.on('close', () => {
    const key = room.p1 === ws ? 'p1' : room.p2 === ws ? 'p2' : null;
    if (!key) return;
    const wasPlaying = room.gameState !== 'LOBBY';
    clearSlot(key);
    // A match can't continue a fighter down — drop back to the lobby, but keep
    // whoever is still connected (and their progress) in place.
    if (wasPlaying) resetToLobby();
    if (!room.p1 && !room.p2) room.gameMode = 'pvp';
    broadcastState();
  });
});

// ─── Static Files ─────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));

server.listen(PORT, () => console.log('Weponare running on port', PORT));
