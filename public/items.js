'use strict';
// ITEMS: bought in the armoury, kept forever, upgraded up to level 3. You take as
// many into a fight as you have item slots (1, and up to 3 bought). Both sides load
// this file (the server for the numbers, the page to show them), so an item can't
// say one thing in the shop and do another in a fight. Ids are saved in players'
// files: only ever add items, never rename one.
//
// kind:  'passive' always on
//        'active'  used with its key (5, 6, 7 or its button), then waits `cd` ms
//        'once'    ONE-TIME-USE: used with its key, once a match
//        'auto'    ONE-TIME-USE: goes off by itself, once a match
// v:     its number at levels 1, 2 and 3 (what `text` puts in place of {v})
(function (root) {
  const LIST = [
    // ── passives ──
    { id: 'heart',  name: 'HEART CHARM',      icon: '❤️', color: '#ff4a6a', kind: 'passive', price: 40000,  v: [15, 25, 35],    text: '+{v} max health' },
    { id: 'boots',  name: 'SWIFT BOOTS',      icon: '👢', color: '#c8884a', kind: 'passive', price: 60000,  v: [6, 9, 12],      text: '+{v}% move speed' },
    { id: 'thorns', name: 'THORN RING',       icon: '🌹', color: '#e83a5a', kind: 'passive', price: 80000,  v: [15, 22, 30],    text: 'when you are hit, the nearest foe takes {v}% of it back' },
    { id: 'fang',   name: 'VAMPIRE FANG',     icon: '🦷', color: '#e8e0f0', kind: 'passive', price: 90000,  v: [3, 5, 7],       text: 'heal {v}% of the damage you deal' },
    { id: 'coin',   name: 'LUCKY COIN',       icon: '🪙', color: '#ffd84a', kind: 'passive', price: 50000,  v: [15, 25, 40],    text: '+{v}% coins from kills' },
    { id: 'moss',   name: 'REGEN MOSS',       icon: '🌿', color: '#5ae87a', kind: 'passive', price: 70000,  v: [1, 1.5, 2.5],   text: 'unhurt for 4s: heal {v}% of your health a second' },
    { id: 'plate',  name: 'IRON PLATE',       icon: '🧱', color: '#a8b0c0', kind: 'passive', price: 100000, v: [5, 8, 12],      text: 'take {v}% less damage' },
    { id: 'whet',   name: 'WHETSTONE',        icon: '🔪', color: '#c8d8e8', kind: 'passive', price: 100000, v: [5, 8, 12],      text: 'deal {v}% more damage' },
    { id: 'scroll', name: "SCHOLAR'S SCROLL", icon: '📜', color: '#e8d8a0', kind: 'passive', price: 50000,  v: [15, 25, 40],    text: '+{v}% XP' },
    { id: 'eye',    name: 'HAWK EYE',         icon: '🦅', color: '#d8a86a', kind: 'passive', price: 90000,  v: [5, 8, 12],      text: '{v}% chance a hit does double damage' },
    { id: 'rage',   name: 'ADRENALINE',       icon: '💢', color: '#ff5a3a', kind: 'passive', price: 80000,  v: [15, 25, 35],    text: 'under 35% health: deal {v}% more damage' },
    { id: 'breath', name: 'LAST BREATH',      icon: '🕯️', color: '#ffe8a0', kind: 'auto',    price: 150000, v: [10, 20, 35],    text: 'the first hit that would kill you leaves you on {v}% health, untouchable for 1.5s' },
    // ── actives: use, wait, use again ──
    { id: 'blink',  name: 'BLINK STONE',      icon: '💠', color: '#5ad8ff', kind: 'active',  price: 90000,  v: [110, 140, 170], cd: 12000, text: 'teleport {v} steps the way you are moving' },
    { id: 'smoke',  name: 'SMOKE BOMB',       icon: '💨', color: '#b8b8c8', kind: 'active',  price: 120000, v: [1.2, 1.6, 2],   cd: 25000, text: 'nothing can hurt you for {v}s' },
    { id: 'horn',   name: 'WAR HORN',         icon: '📯', color: '#ffb02a', kind: 'active',  price: 100000, v: [20, 28, 36],    cd: 30000, text: 'deal {v}% more damage for 6s' },
    { id: 'frost',  name: 'FROST ORB',        icon: '❄️', color: '#8ad8ff', kind: 'active',  price: 110000, v: [1.5, 2, 2.5],   cd: 22000, text: 'freezes monsters near you for {v}s (players are slowed)' },
    { id: 'wind',   name: 'SECOND WIND',      icon: '🌬️', color: '#c8f0ff', kind: 'active',  price: 100000, v: [15, 22, 30],    cd: 40000, text: 'heal {v}% of your health' },
    { id: 'haste',  name: 'HASTE CHARM',      icon: '⚡', color: '#ffe84a', kind: 'active',  price: 70000,  v: [3, 4, 5],       cd: 25000, text: 'run much faster for {v}s' },
    { id: 'quake',  name: 'QUAKE DRUM',       icon: '🥁', color: '#c86a3a', kind: 'active',  price: 110000, v: [30, 45, 60],    cd: 18000, text: 'hits everything close for {v} and throws it back' },
    // ── ONE-TIME-USE: once a match ──
    { id: 'potion', name: 'HEALTH POTION',    icon: '🧪', color: '#ff5a8a', kind: 'once',    price: 40000,  v: [40, 60, 80],    text: 'heal {v}% of your health' },
    { id: 'bomb',   name: 'FIRE BOMB',        icon: '💣', color: '#ff7a2a', kind: 'once',    price: 120000, v: [120, 180, 250], text: 'a blast: {v} damage to everything close' },
    { id: 'bubble', name: 'GUARDIAN BUBBLE',  icon: '🛡️', color: '#7ab8ff', kind: 'once',    price: 90000,  v: [60, 100, 150],  text: 'a bubble soaks up the next {v} damage (8s)' },
    { id: 'clock',  name: 'TIME RESET',       icon: '⏳', color: '#d8b8ff', kind: 'once',    price: 130000, v: [1, 2, 3],       text: 'level 1: your special is ready at once; 2: and your super; 3: and your abilities' },
    { id: 'apple',  name: 'GOLDEN APPLE',     icon: '🍎', color: '#ffc83a', kind: 'once',    price: 100000, v: [20, 35, 50],    text: '+{v} max health for the rest of the match, and full health' },
  ];
  const BY_ID = Object.fromEntries(LIST.map(t => [t.id, t]));
  const MAX_LV = 3, START_SLOTS = 1, MAX_SLOTS = 3, SLOT_PRICE = 500000;
  const KINDS = { passive: 'PASSIVE', active: 'ACTIVE', once: 'ONE-TIME-USE', auto: 'ONE-TIME-USE (BY ITSELF)' };
  // Level 2 costs one and a half times the item, level 3 three times.
  const upPrice = (t, lv) => lv >= MAX_LV ? 0 : Math.round(t.price * (lv === 1 ? 1.5 : 3));
  const val = (t, lv) => t.v[Math.max(0, Math.min(MAX_LV, lv || 1)) - 1];
  const describe = (t, lv) => t.text.replace('{v}', String(val(t, lv)));
  const usable = t => t.kind === 'active' || t.kind === 'once';
  const Items = { LIST, BY_ID, MAX_LV, START_SLOTS, MAX_SLOTS, SLOT_PRICE, KINDS, upPrice, val, describe, usable };
  if (typeof module !== 'undefined' && module.exports) module.exports = Items;
  else root.Items = Items;
})(typeof window !== 'undefined' ? window : globalThis);
