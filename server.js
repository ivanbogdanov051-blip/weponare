'use strict';

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
// Game state is repetitive JSON, so a light deflate cuts it ~4x for almost no CPU.
const wss = new WebSocketServer({
  server,
  perMessageDeflate: { zlibDeflateOptions: { level: 1 }, threshold: 512, concurrencyLimit: 4, serverNoContextTakeover: true, clientNoContextTakeover: true },
});

const PORT = process.env.PORT || 3000;
const PROGRESS_FILE = path.join(__dirname, 'progress.json');

// ─── Constants ────────────────────────────────────────────────────────────────

// World is 1.5× the old 480×270 arena. The client renders the whole world at
// 720×405 and draws its HUD in a 480×270 space scaled by 1.5, so the bigger map
// is simply zoomed out to fit the screen.
// The world size depends on the room's map (small / medium / big), so these are
// set from the room each time the code switches to it (useRoom).
const MAP_SIZES = { small: [560, 315], medium: [720, 405], big: [960, 540] };
const ARENA_X = 12, ARENA_Y = 12;
let CANVAS_W = 720, CANVAS_H = 405;
let ARENA_W = CANVAS_W - ARENA_X * 2, ARENA_H = CANVAS_H - ARENA_Y * 2;
function setArena(size) {
  [CANVAS_W, CANVAS_H] = MAP_SIZES[size] || MAP_SIZES.medium;
  ARENA_W = CANVAS_W - ARENA_X * 2; ARENA_H = CANVAS_H - ARENA_Y * 2;
}
const TICK_MS = 20;

// Dev hook: start co-op/waves at a later wave so the deep-wave monster roster can
// be exercised without playing there first. Unset in production.
const START_WAVE = Math.max(1, Math.floor(Number(process.env.WEPONARE_START_WAVE) || 1));

const ADMIN_PASSWORD = '67892155';
const ADMIN_XP = 1000000000000000000; // 1e18 — unlocks everything
const ADMIN_COINS = 999999999;
function isAdminPw(pw) { return pw === ADMIN_PASSWORD; }

const PARRY_WINDOW   = 1200;  // ms the parry is "active" and reflects
const PARRY_COOLDOWN = 8000;  // ms before it can be used again
const PARRY_REFLECT  = 1.5;   // reflected damage multiplier

const PLAYER_SPEED  = 3.6;    // scaled up with the bigger arena
// Characters are drawn from a 16x22 pixel sprite, so the hitbox matches it.
const PLAYER_W = 16, PLAYER_H = 22;

// ── Traps: sparse, and big enough to be a real hazard on the larger map ──
const MAX_TRAPS = 5;
const TRAP_SPAWN_MIN = 5000, TRAP_SPAWN_MAX = 11000;
// `name` floats up when a trap goes off, so players learn what hit them.
const TRAP_TYPES = {
  spike:  { mode: 'delayed', armTime: 750, size: 34, radius: 52, damage: 30, color: '#ff8822', name: 'SPIKES' },
  mine:   { mode: 'instant',              size: 30, radius: 60, damage: 46, color: '#ff3333', name: 'MINE' },
  snare:  { mode: 'instant',              size: 32, radius: 46, effect: 'slow', dur: 2800, color: '#66ccff', name: 'SNARE' },
  // Erupts after a beat and sets everything nearby on fire (4 damage / 0.5 s).
  fire:   { mode: 'delayed', armTime: 600, size: 32, radius: 50, damage: 16, effect: 'burn', dur: 3000, color: '#ff6a1a', name: 'FIRE VENT' },
  // Leaves a toxic cloud that keeps hurting anyone standing in it.
  poison: { mode: 'instant',              size: 36, radius: 58, damage: 3, effect: 'poison', linger: 4000, tick: 400, color: '#8ad048', name: 'POISON POOL' },
  // Flings everyone nearby away from the pad.
  spring: { mode: 'instant',              size: 30, radius: 46, damage: 6, effect: 'launch', force: 150, color: '#ffd24a', name: 'SPRING PAD' },
  // Charges, then arcs lightning into the nearest few targets (and jolts them slow).
  tesla:  { mode: 'delayed', armTime: 900, size: 32, radius: 115, damage: 24, effect: 'shock', count: 3, color: '#9fe8ff', name: 'TESLA COIL' },
  // Teleports whoever steps on it somewhere random.
  warp:   { mode: 'instant',              size: 34, radius: 24, effect: 'warp', color: '#b07aff', name: 'WARP RUNE' },
  // ── The 10 update ──
  // Freezes monsters solid and chills players to a crawl.
  ice:    { mode: 'instant',              size: 32, radius: 56, effect: 'freeze', dur: 1800, color: '#bfefff', name: 'FROST PLATE' },
  // Spinning blades that keep cutting whoever stays in the pit.
  saw:    { mode: 'instant',              size: 34, radius: 50, damage: 7, effect: 'saw', linger: 3500, tick: 300, color: '#d8dde6', name: 'SAW PIT' },
  // Drags everything nearby into its middle for a while.
  gravity:{ mode: 'instant',              size: 32, radius: 120, damage: 4, effect: 'gravity', linger: 2600, tick: 400, color: '#8a5aff', name: 'GRAVITY WELL' },
  // Cracks open after a beat: a big burst of magma that sets you on fire.
  lava:   { mode: 'delayed', armTime: 800, size: 36, radius: 64, damage: 38, effect: 'burn', dur: 4000, color: '#ff4a1a', name: 'LAVA CRACK' },
  // Vines grab your legs: you can't move for a moment.
  root:   { mode: 'instant',              size: 32, radius: 50, effect: 'root', dur: 1500, color: '#5aa83a', name: 'ROOT VINES' },
  // A powder keg on a long fuse: a huge blast that throws everyone back.
  keg:    { mode: 'delayed', armTime: 1300, size: 30, radius: 95, damage: 60, effect: 'keg', force: 110, color: '#c8742a', name: 'POWDER KEG' },
  // The kind trap: heals everyone standing in it (monsters too).
  healspring:{ mode: 'instant',              size: 34, radius: 60, damage: 6, effect: 'healspring', linger: 3000, tick: 500, color: '#5aff9a', name: 'HEALING SPRING' },
  // Turns your controls back to front for a few seconds.
  mirror: { mode: 'instant',              size: 32, radius: 46, effect: 'confuse', dur: 3500, color: '#ff7ac8', name: 'MIRROR RUNE' },
  // No specials, supers or abilities while it hums.
  nullfield:{ mode: 'instant',              size: 34, radius: 60, effect: 'silence', dur: 3500, color: '#9a9ab8', name: 'NULL FIELD' },
  // The ground splits after a beat: hurts and staggers everyone around it.
  quake:  { mode: 'delayed', armTime: 1000, size: 36, radius: 100, damage: 26, effect: 'quake', dur: 900, color: '#c89a5a', name: 'FAULT LINE' },
};

// Dev hook: limit which traps spawn (comma list). Unset in production.
const TRAP_POOL = (() => {
  const want = String(process.env.WEPONARE_TRAPS || '').split(',').map(t => t.trim()).filter(t => TRAP_TYPES[t]);
  return want.length ? want : Object.keys(TRAP_TYPES);
})();

// ── Items: collectible, grant an activatable buff ──
const MAX_ITEMS = 4;
const ITEM_SPAWN_MIN = 6000, ITEM_SPAWN_MAX = 13000;
const MAX_INVENTORY = 4;
const ITEM_SIZE = 18;
// `name` and `desc` are what the pickup banner tells the player.
const ITEM_TYPES = {
  speed:    { effect: 'speed',    dur: 6000, color: '#44ddee', name: 'SPEED BOOST',  desc: 'Move 70% faster' },
  strength: { effect: 'strength', dur: 6000, color: '#ff5544', name: 'STRENGTH',     desc: 'Hit 80% harder' },
  shield:   { effect: 'shield',   dur: 4500, color: '#ffdd44', name: 'SHIELD',       desc: 'Take no damage' },
  haste:    { effect: 'haste',    dur: 6000, color: '#aa66ff', name: 'HASTE',        desc: 'Attack twice as fast' },
  heal:     { effect: 'heal',     instant: true, amount: 50, color: '#44ff66', name: 'HEAL', desc: 'Restore 50 HP' },
  regen:    { effect: 'regen',    dur: 8000, color: '#ff7ac8', name: 'REGENERATION', desc: 'Heal 5 HP every second' },
  vampire:  { effect: 'vampire',  dur: 7000, color: '#d8304a', name: 'VAMPIRE',      desc: 'Heal 25% of damage dealt' },
  bomb:     { effect: 'bomb',     instant: true, amount: 70, radius: 110, color: '#ff8a2a', name: 'BOMB', desc: 'Blast everything nearby' },
  frost:    { effect: 'frost',    instant: true, radius: 160, dur: 3500, color: '#9fe8ff', name: 'FROST NOVA', desc: 'Freeze nearby foes' },
  // Only ever left behind by the Dagger of Ghosts' knife storm: heals on touch.
  // ── The 10 update ──
  thorns:   { effect: 'thorns',   dur: 8000, color: '#7ac850', name: 'THORNS',        desc: 'Attackers take half their hit back' },
  cloak:    { effect: 'vanish',   dur: 5000, color: '#8a8ab8', name: 'CLOAK',         desc: 'Turn invisible for 5s' },
  zap:      { effect: 'zap',      instant: true, amount: 55, count: 5, radius: 320, color: '#ffe45a', name: 'LIGHTNING JAR', desc: 'Zap the 5 nearest foes' },
  turret:   { effect: 'turret',   instant: true, color: '#ff5a3a', name: 'TURRET',        desc: 'A fire portal shoots your foes' },
  egg:      { effect: 'egg',      instant: true, color: '#7affc8', name: 'MONSTER EGG',   desc: 'Hatch 2 monsters that fight for you' },
  frenzy:   { effect: 'frenzy',   instant: true, dur: 4500, color: '#ff3a8a', name: 'FRENZY',  desc: 'Faster, stronger, quicker for 4.5s' },
  ironskin: { effect: 'ironskin', dur: 8000, color: '#a8b4c4', name: 'IRON SKIN',     desc: 'Take half damage' },
  hourglass:{ effect: 'hourglass', instant: true, dur: 5000, color: '#e8c87a', name: 'HOURGLASS', desc: 'Slow every foe for 5s' },
  goldrush: { effect: 'gold',     dur: 12000, color: '#ffd84a', name: 'GOLD RUSH',    desc: 'Kills drop double coins' },
  elixir:   { effect: 'elixir',   instant: true, color: '#ff4ab8', name: 'ELIXIR',       desc: 'Full heal and cure' },
  medkit:   { effect: 'heal',     instant: true, touch: true, share: 0.3, noSpawn: true, color: '#ff4a5a', name: 'MEDKIT', desc: 'Heals 30% at once' },
};

// Dev hook: limit which power-ups spawn (comma list), for testing one at a
// time. Unset in production.
const ITEM_POOL = (() => {
  const want = String(process.env.WEPONARE_ITEMS || '').split(',').map(t => t.trim()).filter(t => ITEM_TYPES[t]);
  return want.length ? want : Object.keys(ITEM_TYPES).filter(t => !ITEM_TYPES[t].noSpawn);
})();

// ── Coins: drop from every kill, spent on weapon upgrades in the menu ──
const COIN_SIZE = 10;
const COIN_LIFETIME = 22000;
const COIN_MAGNET = 30;       // auto-collect radius
const COIN_ATTRACT = 170;     // coins fly toward a player from this far away
const COIN_PULL = 0.9, COIN_SETTLED_PULL = 0.45, COIN_SETTLE_MS = 1200;
const MAX_COIN_DROPS = 9;     // entities per kill (value is stacked instead)
const COIN_KILL_MULT = 4;     // every kill pays out this many times the base amount
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
  // ── The 10 update: eight more common weapons ──
  // stunHit: ms a melee hit stuns for. lifesteal / knock: built in, on top of upgrades.
  { id: 'scimitar',    name: 'SCIMITAR',    damage: 17, range: 52,  atkSpd: 300,  type: 'melee',  unlockXp: 1000,  special: { kind: 'dash',    dmg: 42,  range: 130, cd: 4500 } },
  { id: 'slingshot',   name: 'SLINGSHOT',   damage: 12, range: 240, atkSpd: 320,  type: 'ranged', unlockXp: 2800,  gust: 14, projSpeed: 5.5, special: { kind: 'spread', dmg: 18, range: 250, cd: 5000, count: 4 } },
  { id: 'mace',        name: 'MACE',        damage: 36, range: 50,  atkSpd: 750,  type: 'melee',  unlockXp: 5200,  stunHit: 450, special: { kind: 'slam', dmg: 80, range: 82, cd: 7500 } },
  { id: 'javelin',     name: 'JAVELIN',     damage: 34, range: 320, atkSpd: 750,  type: 'ranged', unlockXp: 8200,  pierce: true, projSpeed: 7.5, special: { kind: 'pierce', dmg: 75, range: 380, cd: 6000 } },
  { id: 'claws',       name: 'CLAWS',       damage: 13, range: 42,  atkSpd: 150,  type: 'melee',  unlockXp: 12500, lifesteal: 0.06, special: { kind: 'slam', dmg: 40, range: 72, cd: 4000 } },
  { id: 'emberstaff',  name: 'EMBER STAFF', damage: 22, range: 250, atkSpd: 650,  type: 'ranged', unlockXp: 17500, burn: 2000, aoeRadius: 30, special: { kind: 'aoeshot', dmg: 95, range: 280, cd: 7500, aoe: 90 } },
  { id: 'halberd',     name: 'HALBERD',     damage: 48, range: 100, atkSpd: 900,  type: 'melee',  unlockXp: 23000, knock: 10, special: { kind: 'dash', dmg: 90, range: 160, cd: 7000 } },
  { id: 'frostbow',    name: 'FROST BOW',   damage: 24, range: 320, atkSpd: 560,  type: 'ranged', unlockXp: 25500, pierce: true, chill: 1200, projSpeed: 6.5, special: { kind: 'spread', dmg: 30, range: 320, cd: 6500, count: 5 } },
  // Shop-only: never unlocked by XP. Bought for `price` coins once every other
  // weapon is unlocked. Attack = a growing ring of fire (range = its final
  // radius), special = a homing hand of fire, and it alone has a SUPER.
  { id: 'fireglove',   name: 'FIRE GLOVE',  damage: 16, range: 78,  atkSpd: 650,  type: 'melee',  unlockXp: 0, shopOnly: true, price: 5000, fireRing: true,
    special: { kind: 'firehand', dmg: 13, range: 420, cd: 1000, minCd: 1000, aoe: 40, blast: 9 },
    super:   { kind: 'inferno',  dmg: 40, cd: 18000 } },
  // Shop-only, but with no unlock requirement (noRequirement). Attack raises a
  // 3 s shield that blocks every hit and banks the damage it would have done.
  // Special throws that bank back as a lightning vortex; SUPER heals 1.5x the
  // bank. Both empty the bank. special.dmg / super.dmg are percentages of it.
  { id: 'vortex',      name: 'VORTEX SHIELD', damage: 1, range: 60, atkSpd: 11000, type: 'melee', unlockXp: 0, shopOnly: true, noRequirement: true, price: 20000, vortexShield: true,
    special: { kind: 'vortex',     dmg: 100, range: 420, cd: 2500 },
    super:   { kind: 'absorbheal', dmg: 150, cd: 12000 } },
  // Shop-only, no requirement. Attack: a piercing gust that shoves foes back
  // (gust = px). Special: a tornado that drifts forward pulling foes into it.
  // SUPER: a hurricane around you for 5 s that flings foes away and blows
  // enemy shots out of the air.
  { id: 'windwand',    name: 'WIND WAND',   damage: 20, range: 270, atkSpd: 340, type: 'ranged', unlockXp: 0, shopOnly: true, noRequirement: true, price: 9000,
    gust: 38, pierce: true, projSpeed: 6, pellets: 2, needLegendary: true,
    special: { kind: 'tornado',   dmg: 30, range: 320, cd: 4200, aoe: 46 },
    super:   { kind: 'hurricane', dmg: 40, cd: 18000 } },
  // Shop-only, no requirement. Every bullet explodes. Special: fan the hammer
  // (six exploding shots at once). SUPER: dead eye, an exploding bullet into
  // every enemy on the field.
  { id: 'revolver',    name: 'EXPLOSIVE REVOLVER', damage: 24, range: 280, atkSpd: 380, type: 'ranged', unlockXp: 0, shopOnly: true, noRequirement: true, price: 14000,
    aoeRadius: 26, projSpeed: 8.5, needLegendary: true,
    special: { kind: 'fanhammer', dmg: 26, range: 260, cd: 4500, count: 6, aoe: 30 },
    super:   { kind: 'deadeye',   dmg: 110, cd: 16000 } },
  // Never for sale: the Portal Mage's own wand, won by beating him (bossReward).
  // Attack: his burning fireballs, which explode. Special: a portal jump to the
  // safest spot on the field, leaving a fire portal behind that keeps shooting.
  // SUPER: portal legion, portals in your colour pouring out monsters that
  // fight on your side for a while (see spawnAlly).
  { id: 'portalwand',  name: 'PORTAL WAND', damage: 34, range: 330, atkSpd: 360, type: 'ranged', unlockXp: 0, shopOnly: true, bossReward: true, price: 0,
    aoeRadius: 24, projSpeed: 6.2, burn: 1500, portalShot: true,
    special: { kind: 'blink',       dmg: 46, range: 420, cd: 4000 },
    super:   { kind: 'legion',      dmg: 40, cd: 18000 } },
  // ── Three more legendaries (shop-only, each needs another legendary first) ──
  // STORMBREAKER: every hammer blow arcs lightning on to 2 more foes. Special:
  // hurl the hammer — it smashes through everything, stunning, then flies back.
  // SUPER: THUNDER GOD — for 6s lightning strikes the 3 nearest foes every 0.45s.
  { id: 'stormhammer', name: 'STORMBREAKER', damage: 40, range: 56, atkSpd: 650, type: 'melee', unlockXp: 0,
    shopOnly: true, noRequirement: true, needLegendary: true, price: 16000, arcHit: 2,
    special: { kind: 'hammerthrow', dmg: 70, range: 270, cd: 5500 },
    super:   { kind: 'thundergod',  dmg: 34, cd: 20000 } },
  // WINTER'S EDGE: a 360 scythe sweep; every hit adds a frostbite stack and the
  // third freezes the target solid (bosses and players are badly slowed instead).
  // Special: ten ice shards burst out in a ring. SUPER: ABSOLUTE ZERO — a 5s
  // blizzard around you that grinds everything inside, and shatters the frozen
  // for double damage.
  { id: 'frostscythe', name: "WINTER'S EDGE", damage: 30, range: 70, atkSpd: 600, type: 'melee', unlockXp: 0,
    shopOnly: true, noRequirement: true, needLegendary: true, price: 18000, swing360: true, frostbite: true,
    special: { kind: 'icespikes',    dmg: 38, range: 230, cd: 6000, count: 10 },
    super:   { kind: 'absolutezero', dmg: 26, cd: 20000 } },
  // SUNFIRE LONGBOW: piercing arrows of sunlight that set foes alight. Special:
  // a small sun hangs in the air for 4.5s, beaming the nearest foe again and
  // again. SUPER: SUPERNOVA — a beam of sunlight right across the arena that
  // sweeps through a wide arc, burning everything it crosses.
  { id: 'sunbow', name: 'SUNFIRE LONGBOW', damage: 28, range: 340, atkSpd: 520, type: 'ranged', unlockXp: 0,
    shopOnly: true, noRequirement: true, needLegendary: true, price: 15000, pierce: true, projSpeed: 7.5, burn: 1200,
    special: { kind: 'sunorb',    dmg: 26, range: 230, cd: 9000 },
    super:   { kind: 'supernova', dmg: 30, cd: 22000 } },
  // ── The 10 update: two more legendaries (each needs another legendary first) ──
  // CHRONO STAFF: bolts that slow time around whatever they hit. Special: TIME
  // STOP — every foe close by is frozen in place. SUPER: REWIND — your health
  // goes back to the best it was in the last 4s, your special is ready again
  // and you get 4s of haste.
  { id: 'chronostaff', name: 'CHRONO STAFF', damage: 26, range: 300, atkSpd: 450, type: 'ranged', unlockXp: 0,
    shopOnly: true, noRequirement: true, needLegendary: true, price: 17000, chill: 1500, projSpeed: 5,
    special: { kind: 'timestop', dmg: 30, range: 230, cd: 9000 },
    super:   { kind: 'rewind',   dmg: 0,  cd: 20000 } },
  // VOID BLADE: every swing also sends a piercing wave of void ahead of it.
  // Special: RIFT STEP — through a rift to the nearest foe, cutting everything
  // around where you land. SUPER: SINGULARITY — a huge black hole that drags
  // the field in, then collapses in a massive blast.
  { id: 'voidblade',   name: 'VOID BLADE', damage: 38, range: 60, atkSpd: 520, type: 'melee', unlockXp: 0,
    shopOnly: true, noRequirement: true, needLegendary: true, price: 19000, voidWave: true,
    special: { kind: 'riftstep',    dmg: 70, range: 320, cd: 5000 },
    super:   { kind: 'singularity', dmg: 40, cd: 22000 } },
  // MIND TOME: a book of mind power. Only for a master of the Storm Tome (every
  // upgrade maxed) who already owns three other legendaries (needMind).
  // ATK: a psychic trap appears in the path of a nearby enemy — it only hurts
  // your enemies. SPECIAL: four beams of mind energy spin out from you and
  // freeze whatever they touch for 5s. SUPER: MIND CONTROL — take over the
  // strongest enemy on the map (20s for a monster, 5s for a boss or a player):
  // you vanish, your moves drive it and your attack uses its own attack on its
  // friends. Press SUPER again to let go.
  { id: 'mindtome', name: 'MIND TOME', damage: 30, range: 380, atkSpd: 600, type: 'ranged', unlockXp: 0,
    shopOnly: true, noRequirement: true, needMind: true, price: 25000, mindTrap: true,
    special: { kind: 'mindbeams',   dmg: 18, range: 170, cd: 9000 },
    super:   { kind: 'mindcontrol', dmg: 0,  cd: 30000 } },
  // The rarest weapon: free to claim, but only once you own every other weapon
  // in the game (needAll). Attack: melt into the shadows — invisible (you still
  // see yourself) and 75% faster; the next attack is a double-damage ghost
  // strike that ends it, and so does any special, super, ability or weapon swap.
  // Special: a fan of five thrown daggers, the middle one worth at least 16% of
  // the target's max health (32% in the back), the rest 40% of that. SUPER:
  // throw it skyward and it rains 60 knives.
  { id: 'ghostdagger', name: 'DAGGER OF GHOSTS', damage: 32, range: 48, atkSpd: 450, type: 'melee', unlockXp: 0,
    shopOnly: true, needAll: true, noRequirement: true, price: 0, ghostCloak: true,
    special: { kind: 'ghostthrow', dmg: 42, range: 430, cd: 12000 },
    super:   { kind: 'knifestorm', dmg: 110, cd: 24000 } },
  // A blade of pure light, claimed (free) by beating Light three times, over
  // any number of runs, with at least 75% of all weapons fully maxed (needLight).
  // Attack: dash to where you click or tap (or toward the nearest foe) and swipe
  // all round on arrival. Special: five curving dashes that hunt foes (or the
  // nearest pickup if there are none), stunning them and hurling them to the
  // wall. SUPER: LIGHTSPEED — triple speed, a crackling aura that zaps anything
  // close, and crashing into a foe sets off a huge lightning blast.
  // Never for sale: won by surviving the Abyss. Attack: a rapid burst of void
  // bolts from your crossbow and the two floating beside you. Special: the
  // Abyss's own massive orb (charged, then sent; it bursts only on impact).
  // SUPER: all three shoot one spot; where the bolts meet a black hole opens
  // that spits even more bolts and collapses for extreme damage.
  { id: 'infinitybow', name: 'CROSSBOWS OF INFINITY', damage: 12, range: 330, atkSpd: 330, type: 'ranged', unlockXp: 0, shopOnly: true, bossReward: true, price: 0,
    projSpeed: 7, infinityShot: true,
    special: { kind: 'abyssorb',    dmg: 240, range: 900, cd: 9000, aoe: 90 },
    super:   { kind: 'abyssvolley', dmg: 420, cd: 24000 } },
  // Never for sale: won by beating the Abyss a second time. Attack: a scythe
  // swipe whose hits drag foes in. Special: a void beam that spins a full circle
  // round you, fast, pulling everything in like a black hole. SUPER: the Abyss's
  // second phase — six scythes whirl round you, are flung out, then one huge slash.
  { id: 'endlessscythe', name: 'ENDLESS SCYTHE', damage: 46, range: 82, atkSpd: 560, type: 'melee', unlockXp: 0, shopOnly: true, bossReward: true, price: 0,
    voidPull: true,
    special: { kind: 'voidbeam',   dmg: 34, range: 320, cd: 9000 },
    super:   { kind: 'abysswhirl', dmg: 95, cd: 20000 } },
  // Bought for SAM_PRICE once you have cut down SAM_KILLS_NEED samurai (any runs).
  // Attack: a slash wave that seeks out foes. Special: a dash wave — when it
  // reaches a foe you flash through them at near light speed. SUPER: spin for 5s,
  // much faster and gliding, cutting and slowing everything you touch.
  { id: 'samuraiblade', name: "SAMURAI'S KATANA", damage: 48, range: 260, atkSpd: 520, type: 'ranged', unlockXp: 0,
    shopOnly: true, noRequirement: true, needSamurai: true, price: 30000, slashWave: true,
    special: { kind: 'dashwave', dmg: 240, range: 340, cd: 6500 },
    super:   { kind: 'katanaspin', dmg: 45, cd: 20000 } },
  { id: 'lightblade', name: 'LIGHT BLADE', damage: 40, range: 56, atkSpd: 620, type: 'melee', unlockXp: 0,
    shopOnly: true, noRequirement: true, needLight: true, price: 0, lightDash: true,
    special: { kind: 'lightdashes', dmg: 70, range: 260, cd: 9000 },
    super:   { kind: 'lightspeed', dmg: 320, cd: 26000 } },
];

// Melee reach: the swing is 50% longer and a slam special 30% wider. The shield
// and glove (their range is a ring around you) keep their numbers.
const MELEE_REACH_MULT = 1.5, SLAM_REACH_MULT = 1.3;
for (const w of WEAPONS) {
  if (w.type !== 'melee' || w.vortexShield || w.fireRing) continue;
  w.range = Math.round(w.range * MELEE_REACH_MULT);
  if (w.special && w.special.kind === 'slam') w.special.range = Math.round(w.special.range * SLAM_REACH_MULT);
}

const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map(w => [w.id, w]));

const WEAPON_COLORS = {
  scimitar: '#e8e0c8', slingshot: '#b08a5a', mace: '#9aa4b0', javelin: '#d8c8a0', claws: '#e0e4ec',
  emberstaff: '#ff7a2a', halberd: '#c0c8d8', frostbow: '#9fe8ff', chronostaff: '#e8c87a', voidblade: '#9a5aff',
  mindtome: '#ff5ad8', lightblade: '#fff27a',
  sword: '#c8d8e8', dagger: '#d4e8b0', axe: '#e8a040', spear: '#c0c8d0',
  bow: '#b89060', staff: '#cc66ff', hammer: '#aab0b8', wand: '#88ddff',
  crossbow: '#cc8844', flail: '#dd4444', greatsword: '#ddeeff',
  glaive: '#b0d8c0', katana: '#eef0ff', chakram: '#66e0c0', cannon: '#9a90a8', reaper: '#cc66aa',
  whip: '#c9a06a', grapple: '#9fb6c8', boomerang: '#d8b070',
  shuriken: '#d8dde6', frostrod: '#8fe0ff', blunderbuss: '#c89a5a', lance: '#e8d8a0', stormtome: '#ffe45a',
  fireglove: '#ff6a1a', vortex: '#7ad8ff', windwand: '#aef5dc', revolver: '#ffb347', portalwand: '#b07aff', infinitybow: '#9a5aff', samuraiblade: '#ff5a5a', endlessscythe: '#7a2aff',
  ghostdagger: '#a8f0ff', stormhammer: '#7ac8ff', frostscythe: '#bfefff', sunbow: '#ffd24a',
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
  // Parry upgrades (the _parry row in the shop)
  pwin:  { name: 'WINDOW',    short: 'WIN', max: 6,  perLevel: 0.12,  baseCost: 16, desc: '+12% parry duration' },
  pcd:   { name: 'RECHARGE',  short: 'RCH', max: 8,  perLevel: 0.07,  baseCost: 14, desc: '-7% parry cooldown' },
  prefl: { name: 'REFLECT',   short: 'RFL', max: 6,  perLevel: 0.15,  baseCost: 18, desc: '+0.15x damage sent back by a parry' },
  // Character upgrades (the _hero row)
  hp:    { name: 'HEALTH',    short: 'HP',  max: 10, perLevel: 10,    baseCost: 15, desc: '+10 max health' },
  move:  { name: 'SPEED',     short: 'MOV', max: 6,  perLevel: 0.04,  baseCost: 16, desc: '+4% move speed' },
  def:   { name: 'DEFENSE',   short: 'DEF', max: 8,  perLevel: 0.03,  baseCost: 18, desc: '-3% damage taken' },
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
  fireglove:   ['dmg', 'rng', 'crit', 'multi', 'aoe'],
  vortex:      ['dmg', 'spd', 'cdr'],
  windwand:    ['dmg', 'spd', 'knock', 'rng', 'aoe'],
  revolver:    ['dmg', 'spd', 'aoe', 'crit', 'multi'],
  portalwand:  ['dmg', 'crit', 'cdr', 'aoe'],
  infinitybow: ['dmg', 'spd', 'crit', 'cdr', 'multi'],
  samuraiblade: ['dmg', 'spd', 'crit', 'cdr', 'rng'],
  endlessscythe: ['dmg', 'spd', 'rng', 'crit', 'cdr'],
  ghostdagger: ['dmg', 'spd', 'crit', 'cdr'],
  stormhammer: ['dmg', 'spd', 'crit', 'cdr', 'knock'],
  frostscythe: ['dmg', 'rng', 'chill', 'cdr', 'aoe'],
  sunbow:      ['dmg', 'spd', 'rng', 'crit', 'cdr'],
  scimitar:    ['spd', 'crit', 'cdr'],
  slingshot:   ['dmg', 'spd', 'knock'],
  mace:        ['dmg', 'knock', 'cdr'],
  javelin:     ['dmg', 'rng', 'crit'],
  claws:       ['spd', 'life', 'crit'],
  emberstaff:  ['dmg', 'aoe', 'cdr'],
  halberd:     ['dmg', 'rng', 'knock'],
  frostbow:    ['dmg', 'chill', 'multi'],
  chronostaff: ['dmg', 'spd', 'chill', 'cdr'],
  voidblade:   ['dmg', 'spd', 'crit', 'cdr', 'rng'],
  mindtome:    ['dmg', 'spd', 'cdr', 'rng'],   // no SPD or MLT: its portals come fast enough
  lightblade:  ['dmg', 'spd', 'crit', 'cdr', 'rng'],
};
// ── Weapon passives ──
// Max out every upgrade on one of these weapons and, whenever you hold it, you
// get its passive. Clients draw each one (an aura and its own effect) so it
// can be seen; WEAPON_META[id].passive carries these to the upgrade menu.
const PASSIVES = {
  dagger:    { name: 'SWIFTNESS',     color: '#5ac8ff', desc: '+45% move speed' },
  sword:     { name: 'GUARDIAN',      color: '#e8f0ff', desc: 'take 30% less damage' },
  axe:       { name: 'BERSERKER',     color: '#ff4a3a', desc: 'up to +100% damage the lower your health' },
  bow:       { name: 'EAGLE EYE',     color: '#ffd24a', desc: '+30% range and +18% critical chance' },
  staff:     { name: 'ARCANE FLOW',   color: '#b07aff', desc: 'your special recharges 50% faster' },
  katana:    { name: 'BLADE DANCE',   color: '#ff7ac8', desc: '30% faster attacks' },
  reaper:    { name: 'SOUL HARVEST',  color: '#7aff9a', desc: 'every kill heals 12% of your health' },
  frostrod:  { name: 'FROST AURA',    color: '#9fe8ff', desc: 'monsters close to you are heavily slowed' },
  fireglove: { name: 'EMBER SKIN',    color: '#ff8a2a', desc: 'you never burn, and monsters that hit you get scorched and catch fire' },
  stormtome: { name: 'STATIC CHARGE', color: '#c8a0ff', desc: 'zaps the nearest foe every 1.2s for 90% of your damage' },
  // Every legendary has one too (the Fire Glove's is EMBER SKIN above).
  vortex:      { name: 'AEGIS',          color: '#7ad8ff', desc: 'blocks one hit completely every 4s' },
  windwand:    { name: 'GALE GUARD',     color: '#d8f4ff', desc: 'blows away an enemy shot that comes close, every 0.5s' },
  revolver:    { name: 'CHAIN REACTION', color: '#ffa040', desc: 'every hit explodes onto the foes around it, and everything you kill blows up even bigger' },
  endlessscythe: { name: 'EVENT HORIZON', color: '#7a2aff', desc: 'every hit stuns the target and drags it toward you' },
  samuraiblade: { name: 'WAY OF THE BLADE', color: '#ff5a5a', desc: 'you move 75% faster while heading toward an enemy' },
  infinitybow: { name: 'ENDLESS VOLLEY', color: '#9a5aff', desc: 'every 5th attack fires twice as many bolts' },
  portalwand:  { name: 'ESCAPE PORTAL',  color: '#b07aff', desc: 'when a hit drops you below 35% health you warp to safety and heal 20% (every 8s)' },
  ghostdagger: { name: 'HAUNTING',       color: '#a8f0ff', desc: 'your thrown daggers turn in the air and chase down your enemies' },
  stormhammer: { name: 'THUNDERSTRUCK',  color: '#7ac8ff', desc: '35% of your hits call down lightning for +80% damage' },
  frostscythe: { name: 'SHATTERPOINT',   color: '#bfefff', desc: '+50% damage to slowed or frozen foes' },
  chronostaff: { name: 'TIME DILATION',  color: '#e8c87a', desc: 'your special and super recharge 40% faster' },
  mindtome:    { name: 'SHIFTING GROUND', color: '#ff5ad8', desc: 'every 30s every trap on the map jumps next to your enemies (a countdown over your head shows when)' },
  lightblade:  { name: 'AFTERGLOW',      color: '#fff27a', desc: 'every dash leaves a streak of light behind for 2.5s that burns and stuns any foe who touches it' },
  voidblade:   { name: 'VOID HUNGER',    color: '#9a5aff', desc: 'every kill takes 1.5s off your special and super' },
  sunbow:      { name: 'SUNLIT',         color: '#ffd24a', desc: 'heal 5% of your health every second' },
};
const AEGIS_CD = 4000, GALE_CD = 500, GALE_R = 75;
const BLAST_R = 90, BLAST_MULT = 1.1, HIT_BLAST_R = 65, HIT_BLAST_MULT = 0.55, HIT_BLAST_GAP = 60;
const ESCAPE_CD = 8000, ESCAPE_AT = 0.35, ESCAPE_HEAL = 0.2, THUNDER_CHANCE = 0.35, THUNDER_MULT = 1.8;
const SHATTER_MULT = 1.5, SUNLIT_SHARE = 0.05;
const PASSIVE_SPEED = 1.45, PASSIVE_GUARD = 0.7, PASSIVE_RAGE = 1.0, PASSIVE_HARVEST = 0.12;
const FROST_AURA_R = 115, STATIC_CD = 1200, STATIC_R = 220, STATIC_MULT = 0.9, EMBER_BURN = 4000, EMBER_SCORCH = 0.4;

function weaponMaxed(p, wid) {
  const lv = p.upgrades?.[wid] || {};
  return upgradesFor(wid).every(k => (lv[k] || 0) >= UPGRADE_STATS[k].max);
}

// Upgrade rows that aren't weapons: always available, stored alongside the
// weapon upgrades under these ids.
const PERK_UPGRADES = {
  _parry: ['pwin', 'pcd', 'prefl'],
  _hero:  ['hp', 'move', 'def'],
};
function upgradesFor(weaponId) { return PERK_UPGRADES[weaponId] || WEAPON_UPGRADES[weaponId] || ['dmg', 'spd', 'rng']; }
function isUpgradeTarget(id) { return !!(WEAPON_BY_ID[id] || PERK_UPGRADES[id]); }

// A player's character and parry stats, from their perk upgrades.
function perkLevel(p, row, stat) { return (p.upgrades?.[row]?.[stat]) || 0; }
function applyPerks(p) {
  const hurt = p.maxHp - p.hp;
  p.maxHp = 100 + perkLevel(p, '_hero', 'hp') * UPGRADE_STATS.hp.perLevel;
  p.hp = Math.max(1, Math.min(p.maxHp, p.maxHp - hurt));
  p.speed = PLAYER_SPEED * (1 + perkLevel(p, '_hero', 'move') * UPGRADE_STATS.move.perLevel);
  p.defense = perkLevel(p, '_hero', 'def') * UPGRADE_STATS.def.perLevel;
  p.parryWindow = Math.round(PARRY_WINDOW * (1 + perkLevel(p, '_parry', 'pwin') * UPGRADE_STATS.pwin.perLevel));
  p.parryCd = Math.round(PARRY_COOLDOWN * (1 - perkLevel(p, '_parry', 'pcd') * UPGRADE_STATS.pcd.perLevel));
  p.parryReflect = PARRY_REFLECT + perkLevel(p, '_parry', 'prefl') * UPGRADE_STATS.prefl.perLevel;
}
// Reflect multiplier of whoever parried (monsters/unknown fall back to the base).
function reflectOf(t) { return (t && t.parryReflect) || PARRY_REFLECT; }

// ── Skins bought with coins: full outfits drawn over the character ──
// Ownership is saved per password; a skin can only be worn once it is owned.
const SKIN_SHOP = [
  { id: 'ninja',     name: 'NINJA',     price: 120 },
  { id: 'knight',    name: 'KNIGHT',    price: 150 },
  { id: 'pirate',    name: 'PIRATE',    price: 180 },
  { id: 'wizard',    name: 'WIZARD',    price: 200 },
  { id: 'viking',    name: 'VIKING',    price: 240 },
  { id: 'skeleton',  name: 'SKELETON',  price: 280 },
  { id: 'samurai',   name: 'SAMURAI',   price: 320 },
  { id: 'robot',     name: 'ROBOT',     price: 350 },
  { id: 'astronaut', name: 'ASTRONAUT', price: 400 },
  { id: 'vampire',   name: 'VAMPIRE',   price: 450 },
  { id: 'shadow',    name: 'SHADOW',    price: 500 },
  { id: 'pumpkin',   name: 'PUMPKIN',   price: 550 },
  { id: 'inferno',   name: 'INFERNO',   price: 650 },
  { id: 'frost',     name: 'FROST',     price: 700 },
  { id: 'golden',    name: 'GOLDEN',    price: 900 },
  { id: 'angel',     name: 'ANGEL',     price: 1100 },
];
const SKIN_COLOR_COUNT = 24, SKIN_HAT_COUNT = 15, SKIN_ACC_COUNT = 10;
const SKIN_BY_ID = Object.fromEntries(SKIN_SHOP.map(s => [s.id, s]));

// ── Abilities: bought once with coins and kept forever (saved per password,
// like weapons). Two can be equipped at a time, on Q and E.
const ABILITIES = [
  { id: 'dash',   name: 'DASH',        price: 1500,  cd: 3500,  color: '#9fe8ff',
    desc: 'Dash to your mouse cursor. On phones and tablets: a long dash the way you are moving. Untouchable mid-dash' },
  { id: 'heal',   name: 'SECOND WIND', price: 3000,  cd: 25000, color: '#7affb0',
    desc: 'Heal 35% of your max HP' },
  { id: 'frost',  name: 'FROST NOVA',  price: 5000,  cd: 16000, color: '#8fd8ff',
    desc: 'Freeze everything around you solid for 2.5s and chip it for damage' },
  { id: 'rage',   name: 'BERSERK',     price: 7000,  cd: 28000, color: '#ff5544',
    desc: 'Hit 80% harder and attack twice as fast for 6s' },
  { id: 'meteor', name: 'METEOR SHOWER', price: 10000, cd: 24000, color: '#ff9a3a',
    desc: 'Rain 18 meteors across the whole map for 3s, each one a massive blast' },
  { id: 'aegis',  name: 'AEGIS',       price: 4000,  cd: 20000, color: '#ffe066',
    desc: 'A golden barrier: take no damage at all for 3s' },
  { id: 'warp',   name: 'TIME WARP',   price: 6500,  cd: 22000, color: '#c8a0ff',
    desc: 'Slow every enemy on the map to a crawl for 5s' },
  { id: 'storm',  name: 'THUNDERSTORM', price: 8500, cd: 15000, color: '#ffe45a',
    desc: 'Call down lightning on up to 9 different enemies at once' },
  { id: 'drain',  name: 'LIFE DRAIN',  price: 9000,  cd: 24000, color: '#ff4a6a',
    desc: 'A blood aura for 5s: hurts everything near you and heals you for the damage' },
  { id: 'blackhole', name: 'BLACK HOLE', price: 12000, cd: 26000, color: '#8a5aff',
    desc: 'A singularity drags every enemy toward it and crushes them for 3.5s' },
  // ── The second shelf ──
  { id: 'shadowstep', name: 'SHADOW STEP', price: 2500, cd: 7000, color: '#a08aff',
    desc: 'Vanish and reappear behind the nearest enemy, striking it in the back' },
  { id: 'quake',     name: 'EARTHQUAKE',  price: 4500,  cd: 14000, color: '#c89a5a',
    desc: 'Slam the ground: hurts and stuns everything close around you' },
  { id: 'firenova',  name: 'FIRE NOVA',   price: 3500,  cd: 11000, color: '#ff7a2a',
    desc: 'A huge ring of fire bursts out from you, burning everything it touches' },
  { id: 'chain',     name: 'CHAIN LIGHTNING', price: 6000, cd: 10000, color: '#8ff0ff',
    desc: 'A bolt that leaps from enemy to enemy, up to 7 of them' },
  { id: 'army',      name: 'CALL TO ARMS', price: 11000, cd: 30000, color: '#7affc8',
    desc: 'Four monsters in your colour step out of the air and fight for you for 14s' },
  { id: 'sentry',    name: 'FIRE SENTRY', price: 5500,  cd: 18000, color: '#ff5a3a',
    desc: 'Opens a fire portal beside you that throws 8 fireballs at your enemies' },
  { id: 'cyclone',   name: 'CYCLONE',     price: 5000,  cd: 12000, color: '#aef5dc',
    desc: 'A tornado rolls toward the nearest enemy, dragging foes in and shredding them' },
  { id: 'vanish',    name: 'VANISH',      price: 7500,  cd: 22000, color: '#6a6a9a',
    desc: 'Turn invisible for 4s: monsters lose track of you and their shots pass through' },
  { id: 'adrenaline', name: 'ADRENALINE', price: 3000,  cd: 18000, color: '#ffb84a',
    desc: 'Run 70% faster and attack twice as fast for 5s' },
  { id: 'barrier',   name: 'BARRIER',     price: 6500,  cd: 18000, color: '#7ad8ff',
    desc: 'A dome around you for 4s that destroys every enemy shot that reaches it' },
  { id: 'toxic',     name: 'TOXIC CLOUD', price: 4000,  cd: 13000, color: '#8ad048',
    desc: 'A poison cloud on the nearest enemy for 5s: hurts and slows everything inside' },
  { id: 'vampirism', name: 'VAMPIRISM',   price: 8000,  cd: 24000, color: '#d8304a',
    desc: 'For 8s every hit you land heals you for a quarter of its damage' },
  { id: 'rejuvenate', name: 'REJUVENATE', price: 2000,  cd: 20000, color: '#ff7ac8',
    desc: 'Heal 15% at once, then 5 HP every second for 10s' },
  { id: 'airstrike', name: 'AIRSTRIKE',   price: 9500,  cd: 16000, color: '#ffd27a',
    desc: 'Eight bombs fall on your enemies one after another' },
  { id: 'gravity',   name: 'GRAVITY GRIP', price: 5000, cd: 12000, color: '#b08aff',
    desc: 'Yank every nearby enemy in to you (bosses are too heavy)' },
  { id: 'forcepush', name: 'FORCE PUSH',  price: 3500,  cd: 9000,  color: '#e0e8ff',
    desc: 'Blast everything close to you far away and hurt it' },
  { id: 'golem',     name: 'STONE GOLEM', price: 14000, cd: 32000, color: '#9aa8b8',
    desc: 'A huge golem in your colour fights beside you for 12s' },
  { id: 'execute',   name: 'EXECUTE',     price: 10000, cd: 14000, color: '#ff3a4a',
    desc: 'Strike the most wounded enemy near you: below 30% health it dies outright (not bosses)' },
  { id: 'icelance',  name: 'ICE LANCE',   price: 4500,  cd: 10000, color: '#bfefff',
    desc: 'A line of ice spikes toward the nearest enemy that hurts and freezes all in its path' },
  { id: 'phoenix',   name: 'PHOENIX',     price: 15000, cd: 60000, color: '#ffa03a',
    desc: 'For 10s, a killing blow brings you straight back with half your health' },
  // ── The 10 update ──
  { id: 'perfectguard', name: 'PERFECT GUARD', price: 6000, cd: 16000, color: '#ffffff',
    desc: 'A 2.5s parry: every blow and shot that reaches you is thrown back' },
  { id: 'haven',     name: 'SAFE HAVEN',  price: 4000,  cd: 18000, color: '#7affe0',
    desc: 'Warp to the safest spot on the map and heal 15%' },
  { id: 'flurry',    name: 'BLADE FLURRY', price: 3500, cd: 9000,  color: '#d8dde6',
    desc: 'Twelve blades fly out all around you, slicing through everything' },
  { id: 'mines',     name: 'LANDMINES',   price: 5000,  cd: 14000, color: '#ff6a3a',
    desc: 'Drop three mines around you that blow up when an enemy steps close' },
  { id: 'soulchain', name: 'SOUL CHAIN',  price: 4500,  cd: 10000, color: '#7a9aff',
    desc: 'Chain the nearest enemy, drag it to you and stun it' },
  { id: 'warcry',    name: 'WAR CRY',     price: 5500,  cd: 20000, color: '#ff8a3a',
    desc: 'Hit 80% harder for 5s and stun every enemy close around you' },
  { id: 'overcharge', name: 'OVERCHARGE', price: 13000, cd: 45000, color: '#5ae8ff',
    desc: 'Your special and super are ready again, right now' },
  { id: 'fireball',  name: 'FIREBALL',    price: 4000,  cd: 8000,  color: '#ff5a1a',
    desc: 'Hurl a huge fireball that explodes and sets everything around it alight' },
  { id: 'smite',     name: 'SMITE',       price: 8000,  cd: 12000, color: '#fff2a0',
    desc: 'A pillar of light crashes down on the toughest enemy near you' },
  { id: 'frostarmor', name: 'FROST ARMOR', price: 6500, cd: 22000, color: '#9fe8ff',
    desc: 'Ice armour for 6s: take 25% less damage and freeze whoever hits you' },
];
const ABILITY_BY_ID = Object.fromEntries(ABILITIES.map(a => [a.id, a]));
// Everyone starts with two slots (Q, E); up to four more can be bought, each
// for a fortune. Keys: Q E F G V B.
const ABILITY_SLOTS = 2, MAX_ABILITY_SLOTS = 6;
const SLOT_PRICES = [75000, 150000, 300000, 600000];   // the 3rd, 4th, 5th and 6th slot
const AB_KEYS = ['Q', 'E', 'F', 'G', 'V', 'B'];
const DASH_DIST = 150, DASH_CURSOR_MAX = 170, DASH_IFRAMES = 360;   // DASH_DIST: the way you're moving (touch, or no cursor)
const AEGIS_MS = 3000, WARP_MS = 5000;
const STORM_BOLTS = 9, STORM_DMG = 85;
const DRAIN_MS = 5000, DRAIN_R = 95, DRAIN_TICK = 400, DRAIN_DMG = 18, DRAIN_HEAL = 0.6;
const HOLE_MS = 3500, HOLE_R = 30, HOLE_PULL_R = 180, HOLE_TICK = 350, HOLE_DMG = 32;
const HEAL_SHARE = 0.35;
const FROST_R = 95, FROST_FREEZE_MS = 2500, FROST_DMG = 20;
const RAGE_MS = 6000;
const METEOR_R = 50, METEOR_FALL_MS = 800, METEOR_DMG = 280, METEOR_PVP_DMG = 40;
const SHOWER_COUNT = 18, SHOWER_MS = 3000;
const QUAKE_R = 130, NOVA_R = 170, CHAIN_JUMPS = 7, CHAIN_REACH = 170, GRAVITY_R = 240, PUSH_R = 150, PUSH_DIST = 110;
const VANISH_MS = 4000, BARRIER_MS = 4000, BARRIER_R = 58, CLOUD_MS = 5000, CLOUD_R = 70, CLOUD_TICK = 400;
const STRIKES = 8, EXECUTE_R = 230, EXECUTE_SHARE = 0.3, LANCE_LEN = 290, PHOENIX_MS = 10000;

// Equipped slots, keeping only abilities the player owns and no duplicates.
function cleanSlots(raw, owned, count = ABILITY_SLOTS) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const id = Array.isArray(raw) ? raw[i] : null;
    out.push(typeof id === 'string' && owned.includes(id) && !out.includes(id) ? id : null);
  }
  return out;
}

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
  // ── Monsters with their own tricks (see MONSTER_AI) ──
  // Rushes in, lights its fuse when it's next to you and blows up a beat later.
  // Kill it first and it pops on its own pack instead.
  bomber: {
    name: 'BOMBER',   minWave: 4,  weight: 4,  hp: 0.7,  dmg: 1.0, speed: 1.55, size: 0.9,
    color: '#e0a020', xp: 1.1, coins: 1.1, ai: 'bomber',
  },
  // Hangs back behind the pack, healing everything near it and warding it
  // against damage.
  shaman: {
    name: 'SHAMAN',   minWave: 6,  weight: 3,  hp: 1.1,  dmg: 0.8, speed: 0.85, size: 1.0,
    color: '#3ac08a', xp: 1.5, coins: 1.6, ai: 'shaman',
  },
  // A big slime that bursts into two quick slimelets when it dies.
  splitter: {
    name: 'SPLITTER', minWave: 8,  weight: 3,  hp: 1.8,  dmg: 1.2, speed: 0.75, size: 1.3,
    color: '#4ad0c8', xp: 1.3, coins: 1.3, split: 'slimelet', splitCount: 2,
  },
  // Lowers its head, then rams in a straight line; it is dazed if it hits a wall.
  charger: {
    name: 'CHARGER',  minWave: 9,  weight: 3,  hp: 2.2,  dmg: 1.4, speed: 0.8,  size: 1.3,
    color: '#9a7050', xp: 1.6, coins: 1.7, armor: 0.15, ai: 'charger',
  },
  // Raises skeletons from the floor; they crumble when it dies.
  necromancer: {
    name: 'NECROMANCER', minWave: 12, weight: 2, hp: 1.6, dmg: 1.0, speed: 0.8, size: 1.1,
    color: '#5a4a7a', xp: 2.0, coins: 2.2, ai: 'necro',
  },
  // A common duelist: throws slash waves at you, and now and then a quiet wave
  // that does nothing itself — if it touches you, he flashes through you with
  // his katana for huge damage. Parry that and he is left stunned.
  samurai: {
    name: 'SAMURAI', minWave: 3, weight: 7, hp: 1.1, dmg: 1.1, speed: 1.15, size: 1.0,
    color: '#c8303a', xp: 1.8, coins: 2.0, ai: 'samurai',
  },
  // Blindingly fast and rare (see maybeLightWave): sweeps through you and
  // blinks away, or chains curving dashes. Usually comes alone.
  light: {
    name: 'LIGHT', minWave: 6, weight: 0, hp: 3.0, dmg: 1.4, speed: 2.9, size: 1.05,
    color: '#fff6a0', xp: 3.5, coins: 4.0, ai: 'light', rare: true,
  },
  // ── Minions (never spawned by waves, only by the monsters above) ──
  slimelet: {
    name: 'SLIMELET', minWave: 1, weight: 0, hp: 0.45, dmg: 0.6, speed: 1.6, size: 0.7,
    color: '#7ae8e0', xp: 0.4, coins: 0.4, minion: true,
  },
  skeleton: {
    name: 'SKELETON', minWave: 1, weight: 0, hp: 0.5, dmg: 0.8, speed: 1.2, size: 0.85,
    color: '#d8d0b8', xp: 0.3, coins: 0.2, minion: true,
  },
  // ── Boss (never picked at random: see isBossWave) ──
  // The Giant: the most health in the game, a fixed huge body, and a whole tree
  // for a club. No ordinary attacks — see updateGiant.
  giant: {
    name: 'GIANT', minWave: 1, weight: 0, hp: 16, dmg: 3.2, speed: 0.55, size: 2.7,
    color: '#6a8a4a', xp: 8, coins: 3, armor: 0.25, boss: true, fixedW: 84, fixedH: 104,
  },
  // The Portal Mage: only ever met in his own fight (the 'portal' mode). His
  // health is set by MAGE_HP, not the wave formula — see startMageFight.
  portalmage: {
    name: 'PORTAL MAGE', minWave: 1, weight: 0, hp: 1, dmg: 1.4, speed: 1.7, size: 1.6,
    color: '#7a3aff', xp: 0, coins: 0, armor: 0.15, boss: true, mage: true, fixedW: 30, fixedH: 42,
  },
  // The Abyss: four arms, two legs, fought on his own (mode 'abyss'). Health
  // is ABYSS_HP — see startAbyssFight.
  abyss: {
    name: 'THE ABYSS', minWave: 1, weight: 0, hp: 1, dmg: 1.6, speed: 1.35, size: 1.9,
    color: '#5a2aa8', xp: 0, coins: 0, armor: 0.2, boss: true, fixedW: 40, fixedH: 54,
  },
  // ── EXTREME only (extremeOnly: never in normal waves) ──
  // A walking fortress: the most health and armour in the game.
  titan: {
    name: 'TITAN',    minWave: 1, weight: 2, hp: 9.0, dmg: 3.2, speed: 0.55, size: 2.1,
    color: '#5a6a7a', xp: 3.0, coins: 3.2, armor: 0.35, extremeOnly: true,
  },
  // Blinks next to you from across the arena, then slashes fast.
  wraith: {
    name: 'WRAITH',   minWave: 1, weight: 4, hp: 1.8, dmg: 1.7, speed: 1.9, size: 1.0,
    color: '#3a2a5a', xp: 2.0, coins: 2.2, extremeOnly: true, blink: 2600,
  },
  // Keeps its distance and hurls fireballs that set you alight.
  infernal: {
    name: 'INFERNAL', minWave: 1, weight: 3, hp: 2.2, dmg: 1.5, speed: 0.8, size: 1.15,
    color: '#b8340e', xp: 2.2, coins: 2.4, extremeOnly: true,
    ranged: true, shotRange: 270, shotSpeed: 4.4, reload: 1500, shotId: 'hellfire', shotBurn: 1800,
  },
};

// EXTREME mode fields only the strongest monsters, starts as hard as a deep
// normal run (EXTREME_LEVEL_OFFSET waves in) and pays far more.
const EXTREME_ROSTER = { brute: 2, warden: 3, behemoth: 3, titan: 2, wraith: 4, infernal: 3,
                         bomber: 2, shaman: 2, splitter: 2, charger: 3, necromancer: 2, samurai: 8 };
const EXTREME_LEVEL_OFFSET = 9;
const EXTREME_COIN_MULT = 3;        // on top of the normal kill payout
const EXTREME_WAVE_BONUS = 120;     // coins per wave number, paid on every clear

function pickExtremeType() {
  const entries = Object.entries(EXTREME_ROSTER);
  let roll = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [id, w] of entries) { roll -= w; if (roll <= 0) return id; }
  return entries[0][0];
}
// When the Giant comes: the finale of co-op, every 20th wave of WAVES and
// every 5th of EXTREME.
const COOP_FINAL_WAVE = 10;
function isBossWave(num) {
  if (room.gameMode === 'coop')    return num === COOP_FINAL_WAVE;
  if (room.gameMode === 'waves')   return num % 20 === 0;
  if (room.gameMode === 'extreme') return num % 5 === 0;
  return false;
}

// The Portal Mage's minions arrive as tough as a deep EXTREME wave.
const PORTAL_LEVEL = 15;
function modeLevel(num) {
  if (room.gameMode === 'portal' || room.gameMode === 'abyss') return PORTAL_LEVEL;
  if (room.gameMode === 'sandbox') return room.sandbox.level;
  return num + (room.gameMode === 'extreme' ? EXTREME_LEVEL_OFFSET : 0);
}

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
    if (def.extremeOnly || def.boss || def.minion || def.rare || wave < def.minWave) continue;
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
  if (!d.abilities)   d.abilities = {};
  if (!d.abilitySlots) d.abilitySlots = {};
  if (!d.abilitySlotCount) d.abilitySlotCount = {};
  if (!d.lightKills)  d.lightKills = {};
  if (!d.samuraiKills) d.samuraiKills = {};
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

// Waves and EXTREME keep separate top-10 boards.
function addLeaderboardEntry(name, waves, mode) {
  const d = progress();
  const k = mode === 'extreme' ? 'extremeLeaderboard' : 'leaderboard';
  if (!Array.isArray(d[k])) d[k] = [];
  d[k].push({ name, waves, date: new Date().toISOString().split('T')[0] });
  d[k].sort((a, b) => b.waves - a.waves);
  d[k] = d[k].slice(0, 10);
  markDirty();
  return d[k];
}
function getLeaderboard() { return progress().leaderboard; }

// ─── Device Backups ───────────────────────────────────────────────────────────
// The host wipes progress.json on every deploy/restart. So each player's device
// keeps a full copy of their save, signed here so it can't be edited. When a
// password has no record on the server, the copy is restored as-is; otherwise
// only the things that never go down (XP, weapons, upgrades, skins) are merged
// in, and the server's coin count stays authoritative.
const SAVE_SECRET = process.env.SAVE_SECRET || 'weponare-save-v1:9f3c2b7e51a04d8c';

function signSave(pw, data) {
  return crypto.createHmac('sha256', SAVE_SECRET).update(pw + '\n' + data).digest('hex');
}
function saveData(pw) {
  const d = progress();
  return JSON.stringify({
    v: 1, xp: d.players[pw] || 0, coins: d.coins[pw] || 0,
    weapons: d.weapons[pw] || [], upgrades: d.upgrades[pw] || {},
    ownedSkins: d.ownedSkins[pw] || [], skin: d.skins[pw] || null,
    abilities: d.abilities[pw] || [], abilitySlots: d.abilitySlots[pw] || [],
    slotCount: d.abilitySlotCount[pw] || ABILITY_SLOTS,
    lightKills: d.lightKills[pw] || 0,
    samuraiKills: d.samuraiKills[pw] || 0,
  });
}
function makeSave(pw) {
  if (!pw || isAdminPw(pw)) return null;
  const data = saveData(pw);
  return { data, sig: signSave(pw, data) };
}

function restoreBackup(pw, backup) {
  if (!pw || isAdminPw(pw) || !backup || typeof backup !== 'object') return;
  const { data, sig } = backup;
  if (typeof data !== 'string' || typeof sig !== 'string' || data.length > 60000) return;
  const want = signSave(pw, data);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return;
  let b;
  try { b = JSON.parse(data); } catch { return; }
  if (!b || typeof b !== 'object') return;

  const d = progress();
  const num = v => Math.max(0, Math.floor(Number(v) || 0));
  const weapons = Array.isArray(b.weapons) ? b.weapons.filter(id => WEAPON_BY_ID[id]) : [];
  const skins = Array.isArray(b.ownedSkins) ? b.ownedSkins.filter(id => SKIN_BY_ID[id]) : [];
  const abils = Array.isArray(b.abilities) ? b.abilities.filter(id => ABILITY_BY_ID[id]) : [];
  const ups = {};
  if (b.upgrades && typeof b.upgrades === 'object') {
    for (const [wid, lv] of Object.entries(b.upgrades)) {
      if (!lv || typeof lv !== 'object') continue;
      ups[wid] = {};
      for (const [k, n] of Object.entries(lv)) if (UPGRADE_STATS[k]) ups[wid][k] = num(n);
    }
  }

  const fresh = d.players[pw] === undefined && d.coins[pw] === undefined
    && !d.weapons[pw] && !d.upgrades[pw] && !d.ownedSkins[pw] && !d.abilities[pw];
  if (fresh) {
    // Server lost this save: put it all back. Upgrade stats an update removed
    // are left in, so profileFor refunds them like any other stale upgrade.
    d.players[pw] = num(b.xp);
    d.coins[pw] = num(b.coins);
    d.weapons[pw] = sortWeaponIds(weapons);
    d.upgrades[pw] = ups;
    d.ownedSkins[pw] = skins;
    d.abilities[pw] = abils;
    d.abilitySlotCount[pw] = clampSlots(b.slotCount);
    d.abilitySlots[pw] = cleanSlots(b.abilitySlots, abils, d.abilitySlotCount[pw]);
    d.lightKills[pw] = num(b.lightKills);
    d.samuraiKills[pw] = num(b.samuraiKills);
    if (b.skin && typeof b.skin === 'object' && d.skins[pw] === undefined) d.skins[pw] = b.skin;
    markDirty();
    return;
  }

  // Both sides have a save (e.g. another device): merge what only goes up.
  let changed = false;
  if (num(b.xp) > (d.players[pw] || 0)) { d.players[pw] = num(b.xp); changed = true; }
  const have = d.weapons[pw] || [];
  if (weapons.some(id => !have.includes(id))) { d.weapons[pw] = sortWeaponIds([...have, ...weapons]); changed = true; }
  const owned = d.ownedSkins[pw] || [];
  if (skins.some(id => !owned.includes(id))) { d.ownedSkins[pw] = [...new Set([...owned, ...skins])]; changed = true; }
  const haveAb = d.abilities[pw] || [];
  if (abils.some(id => !haveAb.includes(id))) { d.abilities[pw] = [...new Set([...haveAb, ...abils])]; changed = true; }
  if (clampSlots(b.slotCount) > (d.abilitySlotCount[pw] || ABILITY_SLOTS)) { d.abilitySlotCount[pw] = clampSlots(b.slotCount); changed = true; }
  if (num(b.lightKills) > (d.lightKills[pw] || 0)) { d.lightKills[pw] = num(b.lightKills); changed = true; }
  if (num(b.samuraiKills) > (d.samuraiKills[pw] || 0)) { d.samuraiKills[pw] = num(b.samuraiKills); changed = true; }
  for (const [wid, lv] of Object.entries(ups)) {
    const allowed = upgradesFor(wid);
    for (const [k, n] of Object.entries(lv)) {
      if (!allowed.includes(k) || !isUpgradeTarget(wid)) continue;
      if (!d.upgrades[pw]) d.upgrades[pw] = {};
      if (!d.upgrades[pw][wid]) d.upgrades[pw][wid] = {};
      if (n > (d.upgrades[pw][wid][k] || 0)) { d.upgrades[pw][wid][k] = n; changed = true; }
    }
  }
  if (changed) markDirty();
}

// Keep every connected player's device copy up to date as they earn and spend.
function pushSaves() {
  for (const r of rooms) for (const key of KEYS) {
    const ws = r[key], pw = r.passwords[key];
    if (!ws || ws.readyState !== 1 || !pw || isAdminPw(pw)) continue;
    const data = saveData(pw);
    if (ws.lastSave === data) continue;
    ws.lastSave = data;
    ws.send(JSON.stringify({ type: 'save', save: { data, sig: signSave(pw, data) } }));
  }
}
setInterval(pushSaves, 3000).unref?.();

function getUnlockedWeaponIds(xp) {
  return WEAPONS.filter(w => !w.shopOnly && w.unlockXp <= xp).map(w => w.id);
}
// Everything XP can unlock — owning all of these is what opens the shop-only weapons.
const XP_WEAPON_IDS = WEAPONS.filter(w => !w.shopOnly).map(w => w.id);
const SHOP_WEAPONS = WEAPONS.filter(w => w.shopOnly);

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
    if (!isUpgradeTarget(wid) || !lv || typeof lv !== 'object') continue;
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
    lifesteal: (w.lifesteal || 0) + L('life') * per('life'),
    knock: (w.knock || 0) + L('knock') * per('knock'),
    multi,
    chill: w.chill ? Math.round(w.chill * chillM) : w.chill,
    chain: (w.chain || 0) + L('chain'),
    special: sp ? {
      ...sp,
      dmg: Math.max(1, Math.round(sp.dmg * dmgM)),
      // A slam's range is its blast radius, so BLAST widens it too.
      range: Math.round(sp.range * (sp.kind === 'slam' ? aoeM : rngM)),
      cd: Math.max(sp.minCd || 500, Math.round(sp.cd * cdM)),   // fire glove hands may go faster
      aoe: sp.aoe ? Math.round(sp.aoe * aoeM) : sp.aoe,
      blast: sp.blast ? Math.max(1, Math.round(sp.blast * dmgM)) : sp.blast,
      chill: sp.chill ? Math.round(sp.chill * chillM) : sp.chill,
      count: sp.count ? sp.count + multi * (sp.kind === 'ring' ? 2 : 1) : sp.count,
    } : null,
    super: w.super ? { ...w.super, dmg: Math.max(1, Math.round(w.super.dmg * dmgM)) } : w.super,
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
  // A maxed weapon's passive (the sandbox can switch them all on).
  const free = room && room.gameMode === 'sandbox' && room.sandbox?.passives;
  p.passive = PASSIVES[base.id] && (free || weaponMaxed(p, base.id)) ? base.id : null;
  if (p.passive === 'bow')    p.w_ = { ...p.w_, range: Math.round(p.w_.range * 1.3), crit: (p.w_.crit || 0) + 0.18 };
  if (p.passive === 'katana') p.w_ = { ...p.w_, atkSpd: Math.max(70, Math.round(p.w_.atkSpd * 0.7)) };
  if (p.passive === 'staff' && p.w_.special) p.w_ = { ...p.w_, special: { ...p.w_.special, cd: Math.round(p.w_.special.cd * 0.5) } };
  // Swapping off the Dagger of Ghosts drops its cloak.
  if (!base.ghostCloak && p.effects && p.effects.ghost) breakGhost(p);
}
function weapon(p) { return p.w_ || WEAPONS[0]; }

// ─── Room State ───────────────────────────────────────────────────────────────

function spawnPointFor(num) {
  const midX = ARENA_X + Math.round(ARENA_W / 2) - PLAYER_W / 2, midY = ARENA_Y + Math.round(ARENA_H / 2) - PLAYER_H / 2;
  // (not right at the top: the weapon rack covers the top middle of the screen)
  if (num === 3) return { x: midX, y: ARENA_Y + ARENA_H - 40 - PLAYER_H };
  if (num === 4) return { x: midX, y: ARENA_Y + Math.round(ARENA_H * 0.32) };
  return { x: num === 1 ? ARENA_X + 56 : ARENA_X + ARENA_W - 56 - PLAYER_W, y: midY };
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
    superCooldown: 0,
    abilities: [null, null],   // equipped on Q and E
    abCd: {},                  // ability id -> ms until it's ready
    vortexShield: 0,     // ms the vortex shield stays up
    vortexStore: 0,      // damage banked while it was up
    parryCooldown: 0,
    parryTimer: 0,
    swingTimer: 0,
    invincible: 0,
    hitFlash: 0,
    dead: false,
    respawnTimer: 0,
    skin: { colorIdx: 0, hatIdx: 0, accIdx: 0, outfit: '' },
    inventory: [],
    effects: {},
    pull: null,
  };
  refreshWeapon(p);
  applyPerks(p);
  return p;
}

// Player seats. PvP rooms can hold up to four (last one standing); the rest use p1/p2.
const KEYS = ['p1', 'p2', 'p3', 'p4'];
const isPKey = k => KEYS.includes(k);
const perKey = v => Object.fromEntries(KEYS.map(k => [k, typeof v === 'function' ? v(k) : v]));
function allPlayers() { return KEYS.map(k => room.players[k]); }
const blankInput = () => ({ up: false, down: false, left: false, right: false, attack: false, swap: false, swapPrev: false, special: false, parry: false, super: false, ab1: false, ab2: false });
const blankPrev = () => ({ attack: false, swap: false, swapPrev: false, special: false, parry: false, super: false });
function newRound() { return { wins: perKey(0), maxWins: 3, matchWinner: 0 }; }

function emptyWave() { return { num: 0, monstersLeft: 0, spawnQueue: 0, spawnTimer: 0, betweenTimer: 0 }; }

// Every game runs in its own room. The game code works on `room`, which the
// loop and the socket handlers point at the right one before running
// (single-threaded, so it can never be caught half-switched).
function makeRoom() { return {
  id: Math.random().toString(36).slice(2, 10),
  p1: null, p2: null, p3: null, p4: null,
  gameState: 'LOBBY',
  gameMode: 'pvp',
  mapSize: 'medium',
  maxPlayers: 2,
  custom: null,          // a created room: { name, host }
  chats: [],             // quick-chat lines on screen: { key, id, t }
  playerNames: perKey(k => 'PLAYER ' + k.slice(1)),
  passwords: perKey(''),
  playerXp: perKey(0),
  playerCoins: perKey(0),
  playerSkins: perKey(null),
  playerUnlocks: perKey(null),
  playerUpgrades: perKey(null),
  playerAbilities: perKey(null),
  p1Joined: false, p2Joined: false, p3Joined: false, p4Joined: false,
  players: perKey(null),
  inputs: perKey(blankInput),
  monsters: [],
  allies: [],
  projectiles: [],
  fires: [],
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
  unlockQueues: perKey(() => []),
  round: newRound(),
  roundOverTimer: 0,
  lastLeaderboard: [],
  attackJustPressed: perKey(false),
  swapJustPressed: perKey(false),
  swapPrevJustPressed: perKey(false),
  specialJustPressed: perKey(false),
  parryJustPressed: perKey(false),
  superJustPressed: perKey(false),
  prevInputs: perKey(blankPrev),
}; }

// Point the game code at a room (and its map size).
function useRoom(r) { room = r; setArena(r.mapSize); }
const seatKeys = (r = room) => KEYS.slice(0, r.maxPlayers);

const rooms = [];
let room = makeRoom();   // the room being worked on right now

const SOLO_MODES = ['waves', 'extreme', 'portal', 'abyss', 'sandbox'];
// XP needed before a mode opens (kept in step with MODE_XP in client.js).
const MODE_XP = { extreme: 5000, portal: 15000, abyss: 30000 };
function isSolo() { return SOLO_MODES.includes(room.gameMode); }

// Seats (room + slot) held by a password, for pushing shop changes into live games.
function liveSeats(pw) {
  const out = [];
  for (const r of rooms) for (const key of KEYS) if (r[key] && r.passwords[key] === pw) out.push([r, key]);
  return out;
}

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
  return KEYS.find(k => room.players[k] === t) || null;
}

// Everything `pKey` is allowed to hit. In co-op the other player is an ally, so
// they are neither a target nor an obstacle for attacks and auto-aim.
// VANISH or a ghost cloak: nobody can see (or aim at) this player.
function unseen(p) { return hasEffect(p, 'vanish') || hasEffect(p, 'ghost') || !!p.controlling; }

function enemyTargets(pKey) {
  const out = [];
  // Monster fire only ever threatens players — a spitter must not mow down the
  // pack it spawned with.
  // Summoned allies (Portal Wand) are fair game for monsters too.
  // A player under VANISH can't be seen.
  if (pKey === 'monster') {
    for (const k of KEYS) {
      const p = room.players[k];
      if (p && !p.dead && !unseen(p)) out.push(p);
    }
    for (const a of room.allies) if (!a.dead) out.push(a);
    for (const m of room.monsters) if (m.controlledBy && !m.dead) out.push(m);   // a mind-controlled turncoat
    return out;
  }
  for (const k of KEYS) {
    if (k === pKey) continue;
    if (room.gameMode === 'coop' && isPKey(pKey)) continue;
    const p = room.players[k];
    if (p && !p.dead && !unseen(p)) out.push(p);
  }
  // A hidden Portal Mage can't be seen, hit or aimed at.
  for (const m of room.monsters) if (!m.dead && !m.hidden) out.push(m);
  // In PvP the rival's summoned allies can be cut down.
  if (room.gameMode === 'pvp') for (const a of room.allies) if (!a.dead && a.owner !== pKey) out.push(a);
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
  if (hasEffect(p, 'ghost')) s *= 1.75;
  if (p.lightspeed > 0) s *= LIGHTSPEED_MULT;          // the Light Blade's SUPER
  if (p.passive === 'dagger') s *= PASSIVE_SPEED;
  if (p.kspin > 0) s *= KSPIN_SPEED;                    // the katana's SUPER
  if (hasEffect(p, 'slow'))  s *= 0.4;
  if (hasEffect(p, 'root'))  s = 0;          // ROOT VINES
  return s;
}

function tooCloseToPlayers(x, y, dist) {
  for (const key of KEYS) {
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
  const types = TRAP_POOL;
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

// `trigger` is the player who stepped on it (used by the warp rune).
function fireTrap(tr, trigger) {
  const def = TRAP_TYPES[tr.type];
  tr.state = 'firing';
  tr.fireTimer = 280;
  const tx = tr.x + tr.w / 2, ty = tr.y + tr.h / 2;
  const targets = tr.owner ? enemyTargets(tr.owner)
    : [...allPlayers(), ...room.monsters].filter(t => t && !t.dead && !t.controlling);
  const inRange = targets.filter(t => Math.hypot(cx(t) - tx, cy(t) - ty) <= tr.radius);
  const by = tr.owner || 'trap';   // a mind trap's kills are its owner's
  room.particles.push({ type: 'trapburst', x: tx, y: ty, maxR: tr.radius, timer: 340, max: 340, color: tr.color, text: def.name });

  if (tr.effect === 'warp') {
    if (trigger && !trigger.dead) warpPlayer(trigger);
    return;
  }
  if (def.linger) {
    // Poison, saws, gravity, the healing spring: they linger, and their ticks
    // come from the trap update.
    tr.fireTimer = def.linger;
    tr.tickTimer = 0;
    return;
  }
  if (tr.effect === 'shock') {
    const hits = inRange
      .sort((a, b) => Math.hypot(cx(a) - tx, cy(a) - ty) - Math.hypot(cx(b) - tx, cy(b) - ty))
      .slice(0, def.count || 3);
    for (const t of hits) {
      room.particles.push({ type: 'bolt', x: tx, y: ty - 6, x2: cx(t), y2: cy(t), timer: 300, max: 300, color: tr.color });
      applyDamage(t, tr.damage, by);
      chillTarget(t, 700);
    }
    return;
  }
  for (const t of inRange) {
    if (tr.effect === 'slow') {
      chillTarget(t, tr.dur, 'net');
    } else if (tr.effect === 'freeze') {
      if (t.num) chillTarget(t, tr.dur * 1.4); else stagger(t, tr.dur, 'ice');
    } else if (tr.effect === 'root') {
      if (t.num) applyEffect(t, 'root', tr.dur); else stagger(t, tr.dur, 'root');
    } else if (tr.effect === 'confuse') {
      if (t.num) applyEffect(t, 'confuse', tr.dur); else chillTarget(t, tr.dur);
    } else if (tr.effect === 'silence') {
      if (t.num) applyEffect(t, 'silence', tr.dur); else stagger(t, 900, 'silence');
    } else if (tr.effect === 'quake') {
      applyDamage(t, tr.damage, by);
      stagger(t, tr.dur, 'quake');
    } else if (tr.effect === 'keg' || tr.effect === 'launch') {
      applyDamage(t, tr.damage, by);
      let dx = cx(t) - tx, dy = cy(t) - ty, d = Math.hypot(dx, dy);
      if (d < 1) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); d = 1; }
      const PULL = 300;   // ms the fling lasts; applyPull carries it
      t.pull = { vx: (dx / d) * def.force / PULL, vy: (dy / d) * def.force / PULL, timer: PULL, from: null };
    } else {
      applyDamage(t, tr.damage, by);
      if (tr.effect === 'burn') ignite(t, tr.dur);
    }
  }
}

// Somewhere random on the map, away from monsters.
function warpPlayer(p) {
  const from = { x: cx(p), y: cy(p) };
  let pos = randArenaPos(p.w, p.h);
  for (let i = 0; i < 16; i++) {
    pos = randArenaPos(p.w, p.h);
    const px = pos.x + p.w / 2, py = pos.y + p.h / 2;
    if (Math.hypot(px - from.x, py - from.y) > 150
        && !room.monsters.some(m => Math.hypot(cx(m) - px, cy(m) - py) < 90)) break;
  }
  p.x = pos.x; p.y = pos.y; p.pull = null;
  clampToArena(p, 2);
  room.particles.push({ type: 'teleport', x: from.x, y: from.y, timer: 340, max: 340, color: TRAP_TYPES.warp.color });
  room.particles.push({ type: 'teleport', x: cx(p), y: cy(p), timer: 340, max: 340, color: '#ffffff' });
}

// ── Items ──
function spawnItem() {
  const types = ITEM_POOL;
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
  if (isPlayer) return 10 * COIN_KILL_MULT;
  const def = MONSTER_TYPES[target.type] || MONSTER_TYPES.grunt;
  const mode = room.gameMode === 'extreme' ? EXTREME_COIN_MULT : 1;
  return Math.max(1, Math.round((2 + Math.floor((target.maxHp || 30) / 30)) * (def.coins || 1) * COIN_KILL_MULT * mode));
}

function dropCoins(x, y, total) {
  if (room.gameMode === 'sandbox') return;
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
  if (amount <= 0 || room.gameMode === 'sandbox') return;   // the sandbox earns nothing
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
  for (const k of KEYS.slice(1)) if (room[k] && room[k].readyState === 1) room[k].send(str);
}

function spawnMonster(forceType) {
  const type = forceType || (room.gameMode === 'extreme' ? pickExtremeType() : pickMonsterType(room.wave.num));
  const def = MONSTER_TYPES[type];
  const lvl = modeLevel(room.wave.num);

  // Call out a type the first time it appears in this run.
  if (!def.boss && !def.minion && !room.seenTypes.has(type) && room.gameMode !== 'portal' && room.gameMode !== 'abyss') {
    room.seenTypes.add(type);
    if (room.wave.num > 1 || room.gameMode === 'extreme') {
      room.particles.push({
        type: 'newtype', x: CANVAS_W / 2, y: CANVAS_H / 2 + 26,
        text: def.name + 'S INCOMING', color: def.color, timer: 2200, max: 2200,
      });
    }
  }

  // Base health grows with the wave config multiplier and the wave reached, then
  // the type's own multiplier is applied on top.
  const waveBonus = 1 + Math.max(0, lvl - 1) * 0.12;
  const hp = Math.max(1, Math.round(30 * room.waveHpMult * waveBonus * def.hp));

  // Bulk follows health, but on a flattening curve inside hard limits: deep waves
  // should still read as their type rather than filling the arena, so growth tops
  // out at 1.7x and the type's own shape factor does the rest.
  const baseHp = hp / def.hp;                                     // this wave's baseline
  const waveGrowth = Math.min(1.7, Math.pow(Math.max(1, baseHp / 30), 0.28));
  const sizeScale = Math.max(0.6, Math.min(2.7, def.size * waveGrowth));
  const w = def.fixedW || Math.max(9, Math.round(MONSTER_BASE_W * sizeScale));
  const h = def.fixedH || Math.max(11, Math.round(MONSTER_BASE_H * sizeScale));

  // Damage follows the same shape — bulk, then type, then a slow wave ramp — and
  // is capped so even a late behemoth cannot one-shot a full-health player.
  const waveDmg = Math.min(1.8, 1 + Math.max(0, lvl - 1) * 0.025);
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
  // A boss makes an entrance from the side away from the players, halfway
  // down — never from the top, where the HUD would hide it.
  if (def.boss) {
    const ps = [...allPlayers()].filter(p => p && !p.dead);
    const avgX = ps.length ? ps.reduce((s, p) => s + cx(p), 0) / ps.length : 0;
    mx = avgX < CANVAS_W / 2 ? maxX : minX;
    my = Math.round((minY + maxY) / 2);
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
    blinkTimer: def.blink ? def.blink * (0.5 + Math.random() * 0.5) : 0,
    boss: !!def.boss, mage: !!def.mage, windup: 0, wind: null, stun: 0, swipeCd: 1500, slamCd: 3000,
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
    weaponId: def.shotId || 'spit',
    burn: def.shotBurn || 0,
    isAoe: false, aoeRadius: 0,
    pierce: false, grapple: false, boomerang: false, teleport: false,
    returning: false, life: 0, hitTargets: null,
  });
}

// An ordinary melee blow; a parry throws it back onto the monster.
function monsterMelee(m, t) {
  if (t.parryTimer > 0) {
    applyDamage(m, Math.round(m.atkDamage * reflectOf(t)) + 10, playerKeyOf(t));
    spawnParrySpark(cx(t), cy(t));
  } else {
    applyDamage(t, m.atkDamage, 'monster');
    if (t.num && hasEffect(t, 'thorns')) { m.invincible = 0; applyDamage(m, Math.max(1, Math.round(m.atkDamage * THORNS_SHARE * 2)), playerKeyOf(t)); }
    if (t.num && hasEffect(t, 'frostarmor')) stagger(m, 1000, 'ice');
    if (t.passive === 'fireglove') {                                                  // EMBER SKIN
      m.burnTimer = Math.max(m.burnTimer || 0, EMBER_BURN);
      m.invincible = 0;
      applyDamage(m, Math.max(1, Math.round(weapon(t).damage * EMBER_SCORCH)), playerKeyOf(t));
    }
  }
  m.atkCooldown = 1200;
  m.swing = MONSTER_SWING_MS;
}

// Take a monster off the field with no reward (it blew itself up, or its
// master fell).
function removeMonster(m) {
  if (m.dead) return;
  m.dead = true;
  room.monsters = room.monsters.filter(o => o !== m);
  room.wave.monstersLeft--;
}

// Bring a minion in at (x, y); it counts toward the wave like any other monster.
function spawnMinion(type, x, y, extra) {
  spawnMonster(type);
  const s = room.monsters[room.monsters.length - 1];
  s.x = x - s.w / 2; s.y = y - s.h / 2;
  s.invincible = 300;               // not cut down by the swing that made it
  Object.assign(s, extra);
  clampToArena(s);
  room.wave.monstersLeft++;
  return s;
}

const shieldFoes = () => [...allPlayers(), ...room.allies].filter(t => t && !t.dead);

// Hold a distance from the target: close in when too far, back off when too near.
function keepRange(m, dist, dx, dy, spd, factor, want) {
  if (dist > want + 30)      { m.x += (dx / dist) * spd * factor;       m.y += (dy / dist) * spd * factor; }
  else if (dist < want - 30) { m.x -= (dx / dist) * spd * 0.9 * factor; m.y -= (dy / dist) * spd * 0.9 * factor; }
}

// BOMBER: runs at you; next to you it stops and fizzes for BOMB_FUSE, then
// blows up. Its own death (before the fuse burns out) is a blast that only
// hurts other monsters.
const BOMB_FUSE = 900, BOMB_R = 62, BOMB_MULT = 2.6;
function aiBomber(m, t, dist, dx, dy, spd, factor, dt) {
  if (m.fuse > 0) {
    m.fuse -= dt;
    if (m.fuse <= 0) bomberBlast(m, false);
    return true;
  }
  if (dist < 26 + (t.w + m.w) / 2) { m.fuse = BOMB_FUSE; m.swing = MONSTER_SWING_MS; return true; }
  m.x += (dx / dist) * spd * factor;
  m.y += (dy / dist) * spd * factor;
  return true;
}
function bomberBlast(m, killedBy) {
  const x = cx(m), y = cy(m), dmg = Math.round(m.atkDamage * BOMB_MULT);
  room.particles.push({ type: 'shockwave', x, y, maxR: BOMB_R, timer: 450, max: 450, color: '#ffb030' });
  room.particles.push({ type: 'trapburst', x, y, maxR: BOMB_R, timer: 650, max: 650, color: '#ff6a1a', text: 'BOOM!' });
  if (killedBy) {
    // Popped early: the blast catches its own side.
    for (const o of room.monsters.slice()) {
      if (o.dead || o.boss || Math.hypot(cx(o) - x, cy(o) - y) > BOMB_R + o.w / 2) continue;
      o.invincible = 0;
      applyDamage(o, dmg * 2, killedBy === true ? null : killedBy);
    }
    return;
  }
  for (const t of shieldFoes()) {
    if (Math.hypot(cx(t) - x, cy(t) - y) > BOMB_R + t.w / 2) continue;
    if (t.parryTimer > 0) { spawnParrySpark(cx(t), cy(t)); continue; }   // a parry shrugs it off
    applyDamage(t, dmg, 'monster');
  }
  removeMonster(m);
}

// SHAMAN: hangs back; every SHAMAN_PULSE it heals the monsters around it and
// wards them (they take SHAMAN_WARD less damage) for a few seconds.
const SHAMAN_PULSE = 3200, SHAMAN_R = 140, SHAMAN_HEAL = 0.25, SHAMAN_WARD = 0.4, SHAMAN_WARD_MS = 2600;
function aiShaman(m, t, dist, dx, dy, spd, factor, dt) {
  keepRange(m, dist, dx, dy, spd, factor, 170);
  m.pulseCd = (m.pulseCd ?? 1500) - dt;
  if (m.pulseCd <= 0) {
    m.pulseCd = SHAMAN_PULSE;
    m.swing = MONSTER_SWING_MS;
    for (const o of room.monsters) {
      if (o.dead || o.mage || Math.hypot(cx(o) - cx(m), cy(o) - cy(m)) > SHAMAN_R) continue;
      if (o !== m && o.hp < o.maxHp) {
        const heal = Math.round(o.maxHp * SHAMAN_HEAL * (o.boss ? 0.2 : 1));
        o.hp = Math.min(o.maxHp, o.hp + heal);
        room.particles.push({ type: 'xp', x: cx(o), y: o.y, text: '+' + heal, timer: 700, color: '#5aff9a' });
      }
      o.ward = SHAMAN_WARD_MS;
    }
    room.particles.push({ type: 'shockwave', x: cx(m), y: cy(m), maxR: SHAMAN_R, timer: 600, max: 600, color: '#5aff9a' });
  }
  if (dist <= 12 + (t.w + m.w) / 2 && m.atkCooldown <= 0) monsterMelee(m, t);   // a staff poke up close
  return true;
}

// CHARGER: locks an angle and lowers its head for CHARGE_WIND (a line shows
// where it will go), then rams along it, hitting and shoving everything in
// the way. A wall stops it dead and dazes it; a parry dazes it for longer.
const CHARGE_WIND = 750, CHARGE_SPEED = 8.5, CHARGE_DIST = 380, CHARGE_CD = 3600, CHARGE_MULT = 1.7, CHARGE_KNOCK = 42;
function aiCharger(m, t, dist, dx, dy, spd, factor, dt) {
  m.chargeCd = (m.chargeCd ?? 1200) - dt;
  if (m.dazed > 0) { m.dazed -= dt; return true; }
  const c = m.charge;
  if (c) {
    m.face = Math.cos(c.a) < 0 ? -1 : 1;
    if (c.wind > 0) { c.wind -= dt; return true; }
    const step = CHARGE_SPEED * factor, ox = m.x, oy = m.y;
    m.x += Math.cos(c.a) * step; m.y += Math.sin(c.a) * step; c.left -= step;
    clampToArena(m);
    for (const o of shieldFoes()) {
      if (c.hit.has(o) || (o.num && unseen(o)) || !aabb(m, o)) continue;
      c.hit.add(o);
      if (o.parryTimer > 0) {
        applyDamage(m, Math.round(m.atkDamage * reflectOf(o)) + 10, playerKeyOf(o));
        spawnParrySpark(cx(o), cy(o));
        m.charge = null; m.dazed = 1600; m.chargeCd = CHARGE_CD;
        return true;
      }
      applyDamage(o, Math.round(m.atkDamage * CHARGE_MULT), 'monster');
      o.x += Math.cos(c.a) * CHARGE_KNOCK; o.y += Math.sin(c.a) * CHARGE_KNOCK;
      clampToArena(o);
    }
    const wall = Math.hypot(m.x - ox, m.y - oy) < step * 0.5;
    if (wall || c.left <= 0) {
      m.charge = null; m.chargeCd = CHARGE_CD;
      m.dazed = wall ? 1200 : 450;
      if (wall) room.particles.push({ type: 'shockwave', x: cx(m), y: cy(m), maxR: 30, timer: 350, max: 350, color: '#c8a070' });
    }
    return true;
  }
  if (m.chargeCd <= 0 && dist > 70 && dist < 330) {
    m.charge = { a: Math.atan2(dy, dx), wind: CHARGE_WIND, left: CHARGE_DIST, hit: new Set() };
    m.swing = MONSTER_SWING_MS;
    return true;
  }
  return false;   // otherwise it walks up and gores like anyone else
}

// NECROMANCER: keeps away and, every RAISE_CD, channels for RAISE_CHANNEL
// (green marks show where) and raises two skeletons, up to RAISE_MAX of its
// own at once. When it falls, they all crumble.
const RAISE_CD = 5200, RAISE_CHANNEL = 650, RAISE_MAX = 4;
function aiNecro(m, t, dist, dx, dy, spd, factor, dt) {
  if (m.raiseT > 0) {
    m.raiseT -= dt;
    if (m.raiseT <= 0) {
      for (const s of m.raiseAt) {
        spawnMinion('skeleton', s.x, s.y, { master: m.id });
        room.particles.push({ type: 'teleport', x: s.x, y: s.y, timer: 380, max: 380, color: '#9aff7a' });
      }
      m.raiseAt = null;
    }
    return true;   // stands still while it channels
  }
  keepRange(m, dist, dx, dy, spd, factor, 190);
  m.raiseCd = (m.raiseCd ?? 1800) - dt;
  const mine = room.monsters.filter(o => o.master === m.id).length;
  if (m.raiseCd <= 0 && mine < RAISE_MAX) {
    m.raiseCd = RAISE_CD;
    m.raiseT = RAISE_CHANNEL;
    m.swing = MONSTER_SWING_MS;
    m.raiseAt = [];
    for (let i = 0; i < Math.min(2, RAISE_MAX - mine); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = { x: cx(m) + Math.cos(a) * 34, y: cy(m) + Math.sin(a) * 34 };
      s.x = Math.max(ARENA_X + 12, Math.min(ARENA_X + ARENA_W - 12, s.x));
      s.y = Math.max(ARENA_Y + 12, Math.min(ARENA_Y + ARENA_H - 12, s.y));
      m.raiseAt.push(s);
    }
    return true;
  }
  if (dist <= 12 + (t.w + m.w) / 2 && m.atkCooldown <= 0) monsterMelee(m, t);
  return true;
}

// LIGHT: runs at you very fast, and every LIGHT_CD picks one of two moves:
//  SWEEP — a glint (LIGHT_SWEEP_WIND), then he lunges through you at several
//          times his speed with a wide blade sweep, and blinks to a random spot.
//  FLASH CHAIN — LIGHT_DASHES charges in a row, each one curving after you.
// A parry stops either move and dazes him.
const LIGHT_CD = 2400, LIGHT_SWEEP_WIND = 380, LIGHT_SWEEP_MS = 360, LIGHT_SWEEP_R = 46, LIGHT_SWEEP_MULT = 2.0, LIGHT_SWEEP_SPEED = 7.5;
const LIGHT_DASHES = 4, LIGHT_DASH_WIND = 480, LIGHT_DASH_GAP = 170, LIGHT_DASH_SPEED = 9, LIGHT_DASH_DIST = 280;
const LIGHT_TURN = 3.4, LIGHT_DASH_MULT = 1.3, LIGHT_KNOCK = 30;
const LIGHT_CHANCE = 0.12, LIGHT_ALONE = 0.75, LIGHT_FIRST_WAVE = 6, LIGHT_GAP = 2;

function lightParried(m, o) {
  applyDamage(m, Math.round(m.atkDamage * reflectOf(o)) + 10, playerKeyOf(o));
  spawnParrySpark(cx(o), cy(o));
  m.sweep = null; m.dashes = null; m.dazed = 1500; m.lightCd = LIGHT_CD;
}
// Somewhere on the floor well away from the players.
function lightBlink(m) {
  room.particles.push({ type: 'teleport', x: cx(m), y: cy(m), timer: 340, max: 340, color: '#fff6a0' });
  for (let i = 0; i < 16; i++) {
    m.x = ARENA_X + 4 + Math.random() * (ARENA_W - m.w - 8);
    m.y = ARENA_Y + 4 + Math.random() * (ARENA_H - m.h - 8);
    if (!tooCloseToPlayers(cx(m), cy(m), 140)) break;
  }
  clampToArena(m);
  room.particles.push({ type: 'teleport', x: cx(m), y: cy(m), timer: 340, max: 340, color: '#ffffff' });
}
function angleTo(from, to) { return Math.atan2(cy(to) - cy(from), cx(to) - cx(from)); }
function turnToward(a, want, max) {
  let d = want - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + Math.max(-max, Math.min(max, d));
}
// ─── Samurai ──────────────────────────────────────────────────────────────────
const SAM_CD = 2200, SAM_WIND = 380, SAM_RANGE = 300, SAM_DASHWAVE_CHANCE = 0.3;
const SAM_WAVE_SPEED = 8, SAM_WAVE_MULT = 2.0, SAM_DASH_SPEED = 16, SAM_DASH_MULT = 6, SAM_DASH_MIN = 65;
const SAM_WAVE_R = 16;     // a wave's hit radius (drawn twice the old size)
const SAM_STUN_MS = 2200, SAM_TOWARD_DOT = 0.5, SAM_TOWARD_MULT = 1.75;
const SAM_KILLS_NEED = 30;
// A slash wave: a crescent of steel flying at its target (the samurai's, or a katana's).
function slashWave(owner, x, y, a, dmg, opts = {}) {
  room.projectiles.push({ id: nextId(), x, y, dx: Math.cos(a) * (opts.speed || SAM_WAVE_SPEED), dy: Math.sin(a) * (opts.speed || SAM_WAVE_SPEED),
    damage: dmg, owner, traveled: 0, maxRange: opts.range || 420, weaponId: opts.dash ? 'samdashwave' : 'samwave',
    isAoe: false, aoeRadius: 0, pierce: false, grapple: false, boomerang: false, returning: false, life: 0, hitTargets: null,
    hitR: SAM_WAVE_R, homing: !!opts.homing, ...(opts.dash ? { dashWave: opts.dash } : {}), ...(opts.upg ? { upg: opts.upg } : {}) });
}
function aiSamurai(m, t, dist, dx, dy, spd, factor, dt) {
  if (m.dazed > 0) { m.dazed -= dt; return true; }   // stunned by a parried flash
  m.samCd = (m.samCd ?? 1400 + Math.random() * 1200) - dt;
  const d = m.samDash;
  if (d) {
    // The flash: straight through the target at near light speed.
    const step = Math.min(d.left, SAM_DASH_SPEED * factor), ox = m.x, oy = m.y;
    m.x += Math.cos(d.a) * step; m.y += Math.sin(d.a) * step; d.left -= step;
    clampToArena(m);
    m.face = Math.cos(d.a) < 0 ? -1 : 1;
    for (const o of shieldFoes()) {
      if (d.hit.has(o) || (o.num && unseen(o)) || !aabb(m, o)) continue;
      d.hit.add(o);
      if (o.parryTimer > 0) {
        // Parried: the blade is turned and he is left reeling.
        applyDamage(m, Math.round(m.atkDamage * reflectOf(o)) + 10, playerKeyOf(o));
        spawnParrySpark(cx(o), cy(o));
        m.samDash = null; m.dazed = SAM_STUN_MS; m.samCd = SAM_CD;
        room.particles.push({ type: 'crit', x: cx(m), y: m.y - 8, text: 'STUNNED', timer: 900, max: 900 });
        return true;
      }
      applyDamage(o, Math.round(Math.max(SAM_DASH_MIN, m.atkDamage * SAM_DASH_MULT)), 'monster');
      room.particles.push({ type: 'crit', x: cx(o), y: o.y - 8, text: 'IAI!', timer: 700, max: 700 });
    }
    if (d.left <= 0.5 || Math.hypot(m.x - ox, m.y - oy) < step * 0.4) {
      room.particles.push({ type: 'streak', x: d.sx, y: d.sy, x2: cx(m), y2: cy(m), timer: 380, max: 380, color: '#ff5a5a' });
      m.samDash = null; m.samCd = SAM_CD; m.dazed = 250;
    }
    return true;
  }
  if (m.samWind > 0) {
    m.samWind -= dt; m.face = dx > 0 ? 1 : -1;
    if (m.samWind <= 0) {
      const a = Math.atan2(dy, dx);
      if (m.samNext === 'dash') slashWave('monster', cx(m), cy(m), a, 0, { dash: { mon: m.id }, speed: 7.5, range: 520 });
      else slashWave('monster', cx(m), cy(m), a, Math.round(m.atkDamage * SAM_WAVE_MULT));
      m.samCd = SAM_CD;
    }
    return true;
  }
  if (m.samCd <= 0 && dist < SAM_RANGE) {
    m.samWind = SAM_WIND; m.swing = MONSTER_SWING_MS;
    m.samNext = Math.random() < SAM_DASHWAVE_CHANCE ? 'dash' : 'wave';
    return true;
  }
  return false;   // otherwise a swordsman like any other
}
// A dash wave reached someone: whoever threw it flashes through them.
function triggerDashWave(proj, t) {
  const dw = proj.dashWave;
  if (dw.mon) {
    const m = room.monsters.find(o => o.id === dw.mon && !o.dead);
    if (!m || m.dazed > 0 || m.controlledBy) return;
    const a = Math.atan2(cy(t) - cy(m), cx(t) - cx(m));
    m.samDash = { a, left: Math.hypot(cx(t) - cx(m), cy(t) - cy(m)) + 70, hit: new Set(), sx: cx(m), sy: cy(m) };
    m.samWind = 0;
  } else {
    const p = room.players[proj.owner];
    if (!p || p.dead) return;
    const a = Math.atan2(cy(t) - cy(p), cx(t) - cx(p));
    p.facing = Math.cos(a) < 0 ? -1 : 1;
    startBladeDash(p, { kind: 'sam', a, dist: Math.hypot(cx(t) - cx(p), cy(t) - cy(p)) + 60, speed: SAM_DASH_SPEED * 1.2,
                        n: 1, turn: 0, dmg: dw.dmg });
    room.particles.push({ type: 'streak', x: cx(p), y: cy(p), x2: cx(t), y2: cy(t), timer: 380, max: 380, color: '#ff5a5a' });
  }
}
// Cutting down a samurai counts toward his katana, for every player in the run.
function creditSamuraiKill() {
  if (room.gameMode === 'sandbox') return;
  const d = progress();
  for (const k of KEYS) {
    const pw = room.passwords[k];
    if (!room.players[k] || !pw || isAdminPw(pw)) continue;
    const n = d.samuraiKills[pw] = (d.samuraiKills[pw] || 0) + 1;
    markDirty();
    if (n <= SAM_KILLS_NEED && (n % 5 === 0 || n === SAM_KILLS_NEED)) {
      room.particles.push({ type: 'newtype', x: CANVAS_W / 2, y: CANVAS_H / 2 + 26 + KEYS.indexOf(k) * 16,
                            text: n >= SAM_KILLS_NEED ? "SAMURAI'S KATANA UNLOCKED IN THE SHOP" : `SAMURAI DEFEATED ${n}/${SAM_KILLS_NEED}`,
                            color: '#ff7a7a', timer: 2600, max: 2600 });
    }
  }
}
// The katana's SUPER: spinning, faster, gliding, cutting all you touch.
const KSPIN_MS = 5000, KSPIN_SPEED = 1.9, KSPIN_R = 48, KSPIN_TICK = 220, KSPIN_SLOW = 900, KSPIN_GLIDE = 0.07;
function katanaSpinTick(p, key, dt) {
  p.kspin -= dt;
  p.kspinT = (p.kspinT || 0) - dt;
  if (p.kspinT > 0) return;
  p.kspinT = KSPIN_TICK;
  for (const t of enemyTargets(key)) {
    if (Math.hypot(cx(t) - cx(p), cy(t) - cy(p)) > KSPIN_R + t.w / 2) continue;
    if (!t.num) t.invincible = 0;
    applyDamage(t, p.kspinDmg || 20, key);
    if (!t.dead) chillTarget(t, KSPIN_SLOW);
  }
}

function aiLight(m, t, dist, dx, dy, spd, factor, dt) {
  m.lightCd = (m.lightCd ?? 1300) - dt;
  if (m.dazed > 0) { m.dazed -= dt; return true; }
  const s = m.sweep;
  if (s) {
    if (s.wind > 0) {
      s.wind -= dt; s.a = Math.atan2(dy, dx); m.face = dx > 0 ? 1 : -1;
      return true;
    }
    s.t -= dt;
    const step = LIGHT_SWEEP_SPEED * factor;
    m.x += Math.cos(s.a) * step; m.y += Math.sin(s.a) * step;
    clampToArena(m);
    for (const o of shieldFoes()) {
      if (s.hit.has(o) || (o.num && unseen(o))) continue;
      if (Math.hypot(cx(o) - cx(m), cy(o) - cy(m)) > LIGHT_SWEEP_R + o.w / 2) continue;
      s.hit.add(o);
      if (o.parryTimer > 0) { lightParried(m, o); return true; }
      applyDamage(o, Math.round(m.atkDamage * LIGHT_SWEEP_MULT), 'monster');
    }
    if (s.t <= 0) { m.sweep = null; m.lightCd = LIGHT_CD; lightBlink(m); }
    return true;
  }
  const c = m.dashes;
  if (c) {
    if (c.wind > 0) {
      c.wind -= dt; c.a = Math.atan2(dy, dx); m.face = dx > 0 ? 1 : -1;
      return true;
    }
    c.a = turnToward(c.a, Math.atan2(dy, dx), LIGHT_TURN * dt / 1000);   // curves after you
    m.face = Math.cos(c.a) < 0 ? -1 : 1;
    const step = LIGHT_DASH_SPEED * factor, ox = m.x, oy = m.y;
    m.x += Math.cos(c.a) * step; m.y += Math.sin(c.a) * step; c.left -= step;
    clampToArena(m);
    for (const o of shieldFoes()) {
      if (c.hit.has(o) || (o.num && unseen(o)) || !aabb(m, o)) continue;
      c.hit.add(o);
      if (o.parryTimer > 0) { lightParried(m, o); return true; }
      applyDamage(o, Math.round(m.atkDamage * LIGHT_DASH_MULT), 'monster');
      o.x += Math.cos(c.a) * LIGHT_KNOCK; o.y += Math.sin(c.a) * LIGHT_KNOCK;
      clampToArena(o);
    }
    const wall = Math.hypot(m.x - ox, m.y - oy) < step * 0.5;
    if (wall || c.left <= 0) {
      if (--c.n > 0) { c.wind = LIGHT_DASH_GAP; c.left = LIGHT_DASH_DIST; c.hit = new Set(); }
      else { m.dashes = null; m.lightCd = LIGHT_CD; m.dazed = 380; }
    }
    return true;
  }
  if (m.lightCd <= 0 && dist < 340) {
    m.swing = MONSTER_SWING_MS;
    if (dist < 160 && Math.random() < 0.55) m.sweep = { wind: LIGHT_SWEEP_WIND, t: LIGHT_SWEEP_MS, a: Math.atan2(dy, dx), hit: new Set() };
    else m.dashes = { n: LIGHT_DASHES, wind: LIGHT_DASH_WIND, a: Math.atan2(dy, dx), left: LIGHT_DASH_DIST, hit: new Set() };
    return true;
  }
  return false;   // otherwise he closes in (very fast) and slashes like anyone else
}

// Light comes at most every LIGHT_GAP waves, by chance, and most often alone.
// In EXTREME he turns up in almost every wave, never alone, sometimes in twos or threes.
const EXTREME_LIGHT_CHANCE = 0.85;
function maybeLightWave(num) {
  if (!['waves', 'coop', 'extreme'].includes(room.gameMode)) return;
  const extreme = room.gameMode === 'extreme';
  if (num < (extreme ? 2 : LIGHT_FIRST_WAVE)) return;
  if (extreme) {
    if (Math.random() >= EXTREME_LIGHT_CHANCE) return;
  } else if (num - (room.lastLightWave ?? -99) < LIGHT_GAP || Math.random() >= LIGHT_CHANCE) return;
  room.lastLightWave = num;
  room.seenTypes.add('light');
  const roll = Math.random();
  const count = extreme ? (roll < 0.5 ? 1 : roll < 0.85 ? 2 : 3) : 1;
  const alone = !extreme && Math.random() < LIGHT_ALONE;
  if (alone) { room.wave.spawnQueue = 0; room.wave.monstersLeft = count; }
  else room.wave.monstersLeft += count;
  for (let i = 0; i < count; i++) spawnMonster('light');
  room.particles.push({ type: 'newtype', x: CANVAS_W / 2, y: CANVAS_H / 2 + 26,
                        text: count > 1 ? 'LIGHT STRIKES x' + count : alone ? 'LIGHT HAS COME' : 'LIGHT JOINS THE FIGHT', color: '#fff6a0', timer: 3000, max: 3000 });
}

// SEARCH: with every player invisible, monsters stop standing about. They head
// for where they last saw you, then wander the area around it, and every couple
// of seconds swing at the air; anyone invisible close enough to be hit is found.
const SEARCH_SPEED = 0.7, SEARCH_AREA = 150, SEARCH_SWING_MIN = 1600, SEARCH_SWING_VAR = 1400;
const spdOf = m => m.speed * (m.slowTimer > 0 ? 0.4 : 1);
function monsterSearch(m, spd, factor, dt) {
  m.charge = null; m.sweep = null; m.dashes = null; m.fuse = 0;   // whatever it was winding up fizzles
  if (m.dazed > 0) { m.dazed -= dt; return; }
  const home = m.lastSeen;
  if (!m.searchPt || (m.searchT -= dt) <= 0 || Math.hypot(m.searchPt.x - cx(m), m.searchPt.y - cy(m)) < 14) {
    if (home && !m.searchedHome) { m.searchPt = { x: home.x, y: home.y }; m.searchedHome = true; }
    else {
      const a = Math.random() * Math.PI * 2, r = Math.random() * SEARCH_AREA;
      const at = arenaClamp((home ? home.x : cx(m)) + Math.cos(a) * r, (home ? home.y : cy(m)) + Math.sin(a) * r, 14);
      m.searchPt = { x: at.x, y: at.y };
    }
    m.searchT = 1800 + Math.random() * 1600;
  }
  const dx = m.searchPt.x - cx(m), dy = m.searchPt.y - cy(m), d = Math.hypot(dx, dy) || 1;
  if (!(m.ranged && d < 30)) {
    m.x += (dx / d) * spd * SEARCH_SPEED * factor; m.y += (dy / d) * spd * SEARCH_SPEED * factor;
    if (Math.abs(dx) > 2) m.face = dx > 0 ? 1 : -1;
  }
  m.searchSwingCd = (m.searchSwingCd ?? 700 + Math.random() * 900) - dt;
  if (m.searchSwingCd > 0) return;
  m.searchSwingCd = SEARCH_SWING_MIN + Math.random() * SEARCH_SWING_VAR;
  m.swing = MONSTER_SWING_MS;
  room.particles.push({ type: 'crit', x: cx(m), y: m.y - 8, text: '?', timer: 600, max: 600 });
  for (const k of KEYS) {
    const p = room.players[k];
    if (!p || p.dead || p.controlling || !(hasEffect(p, 'vanish') || hasEffect(p, 'ghost'))) continue;
    if (Math.hypot(cx(p) - cx(m), cy(p) - cy(m)) <= m.atkRange + 18 + (p.w + m.w) / 2) { monsterMelee(m, p); m.lastSeen = { x: cx(p), y: cy(p) }; m.searchedHome = false; }
  }
}

const MONSTER_AI = { bomber: aiBomber, shaman: aiShaman, charger: aiCharger, necro: aiNecro, light: aiLight, samurai: aiSamurai };

// After a monster is killed (and paid for): bombers pop, splitters split,
// a necromancer's skeletons crumble.
function monsterDied(m, killer) {
  const def = MONSTER_TYPES[m.type] || {};
  if (m.type === 'light' && !m.controlledBy) creditLightKill();
  if (m.type === 'samurai' && !m.controlledBy) creditSamuraiKill();
  if (def.ai === 'bomber') bomberBlast(m, killer || true);
  if (def.split) {
    for (let i = 0; i < (def.splitCount || 2); i++) {
      const a = Math.random() * Math.PI * 2;
      spawnMinion(def.split, cx(m) + Math.cos(a) * 12, cy(m) + Math.sin(a) * 12);
    }
    room.particles.push({ type: 'shockwave', x: cx(m), y: cy(m), maxR: 26, timer: 300, max: 300, color: def.color });
  }
  if (def.ai === 'necro') {
    for (const o of room.monsters.slice()) {
      if (o.master !== m.id) continue;
      room.particles.push({ type: 'teleport', x: cx(o), y: cy(o), timer: 380, max: 380, color: '#d8d0b8' });
      removeMonster(o);
    }
  }
}

function startWave(num) {
  let cfg;
  const lvl = modeLevel(num);
  if (lvl > WAVE_CONFIG.length) {
    const extra = lvl - WAVE_CONFIG.length;
    const base  = WAVE_CONFIG[WAVE_CONFIG.length - 1];
    cfg = {
      monsters:   Math.min(base.monsters + Math.floor(extra * 0.7), 28),
      hpMult:     base.hpMult    * (1 + extra * 0.15),
      speedMult:  Math.min(base.speedMult * (1 + extra * 0.04), 2.8),
    };
  } else {
    cfg = WAVE_CONFIG[lvl - 1];
  }
  // Extreme sends fewer monsters at a time than its level would — each one is a handful.
  if (room.gameMode === 'extreme') cfg = { ...cfg, monsters: Math.min(cfg.monsters, 4 + num) };
  room.wave = { num, monstersLeft: cfg.monsters, spawnQueue: cfg.monsters, spawnTimer: 500, betweenTimer: 0 };
  room.waveHpMult    = cfg.hpMult;
  room.waveSpeedMult = cfg.speedMult;
  // Boss wave: the Giant is the whole wave — no pack alongside him.
  if (isBossWave(num)) {
    room.wave.spawnQueue = 0;
    room.wave.monstersLeft = 1;
    spawnMonster('giant');
    room.particles.push({ type: 'newtype', x: CANVAS_W / 2, y: CANVAS_H / 2 + 26,
                          text: 'THE GIANT APPROACHES', color: '#c8e07a', timer: 3200, max: 3200 });
  } else { maybeLightWave(num); maybeSamuraiHorde(num); }
}

// In EXTREME a wave may bring a samurai horde: 10 to 20 of them at once.
const SAM_HORDE_CHANCE = 0.4, SAM_HORDE_MIN = 10, SAM_HORDE_MAX = 20;
function maybeSamuraiHorde(num) {
  if (room.gameMode !== 'extreme' || num < 2 || Math.random() >= SAM_HORDE_CHANCE) return;
  const count = SAM_HORDE_MIN + Math.floor(Math.random() * (SAM_HORDE_MAX - SAM_HORDE_MIN + 1));
  room.seenTypes.add('samurai');
  room.wave.monstersLeft += count;
  for (let i = 0; i < count; i++) spawnMonster('samurai');
  room.particles.push({ type: 'newtype', x: CANVAS_W / 2, y: CANVAS_H / 2 + 26,
                        text: 'SAMURAI HORDE x' + count, color: '#ff5a5a', timer: 3000, max: 3000 });
}

function clearField() {
  room.seenTypes   = new Set();
  room.monsters    = [];
  room.allies      = [];
  room.projectiles = [];
  room.fires       = [];
  room.particles   = [];
  room.traps       = [];
  room.items       = [];
  room.coins       = [];
  room.trapSpawnTimer = TRAP_SPAWN_MIN;
  room.itemSpawnTimer = ITEM_SPAWN_MIN;
}

function startGame() {
  if (room.round.matchWinner) room.round = newRound();
  KEYS.forEach((k, i) => {
    room.players[k] = i === 0 || (!isSolo() && i < room.maxPlayers && room[k + 'Joined'])
      ? makePlayer(i + 1, room.playerXp[k], room.playerUpgrades[k]) : null;
  });
  for (const key of KEYS) {
    const p = room.players[key];
    if (!p) continue;
    if (room.playerSkins[key])   p.skin = room.playerSkins[key];
    if (room.playerUnlocks[key]) p.unlockedWeapons = room.playerUnlocks[key];
    if (room.playerAbilities[key]) p.abilities = room.playerAbilities[key].slice();
    refreshWeapon(p);
  }
  clearField();
  room.unlockQueues = perKey(() => []);
  room.chats = [];
  room.wave = emptyWave();
  room.gameState = 'GAMEPLAY';
  room.victory = false;
  if (room.gameMode === 'portal') startMageFight();
  else if (room.gameMode === 'abyss') startAbyssFight();
  else if (room.gameMode === 'sandbox') startSandbox();
  else if (room.gameMode !== 'pvp') startWave(START_WAVE);
}

function resetToLobby() {
  room.gameState = 'LOBBY';
  room.players = perKey(null);
  room.wave = emptyWave();
  room.round = newRound();
  room.roundOverTimer = 0;
  room.unlockQueues = perKey(() => []);
  clearField();
}

function applyDamage(target, dmg, attackerKey) {
  if (target.dead || target.dying || target.invincible > 0 || target.hidden || target.p3) return;
  if (target.num && hasEffect(target, 'shield')) {  // shield item: ignore all incoming damage
    target.hitFlash = 80;
    return;
  }
  if (room.gameMode === 'coop' && target.num && isPKey(attackerKey)) return;
  // Weapon upgrades on the attacking player: critical hits, lifesteal, knockback.
  const atk = isPKey(attackerKey) ? room.players[attackerKey] : null;
  const aw = atk && atk !== target ? weapon(atk) : null;
  if (aw && atk.passive === 'axe') dmg *= 1 + PASSIVE_RAGE * Math.max(0, 1 - atk.hp / atk.maxHp);   // BERSERKER
  if (target.num && hasEffect(target, 'ironskin')) dmg *= 0.5;                                     // IRON SKIN
  if (target.num && hasEffect(target, 'frostarmor')) dmg *= 0.75;                                  // FROST ARMOR
  if (target.num && target.passive === 'sword') dmg *= PASSIVE_GUARD;                              // GUARDIAN
  if (aw && atk.passive === 'frostscythe' && ((target.freeze || 0) > 0 || (target.slowTimer || 0) > 0
      || (target.num && hasEffect(target, 'slow')))) dmg *= SHATTER_MULT;                          // SHATTERPOINT
  if (aw && atk.passive === 'stormhammer' && Math.random() < THUNDER_CHANCE) {                    // THUNDERSTRUCK
    dmg *= THUNDER_MULT;
    room.particles.push({ type: 'bolt', x: cx(target) + (Math.random() - 0.5) * 20, y: ARENA_Y + 2, x2: cx(target), y2: cy(target),
                          timer: 300, max: 300, color: PASSIVES.stormhammer.color });
  }
  // AEGIS: the vortex's holder shrugs off a whole hit every AEGIS_CD.
  if (target.num && target.passive === 'vortex' && !(target.aegisCd > 0)) {
    target.aegisCd = AEGIS_CD;
    target.hitFlash = 80;
    target.invincible = 300;
    room.particles.push({ type: 'shockwave', x: cx(target), y: cy(target), maxR: target.w + 12, timer: 300, max: 300, color: PASSIVES.vortex.color });
    room.particles.push({ type: 'crit', x: cx(target), y: target.y - 10, text: 'BLOCKED', timer: 500, max: 500 });
    return;
  }
  dmg = Math.max(1, Math.round(dmg));
  if (aw && aw.crit && Math.random() < aw.crit) {
    dmg *= 2;
    room.particles.push({ type: 'crit', x: cx(target), y: target.y - 4, text: 'CRIT', timer: 600, max: 600 });
  }
  // Armoured monsters shrug off a share of every hit, but never all of it.
  if (target.armor) dmg = Math.max(1, Math.round(dmg * (1 - target.armor)));
  if (target.ward > 0) dmg = Math.max(1, Math.round(dmg * (1 - SHAMAN_WARD)));   // a shaman's ward
  if (target.num && target.defense) dmg = Math.max(1, Math.round(dmg * (1 - target.defense)));
  // The vortex shield blocks the hit outright, but still banks what it would have done.
  if (target.num && target.vortexShield > 0) {
    bankVortex(target, dmg);
    target.hitFlash = 80;
    target.invincible = 500;
    room.particles.push({ type: 'shockwave', x: cx(target), y: cy(target), maxR: target.w + 6, timer: 220, max: 220, color: '#7ad8ff' });
    return;
  }
  target.hp -= dmg;
  if (atk && atk !== target && atk.passive === 'revolver') hitBlast(target, attackerKey, atk);
  // ESCAPE PORTAL: a hit that leaves the portal wand's holder low warps them out.
  if (target.num && target.passive === 'portalwand' && target.hp > 0 && target.hp < target.maxHp * ESCAPE_AT
      && !(target.escapeCd > 0)) {
    const spot = safestSpot(target, playerKeyOf(target));
    if (spot) {
      target.escapeCd = ESCAPE_CD;
      room.particles.push({ type: 'teleport', x: cx(target), y: cy(target), timer: 420, max: 420, color: PASSIVES.portalwand.color });
      target.x = spot.x - target.w / 2; target.y = spot.y - target.h / 2;
      clampToArena(target);
      target.pull = null;
      target.hp = Math.min(target.maxHp, target.hp + Math.round(target.maxHp * ESCAPE_HEAL));
      room.particles.push({ type: 'teleport', x: cx(target), y: cy(target), timer: 420, max: 420, color: PASSIVES.portalwand.color });
      room.particles.push({ type: 'crit', x: cx(target), y: target.y - 10, text: 'ESCAPE!', timer: 600, max: 600 });
    }
  }
  const steal = (aw ? aw.lifesteal || 0 : 0) + (atk && atk !== target && hasEffect(atk, 'vampire') ? 0.25 : 0);
  if (steal && !atk.dead) {
    const heal = Math.round(dmg * steal);
    if (heal > 0) atk.hp = Math.min(atk.maxHp, atk.hp + heal);
  }
  if (aw && aw.knock && target.hp > 0 && !target.boss) {
    const dx = cx(target) - cx(atk), dy = cy(target) - cy(atk), d = Math.hypot(dx, dy) || 1;
    target.x += (dx / d) * aw.knock;
    target.y += (dy / d) * aw.knock;
    clampToArena(target);
  }
  if (target.mage) mageFloor(target);
  target.hitFlash  = 200;
  target.invincible = target.num ? 500 : 300;
  // THORNS: another player who hits you takes half of it back.
  if (target.num && atk && atk !== target && hasEffect(target, 'thorns') && !atk.dead) {
    applyDamage(atk, Math.max(1, Math.round(dmg * THORNS_SHARE)), playerKeyOf(target));
  }
  if (target.hp <= 0) handleKill(target, attackerKey);
}

function handleKill(target, attackerKey) {
  if (target.controlledBy) {
    const ctrl = room.players[target.controlledBy];
    if (ctrl && ctrl.controlling) endMindControl(ctrl, target.controlledBy);
  }
  if (target.mage) { mageDefeated(target); return; }
  if (target.abyss) { abyssPhase3(target); return; }
  // A monster dies once. Blasts set off inside its own death (a bomber, a
  // chain reaction) could otherwise reach it again before it is marked dead.
  if (!target.num) { if (target.dying || target.dead) return; target.dying = true; }
  if (target.ally) { killAlly(target); return; }   // a summoned ally: no reward for anyone
  // PHOENIX: the killing blow is undone, and nobody is paid for it.
  if (target.num && hasEffect(target, 'phoenix')) {
    delete target.effects.phoenix;
    target.hp = Math.round(target.maxHp * 0.5);
    target.invincible = 1500;
    room.particles.push({ type: 'trapburst', x: cx(target), y: cy(target), maxR: 60, timer: 900, max: 900, color: '#ffa03a', text: 'REBORN!' });
    room.particles.push({ type: 'shockwave', x: cx(target), y: cy(target), maxR: 80, timer: 600, max: 600, color: '#ffd84a' });
    return;
  }
  // SOUL HARVEST: the reaper's wielder feeds on every kill.
  const reaper = room.players[attackerKey];
  if (reaper && reaper !== target && !reaper.dead && reaper.passive === 'reaper') {
    const heal = Math.round(reaper.maxHp * PASSIVE_HARVEST);
    reaper.hp = Math.min(reaper.maxHp, reaper.hp + heal);
    room.particles.push({ type: 'bolt', x: cx(target), y: cy(target), x2: cx(reaper), y2: cy(reaper), timer: 300, max: 300, color: PASSIVES.reaper.color });
    room.particles.push({ type: 'xp', x: cx(reaper), y: reaper.y - 4, text: '+' + heal, timer: 800, color: PASSIVES.reaper.color });
  }
  // VOID HUNGER: the void blade's holder feeds cooldowns on every kill.
  if (reaper && reaper !== target && !reaper.dead && reaper.passive === 'voidblade') {
    reaper.specialCooldown = Math.max(0, (reaper.specialCooldown || 0) - VOID_HUNGER_MS);
    reaper.superCooldown = Math.max(0, (reaper.superCooldown || 0) - VOID_HUNGER_MS);
  }
  const isPlayer = !!target.num;
  let baseGain = isPlayer ? 15 : 6;
  // Bigger (tankier) monsters reward more XP, scaled by their max HP over the base
  // 30, then again by how dangerous their type is.
  if (!isPlayer) {
    const def = MONSTER_TYPES[target.type] || MONSTER_TYPES.grunt;
    baseGain = Math.round(baseGain * Math.max(1, (target.maxHp || 30) / 30) * (def.xp || 1));
  }
  const xpGain = room.gameMode === 'extreme' ? baseGain * 3 : room.gameMode === 'waves' ? baseGain * 2 : baseGain;

  // Credit XP to attacking player
  if (isPKey(attackerKey)) creditXp(attackerKey, xpGain);

  // Only float the XP number when a player actually banked it — a trap or a
  // monster finishing something off earns nobody anything (nor does the sandbox).
  if (isPKey(attackerKey) && room.gameMode !== 'sandbox') {
    room.particles.push({
      type: 'xp', x: cx(target), y: target.y,
      text: '+' + xpGain, timer: 900,
    });
  }

  // Coins drop on the floor for anyone to pick up. Dying to a monster or a trap
  // drops nothing — otherwise you could farm coins off your own deaths.
  const killedByRival = isPKey(attackerKey);
  if (!isPlayer || killedByRival) {
    const rich = room.players[attackerKey] && hasEffect(room.players[attackerKey], 'gold') ? 2 : 1;   // GOLD RUSH
    dropCoins(cx(target), cy(target), coinsForKill(target, isPlayer) * rich);
  }

  if (isPlayer) {
    target.dead = true;
    target.pull = null;
    // Don't respawn still on fire, poisoned or snared.
    if (target.effects) { delete target.effects.burn; delete target.effects.poison; delete target.effects.slow; }
    if (room.gameMode !== 'sandbox') target.lives--;   // the sandbox never runs out of lives
    target.hp = 0;
    if (target.lives > 0) target.respawnTimer = 2000;
  } else {
    target.dead = true;
    room.monsters = room.monsters.filter(m => m !== target);
    room.wave.monstersLeft--;
    monsterDied(target, attackerKey);
  }
  chainReaction(target, attackerKey);
}

// CHAIN REACTION: what the revolver's holder kills blows up. Runs once the kill is
// settled (the victim is already dead), so a blast can never re-kill it or loop
// back through its neighbours; each monster can only die once.
function chainReaction(target, attackerKey) {
  const owner = room.players[attackerKey];
  if (!owner || owner === target || owner.dead || owner.passive !== 'revolver') return;
  room.particles.push({ type: 'trapburst', x: cx(target), y: cy(target), maxR: BLAST_R, timer: 450, max: 450, color: PASSIVES.revolver.color });
  revolverBlast(target, attackerKey, BLAST_R, Math.max(1, Math.round(weapon(owner).damage * BLAST_MULT)));
}

// ...and every hit blows up onto the foes around it, in a smaller blast. Damage
// from inside a blast never sets off another hit-blast (only kills chain), and
// one owner's hit-blasts are spaced HIT_BLAST_GAP apart so a spread of bullets
// doesn't stack a dozen at once.
let blasting = false;
function hitBlast(target, attackerKey, owner) {
  if (blasting || owner.dead) return;
  const now = Date.now();
  if (now - (owner.lastHitBlast || 0) < HIT_BLAST_GAP) return;
  owner.lastHitBlast = now;
  room.particles.push({ type: 'shockwave', x: cx(target), y: cy(target), maxR: HIT_BLAST_R, timer: 320, max: 320, color: PASSIVES.revolver.color });
  revolverBlast(target, attackerKey, HIT_BLAST_R, Math.max(1, Math.round(weapon(owner).damage * HIT_BLAST_MULT)));
}
function revolverBlast(target, attackerKey, r, dmg) {
  const x = cx(target), y = cy(target), was = blasting;
  blasting = true;
  try {
    for (const t of enemyTargets(attackerKey).slice()) {
      if (t === target || t.dead || t.hp <= 0 || Math.hypot(cx(t) - x, cy(t) - y) > r + t.w / 2) continue;
      if (!t.num) t.invincible = 0;
      applyDamage(t, dmg, attackerKey);
    }
  } finally { blasting = was; }
}

// Bank XP for a player: unlocks anything it reaches and saves it.
function creditXp(key, xpGain) {
  if (room.gameMode === 'sandbox' || (room.bot && key === 'p2')) return;
  const attacker = room.players[key];
  const pw = room.passwords[key];
  const admin = isAdminPw(pw);
  const oldXp = room.playerXp[key];
  room.playerXp[key] += xpGain;

  const newUnlocks = checkNewUnlocks(oldXp, room.playerXp[key]);
  room.unlockQueues[key].push(...newUnlocks);
  const merged = sortWeaponIds([
    ...(attacker?.unlockedWeapons || room.playerUnlocks[key] || []),
    ...getUnlockedWeaponIds(room.playerXp[key]),
  ]);
  if (attacker) {
    // Keep holding the same weapon even though the sorted list shifted.
    const cur = attacker.unlockedWeapons[attacker.weaponIdx];
    attacker.unlockedWeapons = merged;
    attacker.weaponIdx = Math.max(0, merged.indexOf(cur));
    refreshWeapon(attacker);
  }
  room.playerUnlocks[key] = merged;

  if (pw && !admin) {
    const d = progress();
    d.players[pw] = room.playerXp[key];
    d.weapons[pw] = merged;
    markDirty();
  }
}

// Back in at the safest spot on the field (away from every foe, trap and shot),
// not on the fixed spawn point, which may be in the middle of the fight.
function respawnPlayer(p) {
  if (p.controlling) endMindControl(p, playerKeyOf(p));
  const safe = safestSpot(p, playerKeyOf(p));
  const sp = safe ? { x: safe.x - p.w / 2, y: safe.y - p.h / 2 } : spawnPointFor(p.num);
  p.hp = p.maxHp;
  p.x  = sp.x;
  p.y  = sp.y;
  clampToArena(p);
  room.particles.push({ type: 'teleport', x: cx(p), y: cy(p), timer: 420, max: 420, color: '#ffffff' });
  p.dead = false;
  p.pull = null;
  p.invincible = 2000;
  p.hitFlash   = 0;
}

function checkRoundEnd() {
  const p1 = room.players.p1;
  const p2 = room.players.p2;

  if (isSolo()) {
    if (p1 && p1.dead && p1.lives <= 0) {
      // The boss fight has no leaderboard: you win or you don't.
      room.lastLeaderboard = room.gameMode === 'portal' || room.gameMode === 'abyss' ? []
        : addLeaderboardEntry(room.playerNames.p1, room.wave.num, room.gameMode);
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
    // PvP: the round ends when one fighter (or none) is left standing.
    const fighters = KEYS.filter(k => room.players[k]);
    if (fighters.length < 2) return;
    const standing = fighters.filter(k => !(room.players[k].dead && room.players[k].lives <= 0));
    if (standing.length <= 1) {
      // Everyone out at once is a draw — nobody banks a win.
      const winner = standing[0] || null;
      room.round.roundWinner = winner ? Number(winner.slice(1)) : 0;
      if (winner) room.round.wins[winner]++;
      // First to maxWins takes the match; the next round starts a fresh tally.
      const champ = KEYS.find(k => room.round.wins[k] >= room.round.maxWins);
      room.round.matchWinner = champ ? Number(champ.slice(1)) : 0;
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
  for (const r of rooms.slice()) { useRoom(r); tickRoom(dt); }
}, TICK_MS);

function tickRoom(dt) {
  if (room.gameState !== 'GAMEPLAY') {
    if (room.gameState === 'ROUND_OVER') {
      room.roundOverTimer -= dt;
      if (room.roundOverTimer <= 0) {
        const hasUnlocks = room.unlockQueues.p1.length > 0 ||
                           (!isSolo() && KEYS.some(k => k !== 'p1' && room.unlockQueues[k].length > 0));
        if (hasUnlocks) {
          room.gameState = 'WEAPON_UNLOCK';
        } else if (isSolo()) {
          endWavesRun();
        } else {
          startGame();
        }
      }
    }
    broadcastTick();
    return;
  }

  const factor = dt / 16.67;
  if (room.bot) botTick(dt);

  // Swap and parry fire once per press. Attack, special and super auto-fire
  // while held: they go off again as soon as their cooldown is ready.
  for (const key of KEYS) {
    const inp  = room.inputs[key];
    const prev = room.prevInputs[key];
    room.attackJustPressed[key]  = inp.attack;
    room.swapJustPressed[key]    = inp.swap    && !prev.swap;
    room.swapPrevJustPressed[key] = !!inp.swapPrev && !prev.swapPrev;
    room.specialJustPressed[key] = inp.special;
    room.parryJustPressed[key]   = inp.parry   && !prev.parry;
    room.superJustPressed[key]   = inp.super;
    room.prevInputs[key] = { attack: inp.attack, swap: inp.swap, swapPrev: !!inp.swapPrev, special: inp.special, parry: inp.parry, super: inp.super };
  }

  // ── Move players ──
  for (const key of KEYS) {
    const p = room.players[key];
    if (!p || p.dead) {
      if (p) { p.bladeDash = null; p.lightspeed = 0; p.bladeClick = null; p.kspin = 0; }
      if (p && p.respawnTimer > 0) {
        p.respawnTimer -= dt;
        if (p.respawnTimer <= 0) respawnPlayer(p);
      }
      continue;
    }
    // In someone's head: you stand still (hidden) and drive them instead.
    if (p.controlling) tickMindControl(p, key, dt, factor);
    const inp = p.controlling ? {} : p.mindControlledBy ? room.inputs[p.mindControlledBy] : room.inputs[key];
    const spd = effectiveSpeed(p);
    let vx = 0, vy = 0;
    if (inp.left)  { vx = -spd; p.facing = -1; }
    if (inp.right) { vx =  spd; p.facing =  1; }
    if (inp.up)    vy = -spd;
    if (inp.down)  vy =  spd;
    if (vx !== 0 && vy !== 0) { vx *= 0.707; vy *= 0.707; }
    if (hasEffect(p, 'confuse')) { vx = -vx; vy = -vy; if (vx) p.facing = vx > 0 ? 1 : -1; }   // MIRROR RUNE
    if (p.passive === 'samuraiblade' && (vx || vy)) {                  // WAY OF THE BLADE
      const f = nearestFoe(p, key);
      if (f) {
        const ax = cx(f) - cx(p), ay = cy(f) - cy(p), al = Math.hypot(ax, ay) || 1, vl = Math.hypot(vx, vy);
        if ((ax * vx + ay * vy) / (al * vl) > SAM_TOWARD_DOT) { vx *= SAM_TOWARD_MULT; vy *= SAM_TOWARD_MULT; }
      }
    }
    if (p.kspin > 0) {
      // Spinning: less grip — speed builds up and carries on after you let go.
      const g = Math.min(1, KSPIN_GLIDE * factor);
      p.kvx = (p.kvx || 0) + (vx - (p.kvx || 0)) * g; p.kvy = (p.kvy || 0) + (vy - (p.kvy || 0)) * g;
      vx = p.kvx; vy = p.kvy;
      katanaSpinTick(p, key, dt);
    }

    if (p.bladeDash && !p.controlling) updateBladeDash(p, key, factor, dt);   // a Light Blade dash carries you
    else {
      p.x += vx * factor;
      p.y += vy * factor;
    }
    applyPull(p, dt);
    clampToArena(p, 2);

    // Burning: 4 damage every half second while it lasts.
    if (hasEffect(p, 'burn')) {
      p.burnAcc = (p.burnAcc || 0) + dt;
      while (p.burnAcc >= 500 && !p.dead) { p.burnAcc -= 500; dotDamage(p, 4); }
    }

    // Regeneration: +1 HP every 200 ms while it lasts.
    if (hasEffect(p, 'regen') && p.hp < p.maxHp) {
      p.regenAcc = (p.regenAcc || 0) + dt;
      while (p.regenAcc >= 200) { p.regenAcc -= 200; p.hp = Math.min(p.maxHp, p.hp + 1); }
    }

    // Decrement active effects
    if (p.effects) for (const k in p.effects) { p.effects[k] -= dt; if (p.effects[k] <= 0) delete p.effects[k]; }

    if (p.atkCooldown     > 0) p.atkCooldown     -= dt;
    if (p.specialCooldown > 0) p.specialCooldown -= dt;
    if (p.superCooldown   > 0) p.superCooldown   -= dt;
    if (p.vortexShield    > 0) p.vortexShield    -= dt;
    if (p.parryCooldown   > 0) p.parryCooldown   -= dt;
    if (p.parryTimer      > 0) p.parryTimer      -= dt;
    if (p.invincible      > 0) p.invincible      -= dt;
    if (p.hitFlash        > 0) p.hitFlash        -= dt;
    if (p.swingTimer      > 0) p.swingTimer      -= dt;
    for (const id in p.abCd) if (p.abCd[id] > 0) p.abCd[id] -= dt;
    if (hasEffect(p, 'thunder')) thunderTick(p, key, dt);
    if (p.lightspeed > 0) lightspeedTick(p, key, dt);
    if (p.passive && !p.dead) passiveTick(p, key, dt);
    // A few seconds of health history, for the Chrono Staff's REWIND.
    p.hpHistAcc = (p.hpHistAcc || 0) + dt;
    if (p.hpHistAcc >= 250) {
      p.hpHistAcc = 0;
      (p.hpHist = p.hpHist || []).push(p.hp);
      if (p.hpHist.length > REWIND_SAMPLES) p.hpHist.shift();
    }
    if (room.gameMode === 'sandbox') sandboxCheats(p);
    // SUPER is held to auto-fire, so letting go of a mind is on a fresh press.
    if (!room.prevSuperHeld) room.prevSuperHeld = {};
    const superTap = room.superJustPressed[key] && !room.prevSuperHeld[key];
    room.prevSuperHeld[key] = room.superJustPressed[key];
    if (p.controlling) {
      if (superTap) endMindControl(p, key);
      continue;
    }
    if (p.mindControlledBy) {
      // Puppeted: its own buttons do nothing; the controller's attack makes it attack.
      const ck = p.mindControlledBy;
      if (room.attackJustPressed[ck] && p.atkCooldown <= 0) doAttack(p, key);
      continue;
    }

    // The katana's spin is all you do while it lasts — only parry gets through.
    if (p.kspin > 0) {
      if (room.parryJustPressed[key] && p.parryCooldown <= 0) {
        p.parryTimer = p.parryWindow || PARRY_WINDOW; p.parryCooldown = p.parryCd || PARRY_COOLDOWN;
        spawnParrySpark(cx(p), cy(p));
      }
      continue;
    }
    // > goes to the next weapon, < to the one before (they wrap round).
    const nWeapons = p.unlockedWeapons.length;
    const step = (room.swapJustPressed[key] ? 1 : 0) - (room.swapPrevJustPressed[key] ? 1 : 0);
    if (step && nWeapons > 0) {
      p.weaponIdx = ((p.weaponIdx + step) % nWeapons + nWeapons) % nWeapons;
      refreshWeapon(p);
    }
    // A Light Blade click / tap is an attack aimed at that spot (kept briefly if it's still cooling).
    if (p.bladeClick && (!weapon(p).lightDash || Date.now() - p.bladeClick.at > BLADE_CLICK_MS)) p.bladeClick = null;
    const bladeBusy = weapon(p).lightDash && p.bladeDash;
    if ((room.attackJustPressed[key] || p.bladeClick) && p.atkCooldown <= 0 && !bladeBusy) {
      doAttack(p, key);
    }
    if (room.specialJustPressed[key] && p.specialCooldown <= 0) {
      doSpecial(p, key);
    }
    if (room.superJustPressed[key] && p.superCooldown <= 0 && weapon(p).super) {
      doSuper(p, key);
    }
    // Abilities auto-fire while held, like attack/special/super.
    for (let i = 0; i < p.abilities.length && i < MAX_ABILITY_SLOTS; i++) {
      if (room.inputs[key]['ab' + (i + 1)] && !p.dead) useAbility(p, key, i);
    }
    if (room.parryJustPressed[key] && p.parryCooldown <= 0) {
      p.parryTimer    = p.parryWindow || PARRY_WINDOW;
      p.parryCooldown = p.parryCd || PARRY_COOLDOWN;
      spawnParrySpark(cx(p), cy(p));
    }
  }

  // ── Monsters ──
  // Snapshot: a kill during this pass replaces room.monsters mid-iteration.
  for (const m of room.monsters.slice()) {
    if (m.dead) continue;
    let nearest = null, bestDist = Infinity;
    for (const p of [...allPlayers(), ...room.allies, ...room.monsters.filter(o => o.controlledBy && o !== m)]) {
      if (!p || p.dead || (p.num && unseen(p))) continue;
      const d = distBetween(p, m);
      if (d < bestDist) { bestDist = d; nearest = p; }
    }

    if (m.slowTimer > 0) m.slowTimer -= dt;
    if (m.burnTimer > 0) {
      m.burnTimer -= dt;
      m.burnAcc = (m.burnAcc || 0) + dt;
      while (m.burnAcc >= 500 && !m.dead) { m.burnAcc -= 500; dotDamage(m, 4); }
    }
    if (m.atkCooldown > 0) m.atkCooldown -= dt;
    if (m.hitFlash    > 0) m.hitFlash    -= dt;
    if (m.invincible  > 0) m.invincible  -= dt;
    if (m.swing       > 0) m.swing       -= dt;
    if (m.ward        > 0) m.ward        -= dt;
    // Frozen solid by a frost nova: no moving, no attacking.
    if (m.freeze > 0) { m.freeze -= dt; continue; }
    if (m.controlledBy) continue;   // a puppet: moved by its controller (tickMindControl)
    if (room.gameMode === 'sandbox' && room.sandbox.freeze) continue;   // sandbox: AI switched off

    if (nearest) {
      const def = MONSTER_TYPES[m.type] || MONSTER_TYPES.grunt;
      const dx = cx(nearest) - cx(m), dy = cy(nearest) - cy(m);
      const dist = Math.hypot(dx, dy) || 1;
      if (Math.abs(dx) > 2) {
        // Monsters are slow to turn round once you slip behind them (bosses aren't),
        // which leaves a window for backstabs.
        const want = dx > 0 ? 1 : -1;
        if (m.boss || !m.face || want === m.face) { m.face = want; m.turnT = 0; }
        else if ((m.turnT = (m.turnT || 0) + dt) >= MONSTER_TURN_MS) { m.face = want; m.turnT = 0; }
      }
      const spd = m.speed * (m.slowTimer > 0 ? 0.4 : 1);

      if (m.boss) {
        if (m.mage) updateMage(m, nearest, dist, dx, dy, spd, factor, dt);
        else if (m.abyss) updateAbyss(m, nearest, dist, dx, dy, spd, factor, dt);
        else updateGiant(m, nearest, dist, dx, dy, spd, factor, dt);
        applyPull(m, dt);
        clampToArena(m);
        continue;
      }

      // Monsters with their own tricks; true means it handled this tick itself.
      if (def.ai && MONSTER_AI[def.ai](m, nearest, dist, dx, dy, spd, factor, dt)) {
        applyPull(m, dt);
        clampToArena(m);
        continue;
      }

      // Wraiths blink: every few seconds, if you're far off, they reappear at
      // your side (a flash marks both ends so it can be read and dodged).
      if (def.blink) {
        m.blinkTimer -= dt;
        if (m.blinkTimer <= 0 && dist > 90) {
          m.blinkTimer = def.blink;
          const a = Math.random() * Math.PI * 2;
          room.particles.push({ type: 'teleport', x: cx(m), y: cy(m), timer: 340, max: 340, color: '#8a6aff' });
          m.x = cx(nearest) + Math.cos(a) * 46 - m.w / 2;
          m.y = cy(nearest) + Math.sin(a) * 46 - m.h / 2;
          clampToArena(m);
          m.atkCooldown = Math.max(m.atkCooldown, 450);   // a beat to react after it lands
          room.particles.push({ type: 'teleport', x: cx(m), y: cy(m), timer: 340, max: 340, color: '#c8b8ff' });
        } else if (m.blinkTimer <= 0) m.blinkTimer = 400;
      }

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
        if (dist <= reach + 4 && m.atkCooldown <= 0) monsterMelee(m, nearest);
      }
      if (nearest.num) { m.lastSeen = { x: cx(nearest), y: cy(nearest) }; m.searchedHome = false; }
    } else if (!m.boss) {
      monsterSearch(m, spdOf(m), factor, dt);   // nobody in sight (you're invisible): hunt around
    }

    applyPull(m, dt);
    clampToArena(m);
  }
  updateAllies(factor, dt);
  updateHurls(dt);
  separateMonsters(factor);

  // ── Projectiles ──
  room.projectiles = room.projectiles.filter(proj => updateProjectile(proj, factor, dt));
  updateFires(factor, dt);

  // ── Wave spawner ── (the Portal Mage fight has no waves: he brings his own;
  // in the sandbox you spawn what you like)
  if (room.gameMode !== 'pvp' && room.gameMode !== 'portal' && room.gameMode !== 'abyss' && room.gameMode !== 'sandbox') {
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
      if (room.gameMode === 'coop' && room.wave.num >= COOP_FINAL_WAVE) {
        room.victory = true;
        room.gameState = 'ROUND_OVER';
        room.roundOverTimer = 7000;
        broadcastState();
        return;
      }
      room.wave.betweenTimer = 3000;
      room.particles.push({
        type: 'waveclear', x: CANVAS_W / 2, y: CANVAS_H / 2 - 10,
        text: 'WAVE ' + room.wave.num + ' CLEAR!', timer: 2500,
      });
      // Extreme pays a coin bonus for every wave survived, straight to the player.
      if (room.gameMode === 'extreme') {
        const bonus = EXTREME_WAVE_BONUS * room.wave.num;
        for (const key of KEYS) {
          const p = room.players[key];
          if (!p) continue;
          addCoins(key, bonus);
          room.particles.push({ type: 'coin', x: cx(p), y: p.y - 10, text: '+' + bonus + ' WAVE BONUS', timer: 1800, max: 1800 });
        }
      }
    }
  }

  // ── Traps ── (in the Portal Mage fight only he lays them)
  room.trapSpawnTimer -= dt;
  if (room.trapSpawnTimer <= 0 && room.gameMode !== 'portal' && room.gameMode !== 'abyss' && room.gameMode !== 'sandbox') {
    if (room.traps.filter(t => !t.owner).length < MAX_TRAPS) spawnTrap();
    room.trapSpawnTimer = TRAP_SPAWN_MIN + Math.random() * (TRAP_SPAWN_MAX - TRAP_SPAWN_MIN);
  }
  room.traps = room.traps.filter(tr => {
    // The mage's traps fade away if nobody steps on them.
    if (tr.expire && tr.state === 'idle') {
      tr.expire -= dt;
      if (tr.expire <= 0) {
        room.particles.push({ type: 'teleport', x: tr.x + tr.w / 2, y: tr.y + tr.h / 2, timer: 300, max: 300, color: '#b07aff' });
        return false;
      }
    }
    if (tr.state === 'idle') {
      if (tr.owner) {
        // A mind trap: sprung by its owner's enemies, never by its owner.
        const foe = enemyTargets(tr.owner).find(t => aabb(t, tr));
        if (foe) {
          if (tr.mode === 'instant') fireTrap(tr, null);
          else { tr.state = 'arming'; tr.armTimer = TRAP_TYPES[tr.type].armTime; tr.trigger = null; }
        }
      } else {
        let sprung = false;
        for (const key of KEYS) {
          const p = room.players[key];
          if (p && !p.dead && !p.controlling && aabb(p, tr)) {
            if (tr.mode === 'instant') fireTrap(tr, p);
            else { tr.state = 'arming'; tr.armTimer = TRAP_TYPES[tr.type].armTime; tr.trigger = key; }
            sprung = true;
            break;
          }
        }
        // A monster under mind control can be walked straight into one.
        const puppet = !sprung && room.monsters.find(m => m.controlledBy && !m.dead && aabb(m, tr));
        if (puppet) {
          if (tr.mode === 'instant') fireTrap(tr, null);
          else { tr.state = 'arming'; tr.armTimer = TRAP_TYPES[tr.type].armTime; tr.trigger = null; }
        }
      }
    } else if (tr.state === 'arming') {
      tr.armTimer -= dt;
      if (tr.armTimer <= 0) fireTrap(tr, tr.trigger ? room.players[tr.trigger] : null);
    } else if (tr.state === 'firing') {
      const ldef = TRAP_TYPES[tr.type];
      if (ldef.linger) {
        const tx = tr.x + tr.w / 2, ty = tr.y + tr.h / 2;
        const inside = (tr.owner ? enemyTargets(tr.owner) : [...allPlayers(), ...room.monsters])
          .filter(t => t && !t.dead && !t.controlling && Math.hypot(cx(t) - tx, cy(t) - ty) <= tr.radius);
        // The gravity well drags all the time, not just on its ticks.
        if (tr.effect === 'gravity') {
          for (const t of inside) {
            if (t.boss) continue;
            const dx = tx - cx(t), dy = ty - cy(t), d = Math.hypot(dx, dy) || 1;
            const pull = Math.min(d, 1.5 * factor);
            t.x += dx / d * pull; t.y += dy / d * pull;
            clampToArena(t);
          }
        }
        tr.tickTimer -= dt;
        if (tr.tickTimer <= 0) {
          tr.tickTimer = ldef.tick;
          for (const t of inside) {
            if (tr.effect === 'poison') { dotDamage(t, tr.damage); if (t.num) applyEffect(t, 'poison', 500); }
            else if (tr.effect === 'healspring') t.hp = Math.min(t.maxHp, t.hp + tr.damage);
            else dotDamage(t, tr.damage);
          }
        }
      }
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
    for (const key of KEYS) {
      const p = room.players[key];
      if (!p || p.dead || !aabb(p, it)) continue;
      // A medkit heals on touch, whatever you're carrying.
      if (ITEM_TYPES[it.type].touch) {
        const heal = Math.min(p.maxHp - p.hp, Math.round(p.maxHp * ITEM_TYPES[it.type].share));
        p.hp += heal;
        room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p), maxR: 30, timer: 700, max: 700,
                              color: ITEM_TYPES[it.type].color, text: '+' + heal + ' HP' });
        return false;
      }
      if (p.inventory.length < MAX_INVENTORY) {
        p.inventory.push(it.type);
        const def = ITEM_TYPES[it.type];
        room.particles.push({ type: 'pickup', x: cx(it), y: it.y, timer: 1800, max: 1800, color: def.color,
                              text: def.name, sub: def.desc, item: it.type, who: key, slot: p.inventory.length });
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
    for (const key of KEYS) {
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
      const settled = COIN_LIFETIME - c.life > COIN_SETTLE_MS;
      const reach = COIN_ATTRACT;
      if (nearDist < reach || settled) {
        const pull = Math.max(settled ? COIN_SETTLED_PULL : 0, COIN_PULL * (1 - nearDist / reach));
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
  broadcastTick();
}


// Nudge overlapping monsters apart so a wave doesn't collapse into one blob.
function separateMonsters(factor) {
  const ms = room.monsters.concat(room.allies);   // allies shoulder through the pack too
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
  if (e.boss) { e.pull = null; return; }
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
// HAUNTING: a thrown ghost dagger turns toward the nearest foe it hasn't hit.
const HOMING_TURN = 6.5, HOMING_SEEK_R = 420;
function homeProjectile(proj, dt) {
  let best = proj.quarry && !proj.quarry.dead && (proj.quarry.num || room.monsters.includes(proj.quarry)) ? proj.quarry : null;
  let bd = HOMING_SEEK_R;
  if (!best) for (const t of enemyTargets(proj.owner)) {
    if (proj.hitTargets && proj.hitTargets.has(t)) continue;
    const d = Math.hypot(cx(t) - proj.x, cy(t) - proj.y);
    if (d < bd) { bd = d; best = t; }
  }
  if (!best) return;
  const sp = Math.hypot(proj.dx, proj.dy) || 1;
  const a = turnToward(Math.atan2(proj.dy, proj.dx), Math.atan2(cy(best) - proj.y, cx(best) - proj.x), HOMING_TURN * dt / 1000);
  proj.dx = Math.cos(a) * sp; proj.dy = Math.sin(a) * sp;
}

function updateProjectile(proj, factor, dt) {
  if (proj.dead) return false;   // shot down
  const stepLen = Math.hypot(proj.dx, proj.dy) * factor;
  const subs = Math.max(1, Math.ceil(stepLen / 5));
  for (let i = 0; i < subs; i++) {
    if (!advanceProjectile(proj, factor / subs, dt / subs)) return false;
  }
  return true;
}

function advanceProjectile(proj, factor, dt) {
  if (proj.homing) homeProjectile(proj, dt);
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

  const hr = proj.hitR || 4;
  const hitBox = { x: proj.x - hr, y: proj.y - hr, w: hr * 2, h: hr * 2 };
  // A player's shot knocks the Abyss's rapid-fire bolts out of the air.
  if (proj.owner !== 'monster') {
    const shot = room.projectiles.find(o => o.shootable && !o.dead && o.owner === 'monster' && Math.abs(o.x - proj.x) < 8 && Math.abs(o.y - proj.y) < 8);
    if (shot) {
      shot.dead = true;
      room.particles.push({ type: 'shockwave', x: shot.x, y: shot.y, maxR: 12, timer: 220, max: 220, color: '#c89aff' });
      if (!proj.pierce && !proj.isAoe) return false;
    }
  }
  for (const t of enemyTargets(proj.owner)) {
    if (t === proj.ignore || !aabb(hitBox, t)) continue;
    if (proj.dashWave) { triggerDashWave(proj, t); return false; }
    const tk = playerKeyOf(t);
    if (tk && t.parryTimer > 0) {
      // Parried: bounce the projectile back at its owner
      proj.dx = -proj.dx; proj.dy = -proj.dy;
      proj.owner = tk;
      proj.traveled = 0;
      proj.returning = false;
      proj.damage = Math.round(proj.damage * reflectOf(t));
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
    if (proj.ghostThrow) { ghostThrowHit(proj, t); return false; }
    if (proj.noIframe && !t.num) t.invincible = 0;   // a rapid burst: every bolt counts
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
// Damage over time (fire, poison): ignores the brief invulnerability after a
// hit — otherwise ticks would simply bounce off — and credits nobody.
function dotDamage(t, dmg) {
  if (t.dead) return;
  if (t.num && hasEffect(t, 'shield')) return;
  if (t.armor) dmg = Math.max(1, Math.round(dmg * (1 - t.armor)));
  if (t.num && t.defense) dmg = Math.max(1, Math.round(dmg * (1 - t.defense)));
  if (t.num && t.vortexShield > 0) { bankVortex(t, dmg); return; }   // blocked, but banked
  if (t.hidden || t.p3) return;
  t.hp -= dmg;
  if (t.mage) mageFloor(t);
  t.hitFlash = Math.max(t.hitFlash || 0, 90);
  if (t.hp <= 0) handleKill(t, 'trap');
}

function ignite(t, ms) {
  if (t.dead) return;
  if (t.num) applyEffect(t, 'burn', ms);
  else t.burnTimer = Math.max(t.burnTimer || 0, ms);
}

// kind: chill (frost), time (time magic), net (snare), poison (toxic cloud).
function chillTarget(t, ms, kind = 'chill') {
  if (t.dead) return;
  if (t.num) applyEffect(t, 'slow', ms);
  else {
    if (ms >= (t.slowTimer || 0)) t.slowKind = kind;
    t.slowTimer = Math.max(t.slowTimer || 0, ms);
  }
}

// A hit that ignores projectiles but still respects a parry: the parrying
// player is untouched and the blow goes back to the attacker instead.
function strikeTarget(t, dmg, ownerKey) {
  const tk = playerKeyOf(t);
  if (tk && t.parryTimer > 0) {
    const o = room.players[ownerKey];
    if (o) applyDamage(o, Math.round(dmg * reflectOf(t)), tk);
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
  if (proj.chill) chillTarget(t, proj.chill, proj.weaponId === 'chronostaff' ? 'time' : 'chill');
  if (proj.stun) stagger(t, proj.stun, 'shock');
  if (proj.frostbite) addFrostbite(t);
  // Wind wand: the gust shoves the target along the shot (never the Giant).
  if (proj.gust && !t.boss && !t.dead) {
    const sp = Math.hypot(proj.dx, proj.dy) || 1;
    t.x += proj.dx / sp * proj.gust;
    t.y += proj.dy / sp * proj.gust;
    clampToArena(t);
  }
  if (proj.burn) ignite(t, proj.burn);
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

// Half-width of a normal melee swing (a little over 90°, so a target at your
// side still gets clipped). Matches the crescent the client draws.
const MELEE_HALF_ARC = Math.PI * 0.55;

function doAttack(p, pKey) {
  const w = weapon(p);
  // Any attack ends a ghost cloak; the Dagger of Ghosts' own strike out of it
  // hits twice as hard, and its attack from the open puts the cloak on.
  const wasGhost = hasEffect(p, 'ghost');
  if (wasGhost) breakGhost(p);
  const dmgMult = (hasEffect(p, 'strength') ? 1.8 : 1) * (wasGhost && w.ghostCloak ? 2 : 1);
  const cdMult  = hasEffect(p, 'haste') ? 0.5 : 1;
  p.atkCooldown = w.atkSpd * cdMult;
  p.swingTimer  = Math.min(w.atkSpd, 200);
  if (w.ghostCloak && !wasGhost) {
    applyEffect(p, 'ghost', GHOST_MS);
    p.atkCooldown = Math.max(p.atkCooldown, GHOST_CLOAK_CD);
    p.swingTimer = 0;
    room.particles.push({ type: 'teleport', x: cx(p), y: cy(p), timer: 420, max: 420, color: WEAPON_COLORS.ghostdagger });
    return;
  }
  if (wasGhost && w.ghostCloak) {
    room.particles.push({ type: 'crit', x: cx(p), y: p.y - 8, text: 'GHOST STRIKE', timer: 600, max: 600 });
  }
  // Any attack can swat an enemy's fire hand out of the air.
  swatFireHands(p, pKey, w.type === 'melee' ? w.range : 48);
  swatShots(p, w.type === 'melee' ? w.range + 10 : 44);
  if (w.infinityShot) { infinityAttack(p, pKey, w, dmgMult); return; }
  if (w.slashWave) {
    // A slash wave that seeks out the nearest foe.
    const aim = nearestTargetAngle(p, pKey);
    p.facing = Math.cos(aim) < 0 ? -1 : 1;
    for (let i = 0; i < 1 + (w.multi || 0); i++) {
      slashWave(pKey, cx(p), cy(p), aim + (i - (w.multi || 0) / 2) * 0.22, Math.round(w.damage * dmgMult),
                { speed: 9, range: w.range, homing: true, upg: p.upgrades?.[w.id] || null });
    }
    return;
  }

  if (w.mindTrap) { placeMindTrap(p, pKey, w, dmgMult); return; }
  if (w.lightDash) { p.swingTimer = 0; bladeAttack(p, pKey, w, dmgMult); return; }
  if (w.vortexShield) {
    p.vortexShield = VORTEX_SHIELD_MS;
    room.particles.push({ type: 'shockwave', x: cx(p), y: cy(p), maxR: 22, timer: 300, max: 300, color: WEAPON_COLORS.vortex });
    return;
  }
  if (w.portalShot) {
    // Portal Wand: a small fire portal flicks open beside you and throws a
    // fireball at the nearest foe (MULTISHOT opens more of them).
    const aim = nearestTargetAngle(p, pKey);
    p.facing = Math.cos(aim) < 0 ? -1 : 1;
    const n = 1 + (w.multi || 0);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 24 + Math.random() * 16;
      const at = arenaClamp(cx(p) + Math.cos(a) * d, cy(p) + Math.sin(a) * d, 12);
      openFirePortal(pKey, at.x, at.y, Math.round(w.damage * dmgMult), -i * 60, [170],
                     { r: 11, linger: 260, aoe: w.aoeRadius });
    }
    return;
  }
  if (w.fireRing) {
    const aim = nearestTargetAngle(p, pKey);
    p.facing = Math.cos(aim) < 0 ? -1 : 1;
    castFireRing(p, pKey, w, dmgMult);
    return;
  }
  if (w.type === 'melee') {
    // Ordinary blades cut a half-circle toward the nearest foe; 360 weapons
    // (whip, flail, reaper) whirl around and hit everything in reach.
    const aim = nearestTargetAngle(p, pKey);
    p.facing = Math.cos(aim) < 0 ? -1 : 1;
    for (const t of enemyTargets(pKey)) {
      const d = distBetween(t, p);
      if (d > w.range) continue;
      if (!w.swing360 && d > 14) {
        let diff = Math.abs(Math.atan2(cy(t) - cy(p), cx(t) - cx(p)) - aim) % (Math.PI * 2);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        if (diff > MELEE_HALF_ARC) continue;
      }
      const tk = playerKeyOf(t);
      if (tk && t.parryTimer > 0) {
        // Parried: the attacker takes the (boosted) hit instead
        applyDamage(p, Math.round(w.damage * dmgMult * reflectOf(t)), tk);
        spawnParrySpark(cx(p), cy(p));
      } else {
        applyDamage(t, Math.round(w.damage * dmgMult), pKey);
        if (w.arcHit) arcLightning(t, Math.round(w.damage * dmgMult * 0.5), w.arcHit, pKey);
        if (w.frostbite) addFrostbite(t);
        if (w.stunHit) stagger(t, w.stunHit, 'stun');              // MACE
        if (w.burn) ignite(t, w.burn);
        if (w.chill) chillTarget(t, w.chill);
        if (w.voidPull && p.passive === 'endlessscythe' && !t.dead) {   // EVENT HORIZON
          stagger(t, HORIZON_STUN_MS, 'stun');   // bosses and players are slowed instead
          const ddx = cx(p) - cx(t), ddy = cy(p) - cy(t), dd = Math.hypot(ddx, ddy) || 1;
          if (!t.boss && dd > 20) { t.x += ddx / dd * 12; t.y += ddy / dd * 12; clampToArena(t); }
        }
      }
    }
    // VOID BLADE: a wave of void flies on ahead of every swing.
    if (w.voidWave) {
      for (let i = 0; i < 1 + (w.multi || 0); i++) {
        const a = aim + (i - (w.multi || 0) / 2) * 0.25;
        room.projectiles.push({ id: nextId(), x: cx(p), y: cy(p), dx: Math.cos(a) * 6, dy: Math.sin(a) * 6,
          damage: Math.round(w.damage * dmgMult * VOID_WAVE_MULT), owner: pKey, traveled: 0, maxRange: VOID_WAVE_RANGE,
          weaponId: 'voidblade', isAoe: false, aoeRadius: 0, pierce: true, grapple: false, boomerang: false,
          returning: false, life: 0, hitTargets: new Set() });
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
      gust: w.gust || 0,
      burn: w.burn || 0,
    });
    }
  }
}

// ─── Fire Glove ───────────────────────────────────────────────────────────────
// room.fires holds the glove's three flames:
//   ring    – the attack: a ring that grows out from the glove for 1 s.
//   hand    – the special: a big fiery hand that hunts the nearest foe. It
//             vanishes when it catches someone, or when its target hits
//             (or parries) it.
//   inferno – the SUPER: a huge ring that keeps growing until it has swept the
//             whole arena. A parry smothers it completely.
const FIRE_RING_MS   = 1000;
const FIRE_BAND      = 8;      // half-thickness of a ring's burning edge
const INFERNO_BAND   = 13;
const INFERNO_START  = 26;
const INFERNO_GROWTH = 2.3;    // px per 16.67 ms
const INFERNO_MAX_R  = Math.hypot(MAP_SIZES.big[0], MAP_SIZES.big[1]) + 40;
// Hands fly like missiles: they launch slowly, accelerate toward a top speed,
// and the faster they go the wider they turn, so a late sidestep makes them
// overshoot. (Speeds in px, turn in rad, both per 16.67 ms.)
const HAND_SPEED0    = 1.0;
const HAND_SPEED_MAX = 4.6;    // a little faster than a running player (3.6)
const HAND_ACCEL     = 0.06;
const HAND_TURN      = 0.13;   // at launch speed; shrinks as it speeds up
const HAND_RADIUS    = 10;
const HAND_LIFE      = 3000;

function castFireRing(p, pKey, w, dmgMult) {
  room.fires.push({ id: nextId(), kind: 'ring', owner: pKey, x: cx(p), y: cy(p), r: 6, maxR: w.range,
                    t: 0, life: FIRE_RING_MS, dmg: Math.round(w.damage * dmgMult), hit: new Set() });
}

// One hand per cast, with no cap on how many can be out. However a hand ends —
// catching someone, being swatted or parried, or burning out after 3 s — it
// explodes (see explodeHand).
// MULTISHOT adds hands, fanned out around the aim.
function castFireHand(p, pKey, sp, dmgMult) {
  const aim = nearestTargetAngle(p, pKey);
  p.facing = Math.cos(aim) < 0 ? -1 : 1;
  const n = 1 + (weapon(p).multi || 0);
  for (let i = 0; i < n; i++) {
    const a = aim + (i - (n - 1) / 2) * 0.7;
    room.fires.push({ id: nextId(), kind: 'hand', owner: pKey, x: cx(p) + Math.cos(a) * 12, y: cy(p) + Math.sin(a) * 12,
                      a, v: HAND_SPEED0, t: 0, life: HAND_LIFE, dmg: Math.round(sp.dmg * dmgMult),
                      aoe: sp.aoe || 40, blast: Math.round((sp.blast || 14) * dmgMult),
                      slot: i, side: n > 1 ? (i - (n - 1) / 2) / ((n - 1) / 2) : 0 });
  }
}

// The blast hurts the caster's enemies nearby — except anyone mid-parry.
function explodeHand(f) {
  for (const t of enemyTargets(f.owner)) {
    if (Math.hypot(cx(t) - f.x, cy(t) - f.y) > f.aoe + t.w / 2) continue;
    if (playerKeyOf(t) && t.parryTimer > 0) continue;
    applyDamage(t, f.blast, f.owner);
    ignite(t, 1200);
  }
  room.particles.push({ type: 'aoe', x: f.x, y: f.y, maxR: f.aoe, radius: 2, timer: 420, max: 420, color: WEAPON_COLORS.fireglove });
  room.particles.push({ type: 'shockwave', x: f.x, y: f.y, maxR: f.aoe, timer: 380, max: 380, color: '#ffc23a' });
}

function doSuper(p, pKey) {
  const su = weapon(p).super;
  if (!su || hasEffect(p, 'silence')) return;
  if (hasEffect(p, 'ghost')) breakGhost(p);
  p.superCooldown = su.cd;
  p.swingTimer = 300;
  const dmgMult = hasEffect(p, 'strength') ? 1.8 : 1;
  if (su.kind === 'katanaspin') {
    p.kspin = KSPIN_MS; p.kspinT = 0; p.kspinDmg = Math.round(su.dmg * dmgMult); p.kvx = 0; p.kvy = 0;
    room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p), maxR: 46, timer: 700, max: 700, color: WEAPON_COLORS.samuraiblade, text: 'WHIRLWIND' });
    return;
  }
  if (su.kind === 'abysswhirl') {
    room.fires.push({ id: nextId(), kind: 'scythewhirl', owner: pKey, x: cx(p), y: cy(p), r: WHIRL_R, t: 0, life: WHIRL_MS + 450,
                      tick: 0, dmg: Math.round(su.dmg * dmgMult), flung: false, slashed: false, a: nearestTargetAngle(p, pKey) });
    room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p), maxR: 50, timer: 700, max: 700, color: WEAPON_COLORS.endlessscythe, text: 'ABYSSAL WHIRL' });
    return;
  }
  if (su.kind === 'abyssvolley') {
    // All three crossbows shoot one spot: a bolt-spitting black hole opens there.
    const t = nearestFoe(p, pKey);
    const at = t ? { x: cx(t), y: cy(t) } : { x: cx(p) + (p.facing || 1) * 140, y: cy(p) };
    const from = infinityMuzzles(p);
    abyssConverge(pKey, from, at, Math.round(40 * dmgMult), {
      r: 26, pullR: 170, dmg: Math.round(30 * dmgMult), life: 3200,
      boom: Math.round(su.dmg * dmgMult), boomR: 120, spit: { every: 160, range: 260, dmg: Math.round(22 * dmgMult) } });
    room.particles.push({ type: 'trapburst', x: at.x, y: at.y, maxR: 50, timer: 800, max: 800, color: WEAPON_COLORS.infinitybow, text: 'INFINITY' });
    return;
  }
  if (su.kind === 'lightspeed') {
    p.lightspeed = LIGHTSPEED_MS; p.lsMult = dmgMult; p.crashCd = 0; p.lsAcc = 0;
    room.particles.push({ type: 'shockwave', x: cx(p), y: cy(p), maxR: 80, timer: 500, max: 500, color: WEAPON_COLORS.lightblade });
    room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p), maxR: 50, timer: 800, max: 800, color: WEAPON_COLORS.lightblade, text: 'LIGHTSPEED' });
    return;
  }
  if (su.kind === 'mindcontrol') {
    if (!startMindControl(p, pKey)) { p.superCooldown = 0; p.swingTimer = 0; }
    return;
  }
  if (su.kind === 'rewind') {
    // REWIND: back to your best health of the last few seconds, bad effects
    // undone, the special ready again, and a burst of haste.
    const best = Math.max(p.hp, ...(p.hpHist || []));
    const gain = Math.round(best - p.hp);
    p.hp = Math.min(p.maxHp, best);
    if (p.effects) for (const k of ['burn', 'poison', 'slow', 'root', 'confuse', 'silence']) delete p.effects[k];
    p.specialCooldown = 0;
    applyEffect(p, 'haste', REWIND_HASTE_MS);
    applyEffect(p, 'speed', REWIND_HASTE_MS);
    room.particles.push({ type: 'shockwave', x: cx(p), y: cy(p), maxR: 70, timer: 700, max: 700, color: WEAPON_COLORS.chronostaff });
    room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p), maxR: 40, timer: 800, max: 800, color: WEAPON_COLORS.chronostaff,
                          text: gain > 0 ? 'REWIND +' + gain : 'REWIND' });
    return;
  }
  if (su.kind === 'singularity') {
    // SINGULARITY: a huge black hole on the nearest foe; it collapses in a blast.
    const t = nearestFoe(p, pKey);
    const at = t ? { x: cx(t), y: cy(t) } : { x: cx(p) + (p.facing || 1) * 120, y: cy(p) };
    room.fires.push({ id: nextId(), kind: 'blackhole', owner: pKey, x: at.x, y: at.y, r: SING_R, t: 0, life: SING_MS, tick: 0,
                      dmg: Math.round(su.dmg * dmgMult), pullR: SING_PULL_R, boom: Math.round(su.dmg * SING_BOOM * dmgMult), boomR: SING_BOOM_R });
    room.particles.push({ type: 'trapburst', x: at.x, y: at.y, maxR: 60, timer: 800, max: 800, color: WEAPON_COLORS.voidblade, text: 'SINGULARITY' });
    return;
  }
  if (su.kind === 'absorbheal') {
    // Nothing banked: nothing to heal, and the cooldown isn't spent.
    const bank = p.vortexStore || 0;
    if (bank <= 0) { p.superCooldown = 0; p.swingTimer = 0; emptyBank(p); return; }
    const heal = Math.round(bank * su.dmg / 100);
    p.hp = Math.min(p.maxHp, p.hp + heal);
    p.vortexStore = 0;
    room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p), maxR: 40, timer: 700, max: 700,
                          color: '#7affb0', text: '+' + heal + ' HP' });
    return;
  }
  if (su.kind === 'inferno') {
    // Five waves, one after another; each starts from wherever you are then.
    for (let i = 0; i < INFERNO_WAVES; i++) {
      room.fires.push({ id: nextId(), kind: 'inferno', owner: pKey, x: cx(p), y: cy(p), r: i ? 0 : INFERNO_START,
                        t: -i * INFERNO_WAVE_GAP, life: 60000, dmg: Math.round(su.dmg * dmgMult), hit: new Set() });
    }
    room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p), maxR: 50, timer: 700, max: 700,
                          color: WEAPON_COLORS.fireglove, text: 'INFERNO x' + INFERNO_WAVES });
    return;
  }
  if (su.kind === 'hurricane') {
    room.fires.push({ id: nextId(), kind: 'hurricane', owner: pKey, x: cx(p), y: cy(p), r: HURRICANE_R,
                      t: 0, life: HURRICANE_MS, dmg: Math.round(su.dmg * dmgMult), tick: 0 });
    room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p), maxR: 50, timer: 700, max: 700,
                          color: WEAPON_COLORS.windwand, text: 'HURRICANE' });
    return;
  }
  if (su.kind === 'deadeye') {
    // An exploding bullet straight into every enemy on the field.
    const foes = enemyTargets(pKey).slice(0, DEADEYE_MAX);
    if (!foes.length) { p.superCooldown = 0; p.swingTimer = 0; return; }
    for (const t of foes) {
      const a = Math.atan2(cy(t) - cy(p), cx(t) - cx(p));
      room.projectiles.push({
        id: nextId(), x: cx(p), y: cy(p), dx: Math.cos(a) * 11, dy: Math.sin(a) * 11,
        damage: Math.round(su.dmg * dmgMult), owner: pKey, traveled: 0,
        maxRange: Math.hypot(cx(t) - cx(p), cy(t) - cy(p)) + 30, weaponId: 'revolver', upg: p.upgrades?.revolver || null,
        special: true, isAoe: true, aoeRadius: DEADEYE_AOE, pierce: false, grapple: false, boomerang: false,
        teleport: false, returning: false, life: 0, hitTargets: null,
      });
      room.particles.push({ type: 'crit', x: cx(t), y: t.y - 6, text: 'X', timer: 500, max: 500 });
    }
    room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p), maxR: 40, timer: 600, max: 600,
                          color: WEAPON_COLORS.revolver, text: 'DEAD EYE' });
    return;
  }
  if (su.kind === 'thundergod') {
    applyEffect(p, 'thunder', THUNDER_MS);
    p.thunderDmg = Math.round(su.dmg * dmgMult);
    p.thunderAcc = THUNDER_EVERY;   // the first strike lands at once
    room.particles.push({ type: 'bolt', x: cx(p), y: ARENA_Y + 2, x2: cx(p), y2: cy(p), timer: 400, max: 400, color: WEAPON_COLORS.stormhammer });
    room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p), maxR: 50, timer: 700, max: 700, color: WEAPON_COLORS.stormhammer, text: 'THUNDER GOD' });
    return;
  }
  if (su.kind === 'absolutezero') {
    room.fires.push({ id: nextId(), kind: 'blizzard', owner: pKey, x: cx(p), y: cy(p), r: BLIZZARD_R, t: 0, life: BLIZZARD_MS,
                      tick: 0, dmg: Math.round(su.dmg * dmgMult) });
    room.particles.push({ type: 'shockwave', x: cx(p), y: cy(p), maxR: BLIZZARD_R, timer: 500, max: 500, color: WEAPON_COLORS.frostscythe });
    room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p), maxR: 50, timer: 700, max: 700, color: WEAPON_COLORS.frostscythe, text: 'ABSOLUTE ZERO' });
    return;
  }
  if (su.kind === 'supernova') {
    const aim = nearestTargetAngle(p, pKey);
    room.fires.push({ id: nextId(), kind: 'sunbeam', owner: pKey, x: cx(p), y: cy(p), r: SUNBEAM_W, t: 0, life: SUNBEAM_MS,
                      a: aim - SUNBEAM_SWEEP / 2, a0: aim - SUNBEAM_SWEEP / 2, tick: 0, dmg: Math.round(su.dmg * dmgMult) });
    room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p), maxR: 50, timer: 700, max: 700, color: WEAPON_COLORS.sunbow, text: 'SUPERNOVA' });
    return;
  }
  if (su.kind === 'knifestorm') {
    // The dagger goes up... and knives come down all over the field for a few
    // seconds, each one marked where it will land.
    room.particles.push({ type: 'streak', x: cx(p), y: cy(p), x2: cx(p), y2: ARENA_Y, timer: 450, max: 450, color: WEAPON_COLORS.ghostdagger });
    for (let i = 0; i < KNIFE_COUNT; i++) {
      room.fires.push({ id: nextId(), kind: 'knife', owner: pKey, x: cx(p), y: cy(p), r: KNIFE_R,
                        t: -Math.round(KNIFE_DELAY + i / KNIFE_COUNT * KNIFE_MS + Math.random() * 120), life: KNIFE_FALL_MS,
                        dmg: Math.round(su.dmg * dmgMult), seek: i % 2 === 0, placed: false });
    }
    room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p), maxR: 50, timer: 700, max: 700,
                          color: WEAPON_COLORS.ghostdagger, text: 'KNIFE STORM' });
    return;
  }
  if (su.kind === 'legion') {
    // Portals in your colour open around you, and each sends out monsters
    // that fight for you (MULTISHOT adds portals).
    const n = LEGION_PORTALS + (weapon(p).multi || 0);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const at = arenaClamp(cx(p) + Math.cos(a) * 75, cy(p) + Math.sin(a) * 75, 26);
      room.fires.push({ id: nextId(), kind: 'portal', color: pKey, owner: pKey, x: at.x, y: at.y, r: 22,
                        t: -i * 120, life: 2300, spawn: 'ally', spawnAt: LEGION_WAVES, spawned: 0,
                        dmg: Math.round(su.dmg * dmgMult) });
    }
    room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p), maxR: 50, timer: 700, max: 700,
                          color: WEAPON_COLORS.portalwand, text: 'PORTAL LEGION' });
  }
}

// ─── Stormbreaker, Winter's Edge, Sunfire Longbow ─────────────────────────────
const ARC_REACH = 110;
const THUNDER_MS = 6000, THUNDER_EVERY = 450, THUNDER_R = 210, THUNDER_TARGETS = 3;
const FROSTBITE_STACKS = 3, FROSTBITE_DECAY = 4000, FROSTBITE_FREEZE = 1500;
const BLIZZARD_MS = 5000, BLIZZARD_R = 150, BLIZZARD_TICK = 400;
const SUNORB_MS = 4500, SUNORB_TICK = 380, SUNORB_R = 230;
const SUNBEAM_MS = 2500, SUNBEAM_SWEEP = 1.6, SUNBEAM_W = 14, SUNBEAM_TICK = 150, SUNBEAM_LEN = 900;

// Lightning leaps from `from` on to up to n more foes nearby, one after another.
function arcLightning(from, dmg, n, pKey) {
  const hit = new Set([from]);
  let at = from;
  for (let i = 0; i < n; i++) {
    let next = null, bd = ARC_REACH;
    for (const t of enemyTargets(pKey)) {
      if (hit.has(t)) continue;
      const d = Math.hypot(cx(t) - cx(at), cy(t) - cy(at));
      if (d < bd) { bd = d; next = t; }
    }
    if (!next) break;
    room.particles.push({ type: 'bolt', x: cx(at), y: cy(at), x2: cx(next), y2: cy(next), timer: 260, max: 260, color: WEAPON_COLORS.stormhammer });
    next.invincible = 0;
    strikeTarget(next, dmg, pKey);
    hit.add(next);
    at = next;
  }
}

// THUNDER GOD: bolts from the sky on the nearest few foes, on a steady beat.
function thunderTick(p, pKey, dt) {
  p.thunderAcc = (p.thunderAcc || 0) + dt;
  if (p.thunderAcc < THUNDER_EVERY) return;
  p.thunderAcc -= THUNDER_EVERY;
  const foes = enemyTargets(pKey)
    .map(t => ({ t, d: Math.hypot(cx(t) - cx(p), cy(t) - cy(p)) }))
    .filter(e => e.d <= THUNDER_R).sort((a, b) => a.d - b.d).slice(0, THUNDER_TARGETS);
  for (const { t } of foes) {
    room.particles.push({ type: 'bolt', x: cx(t) + (Math.random() - 0.5) * 30, y: ARENA_Y + 2, x2: cx(t), y2: cy(t),
                          timer: 300, max: 300, color: WEAPON_COLORS.stormhammer });
    t.invincible = 0;
    strikeTarget(t, (p.thunderDmg || 30) + (t.num ? 0 : Math.round((t.maxHp || 0) * (t.boss ? 0.003 : 0.015))), pKey);
  }
}

// Frostbite: stacks fade if not topped up; the third one freezes.
function addFrostbite(t) {
  if (t.dead) return;
  const now = Date.now();
  if (!t.frostAt || now - t.frostAt > FROSTBITE_DECAY) t.frostStacks = 0;
  t.frostAt = now;
  t.frostStacks = (t.frostStacks || 0) + 1;
  if (t.frostStacks < FROSTBITE_STACKS) { chillTarget(t, 600); return; }
  t.frostStacks = 0;
  if (!t.num && !t.boss) stagger(t, FROSTBITE_FREEZE, 'ice');
  else chillTarget(t, 2000);
  room.particles.push({ type: 'crit', x: cx(t), y: t.y - 6, text: 'FROZEN', timer: 600, max: 600 });
}

// ABSOLUTE ZERO: rides with its caster; every tick it grinds, chills and adds
// frostbite to everything inside, and hits the frozen twice as hard.
function updateBlizzard(f, dt) {
  const o = room.players[f.owner];
  if (!o || o.dead) return false;
  f.x = cx(o); f.y = cy(o);
  f.tick -= dt;
  if (f.tick > 0) return true;
  f.tick = BLIZZARD_TICK;
  for (const t of enemyTargets(f.owner)) {
    if (Math.hypot(cx(t) - f.x, cy(t) - f.y) > f.r + t.w / 2) continue;
    const frozen = (t.freeze || 0) > 0;
    t.invincible = 0;
    applyDamage(t, frozen ? f.dmg * 2 : f.dmg, f.owner);
    if (frozen && !t.dead) room.particles.push({ type: 'crit', x: cx(t), y: t.y - 6, text: 'SHATTER', timer: 450, max: 450 });
    addFrostbite(t);
  }
  return true;
}

// The little sun: beams the nearest foe in reach on every tick.
function updateSunorb(f, dt) {
  f.tick -= dt;
  if (f.tick > 0) return true;
  f.tick = SUNORB_TICK;
  let best = null, bd = SUNORB_R;
  for (const t of enemyTargets(f.owner)) {
    const d = Math.hypot(cx(t) - f.x, cy(t) - f.y);
    if (d < bd) { bd = d; best = t; }
  }
  if (!best) return true;
  room.particles.push({ type: 'bolt', x: f.x, y: f.y, x2: cx(best), y2: cy(best), timer: 220, max: 220, color: WEAPON_COLORS.sunbow });
  best.invincible = 0;
  strikeTarget(best, f.dmg, f.owner);
  ignite(best, 900);
  return true;
}

// SUPERNOVA: the beam rides with its caster and sweeps across SUNBEAM_SWEEP;
// everything along it burns on every tick.
function updateSunbeam(f, dt) {
  const o = room.players[f.owner];
  if (!o || o.dead) return false;
  f.x = cx(o); f.y = cy(o);
  f.a = f.a0 + SUNBEAM_SWEEP * Math.min(1, f.t / f.life);
  f.tick -= dt;
  if (f.tick > 0) return true;
  f.tick = SUNBEAM_TICK;
  const ex = f.x + Math.cos(f.a) * SUNBEAM_LEN, ey = f.y + Math.sin(f.a) * SUNBEAM_LEN;
  for (const t of enemyTargets(f.owner)) {
    if (distToSegment(cx(t), cy(t), f.x, f.y, ex, ey) > f.r + t.w / 2) continue;
    t.invincible = 0;
    applyDamage(t, f.dmg + (t.num ? 0 : Math.round((t.maxHp || 0) * (t.boss ? 0.005 : 0.02))), f.owner);
    ignite(t, 1200);
  }
  return true;
}

// ─── Dagger of Ghosts ─────────────────────────────────────────────────────────
const GHOST_MS = 10 * 60 * 1000;    // the cloak lasts until something breaks it
const GHOST_CLOAK_CD = 700;
const GHOST_FAN_SHARE = 0.4;
const MONSTER_TURN_MS = 550;
const KNIFE_COUNT = 60, KNIFE_MS = 4200, KNIFE_DELAY = 500, KNIFE_FALL_MS = 700, KNIFE_R = 24;
const KNIFE_PVP_DMG = 40, KNIFE_MEDKIT_CHANCE = 0.25, MAX_MEDKITS = 10;
// The thrown dagger: at least this share of the target's max health (bosses
// take a much smaller share, or the fights would be over in a few throws).
const THROW_SHARE = 0.16, THROW_BACK_SHARE = 0.32, THROW_BOSS_SHARE = 0.04, THROW_BOSS_BACK_SHARE = 0.08;

// The passives that act every tick rather than on a stat.
function passiveTick(p, key, dt) {
  if (p.passive === 'mindtome') {                                     // SHIFTING GROUND
    p.shuffleT = (p.shuffleT ?? MIND_SHUFFLE_MS) - dt;
    if (p.shuffleT <= 0) { p.shuffleT = MIND_SHUFFLE_MS; shuffleTraps(p, key); }
  }
  if (p.passive === 'chronostaff') {                                  // TIME DILATION
    if (p.specialCooldown > 0) p.specialCooldown -= dt * CHRONO_DILATION;
    if (p.superCooldown > 0) p.superCooldown -= dt * CHRONO_DILATION;
  }
  if (p.aegisCd > 0) p.aegisCd -= dt;
  if (p.escapeCd > 0) p.escapeCd -= dt;
  if (p.passive === 'sunbow' && p.hp < p.maxHp) {                     // SUNLIT
    p.sunAcc = (p.sunAcc || 0) + dt;
    while (p.sunAcc >= 1000) { p.sunAcc -= 1000; p.hp = Math.min(p.maxHp, p.hp + Math.max(1, Math.round(p.maxHp * SUNLIT_SHARE))); }
  }
  if (p.passive === 'windwand') {                                     // GALE GUARD
    p.galeCd = (p.galeCd || 0) - dt;
    if (p.galeCd <= 0) {
      const hostile = pr => pr.owner === 'monster' || (room.gameMode === 'pvp' && pr.owner !== key);
      const shot = room.projectiles.find(pr => hostile(pr) && Math.hypot(pr.x - cx(p), pr.y - cy(p)) < GALE_R);
      if (shot) {
        p.galeCd = GALE_CD;
        room.projectiles = room.projectiles.filter(pr => pr !== shot);
        room.particles.push({ type: 'shockwave', x: shot.x, y: shot.y, maxR: 18, timer: 260, max: 260, color: PASSIVES.windwand.color });
      }
    }
  }
  if (p.passive === 'fireglove' && p.effects) delete p.effects.burn;   // EMBER SKIN
  if (p.passive === 'frostrod') {                                     // FROST AURA
    for (const m of room.monsters) {
      if (Math.hypot(cx(m) - cx(p), cy(m) - cy(p)) <= FROST_AURA_R + m.w / 2) m.slowTimer = Math.max(m.slowTimer || 0, 400);
    }
  }
  if (p.passive === 'stormtome') {                                    // STATIC CHARGE
    p.staticCd = (p.staticCd || 0) - dt;
    if (p.staticCd > 0) return;
    let best = null, bd = STATIC_R;
    for (const t of enemyTargets(key)) {
      const d = Math.hypot(cx(t) - cx(p), cy(t) - cy(p));
      if (d < bd) { bd = d; best = t; }
    }
    if (!best) { p.staticCd = 250; return; }
    p.staticCd = STATIC_CD;
    room.particles.push({ type: 'bolt', x: cx(p), y: cy(p), x2: cx(best), y2: cy(best), timer: 260, max: 260, color: PASSIVES.stormtome.color });
    applyDamage(best, Math.max(1, Math.round(weapon(p).damage * STATIC_MULT)), key);
  }
}

function breakGhost(p) {
  if (!p.effects || !p.effects.ghost) return;
  delete p.effects.ghost;
  room.particles.push({ type: 'teleport', x: cx(p), y: cy(p), timer: 300, max: 300, color: WEAPON_COLORS.ghostdagger });
}

// Is `t` looking away from a dagger flying along dx? Then it's a hit in the back.
function hitFromBehind(t, dx) {
  const face = t.num ? t.facing : t.face;
  return !!face && Math.abs(dx) > 0.3 && Math.sign(dx) === Math.sign(face);
}

function throwKey(t) { return t.num ? playerKeyOf(t) : t.id; }

function ghostThrowHit(proj, t) {
  const back = proj.backOf ? proj.backOf.has(throwKey(t)) : hitFromBehind(t, proj.dx);
  const share = t.boss ? (back ? THROW_BOSS_BACK_SHARE : THROW_BOSS_SHARE) : (back ? THROW_BACK_SHARE : THROW_SHARE);
  const sm = proj.shareMult || 1;
  let dmg = Math.max(Math.round(proj.damage * sm), Math.round((t.maxHp || 0) * share * sm));
  // "At least" means after armour and defense too.
  if (t.armor) dmg = Math.round(dmg / (1 - t.armor));
  if (t.num && t.defense) dmg = Math.round(dmg / (1 - t.defense));
  t.invincible = 0;
  applyDamage(t, dmg, proj.owner);
  room.particles.push({ type: 'crit', x: cx(t), y: t.y - 6, text: back ? 'BACKSTAB!' : 'GHOST DAGGER', timer: 700, max: 700 });
  room.particles.push({ type: 'teleport', x: cx(t), y: cy(t), timer: 300, max: 300, color: WEAPON_COLORS.ghostdagger });
}

// A falling knife lands: everything under it takes a massive hit, and now and
// then the knife is left behind as a medkit.
function explodeKnife(f) {
  for (const t of enemyTargets(f.owner)) {
    if (Math.hypot(cx(t) - f.x, cy(t) - f.y) > f.r + t.w / 2) continue;
    const dmg = t.num ? KNIFE_PVP_DMG : f.dmg + Math.round((t.maxHp || 0) * (t.boss ? 0.015 : 0.1));
    t.invincible = 0;
    applyDamage(t, dmg, f.owner);
  }
  room.particles.push({ type: 'shockwave', x: f.x, y: f.y, maxR: f.r, timer: 300, max: 300, color: WEAPON_COLORS.ghostdagger });
  if (Math.random() < KNIFE_MEDKIT_CHANCE && room.items.filter(i => i.type === 'medkit').length < MAX_MEDKITS) {
    const at = arenaClamp(f.x, f.y, ITEM_SIZE / 2 + 2);
    room.items.push({ id: nextId(), type: 'medkit', x: at.x - ITEM_SIZE / 2, y: at.y - ITEM_SIZE / 2, w: ITEM_SIZE, h: ITEM_SIZE });
  }
}

// ─── Portal Wand ──────────────────────────────────────────────────────────────
const LEGION_PORTALS = 4, LEGION_WAVES = [450, 950, 1450];   // 3 monsters per portal
const PWAND_FIREBALL_SPEED = 5.2, PWAND_FIREBALL_RANGE = 440;

// ─── Allies ───────────────────────────────────────────────────────────────────
// Monsters summoned by the Portal Wand's SUPER. They live in room.allies, wear
// their owner's colour, hunt the owner's enemies (kills are the owner's) and
// fade after ALLY_LIFE. Monsters fight back; in PvP the rival can cut them down.
const ALLY_TYPES = ['grunt', 'runner', 'brute', 'brute', 'warden', 'wraith', 'behemoth'];
const ALLY_LIFE = 14000, ALLY_MAX = 18, ALLY_HP = 70, ALLY_ATK_MS = 850;

// opts: { type, hp, life, force } — force ignores the ALLY_MAX cap (Stone Golem).
function spawnAlly(owner, x, y, dmg, opts = {}) {
  if (!opts.force && room.allies.filter(a => a.owner === owner).length >= ALLY_MAX) return;
  const type = opts.type || ALLY_TYPES[Math.floor(Math.random() * ALLY_TYPES.length)];
  const def = MONSTER_TYPES[type];
  const s = Math.max(0.8, Math.min(2.2, def.size * 1.15));
  const w = Math.round(MONSTER_BASE_W * s), h = Math.round(MONSTER_BASE_H * s);
  const hp = opts.hp || Math.round(ALLY_HP * def.hp);
  const a = { id: nextId(), ally: true, owner, type, x: x - w / 2, y: y - h / 2, w, h, hp, maxHp: hp,
              speed: 1.3 * def.speed + 0.6, atkDamage: Math.max(1, Math.round(dmg * def.dmg * 0.55)),
              atkRange: 8 + w * 0.5, atkCooldown: 300, armor: def.armor || 0, face: 1, swing: 0,
              life: opts.life || ALLY_LIFE, hitFlash: 0, invincible: 0, slowTimer: 0, pull: null, dead: false };
  clampToArena(a);
  room.allies.push(a);
}

function killAlly(a) {
  if (a.dead) return;
  a.dead = true;
  room.particles.push({ type: 'teleport', x: cx(a), y: cy(a), timer: 380, max: 380, color: WEAPON_COLORS.portalwand });
}

function updateAllies(factor, dt) {
  for (const a of room.allies.slice()) {
    if (a.dead) continue;
    a.life -= dt;
    if (a.life <= 0) { killAlly(a); continue; }
    if (a.atkCooldown > 0) a.atkCooldown -= dt;
    if (a.hitFlash    > 0) a.hitFlash    -= dt;
    if (a.invincible  > 0) a.invincible  -= dt;
    if (a.swing       > 0) a.swing       -= dt;
    if (a.slowTimer   > 0) a.slowTimer   -= dt;
    if (a.burnTimer > 0) {
      a.burnTimer -= dt;
      a.burnAcc = (a.burnAcc || 0) + dt;
      while (a.burnAcc >= 500 && !a.dead) { a.burnAcc -= 500; dotDamage(a, 4); }
      if (a.dead) continue;
    }
    const spd = a.speed * (a.slowTimer > 0 ? 0.4 : 1);
    let best = null, bd = Infinity;
    for (const t of enemyTargets(a.owner)) {
      const d = distBetween(t, a);
      if (d < bd) { bd = d; best = t; }
    }
    if (best) {
      const dx = cx(best) - cx(a), dy = cy(best) - cy(a), dist = Math.hypot(dx, dy) || 1;
      if (Math.abs(dx) > 2) a.face = dx > 0 ? 1 : -1;
      const reach = a.atkRange + (best.w + best.h) / 4;
      if (dist > reach) { a.x += (dx / dist) * spd * factor; a.y += (dy / dist) * spd * factor; }
      if (dist <= reach + 4 && a.atkCooldown <= 0) {
        const tk = playerKeyOf(best);
        if (tk && best.parryTimer > 0) {
          applyDamage(a, Math.round(a.atkDamage * reflectOf(best)) + 10, tk);
          spawnParrySpark(cx(best), cy(best));
        } else if (tk) {
          applyDamage(best, a.atkDamage, a.owner);
        } else if (best.invincible <= 300) {
          // A pack mobbing one monster: every blow lands through the brief
          // invulnerability after a hit (never a boss's longer phase shield),
          // and none of them lends it any.
          const inv = best.invincible;
          best.invincible = 0;
          applyDamage(best, a.atkDamage, a.owner);
          if (!best.dead) best.invincible = inv;
        }
        a.atkCooldown = ALLY_ATK_MS;
        a.swing = MONSTER_SWING_MS;
      }
    } else {
      // Nothing to fight: stay close to whoever summoned it.
      const o = room.players[a.owner];
      if (o && !o.dead) {
        const dx = cx(o) - cx(a), dy = cy(o) - cy(a), d = Math.hypot(dx, dy) || 1;
        if (Math.abs(dx) > 2) a.face = dx > 0 ? 1 : -1;
        if (d > 60) { a.x += (dx / d) * spd * factor; a.y += (dy / d) * spd * factor; }
      }
    }
    applyPull(a, dt);
    clampToArena(a);
  }
  room.allies = room.allies.filter(a => !a.dead);
}

// A player's red fire portal: throws a fireball at the nearest foe at each of `shots` (ms).
function openFirePortal(pKey, x, y, dmg, delay, shots, opts = {}) {
  room.fires.push({ id: nextId(), kind: 'portal', color: 'red', owner: pKey, x, y, r: opts.r || 15,
                    t: delay, life: shots[shots.length - 1] + (opts.linger || 450), shots, shot: 0, dmg, aoe: opts.aoe });
}

// The safest spot on the field: as far as possible from every foe, and clear
// of traps, enemy fire and the path of any shot coming in.
function safestSpot(p, pKey) {
  const hostile = o => o === 'monster' || (room.gameMode === 'pvp' && o !== pKey);
  const foes = enemyTargets(pKey);
  const hazards = [
    ...room.traps.map(t => ({ x: t.x + t.w / 2, y: t.y + t.h / 2, r: Math.max(t.w / 2, t.radius || 0) + 30 })),
    ...room.fires.filter(f => hostile(f.owner) && f.kind !== 'inferno')
      .map(f => ({ x: f.x, y: f.y, r: (f.r || 20) + 45 })),
  ];
  const shots = room.projectiles.filter(pr => hostile(pr.owner));
  let best = null;
  for (let x = ARENA_X + 26; x <= ARENA_X + ARENA_W - 26; x += 22) {
    // (Not in the top strip, where the HUD would hide you.)
    for (let y = ARENA_Y + 60; y <= ARENA_Y + ARENA_H - 26; y += 22) {
      let score = 700;
      for (const t of foes) score = Math.min(score, Math.hypot(cx(t) - x, cy(t) - y) - t.w / 2);
      for (const h of hazards) if (Math.hypot(h.x - x, h.y - y) < h.r) score -= 1000;
      for (const s of shots) {
        if (distToSegment(x, y, s.x, s.y, s.x + s.dx * 80, s.y + s.dy * 80) < 34) { score -= 800; break; }
      }
      score += Math.random() * 4;   // break ties
      if (!best || score > best.score) best = { x, y, score };
    }
  }
  return best;
}

// ─── Wind Wand & Revolver ─────────────────────────────────────────────────────
const INFERNO_WAVES = 5, INFERNO_WAVE_GAP = 220;
const TORNADO_MS = 3200, TORNADO_PULL_R = 100, TORNADO_TICK = 300;
const HURRICANE_MS = 5500, HURRICANE_R = 135, HURRICANE_TICK = 380, HURRICANE_FLING = 42;
const DEADEYE_MAX = 16, DEADEYE_AOE = 40;

// Tornado: drifts along its aim, dragging nearby foes into its middle and
// hurting everything inside it every TORNADO_TICK.
function updateTornado(f, factor, dt) {
  f.x += Math.cos(f.a) * f.v * factor;
  f.y += Math.sin(f.a) * f.v * factor;
  if (f.x < ARENA_X || f.x > ARENA_X + ARENA_W) { f.a = Math.PI - f.a; f.x = Math.max(ARENA_X, Math.min(ARENA_X + ARENA_W, f.x)); }
  if (f.y < ARENA_Y || f.y > ARENA_Y + ARENA_H) { f.a = -f.a; f.y = Math.max(ARENA_Y, Math.min(ARENA_Y + ARENA_H, f.y)); }
  f.tick -= dt;
  const hurt = f.tick <= 0;
  if (hurt) f.tick = TORNADO_TICK;
  for (const t of enemyTargets(f.owner)) {
    const dx = f.x - cx(t), dy = f.y - cy(t), d = Math.hypot(dx, dy) || 1;
    if (d > TORNADO_PULL_R + f.r) continue;
    if (!t.boss && d > 4) {
      const pull = Math.min(d, 1.6 * factor);
      t.x += dx / d * pull; t.y += dy / d * pull;
      clampToArena(t);
    }
    if (hurt && d <= f.r + t.w / 2) applyDamage(t, f.dmg, f.owner);
  }
  return true;
}

// Hurricane: rides along with its caster. Every HURRICANE_TICK it hurts and
// flings away everything inside, and it blows enemy shots out of the air.
function updateHurricane(f, factor, dt) {
  const o = room.players[f.owner];
  if (!o || o.dead) return false;
  f.x = cx(o); f.y = cy(o);
  room.projectiles = room.projectiles.filter(pr =>
    !(pr.owner === 'monster' || (room.gameMode === 'pvp' && pr.owner !== f.owner))
    || Math.hypot(pr.x - f.x, pr.y - f.y) > f.r);
  f.tick -= dt;
  if (f.tick > 0) return true;
  f.tick = HURRICANE_TICK;
  for (const t of enemyTargets(f.owner)) {
    const dx = cx(t) - f.x, dy = cy(t) - f.y, d = Math.hypot(dx, dy) || 1;
    if (d > f.r + t.w / 2) continue;
    applyDamage(t, f.dmg, f.owner);
    if (!t.boss && !t.dead) {
      t.x += dx / d * HURRICANE_FLING; t.y += dy / d * HURRICANE_FLING;
      clampToArena(t);
    }
  }
  return true;
}

// ─── Vortex Shield ────────────────────────────────────────────────────────────
const VORTEX_SHIELD_MS = 3000;
const VORTEX_BANK_MAX  = 300;    // so a long waves run can't bank a one-shot
const VORTEX_FIELD_MS  = 3000;   // how long the force field lasts
const VORTEX_FIELD_R   = 42;     // its radius

function bankVortex(p, dmg) {
  p.vortexStore = Math.min(VORTEX_BANK_MAX, (p.vortexStore || 0) + Math.max(0, dmg));
}

function emptyBank(p) {
  room.particles.push({ type: 'useitem', x: cx(p), y: p.y, timer: 900, max: 900, color: '#7ad8ff', text: 'NOTHING STORED' });
}

// Release the bank as a force field around the player for 3 s. Every foe that
// touches it is struck by lightning for the whole bank (once per field).
// Returns false (and spends nothing) if the bank is empty.
function castVortex(p, pKey, sp, dmgMult) {
  const bank = p.vortexStore || 0;
  if (bank <= 0) { emptyBank(p); return false; }
  room.fires.push({ id: nextId(), kind: 'vortexfield', owner: pKey, x: cx(p), y: cy(p), r: VORTEX_FIELD_R,
                    t: 0, life: VORTEX_FIELD_MS, hit: new Set(),
                    dmg: Math.max(1, Math.round(bank * (sp.dmg / 100) * dmgMult)) });
  room.particles.push({ type: 'shockwave', x: cx(p), y: cy(p), maxR: VORTEX_FIELD_R, timer: 360, max: 360, color: WEAPON_COLORS.vortex });
  p.vortexStore = 0;
  return true;
}

function updateVortexField(f, factor) {
  const o = room.players[f.owner];
  if (!o || o.dead) return false;
  f.x = cx(o); f.y = cy(o);            // the field moves with its owner
  // Idle crackle round the rim so it reads as charged.
  if (Math.random() < 0.35 * factor) {
    const a = Math.random() * Math.PI * 2, a2 = a + (Math.random() - 0.5) * 1.2;
    room.particles.push({ type: 'bolt', x: f.x + Math.cos(a) * f.r, y: f.y + Math.sin(a) * f.r,
                          x2: f.x + Math.cos(a2) * f.r * 0.6, y2: f.y + Math.sin(a2) * f.r * 0.6,
                          timer: 120, max: 120, color: WEAPON_COLORS.vortex });
  }
  for (const t of enemyTargets(f.owner)) {
    const id = playerKeyOf(t) || t.id;
    if (f.hit.has(id)) continue;
    if (Math.hypot(cx(t) - f.x, cy(t) - f.y) > f.r + t.w / 2) continue;
    f.hit.add(id);
    // Lightning forks from the field's edge into whoever touched it.
    const a = Math.atan2(cy(t) - f.y, cx(t) - f.x);
    for (let i = 0; i < 4; i++) {
      const aa = a + (i - 1.5) * 0.35;
      room.particles.push({ type: 'bolt', x: f.x + Math.cos(aa) * f.r * 0.8, y: f.y + Math.sin(aa) * f.r * 0.8,
                            x2: cx(t), y2: cy(t), timer: 320, max: 320, color: i % 2 ? '#ffffff' : WEAPON_COLORS.vortex });
    }
    if (t.invincible > 0 && t.invincible <= 500) t.invincible = 0;
    applyDamage(t, f.dmg, f.owner);
    room.particles.push({ type: 'crit', x: cx(t), y: t.y - 6, text: String(f.dmg), timer: 800, max: 800 });
  }
  return true;
}

// Hands hostile to pKey (only another player's, and only in PvP) within reach
// of p are knocked out of the air.
function swatFireHands(p, pKey, reach) {
  if (room.gameMode !== 'pvp' || !room.fires.length) return;
  room.fires = room.fires.filter(f => {
    if (f.kind !== 'hand' || f.owner === pKey) return true;
    if (Math.hypot(f.x - cx(p), f.y - cy(p)) > reach + HAND_RADIUS) return true;
    fizzleFire(f.x, f.y, 'SWATTED');
    explodeHand(f);
    return false;
  });
}

function fizzleFire(x, y, text) {
  room.particles.push({ type: 'trapburst', x, y, maxR: 34, timer: 600, max: 600, color: '#66ccff', text });
}

function updateFires(factor, dt) {
  if (!room.fires.length) return;
  // Fires can spawn fires mid-pass (a meteor dropping the mage to his last
  // resort opens the giant portals), and a fire can end the fight and clear
  // the list. Keep what was added; honour a clear.
  const old = room.fires, n = old.length;
  const kept = old.filter(f => {
    f.t += dt;
    if (f.t < 0) return true;   // queued (later inferno waves, meteor shower)
    if ((f.kind === 'meteor' || f.kind === 'knife') && !f.placed) placeMeteor(f);
    if (f.kind === 'inferno' && f.r === 0) {
      const o = room.players[f.owner];
      if (o && !o.dead) { f.x = cx(o); f.y = cy(o); }
      f.r = INFERNO_START;
    }
    if (f.t >= f.life) {
      if (f.kind === 'hand') explodeHand(f);
      if (f.kind === 'meteor') explodeMeteor(f);
      if (f.kind === 'knife') explodeKnife(f);
      if (f.kind === 'runecast') placeMageTrap(f);
      if (f.kind === 'blackhole' && f.boom) collapseSingularity(f);
      if (f.kind === 'abyssmark') openAbyssHole(f);
      if (f.kind === 'abysscharge') launchAbyssOrb(f);
      return false;
    }
    if (f.kind === 'abyssmark') return true;   // the bolts are still on their way
    if (f.kind === 'abysscharge') return updateAbyssCharge(f);
    if (f.kind === 'abyssblade') return updateAbyssBlade(f, factor);
    if (f.kind === 'ibburst') return updateIbBurst(f);
    if (f.kind === 'voidbeam') return updateVoidBeam(f, factor, dt);
    if (f.kind === 'scythewhirl') return updateScytheWhirl(f, dt);
    if (f.kind === 'runecast') return true;   // the warning circle, still drawing itself
    if (f.kind === 'meteor' || f.kind === 'knife') return true;   // still falling: only the warning shows
    if (f.kind === 'portal') return updatePortal(f, dt);
    if (f.kind === 'mine') return updatePlayerMine(f);
    if (f.kind === 'mindbeams') return updateMindBeams(f, dt);
    if (f.kind === 'barrier') return updateBarrier(f);
    if (f.kind === 'blizzard') return updateBlizzard(f, dt);
    if (f.kind === 'sunorb') return updateSunorb(f, dt);
    if (f.kind === 'sunbeam') return updateSunbeam(f, dt);
    if (f.kind === 'cloud') return updateCloud(f, dt);
    if (f.kind === 'blackhole') return updateBlackhole(f, factor, dt);
    if (f.kind === 'lightstreak') return updateLightStreak(f);
    if (f.kind === 'drain') return updateDrain(f, factor, dt);
    if (f.kind === 'tornado') return updateTornado(f, factor, dt);
    if (f.kind === 'hurricane') return updateHurricane(f, factor, dt);
    if (f.kind === 'hand') return updateFireHand(f, factor);
    if (f.kind === 'vortexfield') return updateVortexField(f, factor);
    if (f.kind === 'soundwave') return updateSoundwave(f, factor);

    if (f.kind === 'ring') {
      const k = f.t / f.life;
      f.r = 6 + (f.maxR - 6) * (1 - (1 - k) * (1 - k));   // bursts out, then slows
    } else {
      f.r += INFERNO_GROWTH * factor;
      if (f.r > INFERNO_MAX_R) return false;
    }
    const band = f.kind === 'ring' ? FIRE_BAND : INFERNO_BAND;
    for (const t of enemyTargets(f.owner)) {
      const id = playerKeyOf(t) || t.id;
      if (f.hit.has(id)) continue;
      const d = Math.hypot(cx(t) - f.x, cy(t) - f.y);
      if (Math.abs(d - f.r) > band + t.w / 2) continue;
      f.hit.add(id);
      if (playerKeyOf(t) && t.parryTimer > 0) {
        spawnParrySpark(cx(t), cy(t));
        if (f.kind === 'inferno') {
          fizzleFire(cx(t), cy(t), 'INFERNO PARRIED');
          for (const o of old) if (o.kind === 'inferno' && o.owner === f.owner) o.t = o.life;   // the whole super goes with it
          return false;
        }
        continue;   // a parry simply blocks the small ring
      }
      applyDamage(t, f.dmg, f.owner);
      ignite(t, f.kind === 'inferno' ? 3000 : 1500);
    }
    return true;
  });
  const next = kept.concat(old.slice(n));
  const live = room.fires === old ? null : new Set(room.fires);
  room.fires = live ? next.filter(f => live.has(f)) : next;
}

function updateFireHand(f, factor) {
  const foes = enemyTargets(f.owner)
    .map(t => ({ t, d: Math.hypot(cx(t) - f.x, cy(t) - f.y) }))
    .sort((a, b) => a.d - b.d);
  // MULTISHOT hands split up: each picks its own foe (nearest, next nearest...),
  // and with only one foe they still come in from different sides.
  const best = foes.length ? foes[(f.slot || 0) % foes.length].t : null;
  if (best) {
    // Steer toward the prey, turning hard but not instantly.
    const bd = Math.hypot(cx(best) - f.x, cy(best) - f.y);
    const bend = (foes.length < 2 ? f.side || 0 : 0) * 0.9 * Math.min(1, bd / 220);
    let diff = Math.atan2(cy(best) - f.y, cx(best) - f.x) + bend - f.a;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const turn = HAND_TURN * Math.sqrt(HAND_SPEED0 / f.v) * factor;
    f.a += Math.max(-turn, Math.min(turn, diff));
  }
  f.v = Math.min(HAND_SPEED_MAX, f.v + HAND_ACCEL * factor);
  f.x = Math.max(ARENA_X, Math.min(ARENA_X + ARENA_W, f.x + Math.cos(f.a) * f.v * factor));
  f.y = Math.max(ARENA_Y, Math.min(ARENA_Y + ARENA_H, f.y + Math.sin(f.a) * f.v * factor));

  if (best && Math.hypot(cx(best) - f.x, cy(best) - f.y) <= HAND_RADIUS + best.w / 2) {
    if (playerKeyOf(best) && best.parryTimer > 0) {
      spawnParrySpark(f.x, f.y);
      fizzleFire(f.x, f.y, 'PARRIED');
      explodeHand(f);
      return false;
    }
    // Each hand is its own missile: it lands even on a foe still flashing from
    // the hit before (those i-frames are at most 500 ms). A respawn's longer
    // protection and the shield power-up still hold.
    if (best.invincible > 0 && best.invincible <= 500) best.invincible = 0;
    applyDamage(best, f.dmg, f.owner);
    ignite(best, 2000);
    explodeHand(f);
    return false;
  }
  return true;
}

// ─── The Giant ────────────────────────────────────────────────────────────────
// Two moves, both telegraphed by a wind-up:
//   swipe – up close, a sweep of the tree across its front.
//   slam  – from range, it smashes the tree into the ground and a sound wave
//           rolls outward.
// Parrying either one stuns it for 3 s (no moving, no attacking) and hurts it.
const GIANT_SWIPE_REACH = 85;      // past the edge of its body (roughly the tree's length)
const GIANT_SWIPE_WIND  = 650;
const GIANT_SLAM_WIND   = 900;
const GIANT_STUN_MS     = 3000;
const GIANT_STUN_DMG    = 0.05;    // share of its max health a parry costs it
const SOUNDWAVE_SPEED   = 3.2;     // px per 16.67 ms
const SOUNDWAVE_MAX_R   = 420;
const SOUNDWAVE_BAND    = 11;

function updateGiant(m, target, dist, dx, dy, spd, factor, dt) {
  if (m.stun > 0) { m.stun -= dt; return; }
  if (m.swipeCd > 0) m.swipeCd -= dt;
  if (m.slamCd  > 0) m.slamCd  -= dt;

  // Winding up: planted, then the blow lands.
  if (m.windup > 0) {
    m.windup -= dt;
    if (m.windup <= 0) {
      if (m.wind === 'swipe') giantSwipe(m); else giantSlam(m);
      m.wind = null;
      m.swing = MONSTER_SWING_MS;
    }
    return;
  }
  const reach = m.w / 2 + GIANT_SWIPE_REACH;
  if (dist <= reach && m.swipeCd <= 0) {
    m.wind = 'swipe'; m.windup = GIANT_SWIPE_WIND; m.swipeCd = 2200;
    return;
  }
  if (dist > reach + 30 && dist < SOUNDWAVE_MAX_R - 40 && m.slamCd <= 0) {
    m.wind = 'slam'; m.windup = GIANT_SLAM_WIND; m.slamCd = 4800;
    return;
  }
  if (dist > reach * 0.75) {
    m.x += (dx / dist) * spd * factor;
    m.y += (dy / dist) * spd * factor;
  }
}

// ─── The Portal Mage ──────────────────────────────────────────────────────────
// The strongest boss in the game, fought on his own (mode 'portal'). He keeps
// his distance and casts:
//   phase 1  fireportals  red portals around you that hurl fireballs
//            teleport     steps through a portal and out of another; for a
//                         moment you can follow him through it
//            traps        runes that glow, then turn into real traps
//   phase 2  (below half health) all of the above, faster, plus
//            monsterportals  green portals that spit out monsters
//            giants       his last resort, once, at 20% health: two Giants
//                         come through massive portals and he vanishes until
//                         both are dead. Only then can he die.
const MAGE_HP = 26000;
const MAGE_PHASE2 = 0.5, MAGE_LAST = 0.2;
const MAGE_KEEP_AWAY = 170;
const MAGE_FIREBALL_DMG = 22, MAGE_FIREBALL_SPEED = 3.6;
const MAGE_GIANT_HP = 6000;
const MAGE_MAX_MINIONS = 8;
const MAGE_MINIONS = ['brute', 'runner', 'wraith', 'infernal', 'warden', 'spitter', 'titan'];
const MAGE_TRAPS = ['spike', 'mine', 'fire', 'tesla', 'snare', 'poison'];
const MAGE_CAST_MS = { fireportals: 600, teleport: 450, traps: 700, monsterportals: 800 };
const MAGE_REWARD_COINS = 50000, MAGE_REWARD_XP = 50000;

function startMageFight() {
  room.wave = { num: 1, monstersLeft: 1, spawnQueue: 0, spawnTimer: 0, betweenTimer: 0 };
  room.waveHpMult = 1; room.waveSpeedMult = 1;
  spawnMonster('portalmage');
  const m = room.monsters[room.monsters.length - 1];
  m.hp = m.maxHp = MAGE_HP;
  Object.assign(m, { phase: 1, cast: null, castT: 0, castCd: 2200, tpT: 0, lastAtk: null, orbit: 1,
                     summoned: false, giantsDone: false, hidden: false, pendingGiants: 0 });
  room.particles.push({ type: 'newtype', x: CANVAS_W / 2, y: CANVAS_H / 2 + 26,
                        text: 'THE PORTAL MAGE', color: '#c8a0ff', timer: 3200, max: 3200 });
}

// His last resort: below MAGE_LAST he can't be hurt any further until the
// giants he summons are dead.
function mageFloor(m) {
  if (m.giantsDone || m.dead) return;
  const floor = Math.ceil(m.maxHp * MAGE_LAST);
  if (m.hp <= floor) {
    m.hp = floor;
    if (!m.summoned) summonGiants(m);
  }
}

function minionsAlive() { return room.monsters.filter(o => !o.dead && !o.mage && o.type !== 'giant').length; }

// A spot inside the arena, `inset` from the walls.
function arenaClamp(x, y, inset) {
  return { x: Math.max(ARENA_X + inset, Math.min(ARENA_X + ARENA_W - inset, x)),
           y: Math.max(ARENA_Y + inset, Math.min(ARENA_Y + ARENA_H - inset, y)) };
}

function updateMage(m, target, dist, dx, dy, spd, factor, dt) {
  // Hidden behind his giants: he waits for them to fall, then comes back.
  if (m.hidden) {
    // Safety net: giants still owed but no portal bringing them — bring them now.
    if (m.pendingGiants > 0 && !room.fires.some(f => f.spawn === 'giant')) {
      for (let i = 0; i < m.pendingGiants; i++) {
        spawnMonster('giant');
        const g = room.monsters[room.monsters.length - 1];
        g.hp = g.maxHp = MAGE_GIANT_HP;
        g.x = CANVAS_W / 2 + (i ? 1 : -1) * ARENA_W * 0.3 - g.w / 2; g.y = ARENA_Y + ARENA_H / 2 - g.h / 2;
        clampToArena(g);
      }
      m.pendingGiants = 0;
    }
    if (m.pendingGiants <= 0 &&!room.monsters.some(o => o.type === 'giant' && !o.dead)) {
      m.hidden = false; m.giantsDone = true; m.castCd = 1800; m.invincible = 600;
      room.particles.push({ type: 'teleport', x: cx(m), y: cy(m), timer: 500, max: 500, color: '#c8a0ff' });
      room.particles.push({ type: 'newtype', x: CANVAS_W / 2, y: CANVAS_H / 2 + 26,
                            text: 'THE MAGE IS EXPOSED - FINISH HIM!', color: '#ffd84a', timer: 3000, max: 3000 });
    }
    return;
  }
  // Mid-teleport: standing in his portal, then out of the other one.
  if (m.tpT > 0) {
    m.tpT -= dt;
    if (m.tpT <= 0) {
      room.particles.push({ type: 'teleport', x: cx(m), y: cy(m), timer: 380, max: 380, color: '#b07aff' });
      m.x = m.tpTo.x - m.w / 2; m.y = m.tpTo.y - m.h / 2;
      clampToArena(m);
      room.particles.push({ type: 'teleport', x: cx(m), y: cy(m), timer: 380, max: 380, color: '#e0c8ff' });
    }
    return;
  }
  if (m.phase === 1 && m.hp <= m.maxHp * MAGE_PHASE2) {
    m.phase = 2; m.cast = null; m.castT = 0; m.castCd = 1600; m.invincible = 1200;
    room.particles.push({ type: 'shockwave', x: cx(m), y: cy(m), maxR: 140, timer: 700, max: 700, color: '#ff4a8a' });
    room.particles.push({ type: 'newtype', x: CANVAS_W / 2, y: CANVAS_H / 2 + 26,
                          text: 'PHASE 2 - THE MAGE IS ENRAGED', color: '#ff6a9a', timer: 3000, max: 3000 });
  }
  if (m.castCd > 0) m.castCd -= dt;
  // Winding a spell up: planted, staff raised, until it goes off.
  if (m.castT > 0) {
    m.castT -= dt;
    if (m.castT <= 0) { mageCast(m, m.cast, target); m.swing = MONSTER_SWING_MS; }
    return;
  }
  // Keep his distance, circling.
  let vx = -dy / dist * 0.65 * m.orbit, vy = dx / dist * 0.65 * m.orbit;
  if (dist > MAGE_KEEP_AWAY + 30)      { vx += dx / dist; vy += dy / dist; }
  else if (dist < MAGE_KEEP_AWAY - 40) { vx -= dx / dist; vy -= dy / dist; }
  m.x += vx * spd * factor; m.y += vy * spd * factor;
  if (Math.random() < 0.006) m.orbit = -m.orbit;

  if (m.castCd <= 0) {
    const pool = m.phase === 1 ? ['fireportals', 'teleport', 'traps']
                               : ['fireportals', 'teleport', 'traps', 'monsterportals', 'monsterportals'];
    let pick;
    do { pick = pool[Math.floor(Math.random() * pool.length)]; } while (pick === m.lastAtk && Math.random() < 0.85);
    if (pick === 'monsterportals' && minionsAlive() >= MAGE_MAX_MINIONS) pick = 'fireportals';
    m.cast = pick; m.lastAtk = pick;
    m.castT = MAGE_CAST_MS[pick];
    m.castCd = (m.phase === 1 ? 2700 : 1900) + m.castT;
  }
}

function mageCast(m, kind, target) {
  const p2 = m.phase === 2;
  if (kind === 'fireportals') {
    // Red portals in a loose ring around you, each throwing fireballs.
    const n = p2 ? 5 : 3;
    const a0 = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const d = 115 + Math.random() * 60;
      const at = arenaClamp(cx(target) + Math.cos(a) * d, cy(target) + Math.sin(a) * d, 22);
      room.fires.push({ id: nextId(), kind: 'portal', color: 'red', owner: 'monster', x: at.x, y: at.y, r: 15,
                        t: -i * 140, life: p2 ? 3000 : 2500, shots: p2 ? [650, 1150, 1650, 2150] : [700, 1250, 1800], shot: 0 });
    }
  } else if (kind === 'teleport') {
    // Into a portal at his feet, out of one far from you. The entry stays open
    // a moment after he's gone: step in fast and you come out beside him.
    let best = null;
    for (let i = 0; i < 12; i++) {
      const at = arenaClamp(ARENA_X + Math.random() * ARENA_W, ARENA_Y + Math.random() * ARENA_H, 40);
      const d = Math.hypot(at.x - cx(target), at.y - cy(target));
      if (!best || d > best.d) best = { ...at, d };
      if (d > 220) break;
    }
    const exitId = nextId();
    room.fires.push({ id: nextId(), kind: 'portal', color: 'purple', owner: 'monster', x: cx(m), y: cy(m) + m.h * 0.25,
                      r: 20, t: 0, life: 2300, link: exitId });
    room.fires.push({ id: exitId, kind: 'portal', color: 'purple', owner: 'monster', x: best.x, y: best.y + m.h * 0.25,
                      r: 20, t: 0, life: 2300 });
    m.tpT = 450; m.tpTo = { x: best.x, y: best.y };
  } else if (kind === 'traps') {
    // Glowing runes first (the warning), then real traps where they were.
    const n = p2 ? 5 : 3;
    const spots = [];
    for (let i = 0; i < n; i++) {
      let at;
      for (let k = 0; k < 10; k++) {
        const a = Math.random() * Math.PI * 2, d = i === 0 ? Math.random() * 20 : 45 + Math.random() * 120;
        at = arenaClamp(cx(target) + Math.cos(a) * d, cy(target) + Math.sin(a) * d, 26);
        if (spots.every(s => Math.hypot(s.x - at.x, s.y - at.y) > 46)) break;
      }
      spots.push(at);
      const type = MAGE_TRAPS[Math.floor(Math.random() * MAGE_TRAPS.length)];
      room.fires.push({ id: nextId(), kind: 'runecast', color: TRAP_TYPES[type].color, trapType: type, owner: 'monster',
                        x: at.x, y: at.y, r: TRAP_TYPES[type].size / 2 + 6, t: -i * 110, life: 1150 });
    }
  } else if (kind === 'monsterportals') {
    // Green portals near the walls, each sending out monsters.
    const n = 3;
    for (let i = 0; i < n; i++) {
      let at;
      for (let k = 0; k < 10; k++) {
        const edge = Math.floor(Math.random() * 4);
        const x = edge < 2 ? ARENA_X + 40 + Math.random() * (ARENA_W - 80) : (edge === 2 ? ARENA_X + 40 : ARENA_X + ARENA_W - 40);
        const y = edge >= 2 ? ARENA_Y + 50 + Math.random() * (ARENA_H - 100) : (edge === 0 ? ARENA_Y + 50 : ARENA_Y + ARENA_H - 40);
        at = { x, y };
        if (Math.hypot(x - cx(target), y - cy(target)) > 140) break;
      }
      room.fires.push({ id: nextId(), kind: 'portal', color: 'green', owner: 'monster', x: at.x, y: at.y, r: 22,
                        t: -i * 200, life: 2600, spawn: 'minion', spawnAt: [900, 1600], spawned: 0 });
    }
  }
  m.cast = null;
}

// Two massive portals; a Giant steps out of each, and the mage disappears.
function summonGiants(m) {
  m.summoned = true; m.phase = 2;
  m.cast = null; m.castT = 0; m.tpT = 0;
  m.pendingGiants = 2;
  for (const side of [-1, 1]) {
    room.fires.push({ id: nextId(), kind: 'portal', color: 'giant', owner: 'monster',
                      x: CANVAS_W / 2 + side * ARENA_W * 0.3, y: ARENA_Y + ARENA_H / 2, r: 60,
                      t: 0, life: 3400, spawn: 'giant', spawnAt: [1700], spawned: 0 });
  }
  room.particles.push({ type: 'teleport', x: cx(m), y: cy(m), timer: 500, max: 500, color: '#c8a0ff' });
  room.particles.push({ type: 'newtype', x: CANVAS_W / 2, y: CANVAS_H / 2 + 26,
                        text: 'LAST RESORT: THE GIANTS COME', color: '#c8e07a', timer: 3400, max: 3400 });
  m.hidden = true;
  m.hitFlash = 0;
}

function updatePortal(f, dt) {
  // Fire portals: fireballs at the nearest player.
  if (f.shots && f.shot < f.shots.length && f.t >= f.shots[f.shot]) {
    f.shot++;
    // The mage's portals shoot at players; a Portal Wand's at its owner's foes in reach.
    const mine = f.owner !== 'monster';
    const ps = mine ? enemyTargets(f.owner).filter(t => Math.hypot(cx(t) - f.x, cy(t) - f.y) <= PWAND_FIREBALL_RANGE)
                    : [...allPlayers()].filter(p => p && !p.dead);
    if (ps.length) {
      const t = ps.reduce((a, b) => Math.hypot(cx(a) - f.x, cy(a) - f.y) < Math.hypot(cx(b) - f.x, cy(b) - f.y) ? a : b);
      const ang = Math.atan2(cy(t) - f.y, cx(t) - f.x) + (Math.random() - 0.5) * 0.12;
      const sp = mine ? PWAND_FIREBALL_SPEED : MAGE_FIREBALL_SPEED;
      room.projectiles.push({
        id: nextId(), x: f.x, y: f.y, dx: Math.cos(ang) * sp, dy: Math.sin(ang) * sp,
        damage: f.dmg || MAGE_FIREBALL_DMG, owner: f.owner, traveled: 0, maxRange: mine ? PWAND_FIREBALL_RANGE + 40 : 560,
        weaponId: mine ? 'portalwand' : 'hellfire', burn: 1500, special: mine,
        isAoe: mine, aoeRadius: mine ? f.aoe || 22 : 0, pierce: false, grapple: false, boomerang: false, teleport: false,
        returning: false, life: 0, hitTargets: null,
      });
    }
  }
  // Summoning portals.
  if (f.spawn && f.spawned < f.spawnAt.length && f.t >= f.spawnAt[f.spawned]) {
    f.spawned++;
    if (f.spawn === 'giant') {
      spawnMonster('giant');
      const g = room.monsters[room.monsters.length - 1];
      g.hp = g.maxHp = MAGE_GIANT_HP;
      g.x = f.x - g.w / 2; g.y = f.y - g.h / 2;
      clampToArena(g);
      const mage = room.monsters.find(o => o.mage);
      if (mage) mage.pendingGiants--;
    } else if (f.spawn === 'ally') {
      spawnAlly(f.owner, f.x, f.y, f.dmg);
    } else if (minionsAlive() < MAGE_MAX_MINIONS) {
      spawnMonster(MAGE_MINIONS[Math.floor(Math.random() * MAGE_MINIONS.length)]);
      const n = room.monsters[room.monsters.length - 1];
      n.x = f.x - n.w / 2; n.y = f.y - n.h / 2;
      clampToArena(n);
    }
    room.particles.push({ type: 'teleport', x: f.x, y: f.y, timer: 340, max: 340,
                          color: f.color === 'giant' ? '#c8e07a' : f.spawn === 'ally' ? WEAPON_COLORS.portalwand : '#7aff9a' });
  }
  // The teleport portal he left by: anyone stepping in while it's open comes
  // out of its partner.
  if (f.link && f.t > 300 && f.t < f.life - 150) {
    const out = room.fires.find(o => o.id === f.link);
    if (out) {
      for (const key of KEYS) {
        const p = room.players[key];
        if (!p || p.dead || (p.portalCd || 0) > Date.now()) continue;
        if (Math.hypot(cx(p) - f.x, cy(p) - f.y) > f.r + 6) continue;
        room.particles.push({ type: 'teleport', x: cx(p), y: cy(p), timer: 340, max: 340, color: '#b07aff' });
        p.x = out.x - p.w / 2 + 18; p.y = out.y - p.h / 2;
        p.pull = null;
        clampToArena(p, 2);
        p.portalCd = Date.now() + 900;
        room.particles.push({ type: 'teleport', x: cx(p), y: cy(p), timer: 340, max: 340, color: '#ffffff' });
        room.particles.push({ type: 'pickup', who: key, text: 'THROUGH THE PORTAL!', color: '#c8a0ff', timer: 1400, max: 1400,
                              x: cx(p), y: p.y - 10 });
      }
    }
  }
  return true;
}

// The rune has finished glowing: a real trap is now there.
function placeMageTrap(f) {
  const def = TRAP_TYPES[f.trapType];
  if (!def) return;
  if (room.traps.length >= 12) room.traps.shift();
  const s = def.size;
  room.traps.push({
    id: nextId(), type: f.trapType, x: f.x - s / 2, y: f.y - s / 2, w: s, h: s,
    state: 'idle', armTimer: 0, fireTimer: 0,
    mode: def.mode, radius: def.radius, damage: def.damage || 0,
    effect: def.effect || null, dur: def.dur || 0, color: def.color, expire: 14000,
  });
  room.particles.push({ type: 'trapburst', x: f.x, y: f.y, maxR: def.size, timer: 260, max: 260, color: def.color });
}

// ─── The Abyss ────────────────────────────────────────────────────────────────
// Four arms and two legs, 1.5x the Portal Mage's health, fought on his own.
//   phase 1  four void crossbows:
//            converge  all four shoot one spot; where the bolts meet, a small,
//                      strong black hole opens
//            rapid     a stream of spitter bolts (any attack shoots them down)
//            orb       a massive purple orb gathers, then is sent (bursts on impact)
//   phase 2  (below half) the crossbows become scythes, two more float behind
//            him, and the old attacks are gone:
//            spinfling all six scythes whirl round him, then are flung out
//            bigslash  a wind-up, then all six scythes slash, growing huge
//   phase 3  (at 0 health) he rises to the top of the map, immortal, and
//            unleashes black holes, meteors and spinning scythes. Survive
//            ABYSS_P3_MS and he is gone.
const ABYSS_HP = Math.round(MAGE_HP * 1.5);
const ABYSS_PHASE2 = 0.5;
const ABYSS_P3_MS = 10000;
const ABYSS_REWARD_COINS = 100000, ABYSS_REWARD_XP = 75000;
const ABYSS_CONVERGE_MS = 700, ABYSS_HOLE_WARN_MS = 900;
const ABYSS_PLAYER_CHARGE_MS = 650, ABYSS_CHARGE_MS = 1500;
const ABYSS_ORB_DMG = 75, ABYSS_ORB_AOE = 85;
const ABYSS_RAPID_SHOTS = 22, ABYSS_RAPID_EVERY = 90, ABYSS_RAPID_DMG = 9;
const ABYSS_SPIN_MS = 1500, ABYSS_SPIN_R = 62, ABYSS_FLING_DMG = 28;
const ABYSS_SLASH_WIND = 650, ABYSS_SLASH_MS = 950, ABYSS_SLASH_R = 165, ABYSS_SLASH_DMG = 52;

// ── Endless Scythe ──
const HORIZON_STUN_MS = 450;
const VOIDBEAM_MS = 2000, VOIDBEAM_SPIN = Math.PI * 3, VOIDBEAM_W = 12, VOIDBEAM_TICK = 110, VOIDBEAM_PULL_R = 240, VOIDBEAM_HOLD = 50;
const WHIRL_MS = 1200, WHIRL_R = 58, WHIRL_TICK = 250, WHIRL_SLASH_R = 160;
// A void beam sweeping round you one and a half times, fast, dragging foes in.
function updateVoidBeam(f, factor, dt) {
  const o = room.players[f.owner];
  if (!o || o.dead) return false;
  f.x = cx(o); f.y = cy(o);
  f.a = f.a0 + VOIDBEAM_SPIN * Math.min(1, f.t / f.life);
  for (const t of enemyTargets(f.owner)) {
    if (t.boss) continue;
    const dx = f.x - cx(t), dy = f.y - cy(t), d = Math.hypot(dx, dy) || 1;
    // Dragged in to just outside the beam's root, so it still has to sweep past them.
    if (d > VOIDBEAM_PULL_R || d < VOIDBEAM_HOLD) continue;
    const pull = Math.min(d - VOIDBEAM_HOLD, (0.9 + 1.8 * (1 - d / VOIDBEAM_PULL_R)) * factor);
    t.x += dx / d * pull; t.y += dy / d * pull;
    clampToArena(t);
  }
  f.tick -= dt;
  if (f.tick > 0) return true;
  f.tick = VOIDBEAM_TICK;
  const ex = f.x + Math.cos(f.a) * f.len, ey = f.y + Math.sin(f.a) * f.len;
  for (const t of enemyTargets(f.owner)) {
    if (distToSegment(cx(t), cy(t), f.x, f.y, ex, ey) > f.r + t.w / 2) continue;
    t.invincible = 0;
    applyDamage(t, f.dmg + (t.num ? 0 : Math.round((t.maxHp || 0) * (t.boss ? 0.003 : 0.01))), f.owner);
  }
  return true;
}
// The Abyss's second phase, yours: scythes whirl, fly out, then one huge slash.
function updateScytheWhirl(f, dt) {
  const o = room.players[f.owner];
  if (!o || o.dead) return false;
  f.x = cx(o); f.y = cy(o);
  if (f.t < WHIRL_MS) {
    f.tick -= dt;
    if (f.tick <= 0) {
      f.tick = WHIRL_TICK;
      for (const t of enemyTargets(f.owner)) {
        const d = Math.hypot(cx(t) - f.x, cy(t) - f.y);
        if (Math.abs(d - WHIRL_R) > 18 + t.w / 2 && d > WHIRL_R) continue;
        if (!t.num) t.invincible = 0;
        applyDamage(t, Math.round(f.dmg * 0.5), f.owner);
      }
    }
    f.a = nearestTargetAngle(o, f.owner);
    return true;
  }
  if (!f.flung) {
    f.flung = true;
    for (let i = 0; i < 6; i++) {
      const a = f.a + i * Math.PI / 3;
      room.projectiles.push({ id: nextId(), x: f.x + Math.cos(a) * WHIRL_R, y: f.y + Math.sin(a) * WHIRL_R,
        dx: Math.cos(a) * 6.5, dy: Math.sin(a) * 6.5, damage: f.dmg, owner: f.owner, traveled: 0, maxRange: 520,
        weaponId: 'abyssscythe', isAoe: false, aoeRadius: 0, pierce: true, grapple: false, boomerang: false, returning: false,
        life: 0, hitTargets: new Set(), hitR: 8 });
    }
    room.particles.push({ type: 'shockwave', x: f.x, y: f.y, maxR: 80, timer: 380, max: 380, color: '#e0a0ff' });
  }
  if (!f.slashed && f.t >= WHIRL_MS + 150) {
    f.slashed = true;
    for (const t of enemyTargets(f.owner)) {
      const d = Math.hypot(cx(t) - f.x, cy(t) - f.y);
      if (d > WHIRL_SLASH_R + t.w / 2) continue;
      let diff = Math.abs(Math.atan2(cy(t) - f.y, cx(t) - f.x) - f.a) % (Math.PI * 2);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff > 1.45 && d > 30) continue;
      if (!t.num) t.invincible = 0;
      applyDamage(t, Math.round(f.dmg * 1.8), f.owner);
    }
    room.particles.push({ type: 'shockwave', x: f.x, y: f.y, maxR: WHIRL_SLASH_R, timer: 380, max: 380, color: '#e0a0ff' });
  }
  return true;
}

function startAbyssFight() {
  room.wave = { num: 1, monstersLeft: 1, spawnQueue: 0, spawnTimer: 0, betweenTimer: 0 };
  room.waveHpMult = 1; room.waveSpeedMult = 1;
  spawnMonster('abyss');
  const m = room.monsters[room.monsters.length - 1];
  m.hp = m.maxHp = ABYSS_HP;
  m.x = CANVAS_W / 2 - m.w / 2; m.y = ARENA_Y + 30;
  Object.assign(m, { abyss: true, phase: 1, act: null, actT: 0, actCd: 2000, lastAct: null, orbit: 1,
                     p3: false, p3T: 0, chaos: null, rapid: 0, rapidT: 0 });
  room.particles.push({ type: 'newtype', x: CANVAS_W / 2, y: CANVAS_H / 2 + 26,
                        text: 'THE ABYSS AWAKENS', color: '#b07aff', timer: 3200, max: 3200 });
}

// Where his four hands are (upper pair, lower pair).
function abyssHands(m) {
  const c = { x: cx(m), y: cy(m) };
  return [[-0.62, -0.18], [0.62, -0.18], [-0.7, 0.14], [0.7, 0.14]].map(([ox, oy]) => ({ x: c.x + ox * m.w, y: c.y + oy * m.h }));
}

// A void bolt (the boss's crossbows, and the Crossbows of Infinity).
function abyssBolt(owner, x, y, a, speed, dmg, range, extra) {
  room.projectiles.push({ id: nextId(), x, y, dx: Math.cos(a) * speed, dy: Math.sin(a) * speed, damage: dmg, owner,
    traveled: 0, maxRange: range, weaponId: owner === 'monster' ? 'abyssbolt' : 'infinitybow', isAoe: false, aoeRadius: 0,
    pierce: false, grapple: false, boomerang: false, returning: false, life: 0, hitTargets: null, ...(extra || {}) });
}

// Bolts from every origin, timed to meet on one spot; a black hole opens there.
function abyssConverge(owner, from, at, boltDmg, hole) {
  const frames = ABYSS_CONVERGE_MS / 16.67;
  for (const o of from) {
    const d = Math.hypot(at.x - o.x, at.y - o.y) || 1;
    abyssBolt(owner, o.x, o.y, Math.atan2(at.y - o.y, at.x - o.x), d / frames, boltDmg, d, { hitR: 5 });
  }
  room.fires.push({ id: nextId(), kind: 'abyssmark', owner, x: at.x, y: at.y, r: hole.r, t: 0, life: ABYSS_CONVERGE_MS, hole });
}
function openAbyssHole(f) {
  const h = f.hole;
  room.fires.push({ id: nextId(), kind: 'blackhole', owner: f.owner, x: f.x, y: f.y, r: h.r, t: 0, life: h.life, tick: 0,
                    dmg: h.dmg, pullR: h.pullR, ...(h.boom ? { boom: h.boom, boomR: h.boomR } : {}), ...(h.spit ? { spit: h.spit, spitT: 0 } : {}) });
  room.particles.push({ type: 'shockwave', x: f.x, y: f.y, maxR: 46, timer: 420, max: 420, color: '#b07aff' });
}

// The orb gathering: it rides its caster, growing, then is sent at the nearest foe.
function updateAbyssCharge(f) {
  const o = f.mon ? room.monsters.find(m => m.id === f.mon && !m.dead) : room.players[f.owner];
  if (!o || o.dead) return false;
  const k = f.t / f.life;
  f.r = 4 + (f.maxR - 4) * k;
  const lift = f.mon ? -o.h * 0.75 : -16;
  f.x = cx(o); f.y = cy(o) + lift;
  return true;
}
function launchAbyssOrb(f) {
  const foes = enemyTargets(f.owner);
  let best = null, bd = Infinity;
  for (const t of foes) { const d = Math.hypot(cx(t) - f.x, cy(t) - f.y); if (d < bd) { bd = d; best = t; } }
  const o = f.mon ? null : room.players[f.owner];
  const a = best ? Math.atan2(cy(best) - f.y, cx(best) - f.x) : (o && o.facing < 0 ? Math.PI : 0);
  room.projectiles.push({ id: nextId(), x: f.x, y: f.y, dx: Math.cos(a) * f.speed, dy: Math.sin(a) * f.speed, damage: f.dmg,
    owner: f.owner, traveled: 0, maxRange: 1400, weaponId: 'abyssorb', isAoe: true, aoeRadius: f.aoe, hitR: f.maxR,
    pierce: false, grapple: false, boomerang: false, returning: false, life: 0, hitTargets: null, special: !f.mon });
  room.particles.push({ type: 'shockwave', x: f.x, y: f.y, maxR: 30, timer: 300, max: 300, color: '#b07aff' });
}

// Phase 3's scythes: spinning across the field, bouncing off the walls.
function updateAbyssBlade(f, factor) {
  if (!room.monsters.some(m => m.abyss && m.p3 && !m.dead)) return false;
  f.x += f.vx * factor; f.y += f.vy * factor;
  if (f.x < ARENA_X + f.r || f.x > ARENA_X + ARENA_W - f.r) { f.vx = -f.vx; f.x = Math.max(ARENA_X + f.r, Math.min(ARENA_X + ARENA_W - f.r, f.x)); }
  if (f.y < ARENA_Y + f.r || f.y > ARENA_Y + ARENA_H - f.r) { f.vy = -f.vy; f.y = Math.max(ARENA_Y + f.r, Math.min(ARENA_Y + ARENA_H - f.r, f.y)); }
  f.a = (f.a || 0) + 0.35 * factor;
  for (const t of enemyTargets('monster')) {
    if (Math.hypot(cx(t) - f.x, cy(t) - f.y) <= f.r + t.w / 2) applyDamage(t, f.dmg, 'monster');
  }
  return true;
}

// Crossbows of Infinity: a quick burst, one bolt from each crossbow in turn.
function infinityMuzzles(p) {
  const d = p.facing < 0 ? -1 : 1;
  return [{ x: cx(p) + d * 10, y: cy(p) + 2 }, { x: cx(p) + d * 2, y: cy(p) - 19 }, { x: cx(p), y: cy(p) + 15 }];   // held, upper, lower (as drawn)
}
function infinityAttack(p, pKey, w, dmgMult) {
  const aim = nearestTargetAngle(p, pKey);
  p.facing = Math.cos(aim) < 0 ? -1 : 1;
  p.ibCount = (p.ibCount || 0) + 1;
  const double = p.passive === 'infinitybow' && p.ibCount % 5 === 0;   // ENDLESS VOLLEY
  const n = (3 + (w.multi || 0)) * (double ? 2 : 1);
  const shots = [];
  for (let i = 0; i < n; i++) shots.push(i * 55);
  room.fires.push({ id: nextId(), kind: 'ibburst', owner: pKey, x: cx(p), y: cy(p), r: 0, t: 0, life: shots[n - 1] + 30,
                    shots, shot: 0, dmg: Math.round(w.damage * dmgMult), speed: w.projSpeed || 7, range: w.range,
                    upg: p.upgrades?.[w.id] || null });
}
function updateIbBurst(f) {
  const p = room.players[f.owner];
  if (!p || p.dead) return false;
  while (f.shot < f.shots.length && f.t >= f.shots[f.shot]) {
    const from = infinityMuzzles(p)[f.shot % 3];
    const a = nearestTargetAngle(p, f.owner) + (Math.random() - 0.5) * 0.08;
    abyssBolt(f.owner, from.x, from.y, a, f.speed, f.dmg, f.range, { upg: f.upg, hitR: 4, noIframe: true });
    f.shot++;
  }
  return true;
}

// Any attack knocks the rapid-fire bolts that are close enough out of the air.
function swatShots(p, range) {
  let hit = 0;
  for (const pr of room.projectiles) {
    if (!pr.shootable || pr.dead || pr.owner !== 'monster') continue;
    if (Math.hypot(pr.x - cx(p), pr.y - cy(p)) > range) continue;
    pr.dead = true; hit++;
    room.particles.push({ type: 'shockwave', x: pr.x, y: pr.y, maxR: 12, timer: 220, max: 220, color: '#c89aff' });
  }
  return hit;
}

function updateAbyss(m, target, dist, dx, dy, spd, factor, dt) {
  // ── Phase 3: immortal at the top of the map; survive the chaos ──
  if (m.p3) {
    m.hp = 1;
    const tx = CANVAS_W / 2 - m.w / 2, ty = ARENA_Y + ARENA_H * 0.2;   // high up, but clear of the weapon rack
    m.x += (tx - m.x) * Math.min(1, 0.06 * factor); m.y += (ty - m.y) * Math.min(1, 0.06 * factor);
    m.p3T -= dt;
    const c = m.chaos;
    c.hole -= dt; c.meteor -= dt; c.blade -= dt;
    if (c.hole <= 0) {
      c.hole = 900;
      const near = Math.random() < 0.5 && target;
      const at = near ? arenaClamp(cx(target) + (Math.random() - 0.5) * 140, cy(target) + (Math.random() - 0.5) * 140, 30)
                      : arenaClamp(ARENA_X + Math.random() * ARENA_W, ARENA_Y + 60 + Math.random() * (ARENA_H - 60), 30);
      // Marked first, so it can be seen coming.
      room.fires.push({ id: nextId(), kind: 'abyssmark', owner: 'monster', x: at.x, y: at.y, r: 16, t: 0, life: ABYSS_HOLE_WARN_MS,
                        hole: { r: 16, pullR: 115, dmg: 7, life: 2300 } });
    }
    if (c.meteor <= 0) {
      c.meteor = 420;
      room.fires.push({ id: nextId(), kind: 'meteor', owner: 'monster', x: cx(m), y: cy(m), r: 38, t: 0, life: METEOR_FALL_MS,
                        seek: Math.random() < 0.6, placed: false, pvp: 24, base: 0, pct: 0 });
    }
    if (c.blade <= 0 && room.fires.filter(f => f.kind === 'abyssblade').length < 7) {
      c.blade = 1100;
      const a = Math.PI * (0.15 + Math.random() * 0.7);
      room.fires.push({ id: nextId(), kind: 'abyssblade', owner: 'monster', x: cx(m), y: cy(m) + 20, r: 11, t: 0, life: ABYSS_P3_MS + 5000,
                        vx: Math.cos(a) * 3.1 * (Math.random() < 0.5 ? -1 : 1), vy: Math.sin(a) * 3.1, dmg: 15, a: 0 });
    }
    if (m.p3T <= 0) abyssDefeated(m);
    return;
  }

  // ── Half health: crossbows become scythes ──
  if (m.phase === 1 && m.hp <= m.maxHp * ABYSS_PHASE2) {
    m.phase = 2; m.act = null; m.actT = 0; m.rapid = 0; m.actCd = 1400; m.invincible = 1200;
    room.projectiles = room.projectiles.filter(pr => !(pr.owner === 'monster' && pr.shootable));
    room.particles.push({ type: 'shockwave', x: cx(m), y: cy(m), maxR: 160, timer: 800, max: 800, color: '#b07aff' });
    room.particles.push({ type: 'newtype', x: CANVAS_W / 2, y: CANVAS_H / 2 + 26,
                          text: 'PHASE 2 - THE CROSSBOWS BECOME SCYTHES', color: '#e0a0ff', timer: 3000, max: 3000 });
  }

  // Rapid fire runs on its own clock (he can strafe while shooting).
  if (m.rapid > 0) {
    m.rapidT -= dt;
    while (m.rapid > 0 && m.rapidT <= 0) {
      m.rapidT += ABYSS_RAPID_EVERY;
      const hand = abyssHands(m)[m.rapid % 4];
      const a = Math.atan2(cy(target) - hand.y, cx(target) - hand.x) + (Math.random() - 0.5) * 0.22;
      room.projectiles.push({ id: nextId(), x: hand.x, y: hand.y, dx: Math.cos(a) * 4.4, dy: Math.sin(a) * 4.4, damage: ABYSS_RAPID_DMG,
        owner: 'monster', traveled: 0, maxRange: 620, weaponId: 'spit', isAoe: false, aoeRadius: 0, pierce: false, grapple: false,
        boomerang: false, returning: false, life: 0, hitTargets: null, shootable: true });
      m.rapid--;
    }
    if (m.rapid <= 0) m.act = null;
  }

  // An attack in progress.
  if (m.act === 'spin') {
    m.actT += dt;
    // The scythes whirl round him: touching the ring hurts.
    for (const t of enemyTargets('monster')) {
      const d = Math.hypot(cx(t) - cx(m), cy(t) - cy(m));
      if (Math.abs(d - ABYSS_SPIN_R) < 16 + t.w / 2) applyDamage(t, 14, 'monster');
    }
    if (m.actT >= ABYSS_SPIN_MS) {
      const a0 = Math.atan2(cy(target) - cy(m), cx(target) - cx(m));
      for (let i = 0; i < 6; i++) {
        const a = a0 + i * Math.PI / 3;
        room.projectiles.push({ id: nextId(), x: cx(m) + Math.cos(a) * ABYSS_SPIN_R, y: cy(m) + Math.sin(a) * ABYSS_SPIN_R,
          dx: Math.cos(a) * 6.2, dy: Math.sin(a) * 6.2, damage: ABYSS_FLING_DMG, owner: 'monster', traveled: 0, maxRange: 700,
          weaponId: 'abyssscythe', isAoe: false, aoeRadius: 0, pierce: true, grapple: false, boomerang: false, returning: false,
          life: 0, hitTargets: new Set(), hitR: 8 });
      }
      room.particles.push({ type: 'shockwave', x: cx(m), y: cy(m), maxR: 90, timer: 400, max: 400, color: '#e0a0ff' });
      m.act = null; m.actCd = 1700;
    }
    return;
  }
  if (m.act === 'slash') {
    m.actT += dt;
    if (!m.slashHit && m.actT >= ABYSS_SLASH_WIND) {
      m.slashHit = true;
      for (const t of enemyTargets('monster')) {
        const d = Math.hypot(cx(t) - cx(m), cy(t) - cy(m));
        if (d > ABYSS_SLASH_R + t.w / 2) continue;
        let diff = Math.abs(Math.atan2(cy(t) - cy(m), cx(t) - cx(m)) - m.slashA) % (Math.PI * 2);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        if (diff > 1.45 && d > 30) continue;
        if (t.parryTimer > 0) { applyDamage(m, Math.round(ABYSS_SLASH_DMG * reflectOf(t)), playerKeyOf(t)); spawnParrySpark(cx(t), cy(t)); continue; }
        applyDamage(t, ABYSS_SLASH_DMG, 'monster');
        const k = Math.hypot(cx(t) - cx(m), cy(t) - cy(m)) || 1;
        t.x += (cx(t) - cx(m)) / k * 26; t.y += (cy(t) - cy(m)) / k * 26; clampToArena(t);
      }
      room.particles.push({ type: 'shockwave', x: cx(m), y: cy(m), maxR: ABYSS_SLASH_R, timer: 380, max: 380, color: '#e0a0ff' });
    }
    if (m.actT >= ABYSS_SLASH_MS) { m.act = null; m.actCd = 1500; }
    return;
  }
  if (m.act === 'converge' || m.act === 'orb') {
    m.actT += dt;
    if (m.actT >= (m.act === 'orb' ? ABYSS_CHARGE_MS + 300 : ABYSS_CONVERGE_MS + 300)) { m.act = null; m.actCd = 1800; }
    return;   // planted while aiming
  }

  // ── Moving ──
  if (m.phase === 1) {
    // Keeps his distance, circling.
    let vx = -dy / dist * 0.6 * m.orbit, vy = dx / dist * 0.6 * m.orbit;
    if (dist > 230) { vx += dx / dist; vy += dy / dist; }
    else if (dist < 150) { vx -= dx / dist; vy -= dy / dist; }
    m.x += vx * spd * factor; m.y += vy * spd * factor;
    if (Math.random() < 0.006) m.orbit = -m.orbit;
  } else if (dist > 75) {
    // Phase 2: he comes for you.
    m.x += dx / dist * spd * 1.25 * factor; m.y += dy / dist * spd * 1.25 * factor;
  }

  if (m.actCd > 0) { m.actCd -= dt; return; }
  if (m.act) return;
  const pool = m.phase === 1 ? ['converge', 'rapid', 'orb'] : ['spin', 'slash', 'slash'];
  let pick;
  do { pick = pool[Math.floor(Math.random() * pool.length)]; } while (pick === m.lastAct && Math.random() < 0.8);
  m.lastAct = pick; m.act = pick; m.actT = 0;
  if (pick === 'converge') {
    abyssConverge('monster', abyssHands(m), { x: cx(target), y: cy(target) }, 16,
                  { r: 14, pullR: 135, dmg: 12, life: 2600, boom: 45, boomR: 70 });
  } else if (pick === 'rapid') {
    m.rapid = ABYSS_RAPID_SHOTS; m.rapidT = 250; m.actCd = 0;
  } else if (pick === 'orb') {
    room.fires.push({ id: nextId(), kind: 'abysscharge', owner: 'monster', mon: m.id, x: cx(m), y: cy(m) - m.h * 0.75, r: 4, t: 0,
                      life: ABYSS_CHARGE_MS, dmg: ABYSS_ORB_DMG, aoe: ABYSS_ORB_AOE, maxR: 22, speed: 2.6 });
  } else if (pick === 'slash') {
    m.slashA = Math.atan2(cy(target) - cy(m), cx(target) - cx(m)); m.slashHit = false;
  }
}

// Brought to 0: he does not fall — he rises, immortal, for the last stand.
function abyssPhase3(m) {
  if (m.p3 || m.dead) return;
  m.p3 = true; m.hp = 1; m.phase = 3;
  m.act = null; m.rapid = 0; m.p3T = ABYSS_P3_MS;
  m.chaos = { hole: 600, meteor: 300, blade: 200 };
  room.projectiles = room.projectiles.filter(pr => pr.owner !== 'monster');
  room.particles.push({ type: 'shockwave', x: cx(m), y: cy(m), maxR: 240, timer: 1000, max: 1000, color: '#7a2aff' });
  room.particles.push({ type: 'newtype', x: CANVAS_W / 2, y: CANVAS_H / 2 + 26,
                        text: 'FINAL PHASE - SURVIVE 10 SECONDS!', color: '#ff7ad8', timer: 3000, max: 3000 });
}

function abyssDefeated(m) {
  if (m.dead) return;
  m.dead = true; m.p3 = false;
  for (const o of room.monsters) {
    o.dead = true;
    room.particles.push({ type: 'teleport', x: cx(o), y: cy(o), timer: 420, max: 420, color: '#b07aff' });
  }
  room.monsters = [];
  room.wave.monstersLeft = 0;
  room.projectiles = room.projectiles.filter(pr => pr.owner !== 'monster');
  room.fires = room.fires.filter(f => f.owner !== 'monster');
  room.particles.push({ type: 'shockwave', x: cx(m), y: cy(m), maxR: 260, timer: 1000, max: 1000, color: '#b07aff' });
  room.particles.push({ type: 'waveclear', x: CANVAS_W / 2, y: CANVAS_H / 2 - 10, text: 'THE ABYSS IS DEFEATED!', timer: 4000 });
  if (room.gameMode === 'sandbox') return;
  for (const key of KEYS) {
    const p = room.players[key];
    if (!p) continue;
    addCoins(key, ABYSS_REWARD_COINS);
    creditXp(key, ABYSS_REWARD_XP);
    room.particles.push({ type: 'coin', x: cx(p), y: p.y - 10, text: '+' + ABYSS_REWARD_COINS.toLocaleString() + ' COINS', timer: 3000, max: 3000 });
    room.particles.push({ type: 'xp', x: cx(p), y: p.y - 22, text: '+' + ABYSS_REWARD_XP.toLocaleString() + ' XP', timer: 3000 });
    // First win: the Crossbows of Infinity. Beat him again: the Endless Scythe.
    const owned = p.unlockedWeapons || room.playerUnlocks[key] || [];
    const drop = owned.includes('infinitybow') ? 'endlessscythe' : 'infinitybow';
    grantBossWeapon(key, drop);
    room.bossDrops = { ...(room.bossDrops || {}), [key]: drop };
  }
  room.victory = true;
  room.gameState = 'ROUND_OVER';
  room.roundOverTimer = 8000;
}

// Victory: everything he summoned vanishes and the reward is paid out.
function mageDefeated(m) {
  if (m.dead) return;
  m.dead = true;
  for (const o of room.monsters) {
    o.dead = true;
    room.particles.push({ type: 'teleport', x: cx(o), y: cy(o), timer: 420, max: 420, color: '#c8a0ff' });
  }
  room.monsters = [];
  room.wave.monstersLeft = 0;
  room.projectiles = room.projectiles.filter(pr => pr.owner !== 'monster');
  room.fires = room.fires.filter(f => f.owner !== 'monster');
  room.traps = [];
  room.particles.push({ type: 'shockwave', x: cx(m), y: cy(m), maxR: 220, timer: 900, max: 900, color: '#c8a0ff' });
  room.particles.push({ type: 'waveclear', x: CANVAS_W / 2, y: CANVAS_H / 2 - 10, text: 'THE PORTAL MAGE IS DEFEATED!', timer: 4000 });
  if (room.gameMode === 'sandbox') return;   // practice: no reward, and the sandbox carries on
  for (const key of KEYS) {
    const p = room.players[key];
    if (!p) continue;
    addCoins(key, MAGE_REWARD_COINS);
    creditXp(key, MAGE_REWARD_XP);
    room.particles.push({ type: 'coin', x: cx(p), y: p.y - 10, text: '+' + MAGE_REWARD_COINS.toLocaleString() + ' COINS', timer: 3000, max: 3000 });
    room.particles.push({ type: 'xp', x: cx(p), y: p.y - 22, text: '+' + MAGE_REWARD_XP.toLocaleString() + ' XP', timer: 3000 });
    grantBossWeapon(key, 'portalwand');
  }
  room.victory = true;
  room.gameState = 'ROUND_OVER';
  room.roundOverTimer = 8000;
}

// A boss's reward weapon: saved to the account, handed over in the match, and
// shown on the unlock screen once the fight ends.
function grantBossWeapon(key, wid) {
  const p = room.players[key];
  const cur = p?.unlockedWeapons || room.playerUnlocks[key] || [];
  if (cur.includes(wid)) return false;
  const weapons = sortWeaponIds([...cur, wid]);
  const pw = room.passwords[key];
  if (pw && !isAdminPw(pw)) {
    const d = progress();
    d.weapons[pw] = sortWeaponIds([...(d.weapons[pw] || []), ...weapons]);
    markDirty();
  }
  room.playerUnlocks[key] = weapons;
  if (p) {
    const held = p.unlockedWeapons[p.weaponIdx];
    p.unlockedWeapons = weapons;
    p.weaponIdx = Math.max(0, weapons.indexOf(held));
    refreshWeapon(p);
  }
  room.unlockQueues[key].push(wid);
  return true;
}

// ─── Sandbox ──────────────────────────────────────────────────────────────────
// A solo practice arena: no waves, every weapon and ability to try, and a panel
// to spawn monsters, bosses, items and traps and to switch on cheats. Nothing
// here is saved — no XP, no coins, no leaderboard.
const SANDBOX_MAX_MONSTERS = 40;

function startSandbox() {
  room.sandbox = { god: false, noCd: false, freeze: false, passives: false, level: 5 };
  room.wave = { num: 1, monstersLeft: 0, spawnQueue: 0, spawnTimer: 0, betweenTimer: 0 };
  room.waveHpMult = 1; room.waveSpeedMult = 1;
  const p = room.players.p1;
  if (p) {
    p.unlockedWeapons = WEAPONS.map(w => w.id);
    p.weaponIdx = 0;
    refreshWeapon(p);
    // Every ability slot, to try any combination.
    while (p.abilities.length < MAX_ABILITY_SLOTS) p.abilities.push(null);
  }
  // The first-time tutorial: a gentle sandbox — can't die, weak monsters, and
  // just three weapons so swapping is easy to follow.
  if (room.tutorial) {
    room.sandbox.tutorial = true;
    room.sandbox.god = true;
    room.sandbox.level = 1;
    if (p) { p.unlockedWeapons = ['sword', 'bow', 'staff']; p.weaponIdx = 0; refreshWeapon(p); }
    return;
  }
  room.particles.push({ type: 'newtype', x: CANVAS_W / 2, y: CANVAS_H / 2 + 26,
                        text: 'SANDBOX - TRY ANYTHING', color: '#7affc8', timer: 2600, max: 2600 });
}

function sandboxCheats(p) {
  const s = room.sandbox;
  if (s.god) { p.hp = p.maxHp; if (p.effects) { delete p.effects.burn; delete p.effects.poison; } }
  if (s.noCd) {
    p.specialCooldown = 0; p.superCooldown = 0; p.parryCooldown = 0;
    for (const id in p.abCd) p.abCd[id] = 0;
  }
}

function sandboxClear() {
  room.monsters = [];
  room.traps = [];
  room.items = [];
  room.projectiles = room.projectiles.filter(pr => pr.owner !== 'monster');
  room.fires = room.fires.filter(f => f.owner !== 'monster');
}

// A spot a little ahead of the player, inside the arena.
function sandboxSpot(p, dist, size) {
  const a = (p.facing === -1 ? Math.PI : 0) + (Math.random() - 0.5) * 1.2;
  const at = arenaClamp(cx(p) + Math.cos(a) * dist, cy(p) + Math.sin(a) * dist, size / 2 + 4);
  return { x: at.x - size / 2, y: at.y - size / 2 };
}

function sandboxAction(key, msg) {
  const p = room.players[key];
  if (!p) return;
  const s = room.sandbox;
  const act = String(msg.action || '');
  if (act === 'spawn') {
    const type = String(msg.what || '');
    if (!MONSTER_TYPES[type]) return;
    const n = Math.max(1, Math.min(10, Math.floor(Number(msg.count) || 1)));
    for (let i = 0; i < n && room.monsters.length < SANDBOX_MAX_MONSTERS; i++) {
      if (type === 'portalmage') {
        if (room.monsters.some(o => o.mage)) break;   // one mage at a time
        startMageFight();
        break;
      }
      if (type === 'abyss') {
        if (room.monsters.some(o => o.abyss)) break;
        startAbyssFight();
        break;
      }
      spawnMonster(type);
    }
  } else if (act === 'item') {
    const type = String(msg.what || '');
    if (!ITEM_TYPES[type] || room.items.length >= 30) return;
    const at = sandboxSpot(p, 40, ITEM_SIZE);
    room.items.push({ id: nextId(), type, x: at.x, y: at.y, w: ITEM_SIZE, h: ITEM_SIZE });
  } else if (act === 'trap') {
    const type = String(msg.what || '');
    const def = TRAP_TYPES[type];
    if (!def || room.traps.length >= 30) return;
    const at = sandboxSpot(p, 70, def.size);
    room.traps.push({ id: nextId(), type, x: at.x, y: at.y, w: def.size, h: def.size,
                      state: 'idle', armTimer: 0, fireTimer: 0, mode: def.mode, radius: def.radius,
                      damage: def.damage || 0, effect: def.effect || null, dur: def.dur || 0, color: def.color });
  } else if (act === 'clear') {
    sandboxClear();
  } else if (act === 'toggle') {
    const k = String(msg.what || '');
    if (k === 'god' || k === 'noCd' || k === 'freeze' || k === 'passives') s[k] = !s[k];
    if (k === 'passives') refreshWeapon(p);
  } else if (act === 'level') {
    s.level = Math.max(1, Math.min(50, Math.floor(Number(msg.value) || 1)));
  } else if (act === 'ability') {
    const slot = Math.max(0, Math.min(MAX_ABILITY_SLOTS - 1, Math.floor(Number(msg.slot) || 0)));
    const id = msg.what && ABILITY_BY_ID[msg.what] ? msg.what : null;
    p.abilities[slot] = id;
    if (id) p.abCd[id] = 0;
  } else if (act === 'heal') {
    p.hp = p.maxHp;
    p.effects = {};
  }
}

// Where the tree comes down: just ahead of the Giant, on the side it faces.
function giantImpact(m) { return { x: cx(m) + m.face * (m.w / 2 + m.h * 0.45), y: m.y + m.h * 0.8 }; }

function giantSwipe(m) {
  const reach = m.w / 2 + GIANT_SWIPE_REACH;
  room.particles.push({ type: 'giantswipe', x: cx(m), y: cy(m), r: reach, face: m.face, timer: 320, max: 320 });
  for (const p of enemyTargets('monster')) {
    const ddx = cx(p) - cx(m), ddy = cy(p) - cy(m);
    if (Math.hypot(ddx, ddy) > reach + p.w / 2) continue;
    if (ddx * m.face < -m.w * 0.3) continue;          // only in front of it
    if (p.parryTimer > 0) { stunGiant(m, p); return; }
    applyDamage(p, m.atkDamage, 'monster');
    // Sent flying.
    const d = Math.hypot(ddx, ddy) || 1;
    p.pull = { vx: (ddx / d) * 60 / 250, vy: (ddy / d) * 60 / 250, timer: 250, from: null };
  }
}

function giantSlam(m) {
  const at = giantImpact(m);
  room.particles.push({ type: 'shockwave', x: at.x, y: at.y, maxR: 40, timer: 380, max: 380, color: '#d8c89a' });
  room.fires.push({ id: nextId(), kind: 'soundwave', owner: 'monster', boss: m.id, x: at.x, y: at.y, r: 8,
                    t: 0, life: 60000, dmg: Math.max(1, Math.round(m.atkDamage * 0.7)), hit: new Set() });
}

function stunGiant(m, p) {
  if (m.dead) return;
  m.stun = GIANT_STUN_MS;
  m.windup = 0; m.wind = null;
  spawnParrySpark(cx(p), cy(p));
  room.particles.push({ type: 'trapburst', x: cx(m), y: m.y + 10, maxR: 50, timer: 900, max: 900, color: '#ffd84a', text: 'STUNNED' });
  m.invincible = 0;
  applyDamage(m, Math.round(m.maxHp * GIANT_STUN_DMG), playerKeyOf(p));
}

// The ring rolls outward; the first touch hurts, a parry breaks it and stuns the Giant.
function updateSoundwave(f, factor) {
  f.r += SOUNDWAVE_SPEED * factor;
  if (f.r > SOUNDWAVE_MAX_R) return false;
  for (const p of enemyTargets('monster')) {
    const id = playerKeyOf(p) || p.id;
    if (f.hit.has(id)) continue;
    if (Math.abs(Math.hypot(cx(p) - f.x, cy(p) - f.y) - f.r) > SOUNDWAVE_BAND + p.w / 2) continue;
    f.hit.add(id);
    if (p.parryTimer > 0) {
      const giant = room.monsters.find(mo => mo.id === f.boss);
      if (giant) stunGiant(giant, p);
      else spawnParrySpark(cx(p), cy(p));
      return false;
    }
    applyDamage(p, f.dmg, 'monster');
  }
  return true;
}

// ─── Admin: skip wave ─────────────────────────────────────────────────────────
// Every monster on the field dies (no rewards), their shots and sound waves
// vanish, and the next wave starts at once — or, on co-op's last wave, the
// game is won.
function adminSkipWave() {
  if (room.gameState !== 'GAMEPLAY' || room.gameMode === 'pvp') return;
  if (room.gameMode === 'sandbox') { sandboxClear(); return; }
  // Boss fight: skipping means winning it outright.
  if (room.gameMode === 'portal') {
    const m = room.monsters.find(o => o.mage);
    if (m) mageDefeated(m);
    return;
  }
  if (room.gameMode === 'abyss') {
    const m = room.monsters.find(o => o.abyss);
    if (m) abyssDefeated(m);
    return;
  }
  for (const m of room.monsters) {
    room.particles.push({ type: 'aoe', x: cx(m), y: cy(m), maxR: Math.max(16, m.w), radius: 2, timer: 360, max: 360, color: '#ffd870' });
  }
  room.monsters = [];
  room.projectiles = room.projectiles.filter(pr => pr.owner !== 'monster');
  room.fires = room.fires.filter(f => f.owner !== 'monster');
  const num = room.wave.num;
  if (room.gameMode === 'coop' && num >= COOP_FINAL_WAVE) {
    room.wave.spawnQueue = 0; room.wave.monstersLeft = 0;
    room.victory = true;
    room.gameState = 'ROUND_OVER';
    room.roundOverTimer = 7000;
    return;
  }
  startWave(num + 1);
  room.particles.push({ type: 'waveclear', x: CANVAS_W / 2, y: CANVAS_H / 2 - 10,
                        text: 'WAVE ' + num + ' SKIPPED', timer: 1800 });
}

// ─── Abilities ────────────────────────────────────────────────────────────────
// Each returns false when there was nothing to do (full HP, no target), so the
// cooldown isn't spent on a wasted press.
function useAbility(p, pKey, slot) {
  const id = p.abilities?.[slot];
  const ab = ABILITY_BY_ID[id];
  if (!ab || p.dead || (p.abCd[id] || 0) > 0 || hasEffect(p, 'silence')) return;
  let used = true;
  if (id === 'dash') used = abilityDash(p, pKey);
  else if (id === 'heal') used = abilityHeal(p);
  else if (id === 'aegis') {
    applyEffect(p, 'shield', AEGIS_MS);
    room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p), maxR: 34, timer: 650, max: 650, color: ab.color, text: 'AEGIS' });
  }
  else if (id === 'warp') used = abilityWarp(p, pKey);
  else if (id === 'storm') used = abilityStorm(p, pKey);
  else if (id === 'drain') {
    room.fires.push({ id: nextId(), kind: 'drain', owner: pKey, x: cx(p), y: cy(p), r: DRAIN_R, t: 0, life: DRAIN_MS, tick: 0,
                      dmg: Math.round(DRAIN_DMG * (hasEffect(p, 'strength') ? 1.8 : 1)) });
    room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p), maxR: 40, timer: 650, max: 650, color: ab.color, text: 'LIFE DRAIN' });
  }
  else if (id === 'blackhole') used = abilityBlackhole(p, pKey);
  else if (id === 'frost') used = abilityFrost(p, pKey);
  else if (id === 'rage') {
    applyEffect(p, 'strength', RAGE_MS);
    applyEffect(p, 'haste', RAGE_MS);
    room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p), maxR: 34, timer: 600, max: 600, color: ab.color, text: 'BERSERK' });
  } else if (id === 'meteor') used = abilityMeteor(p, pKey);
  else if (ABILITY_FNS[id]) used = ABILITY_FNS[id](p, pKey, ab, hasEffect(p, 'strength') ? 1.8 : 1) !== false;
  if (used) { p.abCd[id] = ab.cd; if (hasEffect(p, 'ghost')) breakGhost(p); }   // an ability ends the ghost cloak
}

// ── The second shelf of abilities ──
// Damage against monsters is a flat part plus a share of their max HP (a much
// smaller share on bosses), so they stay useful deep into a run; another
// player takes a flat hit.
function abDmg(t, base, pct, mult) {
  const d = t.num ? base * 0.5 : base + (t.maxHp || 0) * (t.boss ? pct / 4 : pct);
  return Math.max(1, Math.round(d * mult));
}
function nearestFoe(p, pKey, maxD = Infinity) {
  let best = null, bd = maxD;
  for (const t of enemyTargets(pKey)) {
    const d = Math.hypot(cx(t) - cx(p), cy(t) - cy(p));
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}
function abBurst(p, ab, text, r = 34) {
  room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p), maxR: r, timer: 650, max: 650, color: ab.color, text });
}
// Stun a monster for a moment (bosses and players are only slowed).
// kind: ice, stun, shock, quake, timestop, root, chain, holy, void, silence.
// Each is drawn differently; bosses and players are only slowed.
const STAGGER_SLOW = { timestop: 'time', root: 'net', chain: 'net', mind: 'mind' };
function stagger(t, ms, kind = 'stun') {
  if (t.dead) return;
  if (t.num || t.boss) chillTarget(t, ms, STAGGER_SLOW[kind] || 'chill');
  else {
    if (ms >= (t.freeze || 0)) t.freezeKind = kind;
    t.freeze = Math.max(t.freeze || 0, ms); t.swing = 0;
  }
}

// ── The 10 update ──
const THORNS_SHARE = 0.5, VOID_WAVE_MULT = 0.6, VOID_WAVE_RANGE = 170, VOID_HUNGER_MS = 1500, CHRONO_DILATION = 0.4;
const TIMESTOP_MS = 2000, RIFT_R = 55, REWIND_SAMPLES = 16, REWIND_HASTE_MS = 4000;
const SING_R = 46, SING_MS = 3200, SING_PULL_R = 260, SING_BOOM = 4, SING_BOOM_R = 130;
const MINE_ARM = 500, MINE_LIFE = 20000, MINE_R = 64, MINE_TRIP = 20;

// ── MIND TOME ──
const MIND_LEGENDS = 3, MIND_TRAP_MAX = 6, MIND_TRAP_LIFE = 14000, MIND_BEAM_MS = 2600, MIND_BEAM_SPIN = 2.6, MIND_FREEZE_MS = 5000;
const MIND_CTL_MONSTER = 20000, MIND_CTL_BOSS = 5000, MIND_CTL_PLAYER = 5000, MIND_SHUFFLE_MS = 30000;
const PUPPET_DMG = 1.6, PUPPET_SPEED = 2.6;
// The traps a mind tome can set (warp runes, healing springs and the like would help the enemy).
const MIND_TRAPS = ['spike', 'mine', 'snare', 'fire', 'tesla', 'ice', 'saw', 'gravity', 'lava', 'root', 'keg', 'quake', 'poison'];

// Where to put a trap for an enemy: just in its path toward you, never on you.
function mindSpot(p, pKey, size, maxRange) {
  let foes = enemyTargets(pKey).filter(t => !t.controlledBy);
  const near = foes.filter(t => Math.hypot(cx(t) - cx(p), cy(t) - cy(p)) <= maxRange);
  if (near.length) foes = near;
  for (let tries = 0; tries < 10; tries++) {
    let x, y;
    if (foes.length) {
      const t = foes[Math.floor(Math.random() * foes.length)];
      const dx = cx(p) - cx(t), dy = cy(p) - cy(t), d = Math.hypot(dx, dy) || 1;
      const ahead = Math.min(40, Math.max(0, d - 40)) * (0.5 + Math.random() * 0.5);
      x = cx(t) + dx / d * ahead + (Math.random() - 0.5) * 22;
      y = cy(t) + dy / d * ahead + (Math.random() - 0.5) * 22;
    } else {
      const a = (p.facing === -1 ? Math.PI : 0) + (Math.random() - 0.5) * 1.4;
      x = cx(p) + Math.cos(a) * 90; y = cy(p) + Math.sin(a) * 90;
    }
    const at = arenaClamp(x, y, size / 2 + 4);
    if (Math.hypot(at.x - cx(p), at.y - cy(p)) < 34 + size / 2 && tries < 9) continue;   // not on top of you
    const box = { x: at.x - size / 2, y: at.y - size / 2, w: size, h: size };
    if (tries < 8 && overlapsAny(room.traps.filter(t => t.state === 'idle'), box, 2)) continue;   // nor on another trap
    return { x: at.x - size / 2, y: at.y - size / 2 };
  }
  return null;
}

function placeMindTrap(p, pKey, w, dmgMult) {
  const type = MIND_TRAPS[Math.floor(Math.random() * MIND_TRAPS.length)];
  const def = TRAP_TYPES[type];
  const at = mindSpot(p, pKey, def.size, w.range);
  if (!at) return;
  // Your oldest unsprung trap makes way once you have too many out.
  const mine = room.traps.filter(t => t.owner === pKey);
  if (mine.length >= MIND_TRAP_MAX) {
    const old = mine.find(t => t.state === 'idle') || mine[0];
    room.traps = room.traps.filter(t => t !== old);
  }
  const scale = (w.damage * dmgMult) / 30;
  room.traps.push({ id: nextId(), type, x: at.x, y: at.y, w: def.size, h: def.size, owner: pKey,
                    state: 'idle', armTimer: 0, fireTimer: 0, mode: def.mode, radius: def.radius,
                    damage: Math.max(def.damage ? 1 : 0, Math.round((def.damage || 0) * scale)),
                    effect: def.effect || null, dur: def.dur || 0, color: def.color, expire: MIND_TRAP_LIFE });
  const tx = at.x + def.size / 2, ty = at.y + def.size / 2;
  p.facing = tx < cx(p) ? -1 : 1;
  room.particles.push({ type: 'streak', x: cx(p), y: cy(p) - 4, x2: tx, y2: ty, timer: 260, max: 260, color: WEAPON_COLORS.mindtome });
  room.particles.push({ type: 'teleport', x: tx, y: ty, timer: 380, max: 380, color: WEAPON_COLORS.mindtome });
}

// The four spinning beams: anything they cross is frozen (bosses and players slowed).
function updateMindBeams(f, dt) {
  const o = room.players[f.owner];
  if (!o || o.dead) return false;
  f.x = cx(o); f.y = cy(o);
  f.a += MIND_BEAM_SPIN * dt / 1000;
  for (const t of enemyTargets(f.owner)) {
    const id = playerKeyOf(t) || t.id;
    if (f.hit.has(id)) continue;
    for (let i = 0; i < 4; i++) {
      const a = f.a + i * Math.PI / 2;
      if (distToSegment(cx(t), cy(t), f.x, f.y, f.x + Math.cos(a) * f.r, f.y + Math.sin(a) * f.r) > 8 + t.w / 2) continue;
      f.hit.add(id);
      if (playerKeyOf(t) && t.parryTimer > 0) { spawnParrySpark(cx(t), cy(t)); break; }
      if (!t.num) t.invincible = 0;
      applyDamage(t, f.dmg, f.owner);
      stagger(t, MIND_FREEZE_MS, 'mind');
      room.particles.push({ type: 'crit', x: cx(t), y: t.y - 6, text: 'MIND LOCK', timer: 600, max: 600 });
      break;
    }
  }
  return true;
}

// MIND CONTROL: take over the strongest enemy on the map.
function startMindControl(p, pKey) {
  let best = null;
  for (const t of enemyTargets(pKey)) {
    if (t.controlledBy || t.mindControlledBy || t.ally || t.abyss) continue;
    if (!best || t.hp > best.hp) best = t;
  }
  if (!best) return false;
  const isPlayer = !!best.num, isBoss = !!best.boss;
  const dur = isPlayer ? MIND_CTL_PLAYER : isBoss ? MIND_CTL_BOSS : MIND_CTL_MONSTER;
  p.controlling = { ref: best, isPlayer, left: dur, home: { x: p.x, y: p.y } };
  p.hidden = true;
  p.pull = null;
  if (isPlayer) best.mindControlledBy = pKey;
  else {   // ready to swing at once, with whatever it was doing dropped
    best.controlledBy = pKey; best.freeze = 0; best.windup = 0; best.wind = null; best.atkCooldown = 0;
    best.charge = null; best.sweep = null; best.dashes = null; best.dazed = 0; best.fuse = 0; best.raiseT = 0; best.raiseAt = null;
  }
  room.particles.push({ type: 'teleport', x: cx(p), y: cy(p), timer: 420, max: 420, color: WEAPON_COLORS.mindtome });
  room.particles.push({ type: 'streak', x: cx(p), y: cy(p), x2: cx(best), y2: cy(best), timer: 420, max: 420, color: WEAPON_COLORS.mindtome });
  room.particles.push({ type: 'trapburst', x: cx(best), y: cy(best), maxR: 40, timer: 800, max: 800, color: WEAPON_COLORS.mindtome, text: 'MIND CONTROL' });
  return true;
}

function endMindControl(p, pKey) {
  const c = p.controlling;
  if (!c) return;
  p.controlling = null;
  p.hidden = false;
  const t = c.ref;
  if (t) {
    if (c.isPlayer) { if (t.mindControlledBy === pKey) t.mindControlledBy = null; }
    else if (t.controlledBy === pKey) { t.controlledBy = null; t.pupRush = null; t.atkCooldown = Math.max(t.atkCooldown || 0, 600); }
    if (!t.dead) room.particles.push({ type: 'teleport', x: cx(t), y: cy(t), timer: 380, max: 380, color: '#ffffff' });
  }
  p.invincible = Math.max(p.invincible || 0, 1200);
  room.particles.push({ type: 'teleport', x: cx(p), y: cy(p), timer: 420, max: 420, color: WEAPON_COLORS.mindtome });
}

// Each tick while you are in someone's head.
function tickMindControl(p, key, dt, factor) {
  const c = p.controlling, t = c.ref;
  c.left -= dt;
  const gone = !t || t.dead || (!c.isPlayer && !room.monsters.includes(t));
  if (gone || c.left <= 0) { endMindControl(p, key); return; }
  if (c.isPlayer) return;   // a rival player moves on your keys in their own movement step
  const inp = room.inputs[key];
  c.spCd = Math.max(0, (c.spCd || 0) - dt);
  if (t.pupRush && !(t.freeze > 0)) {
    updatePuppetRush(t, key, factor, dt);
    if (!t.dead && room.monsters.includes(t)) { applyPull(t, dt); clampToArena(t); }
    return;
  }
  if (room.specialJustPressed[key] && c.spCd <= 0 && !(t.freeze > 0)) {
    c.spCd = puppetSpecial(t, key);
    if (t.dead || !room.monsters.includes(t)) return;   // it blew itself up
  }
  if (!(t.freeze > 0)) {
    const spd = Math.max(t.speed * 1.5, PUPPET_SPEED) * (t.slowTimer > 0 ? 0.5 : 1);
    let vx = 0, vy = 0;
    if (inp.left) vx = -1; if (inp.right) vx = 1;
    if (inp.up) vy = -1; if (inp.down) vy = 1;
    if (vx && vy) { vx *= 0.707; vy *= 0.707; }
    if (vx) t.face = vx > 0 ? 1 : -1;
    t.x += vx * spd * factor; t.y += vy * spd * factor;
  }
  applyPull(t, dt);
  clampToArena(t);
  if (t.atkCooldown > 0) t.atkCooldown -= dt;
  if (room.attackJustPressed[key] && !(t.atkCooldown > 0) && !(t.freeze > 0)) puppetAttack(t, key);
}

// Your foes as seen from the puppet (never the puppet itself), and the nearest.
function puppetFoes(m, pKey) { return enemyTargets(pKey).filter(o => o !== m); }
function nearestTo(m, list) {
  let best = null, bd = Infinity;
  for (const o of list) { const d = distBetween(o, m); if (d < bd) { bd = d; best = o; } }
  return best;
}
// One blow from the puppet: a player's parry shrugs it off.
function puppetHit(o, dmg, pKey) {
  if (playerKeyOf(o) && o.parryTimer > 0) { spawnParrySpark(cx(o), cy(o)); return false; }
  if (!o.num) o.invincible = 0;
  applyDamage(o, Math.max(1, Math.round(dmg)), pKey);
  return true;
}
function puppetShot(m, pKey, ang, dmg) {
  const def = MONSTER_TYPES[m.type] || {}, sp = def.shotSpeed || 4.4;
  room.projectiles.push({ id: nextId(), x: cx(m), y: cy(m), dx: Math.cos(ang) * sp, dy: Math.sin(ang) * sp,
    damage: Math.round(dmg), owner: pKey, ignore: m, traveled: 0, maxRange: Math.max(def.shotRange || 260, 300),
    weaponId: def.shotId || (m.mage ? 'hellfire' : 'spit'), burn: def.shotBurn || (m.mage ? 1500 : 0),
    isAoe: false, aoeRadius: 0, pierce: false, grapple: false, boomerang: false, returning: false, life: 0, hitTargets: null });
}
// A shockwave around the puppet: everything of yours in reach is hit and staggered.
function puppetSlam(m, pKey, r, dmg, stunMs, kind, color, text) {
  for (const o of puppetFoes(m, pKey)) {
    if (Math.hypot(cx(o) - cx(m), cy(o) - cy(m)) > r + o.w / 2) continue;
    if (puppetHit(o, dmg, pKey) && stunMs && !o.dead) stagger(o, stunMs, kind);
  }
  room.particles.push({ type: 'shockwave', x: cx(m), y: cy(m), maxR: r, timer: 420, max: 420, color });
  room.particles.push({ type: 'trapburst', x: cx(m), y: cy(m), maxR: Math.min(50, r), timer: 650, max: 650, color, text });
}

// What SPECIAL does while you're inside each monster: its own ability, turned
// on its own side. The name is shown on your SPECIAL button.
const PUPPET_ABILITY = {
  bomber: 'DETONATE', shaman: 'MEND', charger: 'CHARGE', necromancer: 'RAISE DEAD', splitter: 'SPLIT',
  light: 'FLASH CHAIN', wraith: 'BLINK', spitter: 'VOLLEY', infernal: 'FIRESTORM', runner: 'DASH',
  giant: 'STOMP', portalmage: 'FIRE RING',
};
const puppetAbilityName = m => PUPPET_ABILITY[m.type] || 'SLAM';

// Returns the cooldown before it can be used again.
function puppetSpecial(m, pKey) {
  const def = MONSTER_TYPES[m.type] || {};
  const base = m.atkDamage * PUPPET_DMG;
  const best = nearestTo(m, puppetFoes(m, pKey));
  const aim = best ? angleTo(m, best) : (m.face < 0 ? Math.PI : 0);
  m.face = Math.cos(aim) < 0 ? -1 : 1;
  m.swing = MONSTER_SWING_MS;
  const rush = (o) => { m.pupRush = { a: aim, hit: new Set(), wait: 0, ...o, left: o.dist }; };
  switch (m.type) {
    case 'bomber': {
      // The fuse is lit at once: it goes up on your enemies (and takes itself with it).
      const r = BOMB_R * 1.3;
      for (const o of puppetFoes(m, pKey)) if (Math.hypot(cx(o) - cx(m), cy(o) - cy(m)) <= r + o.w / 2) puppetHit(o, base * BOMB_MULT, pKey);
      room.particles.push({ type: 'shockwave', x: cx(m), y: cy(m), maxR: r, timer: 450, max: 450, color: '#ffb030' });
      room.particles.push({ type: 'trapburst', x: cx(m), y: cy(m), maxR: r, timer: 650, max: 650, color: '#ff6a1a', text: 'BOOM!' });
      removeMonster(m);
      return 0;
    }
    case 'shaman': {
      // Heals you (and your partner in co-op) and the puppet.
      for (const k of KEYS) {
        const pl = room.players[k];
        if (!pl || pl.dead || (k !== pKey && enemyTargets(pKey).includes(pl))) continue;
        const heal = Math.round(pl.maxHp * 0.25);
        pl.hp = Math.min(pl.maxHp, pl.hp + heal);
        room.particles.push({ type: 'xp', x: cx(pl), y: pl.y, text: '+' + heal, timer: 700, color: '#5aff9a' });
      }
      m.hp = Math.min(m.maxHp, m.hp + Math.round(m.maxHp * 0.25));
      m.ward = SHAMAN_WARD_MS;
      room.particles.push({ type: 'shockwave', x: cx(m), y: cy(m), maxR: SHAMAN_R, timer: 600, max: 600, color: '#5aff9a' });
      room.particles.push({ type: 'trapburst', x: cx(m), y: cy(m), maxR: 34, timer: 650, max: 650, color: '#5aff9a', text: 'MEND' });
      return 4500;
    }
    case 'charger':
      rush({ dist: CHARGE_DIST, speed: CHARGE_SPEED, mult: CHARGE_MULT, knock: CHARGE_KNOCK, n: 1, turn: 0 });
      return 3000;
    case 'light':
      rush({ dist: LIGHT_DASH_DIST, speed: LIGHT_DASH_SPEED, mult: LIGHT_DASH_MULT, knock: LIGHT_KNOCK, n: 3, turn: LIGHT_TURN });
      return 4000;
    case 'runner':
      rush({ dist: 200, speed: 8, mult: 1.2, knock: 12, n: 1, turn: 0 });
      return 2000;
    case 'necromancer':
    case 'splitter': {
      const type = m.type === 'splitter' ? 'slimelet' : 'skeleton';
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2;
        const at = arenaClamp(cx(m) + Math.cos(a) * 30, cy(m) + Math.sin(a) * 30, 12);
        spawnAlly(pKey, at.x, at.y, base * 1.4, { type, force: true, life: 12000 });
        room.particles.push({ type: 'teleport', x: at.x, y: at.y, timer: 380, max: 380, color: def.color || '#9aff7a' });
      }
      room.particles.push({ type: 'trapburst', x: cx(m), y: cy(m), maxR: 34, timer: 650, max: 650, color: def.color || '#9aff7a', text: puppetAbilityName(m) });
      return m.type === 'splitter' ? 6000 : 5000;
    }
    case 'wraith': {
      if (!best) return 400;
      room.particles.push({ type: 'teleport', x: cx(m), y: cy(m), timer: 340, max: 340, color: '#8a6aff' });
      const a = angleTo(best, m);
      m.x = cx(best) + Math.cos(a) * 30 - m.w / 2; m.y = cy(best) + Math.sin(a) * 30 - m.h / 2;
      clampToArena(m);
      room.particles.push({ type: 'teleport', x: cx(m), y: cy(m), timer: 340, max: 340, color: '#c8b8ff' });
      m.face = cx(best) < cx(m) ? -1 : 1;
      puppetHit(best, base * 1.6, pKey);
      return 2500;
    }
    case 'spitter':
    case 'infernal':
      for (let i = -2; i <= 2; i++) puppetShot(m, pKey, aim + i * 0.18, base);
      return 2500;
    case 'portalmage':
      for (let i = 0; i < 10; i++) puppetShot(m, pKey, aim + i * Math.PI / 5, base);
      return 3500;
    case 'giant':
      puppetSlam(m, pKey, 125, base * 1.6, 1200, 'quake', '#c8e07a', 'STOMP');
      return 4000;
    default:
      puppetSlam(m, pKey, 70 + m.w * 0.5, base * 1.8, 600, 'stun', def.color || '#ffffff', 'SLAM');
      return 3000;
  }
}

// A puppet's charge (or chain of them): runs along its angle, curving after the
// nearest foe if it can turn, hitting each foe once per run.
function updatePuppetRush(m, pKey, factor, dt) {
  const r = m.pupRush;
  if (r.wait > 0) { r.wait -= dt; return; }
  const foes = puppetFoes(m, pKey);
  const tgt = nearestTo(m, foes);
  if (r.turn && tgt) r.a = turnToward(r.a, angleTo(m, tgt), r.turn * dt / 1000);
  m.face = Math.cos(r.a) < 0 ? -1 : 1;
  const step = r.speed * factor, ox = m.x, oy = m.y;
  m.x += Math.cos(r.a) * step; m.y += Math.sin(r.a) * step; r.left -= step;
  clampToArena(m);
  for (const o of foes) {
    if (r.hit.has(o) || Math.hypot(cx(o) - cx(m), cy(o) - cy(m)) > (m.w + o.w) / 2 + 6) continue;
    r.hit.add(o);
    if (puppetHit(o, m.atkDamage * PUPPET_DMG * r.mult, pKey) && !o.dead && !o.boss) {
      o.x += Math.cos(r.a) * r.knock; o.y += Math.sin(r.a) * r.knock;
      clampToArena(o);
    }
  }
  const wall = Math.hypot(m.x - ox, m.y - oy) < step * 0.5;
  if (wall || r.left <= 0) {
    if (--r.n > 0) {
      r.left = r.dist; r.hit = new Set(); r.wait = LIGHT_DASH_GAP;
      if (tgt) r.a = angleTo(m, tgt);
    } else m.pupRush = null;
  }
}

// The puppet uses its own attack — on its own side.
function puppetAttack(m, pKey) {
  const def = MONSTER_TYPES[m.type] || {};
  const foes = puppetFoes(m, pKey);
  const best = nearestTo(m, foes);
  m.swing = MONSTER_SWING_MS;
  const dmg = Math.round(m.atkDamage * PUPPET_DMG);
  if (def.ranged || m.mage) {
    m.atkCooldown = Math.round((def.reload || 1400) * 0.6);
    if (!best) return;
    const ang = angleTo(m, best);
    m.face = Math.cos(ang) < 0 ? -1 : 1;
    puppetShot(m, pKey, ang, dmg);
    return;
  }
  if (m.type === 'light') {
    // Light's blade sweep: a short lunge and a wide cut around him.
    if (best) {
      const a = angleTo(m, best);
      m.x += Math.cos(a) * 28; m.y += Math.sin(a) * 28; clampToArena(m);
      m.face = Math.cos(a) < 0 ? -1 : 1;
    }
    for (const o of foes) {
      if (Math.hypot(cx(o) - cx(m), cy(o) - cy(m)) <= LIGHT_SWEEP_R + 10 + o.w / 2) puppetHit(o, dmg * LIGHT_SWEEP_MULT, pKey);
    }
    room.particles.push({ type: 'shockwave', x: cx(m), y: cy(m), maxR: LIGHT_SWEEP_R + 10, timer: 260, max: 260, color: '#fff6a0' });
    m.atkCooldown = 700;
    return;
  }
  m.atkCooldown = m.boss ? 900 : 650;
  const reach = m.atkRange + (m.boss ? 40 : 18);
  if (best) m.face = cx(best) < cx(m) ? -1 : 1;
  for (const o of foes) {
    if (distBetween(o, m) > reach + (o.w + o.h) / 4) continue;
    if (playerKeyOf(o) && o.parryTimer > 0) { spawnParrySpark(cx(o), cy(o)); continue; }
    o.invincible = 0;
    applyDamage(o, dmg, pKey);
  }
  if (m.boss) room.particles.push({ type: 'shockwave', x: cx(m), y: cy(m), maxR: reach, timer: 300, max: 300, color: '#c8e07a' });
}

// ── Light Blade ──
// Every dash is a short sprint: the player is carried along an angle (curving
// toward a target for the special), hitting each foe once per leg.
const BLADE_DASH_MAX = 240, BLADE_DASH_SPEED = 15, BLADE_PATH_SHARE = 0.5, BLADE_CLICK_MS = 400;
const BLADE_SP_DASHES = 5, BLADE_SP_SPEED = 13, BLADE_SP_TURN = 9, BLADE_SP_GAP = 110, BLADE_SP_STUN = 1500, BLADE_HURL_SPEED = 1.3;
const LIGHTSPEED_MS = 8000, LIGHTSPEED_MULT = 3, LIGHTSPEED_AURA_R = 80, LIGHTSPEED_TICK = 200, LIGHTSPEED_AURA_DMG = 18;
const LIGHT_CRASH_R = 140, LIGHT_CRASH_STUN = 2000, LIGHT_CRASH_CD = 1200, LIGHT_CRASH_KNOCK = 140, LIGHT_CRASH_PVP = 70;
const AFTERGLOW_MS = 2500, AFTERGLOW_TICK = 450, AFTERGLOW_SHARE = 0.4, AFTERGLOW_STUN = 400;
const LIGHT_KILLS_NEED = 3, LIGHT_MAXED_SHARE = 0.75;

// Where the special heads: the nearest foe it hasn't struck yet (then any foe),
// else the nearest pickup on the floor.
function bladeAim(p, pKey, struck) {
  let f = null, fd = Infinity;
  for (const t of enemyTargets(pKey)) {
    if (struck && struck.has(t)) continue;
    const d = Math.hypot(cx(t) - cx(p), cy(t) - cy(p));
    if (d < fd) { fd = d; f = t; }
  }
  if (!f) f = nearestFoe(p, pKey);
  if (f) return { x: cx(f), y: cy(f), foe: f };
  let best = null, bd = Infinity;
  for (const it of room.items) {
    const ix = it.x + it.w / 2, iy = it.y + it.h / 2, d = Math.hypot(ix - cx(p), iy - cy(p));
    if (d < bd) { bd = d; best = { x: ix, y: iy, item: true }; }
  }
  return best;
}
// A leg runs to a pickup and stops on it, or runs through a foe and a bit past.
function bladeLegDist(p, tgt, range) {
  if (!tgt) return range;
  const d = Math.hypot(tgt.x - cx(p), tgt.y - cy(p));
  return tgt.item ? Math.min(range, d + 2) : Math.min(range * 1.6, Math.max(range * 0.5, d + 50));
}
function startBladeDash(p, o) {
  p.bladeDash = { ...o, left: o.dist, hit: new Set(), struck: new Set(), wait: 0, sx: cx(p), sy: cy(p) };
  p.pull = null;
}

// ATK: dash to the click / tap (or the mouse, or the nearest foe) and swipe all round.
function bladeAttack(p, pKey, w, dmgMult) {
  const inp = room.inputs[pKey] || {};
  let tx, ty;
  if (p.bladeClick) { tx = p.bladeClick.x; ty = p.bladeClick.y; }
  else if (inp.aimX != null && inp.aimY != null) { tx = inp.aimX; ty = inp.aimY; }
  else {
    const f = nearestFoe(p, pKey);
    if (f) { tx = cx(f); ty = cy(f); } else { tx = cx(p) + (p.facing || 1) * BLADE_DASH_MAX; ty = cy(p); }
  }
  p.bladeClick = null;
  const a = Math.atan2(ty - cy(p), tx - cx(p));
  p.facing = Math.cos(a) < 0 ? -1 : 1;
  startBladeDash(p, { kind: 'atk', a, dist: Math.min(BLADE_DASH_MAX, Math.hypot(tx - cx(p), ty - cy(p))), speed: BLADE_DASH_SPEED,
                      n: 1, turn: 0, dmg: Math.round(w.damage * dmgMult * BLADE_PATH_SHARE),
                      swipe: Math.round(w.damage * dmgMult), swipeR: w.range });
}

// Fling a foe along `a` until it hits the wall (bosses don't budge).
function hurlToWall(t, a) {
  if (t.boss) return;
  const c = Math.cos(a), s = Math.sin(a);
  const lim = [];
  if (c > 0.01)  lim.push((ARENA_X + ARENA_W - t.w - 2 - t.x) / c);
  if (c < -0.01) lim.push((ARENA_X + 2 - t.x) / c);
  if (s > 0.01)  lim.push((ARENA_Y + ARENA_H - t.h - 2 - t.y) / s);
  if (s < -0.01) lim.push((ARENA_Y + 2 - t.y) / s);
  const dist = Math.max(0, Math.min(...lim));
  if (dist < 4) return;
  const ms = Math.max(120, dist / BLADE_HURL_SPEED);
  t.hurl = { vx: c * dist / ms, vy: s * dist / ms, timer: ms };
}
// Flights in progress: they carry on even while the target is stunned.
function updateHurls(dt) {
  for (const t of [...allPlayers(), ...room.monsters]) {
    if (!t || !t.hurl) continue;
    if (t.dead) { t.hurl = null; continue; }
    const step = Math.min(dt, t.hurl.timer);
    t.x += t.hurl.vx * step; t.y += t.hurl.vy * step;
    t.hurl.timer -= dt;
    clampToArena(t, 2);
    if (t.hurl.timer <= 0) {
      t.hurl = null;
      room.particles.push({ type: 'shockwave', x: cx(t), y: cy(t), maxR: 22, timer: 300, max: 300, color: WEAPON_COLORS.lightblade });
    }
  }
}

function updateBladeDash(p, key, factor, dt) {
  const b = p.bladeDash;
  if (b.wait > 0) { b.wait -= dt; return; }
  if (b.turn) {
    // Chase this leg's quarry (it may be on its way to the wall); once it's
    // been struck, run on straight.
    const q = b.quarry && !b.quarry.dead && !b.hit.has(b.quarry) ? b.quarry : null;
    if (q) b.a = turnToward(b.a, Math.atan2(cy(q) - cy(p), cx(q) - cx(p)), b.turn * dt / 1000);
    else if (!b.quarry && !b.hit.size) {
      const tgt = bladeAim(p, key, b.struck);
      if (tgt && tgt.item) b.a = turnToward(b.a, Math.atan2(tgt.y - cy(p), tgt.x - cx(p)), b.turn * dt / 1000);
    }
  }
  const step = Math.min(b.left, b.speed * factor), ox = p.x, oy = p.y;
  p.x += Math.cos(b.a) * step; p.y += Math.sin(b.a) * step; b.left -= step;
  clampToArena(p, 2);
  p.facing = Math.cos(b.a) < 0 ? -1 : 1;
  p.invincible = Math.max(p.invincible || 0, 100);
  for (const t of enemyTargets(key)) {
    if (b.hit.has(t) || Math.hypot(cx(t) - cx(p), cy(t) - cy(p)) > (t.w + p.w) / 2 + 4) continue;
    b.hit.add(t); b.struck.add(t);
    if (!t.num) t.invincible = 0;
    strikeTarget(t, b.dmg, key);
    if (b.kind === 'sp' && !t.dead) { stagger(t, BLADE_SP_STUN, 'shock'); hurlToWall(t, b.a); }
  }
  if (b.left <= 0.5 || Math.hypot(p.x - ox, p.y - oy) < step * 0.5) endBladeLeg(p, key, b);
}

function endBladeLeg(p, key, b) {
  if (p.passive === 'lightblade') {                                   // AFTERGLOW
    const len = Math.hypot(cx(p) - b.sx, cy(p) - b.sy);
    if (len > 8) room.fires.push({ id: nextId(), kind: 'lightstreak', owner: key, x: b.sx, y: b.sy, a: Math.atan2(cy(p) - b.sy, cx(p) - b.sx),
                                   v: len, r: 6, t: 0, life: AFTERGLOW_MS, dmg: Math.max(1, Math.round(weapon(p).damage * AFTERGLOW_SHARE)), hitAt: new Map() });
  }
  if (b.kind === 'atk') {
    for (const t of enemyTargets(key)) {
      if (Math.hypot(cx(t) - cx(p), cy(t) - cy(p)) > b.swipeR + t.w / 2) continue;
      if (!t.num) t.invincible = 0;
      strikeTarget(t, b.swipe, key);
    }
    p.swingTimer = 200;
    room.particles.push({ type: 'bladeswipe', x: cx(p), y: cy(p), r: b.swipeR, a: b.a, timer: 280, max: 280, color: WEAPON_COLORS.lightblade });
  }
  if (--b.n > 0) {
    const tgt = bladeAim(p, key, b.struck);
    if (tgt) b.a = Math.atan2(tgt.y - cy(p), tgt.x - cx(p));
    b.quarry = tgt && tgt.foe || null;
    b.dist = bladeLegDist(p, tgt, b.range);
    b.left = b.dist; b.hit = new Set(); b.wait = BLADE_SP_GAP; b.sx = cx(p); b.sy = cy(p);
  } else p.bladeDash = null;
}

// AFTERGLOW: a streak of light that burns and stuns whoever crosses it.
function updateLightStreak(f) {
  const x2 = f.x + Math.cos(f.a) * f.v, y2 = f.y + Math.sin(f.a) * f.v;
  for (const t of enemyTargets(f.owner)) {
    if (distToSegment(cx(t), cy(t), f.x, f.y, x2, y2) > 6 + t.w / 2) continue;
    if ((f.hitAt.get(t) ?? -1e9) + AFTERGLOW_TICK > f.t) continue;
    f.hitAt.set(t, f.t);
    if (!t.num) t.invincible = 0;
    applyDamage(t, f.dmg, f.owner);
    if (!t.dead) stagger(t, AFTERGLOW_STUN, 'shock');
  }
  return true;
}

// SUPER: LIGHTSPEED. Triple speed, an aura that zaps whatever comes close, and
// crashing into a foe sets off a huge lightning blast.
function lightspeedTick(p, key, dt) {
  if (weapon(p).id !== 'lightblade') { p.lightspeed = 0; return; }
  p.lightspeed -= dt;
  p.crashCd = (p.crashCd || 0) - dt;
  p.lsAcc = (p.lsAcc || 0) + dt;
  if (p.lsAcc >= LIGHTSPEED_TICK) {
    p.lsAcc -= LIGHTSPEED_TICK;
    for (const t of enemyTargets(key)) {
      if (Math.hypot(cx(t) - cx(p), cy(t) - cy(p)) > LIGHTSPEED_AURA_R + t.w / 2) continue;
      room.particles.push({ type: 'bolt', x: cx(p), y: cy(p), x2: cx(t), y2: cy(t), timer: 180, max: 180,
                            color: Math.random() < 0.5 ? '#ffffff' : WEAPON_COLORS.lightblade });
      if (!t.num) t.invincible = 0;
      const dmg = t.num ? 6 : LIGHTSPEED_AURA_DMG + Math.round((t.maxHp || 0) * (t.boss ? 0.002 : 0.012));
      strikeTarget(t, Math.round(dmg * (p.lsMult || 1)), key);
    }
  }
  if (p.crashCd <= 0) {
    const hit = enemyTargets(key).find(t => Math.abs(cx(t) - cx(p)) < (t.w + p.w) / 2 + 3 && Math.abs(cy(t) - cy(p)) < (t.h + p.h) / 2 + 3);
    if (hit) { p.crashCd = LIGHT_CRASH_CD; lightCrash(p, key); }
  }
  if (p.lightspeed <= 0) p.lightspeed = 0;
}

function lightCrash(p, key) {
  const x = cx(p), y = cy(p), su = weapon(p).super, mult = p.lsMult || 1;
  for (const t of enemyTargets(key)) {
    const d = Math.hypot(cx(t) - x, cy(t) - y);
    if (d > LIGHT_CRASH_R + t.w / 2) continue;
    if (!t.num) t.invincible = 0;
    const dmg = t.num ? LIGHT_CRASH_PVP : su.dmg + Math.round((t.maxHp || 0) * (t.boss ? 0.03 : 0.2));
    strikeTarget(t, Math.round(dmg * mult), key);
    if (t.dead) continue;
    stagger(t, LIGHT_CRASH_STUN, 'shock');
    if (!t.boss) {
      const a = Math.atan2(cy(t) - y, cx(t) - x) || Math.random() * Math.PI * 2;
      t.hurl = { vx: Math.cos(a) * LIGHT_CRASH_KNOCK / 220, vy: Math.sin(a) * LIGHT_CRASH_KNOCK / 220, timer: 220 };
    }
    room.particles.push({ type: 'bolt', x, y, x2: cx(t), y2: cy(t), timer: 400, max: 400, color: '#ffffff' });
  }
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5 + Math.random() * 0.4, r = LIGHT_CRASH_R * (0.6 + Math.random() * 0.4);
    room.particles.push({ type: 'bolt', x, y, x2: x + Math.cos(a) * r, y2: y + Math.sin(a) * r, timer: 420, max: 420,
                          color: i % 2 ? '#ffffff' : WEAPON_COLORS.lightblade });
  }
  room.particles.push({ type: 'shockwave', x, y, maxR: LIGHT_CRASH_R, timer: 600, max: 600, color: WEAPON_COLORS.lightblade });
  room.particles.push({ type: 'shockwave', x, y, maxR: LIGHT_CRASH_R * 0.6, timer: 450, max: 450, color: '#ffffff' });
  room.particles.push({ type: 'trapburst', x, y, maxR: 60, timer: 800, max: 800, color: WEAPON_COLORS.lightblade, text: 'LIGHTNING CRASH' });
}

// How many weapons (not counting the Light Blade) a save has fully maxed.
function maxedWeaponCount(weapons, upgrades) {
  return WEAPONS.filter(w => w.id !== 'lightblade' && weapons.includes(w.id)
    && upgradesFor(w.id).every(k => ((upgrades?.[w.id] || {})[k] || 0) >= UPGRADE_STATS[k].max)).length;
}
const lightMaxedNeed = () => Math.ceil(WEAPONS.filter(w => w.id !== 'lightblade').length * LIGHT_MAXED_SHARE);

// Beating Light counts toward the Light Blade, for every player in the run.
function creditLightKill() {
  if (room.gameMode === 'sandbox') return;
  const d = progress();
  for (const k of KEYS) {
    const pw = room.passwords[k];
    if (!room.players[k] || !pw || isAdminPw(pw)) continue;
    d.lightKills[pw] = (d.lightKills[pw] || 0) + 1;
    markDirty();
    const p = room.players[k];
    room.particles.push({ type: 'newtype', x: CANVAS_W / 2, y: CANVAS_H / 2 + 26 + KEYS.indexOf(k) * 16,
                          text: `LIGHT DEFEATED ${Math.min(d.lightKills[pw], LIGHT_KILLS_NEED)}/${LIGHT_KILLS_NEED}`,
                          color: '#fff6a0', timer: 2600, max: 2600 });
    if (p) room.particles.push({ type: 'teleport', x: cx(p), y: cy(p), timer: 500, max: 500, color: '#fff6a0' });
  }
}

// SHIFTING GROUND: every trap on the map jumps next to your enemies.
function shuffleTraps(p, pKey) {
  let moved = 0;
  for (const tr of room.traps) {
    if (tr.state !== 'idle') continue;
    const at = mindSpot(p, pKey, tr.w, 9999);
    if (!at) continue;
    room.particles.push({ type: 'teleport', x: tr.x + tr.w / 2, y: tr.y + tr.h / 2, timer: 380, max: 380, color: WEAPON_COLORS.mindtome });
    tr.x = at.x; tr.y = at.y;
    room.particles.push({ type: 'teleport', x: tr.x + tr.w / 2, y: tr.y + tr.h / 2, timer: 380, max: 380, color: '#ffffff' });
    moved++;
  }
  room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p) - 10, maxR: 40, timer: 800, max: 800, color: WEAPON_COLORS.mindtome,
                        text: moved ? 'TRAPS SHIFTED' : 'SHIFT' });
}

// The singularity's end: one big blast where it stood.
function collapseSingularity(f) {
  for (const t of enemyTargets(f.owner)) {
    if (Math.hypot(cx(t) - f.x, cy(t) - f.y) > f.boomR + t.w / 2) continue;
    if (!t.num) t.invincible = 0;
    applyDamage(t, f.boom + Math.round(t.num ? 0 : (t.maxHp || 0) * (t.boss ? 0.01 : 0.08)), f.owner);
  }
  room.particles.push({ type: 'shockwave', x: f.x, y: f.y, maxR: f.boomR, timer: 600, max: 600, color: WEAPON_COLORS.voidblade });
  room.particles.push({ type: 'trapburst', x: f.x, y: f.y, maxR: f.boomR, timer: 700, max: 700, color: '#d8b8ff', text: 'COLLAPSE' });
}

// A player's landmine: armed after MINE_ARM, it blows when a foe comes close.
function updatePlayerMine(f) {
  if (f.t < MINE_ARM) return true;
  const trip = enemyTargets(f.owner).some(t => Math.hypot(cx(t) - f.x, cy(t) - f.y) <= MINE_TRIP + t.w / 2);
  if (!trip) return true;
  for (const t of enemyTargets(f.owner)) {
    if (Math.hypot(cx(t) - f.x, cy(t) - f.y) > MINE_R + t.w / 2) continue;
    if (!t.num) t.invincible = 0;
    applyDamage(t, abDmg(t, f.dmg, 0.05, 1), f.owner);
  }
  room.particles.push({ type: 'shockwave', x: f.x, y: f.y, maxR: MINE_R, timer: 450, max: 450, color: ABILITY_BY_ID.mines.color });
  room.particles.push({ type: 'trapburst', x: f.x, y: f.y, maxR: MINE_R, timer: 500, max: 500, color: '#ffb030', text: 'BOOM' });
  return false;
}

// Using one of the new items. Returns false for items handled the old way.
function useItemEffect(p, key, def) {
  const m = hasEffect(p, 'strength') ? 1.8 : 1;
  if (def.effect === 'zap') {
    const foes = enemyTargets(key)
      .map(t => ({ t, d: Math.hypot(cx(t) - cx(p), cy(t) - cy(p)) }))
      .filter(o => o.d <= def.radius).sort((a, b) => a.d - b.d).slice(0, def.count);
    for (const { t } of foes) {
      room.particles.push({ type: 'bolt', x: cx(p), y: cy(p), x2: cx(t), y2: cy(t), timer: 320, max: 320, color: def.color });
      strikeTarget(t, abDmg(t, def.amount, 0.04, m), key);
    }
    return true;
  }
  if (def.effect === 'turret') {
    const at = arenaClamp(cx(p) + (p.facing || 1) * 30, cy(p) - 10, 18);
    openFirePortal(key, at.x, at.y, Math.round(30 * m), 0, [400, 1000, 1600, 2200, 2800, 3400, 4000, 4600, 5200, 5800], { r: 16, aoe: 22 });
    return true;
  }
  if (def.effect === 'egg') {
    for (let i = 0; i < 2; i++) {
      const at = arenaClamp(cx(p) + (i ? 30 : -30), cy(p) + 10, 16);
      spawnAlly(key, at.x, at.y, Math.round(34 * m), { type: i ? 'brute' : 'wraith', hp: 260, life: 12000, force: true });
      room.particles.push({ type: 'teleport', x: at.x, y: at.y, timer: 380, max: 380, color: def.color });
    }
    return true;
  }
  if (def.effect === 'frenzy') {
    for (const e of ['speed', 'strength', 'haste']) applyEffect(p, e, def.dur);
    return true;
  }
  if (def.effect === 'hourglass') {
    for (const t of enemyTargets(key)) {
      if (t.num) chillTarget(t, 2500);
      else chillTarget(t, def.dur, 'time');
    }
    room.particles.push({ type: 'shockwave', x: cx(p), y: cy(p), maxR: 400, timer: 800, max: 800, color: def.color });
    return true;
  }
  if (def.effect === 'elixir') {
    p.hp = p.maxHp;
    if (p.effects) for (const k of ['burn', 'poison', 'slow', 'root', 'confuse', 'silence']) delete p.effects[k];
    room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p), maxR: 36, timer: 700, max: 700, color: def.color, text: 'FULL HEAL' });
    return true;
  }
  if (['thorns', 'vanish', 'ironskin', 'gold'].includes(def.effect)) {
    applyEffect(p, def.effect, def.dur);
    return true;
  }
  return false;
}

const ABILITY_FNS = {
  perfectguard(p, pKey, ab) {
    p.parryTimer = Math.max(p.parryTimer || 0, 2500);
    spawnParrySpark(cx(p), cy(p));
    abBurst(p, ab, 'PERFECT GUARD');
  },
  haven(p, pKey, ab) {
    const to = safestSpot(p, pKey);
    if (!to) return false;
    room.particles.push({ type: 'teleport', x: cx(p), y: cy(p), timer: 380, max: 380, color: ab.color });
    p.x = to.x - p.w / 2; p.y = to.y - p.h / 2;
    clampToArena(p, 2);
    p.pull = null;
    p.invincible = Math.max(p.invincible || 0, 600);
    p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.15));
    room.particles.push({ type: 'teleport', x: cx(p), y: cy(p), timer: 380, max: 380, color: '#ffffff' });
    abBurst(p, ab, 'SAFE HAVEN');
  },
  flurry(p, pKey, ab, m) {
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      room.projectiles.push({ id: nextId(), x: cx(p), y: cy(p), dx: Math.cos(a) * 6, dy: Math.sin(a) * 6,
        damage: Math.round(30 * m), owner: pKey, traveled: 0, maxRange: 230, weaponId: 'shuriken',
        isAoe: false, aoeRadius: 0, pierce: true, grapple: false, boomerang: false, returning: false, life: 0, hitTargets: new Set() });
    }
    abBurst(p, ab, 'BLADE FLURRY');
  },
  mines(p, pKey, ab, m) {
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3 + Math.random() * 0.5;
      const at = arenaClamp(cx(p) + Math.cos(a) * 34, cy(p) + Math.sin(a) * 34, 8);
      room.fires.push({ id: nextId(), kind: 'mine', owner: pKey, x: at.x, y: at.y, r: 7, t: 0, life: MINE_LIFE, dmg: Math.round(60 * m) });
    }
    abBurst(p, ab, 'LANDMINES');
  },
  soulchain(p, pKey, ab, m) {
    const t = nearestFoe(p, pKey, 380);
    if (!t) return false;
    room.particles.push({ type: 'streak', x: cx(p), y: cy(p), x2: cx(t), y2: cy(t), timer: 400, max: 400, color: ab.color });
    strikeTarget(t, abDmg(t, 30, 0.03, m), pKey);
    if (!t.boss) startPull(t, pKey);
    stagger(t, 1400, 'chain');
  },
  warcry(p, pKey, ab, m) {
    applyEffect(p, 'strength', 5000);
    for (const t of enemyTargets(pKey)) {
      if (Math.hypot(cx(t) - cx(p), cy(t) - cy(p)) <= 160 + t.w / 2) stagger(t, 1000, 'stun');
    }
    room.particles.push({ type: 'shockwave', x: cx(p), y: cy(p), maxR: 160, timer: 500, max: 500, color: ab.color });
    abBurst(p, ab, 'WAR CRY');
  },
  overcharge(p, pKey, ab) {
    if (!(p.specialCooldown > 0) && !(p.superCooldown > 0)) return false;   // nothing to recharge
    p.specialCooldown = 0; p.superCooldown = 0;
    abBurst(p, ab, 'OVERCHARGE');
  },
  fireball(p, pKey, ab, m) {
    const a = nearestTargetAngle(p, pKey);
    p.facing = Math.cos(a) < 0 ? -1 : 1;
    room.projectiles.push({ id: nextId(), x: cx(p), y: cy(p), dx: Math.cos(a) * 5, dy: Math.sin(a) * 5,
      damage: Math.round(70 * m), owner: pKey, traveled: 0, maxRange: 380, weaponId: 'fireball',
      isAoe: true, aoeRadius: 62, pierce: false, grapple: false, boomerang: false, returning: false, life: 0, hitTargets: null, burn: 2500 });
    abBurst(p, ab, 'FIREBALL');
  },
  smite(p, pKey, ab, m) {
    let best = null;
    for (const t of enemyTargets(pKey)) {
      if (Math.hypot(cx(t) - cx(p), cy(t) - cy(p)) > 320) continue;
      if (!best || t.hp > best.hp) best = t;
    }
    if (!best) return false;
    room.particles.push({ type: 'bolt', x: cx(best), y: ARENA_Y + 2, x2: cx(best), y2: cy(best), timer: 450, max: 450, color: ab.color });
    room.particles.push({ type: 'shockwave', x: cx(best), y: cy(best), maxR: 40, timer: 450, max: 450, color: ab.color });
    if (!best.num) best.invincible = 0;
    applyDamage(best, abDmg(best, 110, 0.12, m), pKey);
    stagger(best, 600, 'holy');
  },
  frostarmor(p, pKey, ab) {
    applyEffect(p, 'frostarmor', 6000);
    abBurst(p, ab, 'FROST ARMOR');
  },
  shadowstep(p, pKey, ab, m) {
    const t = nearestFoe(p, pKey, 420);
    if (!t) return false;
    const from = { x: cx(p), y: cy(p) };
    const dx = cx(t) - from.x, dy = cy(t) - from.y, d = Math.hypot(dx, dy) || 1;
    const back = t.w / 2 + p.w / 2 + 8;
    p.x = cx(t) + dx / d * back - p.w / 2; p.y = cy(t) + dy / d * back - p.h / 2;
    clampToArena(p, 2);
    p.pull = null; p.facing = dx > 0 ? -1 : 1;
    p.invincible = Math.max(p.invincible, 300);
    room.particles.push({ type: 'teleport', x: from.x, y: from.y, timer: 340, max: 340, color: ab.color });
    room.particles.push({ type: 'teleport', x: cx(p), y: cy(p), timer: 340, max: 340, color: '#ffffff' });
    strikeTarget(t, abDmg(t, 70, 0.06, m), pKey);
    room.particles.push({ type: 'crit', x: cx(t), y: t.y - 4, text: 'BACKSTAB', timer: 600, max: 600 });
  },
  quake(p, pKey, ab, m) {
    for (const t of enemyTargets(pKey)) {
      if (Math.hypot(cx(t) - cx(p), cy(t) - cy(p)) > QUAKE_R + t.w / 2) continue;
      applyDamage(t, abDmg(t, 55, 0.04, m), pKey);
      stagger(t, 1000, 'quake');
    }
    room.particles.push({ type: 'shockwave', x: cx(p), y: cy(p), maxR: QUAKE_R, timer: 480, max: 480, color: ab.color });
    room.particles.push({ type: 'shockwave', x: cx(p), y: cy(p), maxR: QUAKE_R * 0.6, timer: 360, max: 360, color: '#7a5a30' });
    abBurst(p, ab, 'EARTHQUAKE');
  },
  firenova(p, pKey, ab, m) {
    room.fires.push({ id: nextId(), kind: 'ring', owner: pKey, x: cx(p), y: cy(p), r: 6, maxR: NOVA_R,
                      t: 0, life: 900, dmg: Math.round(60 * m), hit: new Set() });
    abBurst(p, ab, 'FIRE NOVA');
  },
  chain(p, pKey, ab, m) {
    let t = nearestFoe(p, pKey, 320);
    if (!t) return false;
    const hit = new Set();
    let from = { x: cx(p), y: cy(p) }, k = 1;
    for (let i = 0; i < CHAIN_JUMPS && t; i++) {
      hit.add(t);
      room.particles.push({ type: 'bolt', x: from.x, y: from.y, x2: cx(t), y2: cy(t), timer: 360, max: 360, color: ab.color });
      strikeTarget(t, abDmg(t, 90, 0.05, m * k), pKey);
      k *= 0.85;
      from = { x: cx(t), y: cy(t) };
      let next = null, bd = CHAIN_REACH;
      for (const o of enemyTargets(pKey)) {
        if (hit.has(o)) continue;
        const d = Math.hypot(cx(o) - from.x, cy(o) - from.y);
        if (d < bd) { bd = d; next = o; }
      }
      t = next;
    }
  },
  army(p, pKey, ab, m) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const at = arenaClamp(cx(p) + Math.cos(a) * 40, cy(p) + Math.sin(a) * 40, 16);
      spawnAlly(pKey, at.x, at.y, Math.round(32 * m));
      room.particles.push({ type: 'teleport', x: at.x, y: at.y, timer: 380, max: 380, color: ab.color });
    }
    abBurst(p, ab, 'CALL TO ARMS');
  },
  sentry(p, pKey, ab, m) {
    const at = arenaClamp(cx(p) - (p.facing || 1) * 30, cy(p) - 10, 18);
    openFirePortal(pKey, at.x, at.y, Math.round(32 * m), 0, [400, 1100, 1800, 2500, 3200, 3900, 4600, 5300], { r: 16, aoe: 22 });
    abBurst(p, ab, 'FIRE SENTRY');
  },
  cyclone(p, pKey, ab, m) {
    const a = nearestTargetAngle(p, pKey);
    room.fires.push({ id: nextId(), kind: 'tornado', owner: pKey, x: cx(p) + Math.cos(a) * 16, y: cy(p) + Math.sin(a) * 16,
                      a, v: 330 / (TORNADO_MS / 16.67), r: 40, t: 0, life: TORNADO_MS + 800, dmg: Math.round(30 * m), tick: 0 });
    abBurst(p, ab, 'CYCLONE');
  },
  vanish(p, pKey, ab) {
    applyEffect(p, 'vanish', VANISH_MS);
    room.particles.push({ type: 'teleport', x: cx(p), y: cy(p), timer: 420, max: 420, color: ab.color });
    abBurst(p, ab, 'VANISH');
  },
  adrenaline(p, pKey, ab) {
    applyEffect(p, 'speed', 5000);
    applyEffect(p, 'haste', 5000);
    abBurst(p, ab, 'ADRENALINE');
  },
  barrier(p, pKey, ab) {
    room.fires.push({ id: nextId(), kind: 'barrier', owner: pKey, x: cx(p), y: cy(p), r: BARRIER_R, t: 0, life: BARRIER_MS });
    abBurst(p, ab, 'BARRIER');
  },
  toxic(p, pKey, ab, m) {
    const t = nearestFoe(p, pKey);
    const at = t ? { x: cx(t), y: cy(t) } : arenaClamp(cx(p) + (p.facing || 1) * 90, cy(p), CLOUD_R);
    room.fires.push({ id: nextId(), kind: 'cloud', owner: pKey, x: at.x, y: at.y, r: CLOUD_R, t: 0, life: CLOUD_MS, tick: 0, mult: m });
    abBurst(p, ab, 'TOXIC CLOUD');
  },
  vampirism(p, pKey, ab) {
    applyEffect(p, 'vampire', 8000);
    abBurst(p, ab, 'VAMPIRISM');
  },
  rejuvenate(p, pKey, ab) {
    const heal = Math.min(p.maxHp - p.hp, Math.round(p.maxHp * 0.15));
    p.hp += heal;
    applyEffect(p, 'regen', 10000);
    abBurst(p, ab, heal > 0 ? '+' + heal + ' HP' : 'REJUVENATE');
  },
  airstrike(p, pKey, ab, m) {
    if (!enemyTargets(pKey).length) return false;
    for (let i = 0; i < STRIKES; i++) {
      room.fires.push({ id: nextId(), kind: 'meteor', owner: pKey, x: cx(p), y: cy(p), r: 34,
                        t: -i * 160, life: 650, dmgMult: m, seek: true, placed: false, base: 70, pct: 0.05, pvp: 18 });
    }
    abBurst(p, ab, 'AIRSTRIKE');
  },
  gravity(p, pKey, ab, m) {
    let any = false;
    for (const t of enemyTargets(pKey)) {
      const dx = cx(p) - cx(t), dy = cy(p) - cy(t), d = Math.hypot(dx, dy) || 1;
      if (d > GRAVITY_R) continue;
      any = true;
      applyDamage(t, abDmg(t, 20, 0.02, m), pKey);
      if (t.boss || t.dead || d < 34) continue;
      const go = d - 30, ms = 260;
      t.pull = { vx: dx / d * go / ms, vy: dy / d * go / ms, timer: ms, from: null };
    }
    if (!any) return false;
    room.particles.push({ type: 'shockwave', x: cx(p), y: cy(p), maxR: GRAVITY_R, timer: 420, max: 420, color: ab.color });
    abBurst(p, ab, 'GRAVITY GRIP');
  },
  forcepush(p, pKey, ab, m) {
    for (const t of enemyTargets(pKey)) {
      const dx = cx(t) - cx(p), dy = cy(t) - cy(p), d = Math.hypot(dx, dy) || 1;
      if (d > PUSH_R + t.w / 2) continue;
      applyDamage(t, abDmg(t, 40, 0.02, m), pKey);
      if (t.boss || t.dead) continue;
      t.pull = { vx: dx / d * PUSH_DIST / 260, vy: dy / d * PUSH_DIST / 260, timer: 260, from: null };
    }
    room.particles.push({ type: 'shockwave', x: cx(p), y: cy(p), maxR: PUSH_R, timer: 360, max: 360, color: ab.color });
    abBurst(p, ab, 'FORCE PUSH');
  },
  golem(p, pKey, ab, m) {
    const at = arenaClamp(cx(p) + (p.facing || 1) * 40, cy(p), 30);
    spawnAlly(pKey, at.x, at.y, Math.round(45 * m), { type: 'titan', hp: 1500, life: 12000, force: true });
    room.particles.push({ type: 'shockwave', x: at.x, y: at.y, maxR: 50, timer: 420, max: 420, color: ab.color });
    abBurst(p, ab, 'STONE GOLEM');
  },
  execute(p, pKey, ab, m) {
    let best = null;
    for (const t of enemyTargets(pKey)) {
      if (Math.hypot(cx(t) - cx(p), cy(t) - cy(p)) > EXECUTE_R) continue;
      if (!best || t.hp / t.maxHp < best.hp / best.maxHp) best = t;
    }
    if (!best) return false;
    room.particles.push({ type: 'streak', x: cx(p), y: cy(p), x2: cx(best), y2: cy(best), timer: 300, max: 300, color: ab.color });
    if (!best.num && !best.boss && best.hp <= best.maxHp * EXECUTE_SHARE) {
      best.invincible = 0;
      applyDamage(best, best.hp + 99999, pKey);
      room.particles.push({ type: 'crit', x: cx(best), y: best.y - 6, text: 'EXECUTED', timer: 700, max: 700 });
    } else {
      strikeTarget(best, abDmg(best, 110, 0.05, m), pKey);
    }
  },
  icelance(p, pKey, ab, m) {
    const a = nearestTargetAngle(p, pKey);
    p.facing = Math.cos(a) < 0 ? -1 : 1;
    const x0 = cx(p), y0 = cy(p);
    const end = arenaClamp(x0 + Math.cos(a) * LANCE_LEN, y0 + Math.sin(a) * LANCE_LEN, 2);
    for (const t of enemyTargets(pKey)) {
      if (distToSegment(cx(t), cy(t), x0, y0, end.x, end.y) > 14 + t.w / 2) continue;
      applyDamage(t, abDmg(t, 65, 0.04, m), pKey);
      stagger(t, 1200, 'ice');
    }
    room.particles.push({ type: 'streak', x: x0, y: y0, x2: end.x, y2: end.y, timer: 420, max: 420, color: ab.color });
    for (let i = 1; i <= 5; i++) {
      const k = i / 5;
      room.particles.push({ type: 'shockwave', x: x0 + (end.x - x0) * k, y: y0 + (end.y - y0) * k, maxR: 14, timer: 300 + i * 40, max: 300 + i * 40, color: '#e8faff' });
    }
  },
  phoenix(p, pKey, ab) {
    applyEffect(p, 'phoenix', PHOENIX_MS);
    abBurst(p, ab, 'PHOENIX');
  },
};

// Barrier: rides with its caster and eats every hostile shot that reaches it.
function updateBarrier(f) {
  const o = room.players[f.owner];
  if (!o || o.dead) return false;
  f.x = cx(o); f.y = cy(o);
  room.projectiles = room.projectiles.filter(pr => {
    const hostile = pr.owner === 'monster' || (room.gameMode === 'pvp' && pr.owner !== f.owner);
    if (!hostile || Math.hypot(pr.x - f.x, pr.y - f.y) > f.r) return true;
    room.particles.push({ type: 'parry', x: pr.x, y: pr.y, timer: 200, max: 200 });
    return false;
  });
  return true;
}

// Toxic cloud: hurts and slows everything inside it, every CLOUD_TICK.
function updateCloud(f, dt) {
  f.tick -= dt;
  if (f.tick > 0) return true;
  f.tick = CLOUD_TICK;
  for (const t of enemyTargets(f.owner)) {
    if (Math.hypot(cx(t) - f.x, cy(t) - f.y) > f.r + t.w / 2) continue;
    applyDamage(t, abDmg(t, 14, 0.012, f.mult || 1), f.owner);
    chillTarget(t, 700, 'poison');
  }
  return true;
}

// Slow everyone to a crawl: monsters (and the Giant) through their slow timer,
// a rival player through the slow effect.
function abilityWarp(p, pKey) {
  const foes = enemyTargets(pKey);
  if (!foes.length) return false;
  for (const t of foes) chillTarget(t, WARP_MS, 'time');
  room.particles.push({ type: 'shockwave', x: cx(p), y: cy(p), maxR: 420, timer: 700, max: 700, color: ABILITY_BY_ID.warp.color });
  room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p), maxR: 36, timer: 700, max: 700, color: ABILITY_BY_ID.warp.color, text: 'TIME WARP' });
  return true;
}

// Lightning on the nearest STORM_BOLTS foes, whatever their range.
function abilityStorm(p, pKey) {
  const dmgMult = hasEffect(p, 'strength') ? 1.8 : 1;
  const foes = enemyTargets(pKey)
    .map(t => ({ t, d: Math.hypot(cx(t) - cx(p), cy(t) - cy(p)) }))
    .sort((a, b) => a.d - b.d).slice(0, STORM_BOLTS);
  if (!foes.length) return false;
  for (const { t } of foes) {
    const dmg = t.num ? 30 : STORM_DMG + Math.round((t.maxHp || 0) * (t.boss ? 0.01 : 0.04));
    room.particles.push({ type: 'bolt', x: cx(t) + (Math.random() - 0.5) * 36, y: ARENA_Y + 2, x2: cx(t), y2: cy(t),
                          timer: 380, max: 380, color: ABILITY_BY_ID.storm.color });
    strikeTarget(t, Math.round(dmg * dmgMult), pKey);
  }
  room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p), maxR: 34, timer: 600, max: 600, color: ABILITY_BY_ID.storm.color, text: 'THUNDERSTORM' });
  return true;
}

// The hole opens on the nearest foe and drags everything toward it.
function abilityBlackhole(p, pKey) {
  let best = null, bd = Infinity;
  for (const t of enemyTargets(pKey)) {
    const d = Math.hypot(cx(t) - cx(p), cy(t) - cy(p));
    if (d < bd) { bd = d; best = t; }
  }
  if (!best) return false;
  room.fires.push({ id: nextId(), kind: 'blackhole', owner: pKey, x: cx(best), y: cy(best), r: HOLE_R, t: 0, life: HOLE_MS, tick: 0,
                    dmg: Math.round(HOLE_DMG * (hasEffect(p, 'strength') ? 1.8 : 1)) });
  room.particles.push({ type: 'trapburst', x: cx(best), y: cy(best), maxR: 40, timer: 650, max: 650, color: ABILITY_BY_ID.blackhole.color, text: 'BLACK HOLE' });
  return true;
}

function updateBlackhole(f, factor, dt) {
  if (f.spit) {
    f.spitT = (f.spitT || 0) - dt;
    if (f.spitT <= 0) {
      f.spitT = f.spit.every;
      const foes = enemyTargets(f.owner).filter(t => Math.hypot(cx(t) - f.x, cy(t) - f.y) < f.spit.range);
      const t = foes.length ? foes[Math.floor(Math.random() * foes.length)] : null;
      // Bolts leave from the rim, so they're seen flying (not swallowed by whatever the hole is holding).
      const rim = (a, sp) => abyssBolt(f.owner, f.x + Math.cos(a) * (f.r + 8), f.y + Math.sin(a) * (f.r + 8), a, sp, f.spit.dmg, f.spit.range, { noIframe: true });
      if (t) rim(Math.atan2(cy(t) - f.y, cx(t) - f.x), 6);
      // ...and a spiral of bolts streaming out of it all the while.
      f.spin = (f.spin || 0) + 0.7;
      for (let i = 0; i < 2; i++) rim(f.spin + i * Math.PI, 5);
    }
  }
  f.tick -= dt;
  const hurt = f.tick <= 0;
  if (hurt) f.tick = HOLE_TICK;
  for (const t of enemyTargets(f.owner)) {
    const dx = f.x - cx(t), dy = f.y - cy(t), d = Math.hypot(dx, dy) || 1;
    const pullR = f.pullR || HOLE_PULL_R;
    if (d > pullR) continue;
    if (!t.boss && d > 3) {
      // Pulls harder the closer it gets.
      const pull = Math.min(d, (1.2 + 2.6 * (1 - d / pullR)) * factor);
      t.x += dx / d * pull; t.y += dy / d * pull;
      clampToArena(t);
    }
    if (hurt && d <= f.r + 24 + t.w / 2) applyDamage(t, f.dmg + Math.round(t.num ? 0 : (t.maxHp || 0) * (t.boss ? 0.004 : 0.02)), f.owner);
  }
  return true;
}

// Life drain rides with its caster, hurting everything near and feeding on it.
function updateDrain(f, factor, dt) {
  const o = room.players[f.owner];
  if (!o || o.dead) return false;
  f.x = cx(o); f.y = cy(o);
  f.tick -= dt;
  if (f.tick > 0) return true;
  f.tick = DRAIN_TICK;
  let fed = 0;
  for (const t of enemyTargets(f.owner)) {
    if (Math.hypot(cx(t) - f.x, cy(t) - f.y) > f.r + t.w / 2) continue;
    applyDamage(t, f.dmg, f.owner);
    fed++;
  }
  if (fed) {
    const heal = Math.max(1, Math.round(f.dmg * DRAIN_HEAL * Math.min(fed, 4)));
    o.hp = Math.min(o.maxHp, o.hp + heal);
  }
  return true;
}

// To the mouse cursor when there is one (up to DASH_CURSOR_MAX away),
// otherwise a fixed hop the way you're moving.
function abilityDash(p, pKey) {
  const inp = room.inputs[pKey];
  const x0 = cx(p), y0 = cy(p);
  let dx, dy, dist = DASH_DIST;
  if (inp.aimX !== null && inp.aimX !== undefined && inp.aimY !== null && inp.aimY !== undefined) {
    dx = inp.aimX - x0; dy = inp.aimY - y0;
    dist = Math.min(DASH_CURSOR_MAX, Math.hypot(dx, dy));
    if (dist < 4) return false;
  } else {
    dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0); dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    if (!dx && !dy) dx = p.facing || 1;
  }
  const d = Math.hypot(dx, dy);
  if (dx) p.facing = dx > 0 ? 1 : -1;
  p.x += dx / d * dist;
  p.y += dy / d * dist;
  p.pull = null;
  clampToArena(p, 2);
  p.invincible = Math.max(p.invincible, DASH_IFRAMES);
  room.particles.push({ type: 'dash', x: x0, y: y0, x2: cx(p), y2: cy(p), timer: 260, max: 260, color: ABILITY_BY_ID.dash.color });
  return true;
}

function abilityHeal(p) {
  if (p.hp >= p.maxHp) return false;
  const heal = Math.min(p.maxHp - p.hp, Math.round(p.maxHp * HEAL_SHARE));
  p.hp += heal;
  room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p), maxR: 36, timer: 700, max: 700,
                        color: ABILITY_BY_ID.heal.color, text: '+' + heal + ' HP' });
  return true;
}

// Monsters freeze solid (the Giant is only slowed); in PvP the other player is slowed.
function abilityFrost(p, pKey) {
  const dmgMult = hasEffect(p, 'strength') ? 1.8 : 1;
  for (const t of enemyTargets(pKey)) {
    if (Math.hypot(cx(t) - cx(p), cy(t) - cy(p)) > FROST_R + t.w / 2) continue;
    const bonus = t.num ? 0 : Math.round((t.maxHp || 0) * (t.boss ? 0.01 : 0.03));
    applyDamage(t, Math.round((FROST_DMG + bonus) * dmgMult), pKey);
    if (t.dead) continue;
    stagger(t, FROST_FREEZE_MS, 'ice');
  }
  room.particles.push({ type: 'shockwave', x: cx(p), y: cy(p), maxR: FROST_R, timer: 420, max: 420, color: ABILITY_BY_ID.frost.color });
  room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p), maxR: 30, timer: 600, max: 600, color: '#dff6ff', text: 'FROST NOVA' });
  return true;
}

// Meteor shower: meteors start falling one after another over SHOWER_MS. Each
// picks its spot as it starts to fall (see placeMeteor): every other one goes
// for an enemy, the rest land anywhere on the map.
function abilityMeteor(p, pKey) {
  const dmgMult = hasEffect(p, 'strength') ? 1.8 : 1;
  for (let i = 0; i < SHOWER_COUNT; i++) {
    room.fires.push({ id: nextId(), kind: 'meteor', owner: pKey, x: cx(p), y: cy(p), r: METEOR_R,
                      t: -Math.round(i / SHOWER_COUNT * SHOWER_MS + Math.random() * 120), life: METEOR_FALL_MS,
                      dmgMult, seek: i % 2 === 0, placed: false });
  }
  room.particles.push({ type: 'trapburst', x: cx(p), y: cy(p), maxR: 34, timer: 700, max: 700,
                        color: ABILITY_BY_ID.meteor.color, text: 'METEOR SHOWER' });
  return true;
}
function placeMeteor(f) {
  f.placed = true;
  const foes = f.seek ? enemyTargets(f.owner) : [];
  if (foes.length) {
    const t = foes[Math.floor(Math.random() * foes.length)];
    f.x = cx(t) + (Math.random() - 0.5) * 24;
    f.y = cy(t) + (Math.random() - 0.5) * 24;
  } else {
    f.x = ARENA_X + 20 + Math.random() * (ARENA_W - 40);
    f.y = ARENA_Y + 20 + Math.random() * (ARENA_H - 40);
  }
}

// The blast: everything in the circle when it lands. Monsters also lose a share
// of their max HP, so it stays worth casting deep into a run.
function explodeMeteor(f) {
  for (const t of enemyTargets(f.owner)) {
    if (Math.hypot(cx(t) - f.x, cy(t) - f.y) > f.r + t.w / 2) continue;
    const base = f.base ?? METEOR_DMG, pct = f.pct ?? 0.12;
    const dmg = t.num ? (f.pvp ?? METEOR_PVP_DMG) : base + Math.round((t.maxHp || 0) * (t.boss ? pct / 3 : pct));
    applyDamage(t, Math.round(dmg * (f.dmgMult || 1)), f.owner);
    if (!t.dead) ignite(t, 2000);
  }
  room.particles.push({ type: 'trapburst', x: f.x, y: f.y, maxR: f.r, timer: 500, max: 500, color: ABILITY_BY_ID.meteor.color });
  room.particles.push({ type: 'shockwave', x: f.x, y: f.y, maxR: f.r + 12, timer: 380, max: 380, color: '#ffd27a' });
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
  if (!sp || hasEffect(p, 'silence')) return;   // NULL FIELD
  const dmgMult = hasEffect(p, 'strength') ? 1.8 : 1;
  if (hasEffect(p, 'ghost')) breakGhost(p);
  p.specialCooldown = sp.cd;
  p.swingTimer = Math.min(sp.cd, 300);

  const px = cx(p), py = cy(p);
  const wc = WEAPON_COLORS[w.id] || '#ffffff';
  const spDmg = Math.round(sp.dmg * dmgMult);

  if (sp.kind === 'firehand') {
    castFireHand(p, pKey, sp, dmgMult);
    return;
  }
  if (sp.kind === 'dashwave') {
    // A quiet wave: when it reaches a foe, you flash through them.
    const aim = nearestTargetAngle(p, pKey);
    p.facing = Math.cos(aim) < 0 ? -1 : 1;
    slashWave(pKey, px, py, aim, 0, { dash: { dmg: spDmg }, speed: 9, range: sp.range, homing: true });
    return;
  }
  if (sp.kind === 'voidbeam') {
    const a0 = nearestTargetAngle(p, pKey);
    room.fires.push({ id: nextId(), kind: 'voidbeam', owner: pKey, x: px, y: py, r: VOIDBEAM_W, t: 0, life: VOIDBEAM_MS,
                      a: a0, a0, tick: 0, dmg: spDmg, len: sp.range });
    room.particles.push({ type: 'trapburst', x: px, y: py, maxR: 46, timer: 700, max: 700, color: wc, text: 'VOID BEAM' });
    return;
  }
  if (sp.kind === 'abyssorb') {
    // The Abyss's orb: it gathers at your crossbow, then flies.
    room.fires.push({ id: nextId(), kind: 'abysscharge', owner: pKey, x: px, y: py, r: 4, t: 0, life: ABYSS_PLAYER_CHARGE_MS,
                      dmg: spDmg, aoe: sp.aoe, maxR: 12, speed: 4 });
    return;
  }
  if (sp.kind === 'lightdashes') {
    // Five curving dashes, each hunting the nearest foe (or a pickup if none).
    const tgt = bladeAim(p, pKey);
    const a = tgt ? Math.atan2(tgt.y - py, tgt.x - px) : (p.facing < 0 ? Math.PI : 0);
    startBladeDash(p, { kind: 'sp', a, dist: bladeLegDist(p, tgt, sp.range), range: sp.range, speed: BLADE_SP_SPEED,
                        n: BLADE_SP_DASHES, turn: BLADE_SP_TURN, dmg: spDmg, quarry: tgt && tgt.foe || null });
    room.particles.push({ type: 'trapburst', x: px, y: py, maxR: 34, timer: 600, max: 600, color: wc, text: 'FLASH STEP' });
    return;
  }
  if (sp.kind === 'mindbeams') {
    // Four beams of mind energy spin out from you; each foe they touch is frozen 5s.
    room.fires.push({ id: nextId(), kind: 'mindbeams', owner: pKey, x: px, y: py, r: sp.range, a: Math.random() * Math.PI,
                      t: 0, life: MIND_BEAM_MS, dmg: spDmg, hit: new Set() });
    room.particles.push({ type: 'shockwave', x: px, y: py, maxR: 40, timer: 400, max: 400, color: wc });
    return;
  }
  if (sp.kind === 'timestop') {
    // TIME STOP: everything close is frozen where it stands.
    for (const t of enemyTargets(pKey)) {
      if (Math.hypot(cx(t) - px, cy(t) - py) > sp.range + t.w / 2) continue;
      applyDamage(t, spDmg, pKey);
      stagger(t, TIMESTOP_MS, 'timestop');
    }
    room.projectiles = room.projectiles.filter(pr => !(pr.owner === 'monster' && Math.hypot(pr.x - px, pr.y - py) < sp.range));
    room.particles.push({ type: 'shockwave', x: px, y: py, maxR: sp.range, timer: 700, max: 700, color: wc });
    room.particles.push({ type: 'trapburst', x: px, y: py, maxR: 40, timer: 700, max: 700, color: wc, text: 'TIME STOP' });
    return;
  }
  if (sp.kind === 'riftstep') {
    // RIFT STEP: through a rift to the nearest foe, cutting all around the landing.
    const t = nearestFoe(p, pKey, sp.range);
    if (!t) { p.specialCooldown = 0; p.swingTimer = 0; return; }
    room.particles.push({ type: 'teleport', x: px, y: py, timer: 380, max: 380, color: wc });
    const dx = cx(t) - px, dy = cy(t) - py, d = Math.hypot(dx, dy) || 1;
    const back = t.w / 2 + p.w / 2 + 6;
    p.x = cx(t) + dx / d * back - p.w / 2; p.y = cy(t) + dy / d * back - p.h / 2;
    clampToArena(p, 2);
    p.pull = null; p.facing = dx > 0 ? -1 : 1;
    p.invincible = Math.max(p.invincible || 0, 350);
    for (const o of enemyTargets(pKey)) {
      if (Math.hypot(cx(o) - cx(p), cy(o) - cy(p)) > RIFT_R + o.w / 2) continue;
      strikeTarget(o, spDmg, pKey);
      stagger(o, 500, 'void');
    }
    room.particles.push({ type: 'teleport', x: cx(p), y: cy(p), timer: 380, max: 380, color: '#ffffff' });
    room.particles.push({ type: 'shockwave', x: cx(p), y: cy(p), maxR: RIFT_R, timer: 380, max: 380, color: wc });
    return;
  }
  if (sp.kind === 'blink') {
    // Through a portal to the safest spot on the field; a fire portal opens
    // where you stood and keeps shooting at whoever was chasing you.
    const to = safestSpot(p, pKey);
    room.fires.push({ id: nextId(), kind: 'portal', color: 'purple', owner: pKey, x: px, y: py + p.h * 0.25, r: 18, t: 0, life: 650 });
    p.x = to.x - p.w / 2; p.y = to.y - p.h / 2;
    clampToArena(p, 2);
    p.pull = null;
    p.invincible = Math.max(p.invincible || 0, 400);
    room.fires.push({ id: nextId(), kind: 'portal', color: 'purple', owner: pKey, x: cx(p), y: cy(p) + p.h * 0.25, r: 18, t: 0, life: 650 });
    room.particles.push({ type: 'teleport', x: px, y: py, timer: 380, max: 380, color: '#b07aff' });
    room.particles.push({ type: 'teleport', x: cx(p), y: cy(p), timer: 380, max: 380, color: '#e0c8ff' });
    const n = 3 + (w.multi || 0);
    openFirePortal(pKey, px, py, spDmg, -350, Array.from({ length: n }, (_, i) => 400 + i * 420));
    return;
  }
  if (sp.kind === 'vortex') {
    if (!castVortex(p, pKey, sp, dmgMult)) { p.specialCooldown = 0; p.swingTimer = 0; }
    return;
  }
  if (sp.kind === 'tornado') {
    const a = nearestTargetAngle(p, pKey);
    p.facing = Math.cos(a) < 0 ? -1 : 1;
    room.fires.push({ id: nextId(), kind: 'tornado', owner: pKey, x: px + Math.cos(a) * 16, y: py + Math.sin(a) * 16,
                      a, v: sp.range / (TORNADO_MS / 16.67), r: sp.aoe || 34, t: 0, life: TORNADO_MS, dmg: spDmg, tick: 0 });
    return;
  }
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

  const speed = sp.kind === 'hook' ? 14 : sp.kind === 'fanhammer' ? 8.5 : 5.2;
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

  if (sp.kind === 'sunorb') {
    // The sun hangs part-way toward the nearest foe.
    const t = nearestFoe(p, pKey, 600);
    const d = t ? Math.min(160, Math.hypot(cx(t) - px, cy(t) - py)) : 60;
    const at = arenaClamp(px + Math.cos(aim) * d, py + Math.sin(aim) * d - 20, 16);
    room.fires.push({ id: nextId(), kind: 'sunorb', owner: pKey, x: at.x, y: at.y, r: 12, t: 0, life: SUNORB_MS, tick: 200, dmg: spDmg });
    return;
  }
  if (sp.kind === 'hammerthrow') {
    // Out through everything in its path, stunning, and back to your hand.
    room.projectiles.push(mkProj(aim, { pierce: true, boomerang: true, hitTargets: new Set(), life: 4000, stun: 700,
                                        dx: Math.cos(aim) * 7, dy: Math.sin(aim) * 7 }));
    return;
  }
  if (sp.kind === 'icespikes') {
    const n = sp.count || 10;
    for (let i = 0; i < n; i++) {
      room.projectiles.push(mkProj(aim + (i / n) * Math.PI * 2, { pierce: true, hitTargets: new Set(), chill: 1200, frostbite: true }));
    }
    return;
  }
  if (sp.kind === 'ghostthrow') {
    // Who has their back to you right now? (Monsters turn the moment you
    // reappear, so it's decided as the dagger leaves your hand.)
    const backOf = new Set(enemyTargets(pKey).filter(t => hitFromBehind(t, cx(t) - px)).map(throwKey));
    // A fan of five: the middle dagger is the full throw, the outer four hit for a share of it.
    // HAUNTING: each dagger picks its own quarry (the closest foes, the middle
    // dagger taking the closest), chases it, and flies further to do it.
    const haunt = p.passive === 'ghostdagger';
    const prey = haunt ? enemyTargets(pKey).map(t => ({ t, d: Math.hypot(cx(t) - px, cy(t) - py) }))
                                           .sort((u, v) => u.d - v.d).slice(0, 5).map(e => e.t) : [];
    const order = [0, -1, 1, -2, 2];
    for (let i = -2; i <= 2; i++) {
      const a = aim + i * 0.2;
      const quarry = prey.length ? prey[order.indexOf(i) % prey.length] : null;
      room.projectiles.push(mkProj(a, { ghostThrow: true, backOf, shareMult: i === 0 ? 1 : GHOST_FAN_SHARE,
                                        homing: haunt, quarry, maxRange: sp.range * (haunt ? 1.8 : 1),
                                        dx: Math.cos(a) * 8.5, dy: Math.sin(a) * 8.5 }));
    }
  } else if (sp.kind === 'pierce') {
    room.projectiles.push(mkProj(aim, { pierce: true, hitTargets: new Set() }));
  } else if (sp.kind === 'fanhammer') {
    // Fan the hammer: every chamber at once, in a tight fan, all exploding.
    const n = sp.count || 6;
    for (let i = 0; i < n; i++) {
      const a = aim + (i - (n - 1) / 2) * 0.1 + (Math.random() - 0.5) * 0.04;
      room.projectiles.push(mkProj(a, { isAoe: true, aoeRadius: sp.aoe || 30 }));
    }
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
    out.push({ x1: cx(o), y1: cy(o), x2: pr.x, y2: pr.y, kind: pr.hook ? 'hook' : 'grapple', o: pr.owner });
  }
  for (const e of [...allPlayers(), ...room.monsters]) {
    if (!e || e.dead || !e.pull || !e.pull.from) continue;
    const o = room.players[e.pull.from];
    if (!o || o.dead) continue;
    out.push({ x1: cx(o), y1: cy(o), x2: cx(e), y2: cy(e), kind: 'grapple', o: e.pull.from });
  }
  return out;
}

// Fires that sit on their caster every tick. Clients pin them to wherever they
// draw that player, so they never trail behind a predicted or smoothed position.
const RIDES_OWNER = new Set(['barrier', 'hurricane', 'vortexfield', 'drain', 'blizzard', 'sunbeam', 'mindbeams', 'voidbeam', 'scythewhirl']);

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
    superCd: Math.max(0, p.superCooldown || 0), superMax: w.super?.cd || 0,
    abil: (p.abilities || []).map(id => id && ABILITY_BY_ID[id]
      ? { id, cd: Math.max(0, Math.round(p.abCd[id] || 0)), max: ABILITY_BY_ID[id].cd } : null),
    vShield: p.vortexShield > 0 ? Math.round(p.vortexShield) : 0, vStore: Math.round(p.vortexStore || 0),
    parryCd: Math.max(0, p.parryCooldown), parryMax: p.parryCd || PARRY_COOLDOWN, parryActive: p.parryTimer > 0,
    speed: Math.round(p.speed * 1000) / 1000,
    passive: p.passive || null,
    ...(p.controlling ? { controlling: true, ctlLeft: Math.max(0, Math.round(p.controlling.left)),
                          ...(!p.controlling.isPlayer && p.controlling.ref ? { pupAb: puppetAbilityName(p.controlling.ref), pupCd: Math.round(p.controlling.spCd || 0) } : {}) } : {}),
    ...(p.mindControlledBy ? { puppet: p.mindControlledBy } : {}),
    ...(p.bladeDash ? { dashing: p.bladeDash.kind } : {}),
    ...(p.lightspeed > 0 ? { lightspeed: Math.round(p.lightspeed) } : {}),
    ...(p.kspin > 0 ? { kspin: Math.round(p.kspin) } : {}),
    ...(p.passive === 'mindtome' ? { shuffleIn: Math.max(0, Math.round(p.shuffleT ?? MIND_SHUFFLE_MS)) } : {}),
    ...(p.passive === 'vortex' ? { aegis: !(p.aegisCd > 0) } : {}),
    effects: p.effects,
    pulled: !!p.pull,
  };
}

function buildStateMsg(playerNum) {
  const key = 'p' + playerNum;
  return {
    type: 'state',
    st: Date.now(),   // server clock: lets the client place snapshots on a steady timeline
    myNum: playerNum,
    gameState: room.gameState,
    gameMode: room.gameMode,
    world: { size: room.mapSize, w: CANVAS_W, h: CANVAS_H },
    maxPlayers: room.maxPlayers,
    ...(room.custom ? { roomName: room.custom.name, roomId: room.id } : {}),
    seated: seatKeys().filter(k => room[k] || (room.bot && k === 'p2')).length,
    chats: room.chats.map(c => ({ key: c.key, id: c.id, age: Date.now() - c.t })),
    ...(room.bot ? { bot: room.bot.level } : {}),
    playerNames: room.playerNames,
    players: perKey(k => playerView(room.players[k])),
    monsters:    room.monsters.map(m => ({ id: m.id, type: m.type, x: r1(m.x), y: r1(m.y), w: m.w, h: m.h,
                  hp: m.hp, maxHp: m.maxHp, face: m.face,
                  ...(m.hitFlash > 0 ? { hitFlash: Math.round(m.hitFlash) } : {}),
                  ...(m.slowTimer > 0 ? { slowed: true, sk: m.slowKind || 'chill' } : {}),
                  ...(m.freeze > 0 ? { frozen: true, fk: m.freezeKind || 'ice' } : {}),
                  ...(m.burnTimer > 0 ? { burning: true } : {}), ...(m.armor ? { armor: m.armor } : {}),
                  ...(m.swing > 0 ? { swing: Math.round(m.swing) } : {}),
                  ...(m.controlledBy ? { ctl: m.controlledBy, ctlLeft: Math.round(room.players[m.controlledBy]?.controlling?.left || 0) } : {}),
                  ...(m.fuse > 0 ? { fuse: Math.round(m.fuse) } : {}), ...(m.ward > 0 ? { ward: true } : {}),
                  ...(m.charge ? { charge: { a: Math.round(m.charge.a * 100) / 100, wind: m.charge.wind > 0 } } : {}),
                  ...(m.dazed > 0 ? { dazed: true } : {}),
                  ...(m.samWind > 0 ? { samWind: m.samNext === 'dash' ? 'dash' : 'wave' } : {}),
                  ...(m.samDash ? { samDash: Math.round(m.samDash.a * 100) / 100 } : {}),
                  ...(m.sweep ? { lsweep: { a: Math.round(m.sweep.a * 100) / 100, wind: m.sweep.wind > 0 } } : {}),
                  ...(m.dashes ? { ldash: { a: Math.round(m.dashes.a * 100) / 100, wind: m.dashes.wind > 0, n: m.dashes.n } } : {}),
                  ...(m.pupRush ? { ldash: { a: Math.round(m.pupRush.a * 100) / 100, wind: false, n: m.pupRush.n || 1 } } : {}),
                  ...(m.raiseT > 0 && m.raiseAt ? { raise: m.raiseAt.map(r => ({ x: r1(r.x), y: r1(r.y) })) } : {}),
                  ...(m.boss ? { boss: true, wind: m.windup > 0 ? m.wind : null, windup: Math.max(0, Math.round(m.windup)), stun: Math.max(0, Math.round(m.stun)) } : {}),
                  ...(m.mage ? { mage: true, hidden: !!m.hidden, phase: m.phase, cast: m.tpT > 0 ? 'teleport' : m.castT > 0 ? m.cast : null } : {}),
                  ...(m.abyss ? { abyss: true, phase: m.phase, act: m.rapid > 0 ? 'rapid' : m.act, actT: Math.round(m.actT || 0),
                                  ...(m.act === 'slash' ? { sa: Math.round(m.slashA * 100) / 100 } : {}),
                                  ...(m.p3 ? { p3: Math.max(0, Math.ceil(m.p3T / 1000)) } : {}) } : {}) })),
    allies:      room.allies.map(a => ({ id: a.id, type: a.type, owner: a.owner, x: r1(a.x), y: r1(a.y), w: a.w, h: a.h,
                  hp: a.hp, maxHp: a.maxHp, hitFlash: a.hitFlash, burning: (a.burnTimer || 0) > 0,
                  face: a.face, swing: a.swing > 0 ? Math.round(a.swing) : 0, fade: a.life < 1500 })),
    projectiles: room.projectiles.map(pr => ({ id: pr.id, x: r1(pr.x), y: r1(pr.y), dx: r1(pr.dx), dy: r1(pr.dy), weaponId: pr.weaponId,
                  upg: pr.upg || null, isAoe: pr.isAoe, special: !!pr.special, grapple: !!pr.grapple,
                  hook: !!pr.hook, boomerang: !!pr.boomerang })),
    fires:       room.fires.map(f => ({ id: f.id, kind: f.kind, x: r1(f.x), y: r1(f.y), r: r1(f.r || 0),
                                    a: Math.round((f.a || 0) * 100) / 100, v: f.v ? r1(f.v) : 0, k: Math.round(f.t / f.life * 100) / 100,
                                    ...(f.color ? { c: f.color } : {}), ...(f.trapType ? { tt: f.trapType } : {}),
                                    ...(RIDES_OWNER.has(f.kind) ? { fo: f.owner } : {}) })),
    chains:      buildChains().map(c => ({ x1: r1(c.x1), y1: r1(c.y1), x2: r1(c.x2), y2: r1(c.y2), kind: c.kind, o: c.o })),
    traps:       room.traps.map(tr => ({ x: r1(tr.x), y: r1(tr.y), w: tr.w, h: tr.h, type: tr.type, state: tr.state, radius: tr.radius, color: tr.color, o: tr.owner || null,
                  armRatio: tr.state === 'arming' ? r1(1 - tr.armTimer / (TRAP_TYPES[tr.type].armTime || 1)) : 0 })),
    items:       room.items.map(it => ({ x: r1(it.x), y: r1(it.y), w: it.w, h: it.h, type: it.type, color: ITEM_TYPES[it.type].color })),
    coins:       room.coins.map(c => ({ id: c.id, x: r1(c.x), y: r1(c.y), w: c.w, h: c.h, value: c.value, fading: c.life < 4000 })),
    particles:   room.particles.map(p => (p.x === undefined ? p : { ...p, x: r1(p.x), y: r1(p.y) })),
    wave:        room.wave,
    xp:          room.playerXp[key],
    myCoins:     room.playerCoins[key],
    isAdmin:     isAdminPw(room.passwords[key]),
    inventory:   room.players[key] ? room.players[key].inventory : [],
    round:       room.round,
    victory:     !!room.victory,
    sandbox:     room.gameMode === 'sandbox' ? room.sandbox : null,
    finalWave:   room.gameMode === 'coop' ? COOP_FINAL_WAVE : 0,
    pendingUnlock: room.unlockQueues[key][0] || null,
    otherHasUnlocks: KEYS.some(k => k !== key && room.unlockQueues[k].length > 0),
    bossDrop: room.bossDrops?.[key] || null,
    leaderboard: isSolo() && room.gameState === 'ROUND_OVER' ? room.lastLeaderboard : null,
  };
}

// Snapshots go out at most every 26 ms: every other 20 ms tick on Linux hosts
// (25/s), every tick where the timer really lands ~28 ms apart (Windows). The
// client buffers and blends them, so fewer arrive without looking choppier — and
// building, stringifying and compressing each one is most of the server's CPU,
// which on a small shared host (Render free: 0.1 CPU) is what caused the lag.
const STATE_MIN_GAP_MS = 26;
// A socket with more than this still waiting to leave is on a slow link; sending
// it more only makes its picture older and older, so it skips frames instead
// and always gets the freshest state once it catches up.
const MAX_BUFFERED = 40 * 1024;
const ACK_SLACK_MS = 250;
function broadcastTick() {
  const now = Date.now();
  if (now - (room.lastStateAt || 0) < STATE_MIN_GAP_MS) return;
  room.lastStateAt = now;
  broadcastState();
}
function broadcastState() {
  if (room.chats.length) room.chats = room.chats.filter(c => Date.now() - c.t < CHAT_SHOW_MS);
  KEYS.forEach((k, i) => {
    const ws = room[k];
    if (!ws || ws.readyState !== 1 || ws.bufferedAmount > MAX_BUFFERED) return;
    // Flow control: if the newest snapshot this player has confirmed is well
    // behind their usual round trip, snapshots are piling up somewhere (a slow
    // link, a proxy's buffer, a busy browser). Hold off until it drains, so the
    // picture is at most a fraction of a second old, never seconds. A probe
    // still goes out every half second so a lost ack can't stall it.
    const now = Date.now();
    if (ws.ackSt && now - ws.ackSt > ws.minAckAge + ACK_SLACK_MS && now - (ws.lastProbe || 0) < 500) return;
    ws.lastProbe = now;
    ws.send(JSON.stringify(buildStateMsg(i + 1)));
  });
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
    damage: w.damage, range: w.range, atkSpd: w.atkSpd, spin: !!w.swing360,
    shopOnly: !!w.shopOnly, noRequirement: !!w.noRequirement, needLegendary: !!w.needLegendary, price: w.price || 0,
    needAll: !!w.needAll,
    needMind: !!w.needMind,
    needLight: !!w.needLight,
    needSamurai: !!w.needSamurai,
    bossReward: !!w.bossReward,
    special: w.special ? { kind: w.special.kind, dmg: w.special.dmg, cd: w.special.cd } : null,
    super: w.super ? { kind: w.super.kind, dmg: w.super.dmg, cd: w.super.cd } : null,
    upgrades: upgradesFor(w.id),
    passive: PASSIVES[w.id] || null,
  }));
}

function profileFor(pw, opts = {}) {
  const admin = isAdminPw(pw);
  const d = progress();
  if (!admin) restoreBackup(pw, opts.backup);

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

  const weapons = sortWeaponIds([...getUnlockedWeaponIds(xp), ...(d.weapons[pw] || []),
                                 ...(admin ? SHOP_WEAPONS.map(w => w.id) : [])]);
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
  const abilities = admin ? ABILITIES.map(a => a.id)
    : (Array.isArray(d.abilities[pw]) ? d.abilities[pw].filter(id => ABILITY_BY_ID[id]) : []);
  const slotCount = admin ? MAX_ABILITY_SLOTS : clampSlots(d.abilitySlotCount[pw]);
  const abilitySlots = cleanSlots(d.abilitySlots[pw], abilities, slotCount);
  const lightKills = admin ? LIGHT_KILLS_NEED : (d.lightKills[pw] || 0);
  const samuraiKills = admin ? SAM_KILLS_NEED : (d.samuraiKills[pw] || 0);
  return { xp, coins, weapons, upgrades, ownedSkins, abilities, abilitySlots, slotCount, lightKills, samuraiKills, samuraiNeed: SAM_KILLS_NEED,
           lightMaxed: maxedWeaponCount(weapons, upgrades), lightMaxedNeed: lightMaxedNeed(),
           nextSlotPrice: slotCount < MAX_ABILITY_SLOTS ? SLOT_PRICES[slotCount - ABILITY_SLOTS] : 0,
           refunded, save: makeSave(pw) };
}

function clampSlots(n) {
  return Math.max(ABILITY_SLOTS, Math.min(MAX_ABILITY_SLOTS, Math.floor(Number(n) || ABILITY_SLOTS)));
}

// A skin is { colorIdx, hatIdx, outfit }. The outfit survives only if owned.
function cleanSkin(raw, owned) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const outfit = typeof s.outfit === 'string' && SKIN_BY_ID[s.outfit] && owned.includes(s.outfit) ? s.outfit : '';
  return {
    colorIdx: Math.max(0, Math.min(SKIN_COLOR_COUNT - 1, Math.floor(Number(s.colorIdx) || 0))),
    hatIdx:   Math.max(0, Math.min(SKIN_HAT_COUNT - 1,   Math.floor(Number(s.hatIdx)   || 0))),
    accIdx:   Math.max(0, Math.min(SKIN_ACC_COUNT - 1,   Math.floor(Number(s.accIdx)   || 0))),
    outfit,
  };
}

// Use the item in inventory slot `index` (a player's 1-4 keys, or the bot).
function useInventorySlot(myKey, index) {
  const p = room.players[myKey];
  if (p && !p.dead && Array.isArray(p.inventory)) {
    const idx = Number(index);
    if (Number.isInteger(idx) && idx >= 0 && idx < p.inventory.length) {
      const type = p.inventory[idx];
      const def = ITEM_TYPES[type];
      if (def && useItemEffect(p, myKey, def)) {
        p.inventory.splice(idx, 1);
        room.particles.push({ type: 'useitem', x: cx(p), y: p.y, timer: 900, max: 900, color: def.color, text: def.name });
      } else if (def) {
        if (def.instant && def.effect === 'heal') {
          p.hp = Math.min(p.maxHp, p.hp + def.amount);
        } else if (def.effect === 'bomb') {
          for (const t of enemyTargets(myKey)) {
            if (Math.hypot(cx(t) - cx(p), cy(t) - cy(p)) <= def.radius) strikeTarget(t, def.amount, myKey);
          }
          room.particles.push({ type: 'aoe', x: cx(p), y: cy(p), maxR: def.radius, radius: 2, timer: 420, max: 420, color: def.color });
          room.particles.push({ type: 'shockwave', x: cx(p), y: cy(p), maxR: def.radius, timer: 420, max: 420, color: '#ffe0a0' });
        } else if (def.effect === 'frost') {
          for (const t of enemyTargets(myKey)) {
            if (Math.hypot(cx(t) - cx(p), cy(t) - cy(p)) <= def.radius) chillTarget(t, def.dur);
          }
          room.particles.push({ type: 'aoe', x: cx(p), y: cy(p), maxR: def.radius, radius: 2, timer: 520, max: 520, color: def.color });
        } else {
          applyEffect(p, def.effect, def.dur);
        }
        p.inventory.splice(idx, 1);
        room.particles.push({ type: 'useitem', x: cx(p), y: p.y, timer: 900, max: 900, color: def.color, text: def.name });
      }
    }
  }
}

// ─── BOT BATTLE ───────────────────────────────────────────────────────────────
// A PvP match against a bot. It is a real second player: it gets a loadout
// (weapons, upgrades, abilities, skin) scaled to its level and fights by
// writing room.inputs.p2 every tick, exactly as a client would. The match
// itself is plain PvP: same arena, lives, rounds and rewards.
// own:   the chance it owns each weapon, ability and skin (rolled one by one),
//        and how far each weapon is upgraded.
// think: ms between decisions (its reaction time).
// aggro: chance it swings when in range · parry / dodge: chance it reacts to a
// blow or a shot · skill: how readily it uses specials, supers, abilities, items.
const BOT_LEVELS = {
  easy:    { name: 'EASY',    own: 0.10, think: 420, aggro: 0.45, parry: 0.00, dodge: 0.00, skill: 0.25, slots: 1 },
  common:  { name: 'COMMON',  own: 0.20, think: 340, aggro: 0.60, parry: 0.06, dodge: 0.15, skill: 0.40, slots: 2 },
  average: { name: 'AVERAGE', own: 0.30, think: 270, aggro: 0.70, parry: 0.15, dodge: 0.30, skill: 0.55, slots: 2 },
  strong:  { name: 'STRONG',  own: 0.40, think: 210, aggro: 0.80, parry: 0.28, dodge: 0.45, skill: 0.70, slots: 3 },
  hard:    { name: 'HARD',    own: 0.50, think: 160, aggro: 0.90, parry: 0.42, dodge: 0.60, skill: 0.85, slots: 4 },
  insane:  { name: 'INSANE',  own: 0.60, think: 110, aggro: 1.00, parry: 0.60, dodge: 0.80, skill: 1.00, slots: 6 },
  // The admin bot owns every weapon, all of them fully maxed (so every passive
  // is live), a loadout of only the best abilities, and fights flat out,
  // leaning on the legendaries.
  admin:   { name: 'ADMIN',   own: 1.00, think: 70,  aggro: 1.00, parry: 0.85, dodge: 0.95, skill: 1.00, slots: 6, all: true, favor: 0.7 },
};
const BOT_BEST_ABILITIES = ['execute', 'meteor', 'blackhole', 'perfectguard', 'phoenix', 'airstrike'];
const BOT_HEALS = ['heal', 'rejuvenate', 'haven', 'vampirism', 'phoenix'];
const BOT_GUARDS = ['aegis', 'barrier', 'perfectguard', 'vanish', 'shadowstep', 'warp'];
const BOT_SWAP_MIN = 10000, BOT_SWAP_VAR = 12000;

// Each thing is owned on its own roll: `chance` of it being there.
const rollOwned = (list, chance) => list.filter(() => Math.random() < chance);
const pickSome = (list, n) => {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, Math.max(0, Math.min(a.length, n)));
};

// A room of its own with the bot already seated as player 2.
function newBotRoom(level, size) {
  const r = makeRoom();
  r.gameMode = 'pvp';
  r.mapSize = MAP_SIZES[size] ? size : 'medium';
  r.bot = { level };
  rooms.push(r);
  return [r, 'p1'];
}

// Everything the bot owns, rolled fresh for each bot battle.
function setupBot() {
  const L = BOT_LEVELS[room.bot.level];
  const starters = getUnlockedWeaponIds(0);
  const all = WEAPONS.map(w => w.id);
  const weapons = L.all ? sortWeaponIds(all) : sortWeaponIds([...new Set([...starters, ...rollOwned(all, L.own)])]);
  const upgrades = {};
  for (const id of weapons) {
    upgrades[id] = {};
    for (const k of upgradesFor(id)) {
      if (L.all) { upgrades[id][k] = UPGRADE_STATS[k].max; continue; }          // admin: everything maxed
      const lv = Math.round(UPGRADE_STATS[k].max * L.own + (Math.random() - 0.5) * 2);
      upgrades[id][k] = Math.max(0, Math.min(UPGRADE_STATS[k].max - 1, lv));   // never fully maxed: no passives
    }
  }
  let abilities = L.all ? BOT_BEST_ABILITIES.slice() : pickSome(rollOwned(ABILITIES.map(a => a.id), L.own), L.slots);
  if (!abilities.length) abilities = pickSome(ABILITIES.map(a => a.id), 1);   // always has at least one
  const slots = Array.from({ length: L.slots }, (_, i) => abilities[i] || null);
  const outfits = L.all ? ['golden'] : pickSome(rollOwned(SKIN_SHOP.map(s => s.id), L.own), 1);
  room.playerNames.p2 = 'BOT ' + L.name;
  room.passwords.p2 = '';
  room.playerXp.p2 = 0;
  room.playerCoins.p2 = 0;
  room.playerUnlocks.p2 = weapons;
  room.playerUpgrades.p2 = upgrades;
  room.playerAbilities.p2 = slots;
  room.playerSkins.p2 = {
    colorIdx: Math.floor(Math.random() * SKIN_COLOR_COUNT), hatIdx: Math.floor(Math.random() * SKIN_HAT_COUNT),
    accIdx: Math.floor(Math.random() * SKIN_ACC_COUNT), outfit: outfits.length && (L.all || Math.random() < 0.7) ? outfits[0] : '',
  };
  room.p2Joined = true;
  room.bot.thinkT = 0; room.bot.swapT = 0; room.bot.strafe = 1; room.bot.wasDead = true;
}

// Hold a random weapon from what it owns.
function botPickWeapon(p) {
  const ids = p.unlockedWeapons || [];
  if (ids.length < 2) return;
  const favor = BOT_LEVELS[room.bot.level].favor || 0;
  const legends = ids.filter(id => WEAPON_BY_ID[id] && WEAPON_BY_ID[id].shopOnly);
  let i = p.weaponIdx;
  if (legends.length && Math.random() < favor) i = ids.indexOf(legends[Math.floor(Math.random() * legends.length)]);
  else while (i === p.weaponIdx) i = Math.floor(Math.random() * ids.length);
  if (i === p.weaponIdx && ids.length > 1) i = (i + 1) % ids.length;
  p.weaponIdx = i;
  refreshWeapon(p);
}

function botTick(dt) {
  const b = room.bot, L = BOT_LEVELS[b.level];
  const p = room.players.p2, foe = room.players.p1;
  const inp = room.inputs.p2;
  // One-press buttons only stay down for a single tick.
  inp.parry = false; inp.swap = false; inp.swapPrev = false; inp.special = false; inp.super = false;
  for (let i = 1; i <= 6; i++) inp['ab' + i] = false;
  if (!p || p.dead || p.mindControlledBy) {
    inp.up = inp.down = inp.left = inp.right = inp.attack = false;
    if (p && p.dead) b.wasDead = true;
    return;
  }
  // A fresh life (or a while on one weapon): pick another at random.
  b.swapT -= dt;
  if (b.wasDead || b.swapT <= 0) {
    if (b.wasDead || Math.random() < 0.8) botPickWeapon(p);
    b.wasDead = false;
    b.swapT = BOT_SWAP_MIN + Math.random() * BOT_SWAP_VAR;
  }
  b.thinkT -= dt;
  if (b.thinkT > 0) return;
  b.thinkT = L.think * (0.8 + Math.random() * 0.4);

  const w = weapon(p), melee = w.type === 'melee';
  const see = foe && !foe.dead && !unseen(foe) && !foe.hidden;
  const px = cx(p), py = cy(p);
  let mx = 0, my = 0, d = Infinity, dx = 0, dy = 0;
  if (see) {
    dx = cx(foe) - px; dy = cy(foe) - py; d = Math.hypot(dx, dy) || 1;
    const want = w.lightDash ? 150 : melee ? Math.max(14, w.range * 0.55) : Math.min(260, w.range * 0.65);
    if (d > want + 15) { mx += dx / d; my += dy / d; }
    else if (!melee && d < want - 30) { mx -= dx / d; my -= dy / d; }
    if (Math.random() < 0.08) b.strafe = -b.strafe;
    const sk = melee && d < want + 15 ? 0.35 : 0.65;
    mx += (-dy / d) * sk * b.strafe; my += (dx / d) * sk * b.strafe;
    // Badly hurt and not built to brawl: back off a little.
    if (p.hp < p.maxHp * 0.25 && L.skill >= 0.7 && !melee) { mx -= dx / d * 0.6; my -= dy / d * 0.6; }
    inp.aimX = Math.round(cx(foe)); inp.aimY = Math.round(cy(foe));
  } else {
    // Can't see them: roam (toward where they were last seen first).
    if (!b.roam || Math.hypot(b.roam.x - px, b.roam.y - py) < 20 || Math.random() < 0.04) {
      const last = foe && !foe.dead ? { x: cx(foe), y: cy(foe) } : null;
      b.roam = last && Math.random() < 0.5 ? arenaClamp(last.x + (Math.random() - 0.5) * 160, last.y + (Math.random() - 0.5) * 160, 20)
                                           : arenaClamp(ARENA_X + Math.random() * ARENA_W, ARENA_Y + Math.random() * ARENA_H, 20);
    }
    const rx = b.roam.x - px, ry = b.roam.y - py, rd = Math.hypot(rx, ry) || 1;
    mx = rx / rd; my = ry / rd;
    inp.aimX = null; inp.aimY = null;
  }
  let chasing = false;
  // Powerups lying close by: collect them like anyone (4 at most; a full bag
  // only lets it walk over medkits when it's hurt).
  if (room.items.length && (!see || d > 140)) {
    const full = (p.inventory || []).length >= MAX_INVENTORY;
    let best = null, bd = 260;
    for (const it of room.items) {
      if (full && !(ITEM_TYPES[it.type].touch && p.hp < p.maxHp * 0.8)) continue;
      const id = Math.hypot(it.x + it.w / 2 - px, it.y + it.h / 2 - py);
      if (id < bd) { bd = id; best = it; }
    }
    if (best) { mx = (best.x + best.w / 2 - px) / bd; my = (best.y + best.h / 2 - py) / bd; chasing = true; }
  }
  // Keep clear of traps that aren't its own.
  for (const tr of room.traps) {
    if (tr.owner === 'p2') continue;
    const tx = px - (tr.x + tr.w / 2), ty = py - (tr.y + tr.h / 2), td = Math.hypot(tx, ty) || 1;
    if (td < 44) { mx += tx / td * 1.2; my += ty / td * 1.2; }
  }
  // Shots coming its way: sidestep, or parry if one is about to land.
  let threat = false;
  for (const pr of room.projectiles) {
    if (pr.owner !== 'p1') continue;
    const rx = px - pr.x, ry = py - pr.y, rd = Math.hypot(rx, ry);
    const sp = Math.hypot(pr.dx, pr.dy) || 1;
    if (rd > 160 || (rx * pr.dx + ry * pr.dy) <= 0) continue;          // heading away
    const miss = Math.abs(rx * pr.dy - ry * pr.dx) / sp;               // how close it will pass
    if (miss > 22) continue;
    if (rd < 55) threat = true;
    if (Math.random() < L.dodge) { const s = (rx * pr.dy - ry * pr.dx) >= 0 ? 1 : -1; mx += (pr.dy / sp) * s * 1.6; my += (-pr.dx / sp) * s * 1.6; }
  }
  if (see && foe.swingTimer > 0 && d < weapon(foe).range + 24) threat = true;
  if (threat && p.parryCooldown <= 0 && Math.random() < L.parry) inp.parry = true;
  // Walls: steer back toward the middle when hugging one.
  if (!chasing) {
    if (p.x < ARENA_X + 20) mx += 0.8; if (p.x > ARENA_X + ARENA_W - p.w - 20) mx -= 0.8;
    if (p.y < ARENA_Y + 20) my += 0.8; if (p.y > ARENA_Y + ARENA_H - p.h - 20) my -= 0.8;
  }

  const mm = Math.hypot(mx, my);
  if (mm > 0.01) { mx /= mm; my /= mm; }
  inp.left = mx < -0.38; inp.right = mx > 0.38; inp.up = my < -0.38; inp.down = my > 0.38;

  // Attack, special, super, abilities, items.
  const reach = w.lightDash ? 240 : melee ? w.range + (p.w + (foe ? foe.w : 16)) / 2 + 6 : w.range;
  inp.attack = see && d <= reach && Math.random() < L.aggro;
  if (!see) return;
  const spRange = (w.special && w.special.range) || Math.max(140, w.range * 1.3);
  if (w.special && p.specialCooldown <= 0 && d <= Math.max(spRange, 120) && Math.random() < L.skill * 0.6) inp.special = true;
  if (w.super && p.superCooldown <= 0 && d <= 320 && Math.random() < L.skill * 0.5) inp.super = true;
  const hurt = p.hp / p.maxHp;
  // Items: only what it has picked up. Heals when hurt, the rest once the fight is on.
  if (p.inventory && p.inventory.length && Math.random() < 0.3 + L.skill * 0.4) {
    const heals = p.inventory.findIndex(t => ['heal', 'regen', 'elixir'].includes(t));
    const buffs = p.inventory.findIndex(t => !['heal', 'regen', 'elixir', 'cloak', 'goldrush'].includes(t));
    if (heals >= 0 && hurt < 0.5) useInventorySlot('p2', heals);
    else if (buffs >= 0 && d < 190) useInventorySlot('p2', buffs);
  }
  for (let i = 0; i < p.abilities.length; i++) {
    const id = p.abilities[i];
    if (!id || (p.abCd[id] || 0) > 0 || Math.random() > L.skill * 0.5) continue;
    const use = BOT_HEALS.includes(id) ? hurt < 0.55
      : BOT_GUARDS.includes(id) ? hurt < 0.7 && d < 160
      : id === 'dash' ? d > reach + 60
      : d < 230;
    if (use) { inp['ab' + (i + 1)] = true; break; }
  }
}

// ─── HTTP API (shop / upgrades) ───────────────────────────────────────────────

app.use(express.json({ limit: '64kb' }));

// Open custom rooms, for the JOIN A ROOM list.
app.get('/api/rooms', (_req, res) => { res.json({ rooms: openRoomList() }); });

app.get('/api/catalog', (_req, res) => {
  res.json({ catalog: weaponCatalog(), perks: PERK_UPGRADES, upgradeDefs: UPGRADE_STATS, costs: costTable(), colors: WEAPON_COLORS, skinShop: SKIN_SHOP, abilityDefs: ABILITIES });
});

app.post('/api/profile', (req, res) => {
  const pw = sanitizeText(req.body?.password, 32);
  if (!pw) return res.status(400).json({ error: 'A password is required to save upgrades.' });
  const p = profileFor(pw, { localXp: req.body?.localXp, localCoins: req.body?.localCoins, backup: req.body?.backup });
  res.json({ ...p, catalog: weaponCatalog(), perks: PERK_UPGRADES, upgradeDefs: UPGRADE_STATS, costs: costTable(), colors: WEAPON_COLORS, skinShop: SKIN_SHOP, abilityDefs: ABILITIES });
});

// Hand a player's equipped abilities to any match they're in right now.
function pushAbilities(pw, slots) {
  for (const [r, key] of liveSeats(pw)) {
    r.playerAbilities[key] = slots;
    const p = r.players[key];
    if (p) p.abilities = slots.slice();
  }
}

// Abilities: bought once, kept forever. A new one drops into an empty slot.
app.post('/api/buy_ability', (req, res) => {
  const pw = sanitizeText(req.body?.password, 32);
  if (!pw) return res.status(400).json({ error: 'A password is required to buy abilities.' });
  const id = sanitizeText(req.body?.abilityId, 16);
  const def = ABILITY_BY_ID[id];
  if (!def) return res.status(400).json({ error: 'Unknown ability.' });

  const admin = isAdminPw(pw);
  const prof = profileFor(pw, { localCoins: req.body?.localCoins, backup: req.body?.backup });
  if (prof.abilities.includes(id)) return res.status(400).json({ error: 'You already own that ability.' });
  if (prof.coins < def.price) return res.status(400).json({ error: 'Not enough coins.' });

  const d = progress();
  const owned = [...prof.abilities, id];
  const slots = prof.abilitySlots.slice();
  const free = slots.indexOf(null);
  if (free >= 0) slots[free] = id;
  d.abilities[pw] = owned;
  d.abilitySlots[pw] = slots;
  d.coins[pw] = prof.coins - def.price;
  markDirty();
  for (const [r, key] of liveSeats(pw)) r.playerCoins[key] = d.coins[pw];
  pushAbilities(pw, slots);
  const next = profileFor(pw, {});
  res.json({ ...next, spent: def.price });
});

// Put an owned ability in a slot (0 = Q, 1 = E); an empty id clears the slot.
// Equipping one that's already in the other slot swaps them.
app.post('/api/equip_ability', (req, res) => {
  const pw = sanitizeText(req.body?.password, 32);
  if (!pw) return res.status(400).json({ error: 'A password is required.' });
  const id = sanitizeText(req.body?.abilityId, 16);
  const slot = Math.floor(Number(req.body?.slot));
  const prof = profileFor(pw, { backup: req.body?.backup });
  if (!(slot >= 0 && slot < prof.slotCount)) return res.status(400).json({ error: 'Unknown slot.' });
  if (id && !prof.abilities.includes(id)) return res.status(400).json({ error: 'Buy that ability first.' });
  const slots = prof.abilitySlots.slice();
  const other = id ? slots.indexOf(id) : -1;
  if (other >= 0 && other !== slot) slots[other] = slots[slot];
  slots[slot] = id || null;
  progress().abilitySlots[pw] = slots;
  markDirty();
  pushAbilities(pw, slots);
  res.json(profileFor(pw, {}));
});

// One more ability slot, for a fortune. Each costs twice the one before.
app.post('/api/buy_slot', (req, res) => {
  const pw = sanitizeText(req.body?.password, 32);
  if (!pw) return res.status(400).json({ error: 'A password is required.' });
  if (isAdminPw(pw)) return res.status(400).json({ error: 'You already have every slot.' });
  const prof = profileFor(pw, { localCoins: req.body?.localCoins, backup: req.body?.backup });
  if (prof.slotCount >= MAX_ABILITY_SLOTS) return res.status(400).json({ error: 'You already have every slot.' });
  const price = prof.nextSlotPrice;
  if (prof.coins < price) return res.status(400).json({ error: 'Not enough coins.' });
  const d = progress();
  d.coins[pw] = prof.coins - price;
  d.abilitySlotCount[pw] = prof.slotCount + 1;
  const slots = [...prof.abilitySlots, null];
  d.abilitySlots[pw] = slots;
  markDirty();
  for (const [r, key] of liveSeats(pw)) r.playerCoins[key] = d.coins[pw];
  pushAbilities(pw, slots);
  res.json({ ...profileFor(pw, {}), spent: price, newKey: AB_KEYS[prof.slotCount] });
});

app.post('/api/upgrade', (req, res) => {
  const pw = sanitizeText(req.body?.password, 32);
  if (!pw) return res.status(400).json({ error: 'A password is required to save upgrades.' });
  const weaponId = sanitizeText(req.body?.weaponId, 24);
  const stat = sanitizeText(req.body?.stat, 8);
  if (!isUpgradeTarget(weaponId)) return res.status(400).json({ error: 'Unknown weapon.' });
  if (!UPGRADE_STATS[stat] || !upgradesFor(weaponId).includes(stat)) {
    return res.status(400).json({ error: 'That weapon has no such upgrade.' });
  }

  const admin = isAdminPw(pw);
  const prof = profileFor(pw, { backup: req.body?.backup });
  if (!PERK_UPGRADES[weaponId] && !prof.weapons.includes(weaponId)) {
    return res.status(400).json({ error: 'Unlock that weapon first.' });
  }

  // `count`: how many levels to buy in one go (queued taps), or 'max' for as
  // many as the coins cover. Stops early at the level cap or when coins run out.
  const d = progress();
  const levels = prof.upgrades[weaponId] || {};
  const start = levels[stat] || 0;
  const max = UPGRADE_STATS[stat].max;
  if (start >= max) {
    return res.status(400).json({ error: 'Already at max level.' });
  }
  const want = req.body?.count === 'max' ? max
    : Math.max(1, Math.min(max, Math.floor(Number(req.body?.count) || 1)));
  let lv = start, coins = prof.coins, cost = 0;
  while (lv < max && lv - start < want) {
    const c = upgradeCost(stat, lv + 1);
    if (!admin && coins < c) break;
    if (!admin) coins -= c;
    cost += c;
    lv++;
  }
  if (lv === start) {
    return res.status(400).json({ error: 'Not enough coins.' });
  }

  if (!d.upgrades[pw]) d.upgrades[pw] = {};
  if (!d.upgrades[pw][weaponId]) d.upgrades[pw][weaponId] = {};
  d.upgrades[pw][weaponId][stat] = lv;
  if (!admin) d.coins[pw] = coins;
  markDirty();

  // Push the new levels into a live game if this player is mid-match.
  for (const [room, key] of liveSeats(pw)) {
    const ups = normalizeUpgrades(d.upgrades[pw]);
    room.playerUpgrades[key] = ups;
    if (!admin) room.playerCoins[key] = d.coins[pw];
    const p = room.players[key];
    if (p) { p.upgrades = ups; refreshWeapon(p); applyPerks(p); }
  }

  const next = profileFor(pw, {});
  res.json({ ...next, spent: admin ? 0 : cost, bought: lv - start });
});

app.post('/api/buy_skin', (req, res) => {
  const pw = sanitizeText(req.body?.password, 32);
  if (!pw) return res.status(400).json({ error: 'A password is required to buy skins.' });
  const skinId = sanitizeText(req.body?.skinId, 16);
  const def = SKIN_BY_ID[skinId];
  if (!def) return res.status(400).json({ error: 'Unknown skin.' });

  const admin = isAdminPw(pw);
  const prof = profileFor(pw, { localCoins: req.body?.localCoins, backup: req.body?.backup });
  if (prof.ownedSkins.includes(skinId)) return res.status(400).json({ error: 'You already own that skin.' });
  if (!admin && prof.coins < def.price) return res.status(400).json({ error: 'Not enough coins.' });

  const d = progress();
  if (!admin) {
    d.ownedSkins[pw] = [...prof.ownedSkins, skinId];
    d.coins[pw] = prof.coins - def.price;
    markDirty();
    for (const [room, key] of liveSeats(pw)) room.playerCoins[key] = d.coins[pw];
  }
  const next = profileFor(pw, {});
  res.json({ ...next, spent: admin ? 0 : def.price, skinShop: SKIN_SHOP });
});

// Shop-only weapons: bought with coins, and only once every XP weapon is unlocked.
app.post('/api/buy_weapon', (req, res) => {
  const pw = sanitizeText(req.body?.password, 32);
  if (!pw) return res.status(400).json({ error: 'A password is required to buy weapons.' });
  const weaponId = sanitizeText(req.body?.weaponId, 24);
  const def = WEAPON_BY_ID[weaponId];
  if (!def || !def.shopOnly) return res.status(400).json({ error: 'That weapon is not for sale.' });
  if (def.bossReward) return res.status(400).json({ error: def.id === 'infinitybow' ? 'Only won by defeating the Abyss.' : def.id === 'endlessscythe' ? 'Only won by defeating the Abyss a second time.' : 'Only won by defeating the Portal Mage.' });
  if (def.needAll) {
    const prof0 = profileFor(pw, { localXp: req.body?.localXp, localCoins: req.body?.localCoins, backup: req.body?.backup });
    const left = WEAPONS.filter(w => w.id !== weaponId && !prof0.weapons.includes(w.id)).length;
    if (left) return res.status(400).json({ error: `Own every other weapon first (${left} to go).` });
  }

  const admin = isAdminPw(pw);
  const prof = profileFor(pw, { localXp: req.body?.localXp, localCoins: req.body?.localCoins, backup: req.body?.backup });
  if (prof.weapons.includes(weaponId)) return res.status(400).json({ error: 'You already own that weapon.' });
  const missing = def.noRequirement ? 0 : XP_WEAPON_IDS.filter(id => !prof.weapons.includes(id)).length;
  // Some legendaries are only for players who already own another one.
  if (def.needMind) {
    const tomeLv = prof.upgrades?.stormtome || {};
    const tomeMaxed = prof.weapons.includes('stormtome') && upgradesFor('stormtome').every(k => (tomeLv[k] || 0) >= UPGRADE_STATS[k].max);
    const legends = SHOP_WEAPONS.filter(w => w.id !== weaponId && prof.weapons.includes(w.id)).length;
    if (!tomeMaxed) return res.status(400).json({ error: 'Max out every upgrade on the Storm Tome first.' });
    if (legends < MIND_LEGENDS) return res.status(400).json({ error: `Own ${MIND_LEGENDS} other legendary weapons first (${legends}/${MIND_LEGENDS}).` });
  }
  if (def.needSamurai && !admin && prof.samuraiKills < SAM_KILLS_NEED) {
    return res.status(400).json({ error: `Defeat ${SAM_KILLS_NEED} samurai first (${prof.samuraiKills}/${SAM_KILLS_NEED}).` });
  }
  if (def.needLight && !admin) {
    if (prof.lightKills < LIGHT_KILLS_NEED) return res.status(400).json({ error: `Beat Light ${LIGHT_KILLS_NEED} times first (${prof.lightKills}/${LIGHT_KILLS_NEED}).` });
    if (prof.lightMaxed < prof.lightMaxedNeed) return res.status(400).json({ error: `Max out at least ${prof.lightMaxedNeed} weapons first (${prof.lightMaxed}/${prof.lightMaxedNeed}).` });
  }
  if (def.needLegendary && !SHOP_WEAPONS.some(w => w.id !== weaponId && prof.weapons.includes(w.id))) {
    return res.status(400).json({ error: 'Own at least one other legendary weapon first.' });
  }
  if (missing) return res.status(400).json({ error: `Unlock every other weapon first (${missing} to go).` });
  if (!admin && prof.coins < def.price) return res.status(400).json({ error: 'Not enough coins.' });

  const d = progress();
  const weapons = sortWeaponIds([...prof.weapons, weaponId]);
  if (!admin) {
    d.weapons[pw] = weapons;
    d.coins[pw] = prof.coins - def.price;
    markDirty();
  }
  // Hand it over in a live match straight away.
  for (const [room, key] of liveSeats(pw)) {
    room.playerUnlocks[key] = weapons;
    if (!admin) room.playerCoins[key] = d.coins[pw];
    const p = room.players[key];
    if (p) {
      const cur = p.unlockedWeapons[p.weaponIdx];
      p.unlockedWeapons = weapons;
      p.weaponIdx = Math.max(0, weapons.indexOf(cur));
      refreshWeapon(p);
    }
  }
  const next = profileFor(pw, {});
  res.json({ ...next, spent: admin ? 0 : def.price });
});

// ─── WebSocket Connections ────────────────────────────────────────────────────

function clearSlot(key) {
  room[key] = null;
  room[key + 'Joined'] = false;
  room.playerNames[key] = 'PLAYER ' + key.slice(1);
  room.passwords[key] = '';
  room.playerXp[key] = 0;
  room.playerCoins[key] = 0;
  room.playerSkins[key] = null;
  room.playerUnlocks[key] = null;
  room.playerUpgrades[key] = null;
  room.playerAbilities[key] = null;
  room.unlockQueues[key] = [];
  room.players[key] = null;
  room.inputs[key] = blankInput();
  room.prevInputs[key] = blankPrev();
}

// Drop slots whose socket died without a close event, and rooms left empty.
function reapRooms() {
  for (const r of rooms.slice()) {
    useRoom(r);
    for (const key of KEYS) if (r[key] && r[key].readyState !== 1) clearSlot(key);
    if (KEYS.every(k => !r[k])) rooms.splice(rooms.indexOf(r), 1);
  }
}

// Seat a player who picked a mode. WAVES and EXTREME are solo, so they always
// get a room of their own; PvP and co-op pair up with someone waiting for the
// same mode, or open a new room and wait.
function findSeat(mode, size) {
  if (!SOLO_MODES.includes(mode)) {
    for (const r of rooms) {
      if (r.gameState !== 'LOBBY' || r.gameMode !== mode || r.bot || r.custom || r.mapSize !== size) continue;
      const free = seatKeys(r).find(k => !r[k]);
      if (free && KEYS.some(k => r[k])) return [r, free];
    }
  }
  const r = makeRoom();
  r.gameMode = mode;
  r.mapSize = size;
  rooms.push(r);
  return [r, 'p1'];
}

// ── Custom PvP rooms ──
// Made with a name, a player count (2-4: more than two is last one standing)
// and a map size; listed for everyone to browse and join until they fill up.
const ROOM_NAME_MAX = 20;
function createRoom(opts) {
  const r = makeRoom();
  r.gameMode = 'pvp';
  r.maxPlayers = Math.max(2, Math.min(4, Math.floor(Number(opts.maxPlayers) || 2)));
  r.mapSize = MAP_SIZES[opts.size] ? opts.size : 'medium';
  r.custom = { name: sanitizeText(opts.roomName, ROOM_NAME_MAX) || 'ROOM', host: sanitizeText(opts.name, 12).toUpperCase() || 'PLAYER' };
  rooms.push(r);
  return [r, 'p1'];
}
function openRoomList() {
  return rooms.filter(r => r.custom && r.gameState === 'LOBBY' && KEYS.some(k => r[k]) && seatKeys(r).some(k => !r[k]))
    .map(r => ({ id: r.id, name: r.custom.name, host: r.custom.host, size: r.mapSize, maxPlayers: r.maxPlayers,
                 players: seatKeys(r).filter(k => r[k]).length, names: seatKeys(r).filter(k => r[k]).map(k => r.playerNames[k]) }));
}

// ── Safe chat: only these lines can be sent ──
const CHAT_LINES = ['HELLO!', 'GOOD LUCK!', 'HAVE FUN!', 'NICE ONE!', 'WELL PLAYED!', 'GG!', 'OOPS!', 'SO CLOSE!',
                    'WATCH OUT!', 'HELP!', 'THANKS!', 'SORRY!', 'REMATCH?', 'LET\'S GO!', 'HAHA!', 'WOW!'];
const CHAT_SHOW_MS = 3500, CHAT_GAP_MS = 1200;

wss.on('connection', (ws) => {
  // Not seated until the player picks a mode (the join message).
  ws.send(JSON.stringify({
    type: 'welcome', num: 0,
    leaderboard: getLeaderboard(),
    world: { w: CANVAS_W, h: CANVAS_H, ax: ARENA_X, ay: ARENA_Y, aw: ARENA_W, ah: ARENA_H },
    playerSpeed: PLAYER_SPEED,
    catalog: weaponCatalog(),
    abilityDefs: ABILITIES,
    colors: WEAPON_COLORS,
    chatLines: CHAT_LINES,
    // What the sandbox panel can spawn.
    sandboxDefs: {
      monsters: Object.entries(MONSTER_TYPES).map(([id, m]) => ({ id, name: m.name, color: m.color, boss: !!m.boss })),
      items: Object.entries(ITEM_TYPES).map(([id, t]) => ({ id, name: t.name, color: t.color })),
      traps: Object.entries(TRAP_TYPES).map(([id, t]) => ({ id, name: t.name, color: t.color })),
    },
  }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      // The client confirms each snapshot it has drawn. How old the newest
      // confirmed one is tells us whether anything is queuing up on the way.
      if (msg.type === 'ack') {
        const st = Number(msg.st), now = Date.now();
        if (Number.isFinite(st) && st <= now && st > (ws.ackSt || 0)) {
          ws.ackSt = st;
          const age = now - st;
          ws.minAckAge = ws.minAckAge === undefined || age < ws.minAckAge ? age : ws.minAckAge + 0.5;
        }
        return;
      }
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', t: msg.t }));
        return;
      }
      if (msg.type === 'join' && !ws.room) {
        const mode = ['pvp', 'coop', 'waves', 'extreme', 'portal', 'abyss', 'sandbox', 'bot', 'create', 'joinroom'].includes(msg.mode) ? msg.mode : 'pvp';
        const size = MAP_SIZES[msg.size] ? msg.size : 'medium';
        // EXTREME and the PORTAL MAGE open up with XP (admins skip the wait).
        if (MODE_XP[mode]) {
          const pw = sanitizeText(msg.password, 32);
          const saved = pw ? (isAdminPw(pw) ? Infinity : (progress().players[pw] || 0)) : 0;
          const xp = Math.max(saved, Math.floor(Number(msg.localXp) || 0));
          if (xp < MODE_XP[mode]) { ws.send(JSON.stringify({ type: 'mode_locked', mode, need: MODE_XP[mode], xp: Number.isFinite(xp) ? xp : 0 })); return; }
        }
        reapRooms();
        let seat = null;
        if (mode === 'joinroom') {
          // A listed room: take its first free seat, if it is still open.
          const r = rooms.find(o => o.id === msg.roomId && o.custom && o.gameState === 'LOBBY');
          const free = r && seatKeys(r).find(k => !r[k]);
          if (!free) { ws.send(JSON.stringify({ type: 'room_gone' })); return; }
          seat = [r, free];
        }
        // BOT BATTLE: a PvP room of your own, the bot in the other seat.
        const [r, key] = seat || (mode === 'bot' ? newBotRoom(BOT_LEVELS[msg.level] ? msg.level : 'average', size)
          : mode === 'create' ? createRoom({ ...msg, size }) : findSeat(mode, size));
        ws.room = r; ws.key = key;
        if (mode === 'sandbox' && msg.tutorial) r.tutorial = true;
        r[key] = ws;
        ws.send(JSON.stringify({ type: 'seat', num: KEYS.indexOf(key) + 1, mode, maxPlayers: r.maxPlayers, roomName: r.custom ? r.custom.name : null }));
      }
      if (!ws.room) return;
      useRoom(ws.room);
      const myKey = ws.key, isP1 = myKey === 'p1';

      if (msg.type === 'join') {
        room.playerNames[myKey] = sanitizeText(msg.name, 12).toUpperCase() || 'PLAYER ' + myKey.slice(1);

        const pw = sanitizeText(msg.password, 32);
        room.passwords[myKey] = pw;
        const admin = isAdminPw(pw);

        const prof = pw
          ? profileFor(pw, { localXp: msg.localXp, localCoins: msg.localCoins, backup: msg.backup })
          : { xp: 0, coins: 0, weapons: getUnlockedWeaponIds(0), upgrades: {}, ownedSkins: [] };

        room.playerXp[myKey]       = prof.xp;
        room.playerCoins[myKey]    = prof.coins;
        room.playerUnlocks[myKey]  = prof.weapons;
        room.playerUpgrades[myKey] = prof.upgrades;
        room.playerAbilities[myKey] = prof.abilitySlots || [null, null];

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
        const save = pw && makeSave(pw);
        if (save) { ws.lastSave = save.data; ws.send(JSON.stringify({ type: 'save', save })); }

        room[myKey + 'Joined'] = true;
        if (room.bot && !room.p2Joined) setupBot();
        room.playerNames[myKey] = room.playerNames[myKey] || 'PLAYER';

        // Start game: solo modes at once, the others once both have joined.
        const canStart = isSolo()
          ? room.p1Joined
          : seatKeys().every(k => room[k + 'Joined']);

        if (canStart && room.gameState === 'LOBBY') startGame();
        broadcastState();
      }

      if (msg.type === 'input' && msg.keys && typeof msg.keys === 'object') {
        const k = msg.keys;
        room.inputs[myKey] = {
          up: !!k.up, down: !!k.down, left: !!k.left, right: !!k.right,
          attack: !!k.attack, swap: !!k.swap, swapPrev: !!k.swapPrev, special: !!k.special, parry: !!k.parry, super: !!k.super,
          ab1: !!k.ab1, ab2: !!k.ab2, ab3: !!k.ab3, ab4: !!k.ab4, ab5: !!k.ab5, ab6: !!k.ab6,
          // Mouse position in world space (desktop only): where DASH goes.
          aimX: Number.isFinite(k.aimX) ? k.aimX : null, aimY: Number.isFinite(k.aimY) ? k.aimY : null,
        };
      }

      // Safe chat: a line from the fixed list, a few at most per second.
      if (msg.type === 'chat' && Number.isInteger(msg.id) && msg.id >= 0 && msg.id < CHAT_LINES.length) {
        const now = Date.now();
        if (now - (ws.lastChat || 0) >= CHAT_GAP_MS) {
          ws.lastChat = now;
          room.chats = room.chats.filter(c => c.key !== myKey && now - c.t < CHAT_SHOW_MS);
          room.chats.push({ key: myKey, id: msg.id, t: now });
        }
      }

      // Light Blade: a click or tap on the field is an attack aimed at that spot.
      if (msg.type === 'blade_dash' && Number.isFinite(msg.x) && Number.isFinite(msg.y)) {
        const p = room.players[myKey];
        if (p && !p.dead && weapon(p).lightDash) p.bladeClick = { x: msg.x, y: msg.y, at: Date.now() };
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
        useInventorySlot(myKey, msg.index);
      }

      if (msg.type === 'sandbox' && room.gameMode === 'sandbox' && room.gameState === 'GAMEPLAY') sandboxAction(myKey, msg);

      // Admin tool: wipe out the current wave and go straight to the next.
      if (msg.type === 'skip_wave' && isAdminPw(room.passwords[myKey])) adminSkipWave();

      if (msg.type === 'ack_unlock' && room.gameState === 'WEAPON_UNLOCK') {
        room.unlockQueues[myKey].shift();
        const p1Done = room.unlockQueues.p1.length === 0;
        const othersDone = isSolo() || KEYS.slice(1).every(k => !room[k + 'Joined'] || room.unlockQueues[k].length === 0);
        if (p1Done && othersDone) {
          if (isSolo()) endWavesRun();
          else startGame();
        }
      }
    } catch {}
  });

  ws.on('close', () => {
    const r = ws.room;
    if (!r || r[ws.key] !== ws) return;
    useRoom(r);
    const wasPlaying = room.gameState !== 'LOBBY';
    clearSlot(ws.key);
    // A match can't continue a fighter down — drop back to the lobby, but keep
    // whoever is still connected (and their progress) in place.
    if (wasPlaying) resetToLobby();
    if (KEYS.every(k => !room[k])) { rooms.splice(rooms.indexOf(r), 1); return; }
    broadcastState();
  });
});

// ─── Static Files ─────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, file) {
    if (/\.(js|css|html)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
  },
}));

server.listen(PORT, () => console.log('Weponare running on port', PORT));
