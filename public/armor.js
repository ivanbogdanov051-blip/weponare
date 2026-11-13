'use strict';
// THE ARMOURY: every piece of armour in the game. Both sides load this one file
// (the server to work out stats and prices, the page to draw them), so a piece
// can't say one thing in the shop and do another in a fight.
//
// A piece is one of 40 sets × 3 slots, 120 in all, or one of 56 shields, which go
// in a fourth slot. Most passives are the same numbers the forge uses (see forgeFx
// in server.js), so they work with every weapon. Ids are saved in players' files:
// only ever add pieces, never rename one.
(function (root) {
  const RARITIES = [
    { id: 'common',    name: 'COMMON',    color: '#b8c0cc', weight: 28, price: [1500, 4000],      hp: [10, 30] },
    { id: 'uncommon',  name: 'UNCOMMON',  color: '#5ad86a', weight: 26, price: [8000, 16000],     hp: [20, 45] },
    { id: 'rare',      name: 'RARE',      color: '#4aa8ff', weight: 20, price: [30000, 55000],    hp: [35, 60] },
    { id: 'epic',      name: 'EPIC',      color: '#c05aff', weight: 14, price: [90000, 150000],   hp: [50, 100] },
    { id: 'legendary', name: 'LEGENDARY', color: '#ffb82a', weight: 9,  price: [300000, 500000],  hp: [75, 150] },
    { id: 'mythic',    name: 'MYTHIC',    color: '#ff2a3a', weight: 3,  price: [1000000, 2000000], hp: [100, 200] },
  ];
  const SLOTS = { head: 'HELMET', chest: 'CHESTPLATE', legs: 'LEGGINGS', shield: 'SHIELD' };
  const HELM_WORD = { cap: 'CAP', hood: 'HOOD', visor: 'VISOR', great: 'GREATHELM', mask: 'MASK', circlet: 'CROWN' };
  const CHEST_WORD = { vest: 'VEST', plate: 'CUIRASS', robe: 'ROBE', scale: 'SCALEMAIL', spiked: 'WARPLATE' };
  const LEGS_WORD = { pants: 'TROUSERS', greaves: 'GREAVES', tasset: 'TASSETS', scale: 'LEGGUARDS', spiked: 'WARBOOTS' };

  // [id, name, rarity, [dark, mid, light, accent], helm, crest, chest, legs, motif, [hp×3], [passives×3]]
  const SETS = [
    // ── COMMON: only health ──
    ['leather', 'LEATHER', 0, ['#4a2e18', '#8a5a30', '#b8884a', '#e0b070'], 'cap', '', 'vest', 'pants', 'stitch', [12, 20, 14]],
    ['wool', 'WOOLEN', 0, ['#4a4a5a', '#8a8a9a', '#b8b8c8', '#e8d8a8'], 'hood', '', 'robe', 'pants', 'stitch', [10, 16, 12]],
    ['copper', 'COPPER', 0, ['#5a3014', '#b06a2a', '#e09a4a', '#ffd08a'], 'cap', '', 'plate', 'greaves', 'diamond', [15, 24, 18]],
    ['tin', 'TIN', 0, ['#4a5a6a', '#8a9aaa', '#c0ccd8', '#f0f4f8'], 'visor', '', 'plate', 'greaves', 'cross', [14, 22, 16]],
    ['bark', 'BARKSKIN', 0, ['#2e2012', '#5a4428', '#7a6a3a', '#9ac05a'], 'hood', '', 'vest', 'tasset', 'leaf', [13, 21, 17]],
    ['hide', 'BEAST HIDE', 0, ['#54382a', '#9a7050', '#c8a070', '#f0d8b0'], 'cap', 'horns', 'vest', 'pants', 'claw', [16, 26, 19]],
    ['bone', 'BONE', 0, ['#6a6450', '#c8c0a8', '#e8e4d0', '#4a4030'], 'mask', '', 'spiked', 'tasset', 'skull', [18, 28, 20]],
    ['rusty', 'RUSTY', 0, ['#4a2214', '#8a4a2a', '#b0703a', '#d8a060'], 'great', '', 'plate', 'greaves', 'cross', [17, 30, 22]],

    // ── UNCOMMON: health and a small passive ──
    ['iron', 'IRON', 1, ['#3a4250', '#6a7686', '#9aa8b8', '#d8e4f0'], 'visor', '', 'plate', 'greaves', 'shield', [26, 42, 30],
      [{ armor: 0.03 }, { armor: 0.05 }, { armor: 0.04 }]],
    ['scout', 'SCOUT', 1, ['#26402a', '#4a7a4a', '#7ab06a', '#e8d870'], 'hood', 'plume', 'vest', 'pants', 'arrow', [20, 30, 24],
      [{ rng: 0.05 }, { speed: 0.05 }, { speed: 0.07 }]],
    ['hunter', 'HUNTER', 1, ['#3a2a18', '#7a5a2a', '#a88a3a', '#ff8a3a'], 'cap', 'plume', 'scale', 'pants', 'claw', [22, 34, 26],
      [{ crit: 0.03 }, { crit: 0.04 }, { fresh: 0.08 }]],
    ['bronze', 'BRONZE', 1, ['#4a3010', '#a0702a', '#d8a84a', '#ffe08a'], 'great', 'plume', 'plate', 'tasset', 'sword', [25, 40, 28],
      [{ dmg: 0.03 }, { dmg: 0.05 }, { knock: 5 }]],
    ['moss', 'MOSSGROWN', 1, ['#1e3a1e', '#3a7a3a', '#6ab04a', '#c8ff7a'], 'hood', '', 'robe', 'tasset', 'leaf', [23, 36, 27],
      [{ regen: 0.3 }, { regen: 0.5 }, { regen: 0.4 }]],
    ['sentinel', 'SENTINEL', 1, ['#22344a', '#3a5a8a', '#6a8ab8', '#ffd84a'], 'visor', 'spikes', 'plate', 'greaves', 'shield', [24, 38, 29],
      [{ parryCd: 0.06 }, { parryWin: 0.08 }, { parryCd: 0.08 }]],
    ['gambler', 'GAMBLER', 1, ['#3a1a3a', '#7a3a6a', '#b06a9a', '#ffd84a'], 'cap', '', 'vest', 'pants', 'coin', [20, 32, 22],
      [{ killCoins: 0.06 }, { killCoins: 0.1 }, { killCoins: 0.08 }]],
    ['scholar', 'SCHOLAR', 1, ['#1e2a5a', '#3a4a9a', '#6a7ac8', '#e8e0a8'], 'hood', '', 'robe', 'pants', 'eye', [21, 33, 25],
      [{ killXp: 0.06 }, { killXp: 0.1 }, { killXp: 0.08 }]],

    // ── RARE: more health, a bigger passive ──
    ['steel', 'STEEL', 2, ['#2e3a4a', '#6a7a8e', '#b0c0d0', '#7ad8ff'], 'great', '', 'plate', 'greaves', 'shield', [42, 60, 46],
      [{ armor: 0.06 }, { armor: 0.09 }, { thorns: 0.06 }]],
    ['frostbite', 'FROSTBITTEN', 2, ['#1a3a5a', '#3a7ab0', '#8ad0f0', '#e8ffff'], 'visor', 'spikes', 'scale', 'greaves', 'snow', [38, 54, 42],
      [{ chill: 600 }, { chill: 900 }, { stunRes: 0.2 }]],
    ['ember', 'EMBERWEAVE', 2, ['#4a1408', '#b03a12', '#ff7a1a', '#ffd84a'], 'hood', 'spikes', 'robe', 'tasset', 'flame', [36, 52, 40],
      [{ burn: 600 }, { burn: 900 }, { speed: 0.08 }]],
    ['viper', 'VIPER', 2, ['#123a1e', '#2a7a3a', '#5ac85a', '#d8ff4a'], 'mask', 'fins', 'scale', 'scale', 'drop', [35, 50, 38],
      [{ venom: 2 }, { venom: 3 }, { dodge: 0.05 }]],
    ['stormcloth', 'STORMCLOTH', 2, ['#22285a', '#4a4ab0', '#8a8ae8', '#ffe84a'], 'hood', 'fins', 'robe', 'pants', 'bolt', [37, 52, 41],
      [{ spCd: 0.06 }, { suCd: 0.08 }, { speed: 0.1 }]],
    ['shadow', 'SHADOW', 2, ['#0e0e1e', '#2a2a44', '#4a4a6a', '#a07aff'], 'mask', '', 'vest', 'scale', 'moon', [35, 48, 37],
      [{ dodge: 0.05 }, { dodge: 0.07 }, { crit: 0.06 }]],
    ['silver', 'SILVER', 2, ['#5a6474', '#a8b4c4', '#e0e8f0', '#ffb8c8'], 'circlet', 'wings', 'plate', 'tasset', 'heart', [39, 56, 44],
      [{ life: 0.02 }, { killHeal: 0.02 }, { regen: 0.8 }]],

    // ── EPIC: 50-100 health and a good passive ──
    ['dragon', 'DRAGONSCALE', 3, ['#3a0e12', '#a01e2a', '#e8502a', '#ffd84a'], 'great', 'horns', 'scale', 'scale', 'flame', [68, 100, 76],
      [{ dmg: 0.1 }, { armor: 0.12 }, { burn: 1200 }]],
    ['obsidian', 'OBSIDIAN', 3, ['#0a0a12', '#26262e', '#4a4a5a', '#ff5a2a'], 'visor', 'spikes', 'spiked', 'spiked', 'diamond', [70, 96, 74],
      [{ thorns: 0.12 }, { armor: 0.14 }, { stunRes: 0.35 }]],
    ['paladin', 'PALADIN', 3, ['#8a7a4a', '#d8ccA0', '#fff6d8', '#ffc82a'], 'great', 'wings', 'plate', 'greaves', 'cross', [66, 92, 72],
      [{ regen: 1.5 }, { ward: 1 }, { parryWin: 0.2 }]],
    ['assassin', 'ASSASSIN', 3, ['#180e1e', '#3a1a3e', '#6a2a5a', '#ff2a6a'], 'mask', 'fins', 'vest', 'pants', 'sword', [50, 70, 54],
      [{ crit: 0.1 }, { critX: 1 }, { speed: 0.15 }]],
    ['thunder', 'THUNDERLORD', 3, ['#1a2a5a', '#2a5ab0', '#5ab0ff', '#ffff7a'], 'visor', 'wings', 'plate', 'tasset', 'bolt', [60, 84, 64],
      [{ shock: 0.12 }, { spd: 0.1 }, { stunCh: 0.08 }]],
    ['bloodmoon', 'BLOODMOON', 3, ['#2a0610', '#7a1228', '#c82a4a', '#ffb0c0'], 'hood', 'horns', 'robe', 'tasset', 'moon', [58, 80, 62],
      [{ life: 0.05 }, { desperate: 0.25 }, { killHeal: 0.04 }]],
    ['tide', 'TIDECALLER', 3, ['#0a3050', '#1a78a8', '#4ac8e0', '#d8ffff'], 'circlet', 'fins', 'scale', 'scale', 'drop', [56, 82, 60],
      [{ spCd: 0.12 }, { suCd: 0.14 }, { magnet: 40 }]],

    // ── LEGENDARY: 75-150 health and two strong passives ──
    ['phoenix', 'PHOENIX', 4, ['#6a1a0a', '#e8501a', '#ffb02a', '#fff0a0'], 'great', 'plume', 'scale', 'tasset', 'flame', [110, 150, 118],
      [{ regen: 3, desperate: 0.3 }, { undying: 1, burn: 2000 }, { speed: 0.25, killHeal: 0.06 }]],
    ['titan', 'TITANFORGED', 4, ['#2a2e36', '#5a6474', '#9aa8b8', '#ffb02a'], 'great', 'horns', 'spiked', 'spiked', 'shield', [125, 150, 130],
      [{ armor: 0.15, thorns: 0.1 }, { armor: 0.2, stunRes: 0.5 }, { knock: 18, thorns: 0.15 }]],
    ['reaper', 'GRIM REAPER', 4, ['#08080e', '#20202c', '#46465a', '#7affb0'], 'hood', 'horns', 'robe', 'tasset', 'skull', [80, 112, 86],
      [{ crit: 0.15, execute: 0.35 }, { killCd: 1500, life: 0.08 }, { speed: 0.3, execute: 0.3 }]],
    ['archangel', 'ARCHANGEL', 4, ['#b0a880', '#f0ecd8', '#ffffff', '#ffd84a'], 'circlet', 'wings', 'plate', 'greaves', 'sun', [95, 140, 100],
      [{ regen: 4, parryWin: 0.4 }, { ward: 1, regen: 2.5 }, { speed: 0.5, dodge: 0.08 }]],
    ['leviathan', 'LEVIATHAN', 4, ['#04283e', '#0e6a8a', '#2ab8c8', '#a8ffe8'], 'visor', 'fins', 'scale', 'scale', 'drop', [100, 145, 108],
      [{ chill: 2000, spCd: 0.2 }, { thorns: 0.2, aura: 8 }, { speed: 0.2, suCd: 0.25 }]],
    ['stormking', 'STORM KING', 4, ['#14143e', '#3a3ab8', '#7a8aff', '#ffff7a'], 'circlet', 'spikes', 'plate', 'tasset', 'bolt', [90, 130, 96],
      [{ shock: 0.25, spd: 0.15 }, { spd: 0.2, stunCh: 0.12 }, { speed: 0.35, momentum: 0.02 }]],

    // ── MYTHIC: 100-200 health and 3 or 4 passives. They glow red. ──
    ['godslayer', 'GODSLAYER', 5, ['#2a0404', '#a00a1a', '#ff3a2a', '#ffe0a0'], 'great', 'horns', 'spiked', 'spiked', 'sword', [150, 200, 160],
      [{ dmg: 0.25, crit: 0.2, giant: 0.4 }, { armor: 0.22, thorns: 0.3, undying: 1, regen: 3 }, { speed: 0.4, dodge: 0.15, dmg: 0.12 }]],
    ['voidemperor', 'VOID EMPEROR', 5, ['#06021a', '#2a0a5a', '#7a1ac8', '#ff5ad8'], 'circlet', 'spikes', 'robe', 'scale', 'eye', [120, 175, 130],
      [{ spCd: 0.3, suCd: 0.3, dmg: 0.15, hitCd: 200 }, { life: 0.12, aura: 14, armor: 0.15 }, { dodge: 0.2, speed: 0.3, sunder: 0.6 }]],
    ['worldeater', 'WORLDEATER', 5, ['#140606', '#4a1a12', '#8a3a1a', '#ff7a1a'], 'mask', 'horns', 'spiked', 'spiked', 'skull', [135, 190, 145],
      [{ reap: 0.1, killHeal: 0.1, warpath: 0.03 }, { lives: 1, armor: 0.18, thorns: 0.2, stunRes: 0.6 }, { knock: 25, speed: 0.3, splash: 0.3, magnet: 80 }]],
    ['eternalsun', 'ETERNAL SUN', 5, ['#8a3a06', '#ff9a0a', '#ffe04a', '#ffffff'], 'circlet', 'wings', 'plate', 'greaves', 'sun', [110, 180, 125],
      [{ burn: 3000, echo: 0.15, regen: 5 }, { ward: 1, aura: 20, armor: 0.16 }, { speed: 0.45, killSpeed: 2500, nth: 6, killCoins: 0.5 }]],
    // ── THE ICE KNIGHT's ── never sold: won by beating him. The best armour there is.
    ['iceknight', 'ICE KNIGHT', 5, ['#16467a', '#4aa8e0', '#b8ecff', '#ffffff'], 'great', 'spikes', 'plate', 'greaves', 'snow', [240, 320, 260],
      [{ dmg: 0.3, crit: 0.2, chill: 2500, spCd: 0.3, suCd: 0.3 }, { armor: 0.3, thorns: 0.3, undying: 1, regen: 6, ward: 1 },
       { speed: 0.45, dodge: 0.2, stunRes: 0.8, lives: 1 }]],
  ];

  const roundPrice = n => { const step = n >= 100000 ? 5000 : n >= 10000 ? 500 : 100; return Math.round(n / step) * step; };
  const PIECES = [];
  for (const [id, name, rarity, pal, helm, crest, chest, legs, motif, hp, fx] of SETS) {
    const R = RARITIES[rarity];
    ['head', 'chest', 'legs'].forEach((slot, i) => {
      const word = slot === 'head' ? HELM_WORD[helm] : slot === 'chest' ? CHEST_WORD[chest] : LEGS_WORD[legs];
      // Inside a rarity, the tougher piece costs more.
      const k = (hp[i] - R.hp[0]) / (R.hp[1] - R.hp[0]);
      PIECES.push({ id: id + '_' + slot[0], set: id, name: name + ' ' + word, slot, rarity, pal, helm, crest, chest, legs, motif,
                    hp: hp[i], fx: fx ? fx[i] : {}, price: roundPrice(R.price[0] + (R.price[1] - R.price[0]) * k) });
    });
  }

  // ── SHIELDS ── No extra health: you switch one on (X, or the shield button) and for
  // SHIELD_UP_MS it takes hits in your health's place, up to `guard` damage. Switching
  // it on sets off its `on` abilities (server.js: SHIELD_ON), and it's ready again
  // SHIELD_CD_MS after the press. COMMON ones only soak; rarer ones do more: 0 to 4
  // abilities, 0 or 1 passive.
  // [id, name, rarity, [dark, mid, light, accent], shape, trim, emblem, guard, on, passive]
  const SHIELD_UP_MS = 5000, SHIELD_CD_MS = 10000;
  const SHIELDS = [
    // ── COMMON: a plain block ──
    ['sh_oak', 'OAK BUCKLER', 0, ['#3a2410', '#7a5228', '#a87a40', '#d8b070'], 'buckler', 'plain', '', 36],
    ['sh_pine', 'PINE ROUNDEL', 0, ['#3a3016', '#8a7238', '#b89a52', '#e0cc88'], 'round', 'studs', '', 48],
    ['sh_pan', 'TIN PAN LID', 0, ['#4a5a6a', '#8a9aaa', '#c0ccd8', '#f0f4f8'], 'round', 'rim', '', 30],
    ['sh_crate', 'CRATE LID', 0, ['#4a3218', '#94683a', '#b88a52', '#5a3a1a'], 'tower', 'band', '', 51],
    ['sh_targe', 'LEATHER TARGE', 0, ['#4a2e18', '#8a5a30', '#b8884a', '#e0b070'], 'round', 'studs', 'stitch', 42],
    ['sh_barrel', 'BARREL LID', 0, ['#3e2a1a', '#6e4e30', '#967048', '#a8a8b0'], 'round', 'band', '', 33],
    ['sh_heater', 'RUSTY HEATER', 0, ['#4a2214', '#8a4a2a', '#b0703a', '#d8a060'], 'heater', 'plain', 'cross', 45],
    ['sh_disc', 'COPPER DISC', 0, ['#5a3014', '#b06a2a', '#e09a4a', '#ffd08a'], 'buckler', 'rim', 'diamond', 39],
    ['sh_bone', 'BONE GUARD', 0, ['#6a6450', '#c8c0a8', '#e8e4d0', '#4a4030'], 'kite', 'plain', 'skull', 54],
    ['sh_slab', 'STONE SLAB', 0, ['#3e4044', '#74787e', '#a0a4aa', '#54585e'], 'tower', 'plain', '', 57],

    // ── UNCOMMON: one ability ──
    ['sh_kite', 'IRON KITE', 1, ['#3a4250', '#6a7686', '#9aa8b8', '#d8e4f0'], 'kite', 'rim', 'shield', 60, { shove: 70 }],
    ['sh_scout', "SCOUT'S ROUNDEL", 1, ['#26402a', '#4a7a4a', '#7ab06a', '#e8d870'], 'round', 'quarter', 'arrow', 55, { haste: 1500 }],
    ['sh_medic', "MEDIC'S TARGE", 1, ['#5a1e22', '#d8d8d8', '#ffffff', '#e8323a'], 'heater', 'studs', 'cross', 55, { heal: 0.05 }],
    ['sh_bounce', 'BOUNCING BOARD', 1, ['#14405a', '#2a8ab0', '#6ad0e8', '#ffffff'], 'buckler', 'split', 'moon', 65, { reflect: 0.5 }],
    ['sh_spring', 'SPRINGWOOD GUARD', 1, ['#2a3a12', '#5a8a2a', '#9ac04a', '#e8ff8a'], 'tall', 'plain', 'leaf', 60, { leap: 90 }],
    ['sh_bramble', 'BRAMBLE BOSS', 1, ['#1e3010', '#3a6a20', '#6a9a3a', '#c83a3a'], 'round', 'spikes', 'claw', 60, { counter: 20 }],
    ['sh_tinder', 'TINDERBOX', 1, ['#3a1608', '#8a3a12', '#d86a1a', '#ffd84a'], 'tower', 'band', 'flame', 65, { nova: 14 }],
    ['sh_chill', 'CHILLPLATE', 1, ['#1e4a6a', '#5a9ac8', '#b0e0f8', '#ffffff'], 'heater', 'rim', 'snow', 65, { frost: 500 }],
    ['sh_pavise', "TACTICIAN'S PAVISE", 1, ['#22344a', '#3a5a8a', '#6a8ab8', '#ffd84a'], 'tall', 'split', 'eye', 70, { refresh: 1000 }],
    ['sh_hook', 'HOOKED BUCKLER', 1, ['#2e2e36', '#5a5a68', '#8a8a9a', '#ffb02a'], 'buckler', 'spikes', 'claw', 55, { pull: 70 }],
    ['sh_spark', 'SPARK COIL', 1, ['#22285a', '#4a4ab0', '#8a8ae8', '#ffe84a'], 'round', 'rim', 'bolt', 60, { chain: 16 }],
    ['sh_wasp', 'WASP NEST', 1, ['#2a2008', '#c89a12', '#ffd84a', '#1a1408'], 'kite', 'studs', 'drop', 65, { venom: 3 }],

    // ── RARE: a better ability, sometimes a passive ──
    ['sh_warp', 'WARPGLASS BUCKLER', 2, ['#2a1458', '#6a3ac8', '#a88aff', '#e8d8ff'], 'buckler', 'rim', 'star', 85, { blink: 130 }],
    ['sh_ghost', 'GHOSTWOOD WARD', 2, ['#2a3a44', '#6a8a94', '#b0d0d8', '#e8ffff'], 'tall', 'plain', 'moon', 80, { vanish: 900 }],
    ['sh_mirror', 'MIRROR STEEL', 2, ['#5a6474', '#a8b4c4', '#e8f0f8', '#7ad8ff'], 'heater', 'split', 'star', 90, { reflect: 0.8 }],
    ['sh_thorn', 'THORN WALL', 2, ['#143018', '#2a6a30', '#5aa04a', '#d8ff4a'], 'tower', 'spikes', 'leaf', 90, { spines: 3000 }],
    ['sh_warden', "WARDEN'S BULWARK", 2, ['#2e3a4a', '#6a7a8e', '#b0c0d0', '#7ad8ff'], 'tower', 'rim', 'shield', 100, { harden: 5000 }, { armor: 0.04 }],
    ['sh_rage', "BERSERKER'S BOARD", 2, ['#3a0a0a', '#8a1a1a', '#d83a2a', '#ffb02a'], 'round', 'quarter', 'skull', 85, { fury: 2000 }],
    ['sh_leech', 'LEECH SHELL', 2, ['#2a0610', '#7a1228', '#c82a4a', '#ffb0c0'], 'kite', 'band', 'heart', 85, { leech: 3000 }],
    ['sh_storm', 'STORM TOWER', 2, ['#14143e', '#3a3ab8', '#7a8aff', '#ffff7a'], 'tall', 'rim', 'bolt', 90, { chain: 30 }, { spCd: 0.05 }],
    ['sh_ember', 'EMBER KITE', 2, ['#4a1408', '#b03a12', '#ff7a1a', '#ffd84a'], 'kite', 'rim', 'flame', 85, { nova: 28 }, { burn: 500 }],
    ['sh_frost', 'FROSTWALL', 2, ['#1a3a5a', '#3a7ab0', '#8ad0f0', '#e8ffff'], 'tower', 'quarter', 'snow', 95, { frost: 900 }, { stunRes: 0.15 }],
    ['sh_sapper', "SAPPER'S PLATE", 2, ['#2a2e22', '#5a6444', '#8a9a6a', '#ff6a3a'], 'heater', 'band', 'diamond', 90, { mine: 60 }],
    ['sh_glass', 'HOURGLASS', 2, ['#6a4a1a', '#d8b05a', '#ffe8a8', '#4a8ad8'], 'tall', 'quarter', 'sun', 85, { bulk: 0.35 }],

    // ── EPIC: two abilities ──
    ['sh_phase', 'PHASE ROUNDEL', 3, ['#180e4a', '#4a2ad8', '#8a7aff', '#7affff'], 'round', 'rim', 'star', 120, { blink: 160, haste: 1500 }],
    ['sh_shiv', "ASSASSIN'S TARGE", 3, ['#180e1e', '#3a1a3e', '#6a2a5a', '#ff2a6a'], 'buckler', 'quarter', 'sword', 110, { behind: 40, fury: 1500 }],
    ['sh_knight', "KNIGHT'S PAVISE", 3, ['#8a7a4a', '#d8cca0', '#fff6d8', '#ffc82a'], 'tower', 'rim', 'cross', 140, { shove: 110, harden: 5000 }, { armor: 0.06 }],
    ['sh_spirit', 'SPIRIT SHELL', 3, ['#0e4a4a', '#2aa8a0', '#7affe0', '#ffffff'], 'round', 'studs', 'heart', 120, { heal: 0.1, refresh: 1500 }],
    ['sh_hail', 'HAILSTONE', 3, ['#2a4a7a', '#6a9ad8', '#c8e8ff', '#ffffff'], 'kite', 'spikes', 'snow', 120, { frost: 1000, shards: 14 }],
    ['sh_dragon', 'DRAGONHIDE', 3, ['#3a0e12', '#a01e2a', '#e8502a', '#ffd84a'], 'heater', 'spikes', 'flame', 125, { nova: 40, spines: 3000 }, { burn: 600 }],
    ['sh_viper', "VIPER'S MIRROR", 3, ['#123a1e', '#2a7a3a', '#5ac85a', '#d8ff4a'], 'kite', 'split', 'drop', 120, { reflect: 0.8, venom: 5 }],
    ['sh_thunder', 'THUNDERHEAD', 3, ['#1a2a5a', '#2a5ab0', '#5ab0ff', '#ffff7a'], 'round', 'quarter', 'bolt', 115, { chain: 36, stun: 800 }],
    ['sh_grave', 'GRAVEYARD GATE', 3, ['#10141a', '#3a4450', '#6a7a84', '#7affb0'], 'tall', 'band', 'skull', 125, { pull: 110, mine: 80 }],
    ['sh_night', 'NIGHTFALL', 3, ['#0e0e1e', '#2a2a44', '#4a4a6a', '#a07aff'], 'heater', 'rim', 'moon', 110, { vanish: 1200, leech: 2500 }, { dodge: 0.05 }],

    // ── LEGENDARY: three abilities ──
    ['sh_dawn', 'AEGIS OF DAWN', 4, ['#a8701a', '#ffc82a', '#fff0a0', '#ffffff'], 'heater', 'rim', 'sun', 170, { heal: 0.12, harden: 5000, nova: 50 }, { regen: 1 }],
    ['sh_tempest', 'TEMPEST WALL', 4, ['#14143e', '#2a4ad8', '#5ac0ff', '#ffff7a'], 'tall', 'spikes', 'bolt', 165, { blink: 180, chain: 45, haste: 2000 }],
    ['sh_oracle', "ORACLE'S MIRROR", 4, ['#3a2a6a', '#8a7ae0', '#e0d8ff', '#ffd84a'], 'round', 'split', 'eye', 175, { reflect: 1, stun: 1000, refresh: 2000 }],
    ['sh_kraken', 'KRAKEN GATE', 4, ['#04283e', '#0e6a8a', '#2ab8c8', '#a8ffe8'], 'tower', 'spikes', 'drop', 180, { pull: 140, frost: 1200, shards: 20 }],
    ['sh_warlord', "WARLORD'S BASTION", 4, ['#2a2e36', '#5a6474', '#9aa8b8', '#ffb02a'], 'tower', 'studs', 'crown', 195, { shove: 150, fury: 3000, spines: 4000 }, { thorns: 0.1 }],
    ['sh_shade', 'SHADE PRISM', 4, ['#08080e', '#20202c', '#46465a', '#c07aff'], 'kite', 'quarter', 'eye', 155, { vanish: 1500, behind: 70, bulk: 0.4 }],
    ['sh_phoenix', 'IRON PHOENIX', 4, ['#6a1a0a', '#e8501a', '#ffb02a', '#fff0a0'], 'heater', 'studs', 'wing', 165, { brace: 600, heal: 0.15, mine: 110 }, { stunRes: 0.3 }],

    // ── MYTHIC: four abilities and a passive. They glow red. ──
    ['sh_worldend', "WORLD'S END", 5, ['#2a0404', '#a00a1a', '#ff3a2a', '#ffe0a0'], 'tower', 'spikes', 'sword', 290, { nova: 80, shove: 180, harden: 5000, heal: 0.15 }, { armor: 0.1 }],
    ['sh_voidgate', 'VOIDGATE', 5, ['#06021a', '#2a0a5a', '#7a1ac8', '#ff5ad8'], 'round', 'rim', 'eye', 240, { blink: 220, vanish: 1500, bulk: 0.5, leech: 4000 }, { dodge: 0.12 }],
    ['sh_celestial', 'CELESTIAL MIRROR', 5, ['#8a3a06', '#ff9a0a', '#ffe04a', '#ffffff'], 'heater', 'split', 'sun', 270, { reflect: 1.2, stun: 1400, refresh: 3000, brace: 800 }, { regen: 2 }],
    ['sh_stormheart', 'STORMHEART', 5, ['#0a0a3a', '#2a2ae8', '#5ac0ff', '#fff07a'], 'kite', 'spikes', 'bolt', 255, { chain: 70, frost: 1500, fury: 3000, haste: 2500 }, { speed: 0.1 }],
    ['sh_crown', 'CROWN OF THORNS', 5, ['#140606', '#4a1a12', '#8a3a1a', '#ff7a1a'], 'tall', 'spikes', 'crown', 270, { spines: 5000, shards: 30, venom: 8, pull: 160 }, { thorns: 0.15 }],
    // The Ice Knight's own: never sold, won by beating him.
    ['sh_frostwall', 'FROSTWALL', 5, ['#0e2a4a', '#3a8ad0', '#a8e4ff', '#ffffff'], 'tower', 'spikes', 'snow', 330, { icespikes: 70, frost: 2000, harden: 5000, heal: 0.12 }, { armor: 0.12 }],
  ];
  const inRarity = [0, 0, 0, 0, 0, 0], ofRarity = r => SHIELDS.filter(s => s[2] === r).length;
  for (const [id, name, rarity, pal, shape, trim, motif, guard, on, fx] of SHIELDS) {
    const R = RARITIES[rarity], k = inRarity[rarity]++ / Math.max(1, ofRarity(rarity) - 1);
    PIECES.push({ id, set: id, name, slot: 'shield', rarity, pal, shape, trim, motif, guard, on: on || {}, hp: 0, fx: fx || {},
                  price: roundPrice(R.price[0] + (R.price[1] - R.price[0]) * k) });
  }
  const BY_ID = Object.fromEntries(PIECES.map(p => [p.id, p]));
  // Event gear: won in an event and never sold in the armoury (still tradeable).
  BY_ID.sh_voidgate.event = 'VOID DUNGEON';
  // The Ice Knight's gear: the same "never sold", but a boss's reward (`boss`), not an event's.
  for (const id of ['iceknight_h', 'iceknight_c', 'iceknight_l', 'sh_frostwall']) { BY_ID[id].event = 'ICE KNIGHT'; BY_ID[id].boss = true; }

  // The strongest a full suit can stack, whatever is worn: `max` keys don't add up
  // (two "every 6th hit" pieces are not "every 12th"), and the rest are capped so
  // three pieces can't reach 100% dodge or no damage at all.
  const MAX_ONLY = ['critX', 'ward', 'undying', 'nth', 'reap'];
  const CAPS = { dodge: 0.45, armor: 0.55, speed: 0.9, spd: 0.5, thorns: 0.6, life: 0.25, crit: 0.5, spCd: 0.55, suCd: 0.55, parryCd: 0.5, stunRes: 0.8 };
  function combineFx(list) {
    const f = {};
    for (const fx of list) {
      if (!fx) continue;
      for (const [k, v] of Object.entries(fx)) f[k] = MAX_ONLY.includes(k) ? Math.max(f[k] || 0, v) : (f[k] || 0) + v;
    }
    for (const k of Object.keys(CAPS)) if (f[k] > CAPS[k]) f[k] = CAPS[k];
    return f;
  }
  const fxOf = ids => combineFx(ids.map(id => BY_ID[id]?.fx));
  const hpOf = ids => ids.reduce((s, id) => s + (BY_ID[id]?.hp || 0), 0);

  // What each passive says on its card.
  const pct = v => Math.round(v * 100);
  const secs = v => +(v / 1000).toFixed(1);
  const FX_TEXT = {
    dmg: v => `+${pct(v)}% damage`, spd: v => `${pct(v)}% faster attacks`, speed: v => `+${pct(v)}% move speed`,
    armor: v => `Take ${pct(v)}% less damage`, thorns: v => `${pct(v)}% of damage goes back at the attacker`,
    life: v => `Heal ${pct(v)}% of the damage you deal`, crit: v => `+${pct(v)}% critical chance`, critX: () => 'Critical hits deal x3',
    dodge: v => `${pct(v)}% chance to dodge a hit`, regen: v => `Heal ${v} health a second`, rng: v => `+${pct(v)}% range`,
    spCd: v => `${pct(v)}% shorter special cooldown`, suCd: v => `${pct(v)}% shorter super cooldown`,
    parryCd: v => `${pct(v)}% shorter parry cooldown`, parryWin: v => `Parries last ${pct(v)}% longer`,
    killCoins: v => `Kills drop ${pct(v)}% more coins`, killXp: v => `Kills give ${pct(v)}% more XP`,
    killHeal: v => `Each kill heals ${pct(v)}% of your health`, killSpeed: v => `Each kill gives ${secs(v)}s of speed`,
    killCd: v => `Each kill takes ${secs(v)}s off your special and super`, hitCd: v => `Each hit takes ${secs(v)}s off your special and super`,
    execute: v => `+${pct(v)}% damage to foes under 30% health`, fresh: v => `+${pct(v)}% damage to foes at full health`,
    giant: v => `+${pct(v)}% damage to bosses`, desperate: v => `+${pct(v)}% damage while under 40% health`, knock: v => `Hits knock foes ${v}px further`,
    burn: v => `Hits burn foes for ${secs(v)}s`, chill: v => `Hits slow foes for ${secs(v)}s`, venom: () => 'Hits poison foes',
    stunCh: v => `${pct(v)}% chance to stun on hit`, splash: v => `${pct(v)}% of each hit splashes on foes close by`,
    sunder: v => `Ignore ${pct(v)}% of a foe's armour`, momentum: v => `Each hit in a row adds +${pct(v)}% damage`,
    ward: () => 'Shrug off one hit completely every 8s', undying: () => 'A killing blow leaves you at 25% health (once a minute)',
    echo: v => `${pct(v)}% chance that a hit lands twice`, shock: v => `${pct(v)}% chance that lightning jumps to more foes`,
    nth: v => `Every ${v}th hit explodes for 200% damage`, reap: v => `Hits kill monsters under ${pct(v)}% health`,
    warpath: v => `Each kill adds +${pct(v)}% damage until you die`, aura: v => `Burn foes close to you for ${v} damage a second`,
    lives: v => `+${v} extra life (not in PvP)`, magnet: v => `Coins fly to you from ${v}px further away`, stunRes: v => `Stuns last ${pct(v)}% less`,
  };
  const fxLines = fx => Object.entries(fx || {}).map(([k, v]) => (FX_TEXT[k] ? FX_TEXT[k](v) : k));
  // What a shield does the moment you switch it on.
  const ON_TEXT = {
    blink: v => `Teleport ${v}px the way you were moving`, leap: v => `Spring ${v}px away from the closest foe`,
    behind: v => `Warp behind the closest foe and hit for ${v}`, reflect: v => `${pct(v)}% of the damage it takes hits the closest foe`,
    counter: v => `Strike the closest foe for ${v}`, stun: v => `Stun the closest foe for ${secs(v)}s`,
    shove: v => `Blast foes around you ${v}px away`, nova: v => `A ring of fire burns foes for ${v}`,
    frost: v => `Freeze foes around you for ${secs(v)}s`, chain: v => `Lightning jumps between 4 foes for ${v}`,
    shards: v => `Fire 8 shards for ${v} each`, venom: v => `Poison foes around you (${v} a tick)`,
    pull: v => `Drag foes ${v}px towards you`, mine: v => `Drop a landmine for ${v}`, heal: v => `Heal ${pct(v)}% of your health`,
    haste: v => `Move faster for ${secs(v)}s`, fury: v => `Deal 80% more damage for ${secs(v)}s`, harden: v => `Take 50% less damage for ${secs(v)}s`,
    vanish: v => `Turn invisible for ${secs(v)}s`, leech: v => `Heal 25% of the damage you deal for ${secs(v)}s`,
    spines: v => `Hits on you bounce back for ${secs(v)}s`, refresh: v => `${secs(v)}s off your special and super`,
    icespikes: v => `Ice spikes race out all round you for ${v}, slowing what they hit`,
    bulk: v => `The shield takes ${pct(v)}% more this time`, brace: v => `Nothing wears the shield for ${secs(v)}s`,
  };
  const onLines = a => Object.entries(a?.on || {}).map(([k, v]) => (ON_TEXT[k] ? ON_TEXT[k](v) : k));
  const shieldStat = a => `TAKES ${a.guard} DAMAGE`;
  const shieldBack = `On for ${secs(SHIELD_UP_MS)}s, ready every ${secs(SHIELD_CD_MS)}s`;

  const Armor = { RARITIES, SLOTS, PIECES, BY_ID, ON_TEXT, SHIELD_UP_MS, SHIELD_CD_MS, combineFx, fxOf, hpOf, fxLines, onLines, shieldStat, shieldBack };

  // ── The pictures ── Everything below is browser-only. Letters are shades of the
  // set's palette (a dark, b mid, c light, d accent). A helmet's 12 rows sit straight
  // on the character's head, so the same art is the shop icon and what you see worn.
  const HELMS = {
    cap: ['................', '.....aaaaaaa....', '...aabbbbbbbaa..', '..abbbcccbbbba..', '..abbcccbbbbbba.', '..abbccbbbbbbba.',
          '..abbbbddddddddd', '..abbba.........', '..abba..........', '..aba...........', '...a............', '................'],
    hood: ['.....aaaaaa.....', '...aabbbbbbaa...', '..abbcccbbbbba..', '.abbcccbbbbbbba.', '.abbccbbbbbbbba.', '.abbbbaaaaaaaaa.',
           '.abbba......a...', '.abbba..........', '.abbba..........', '..abbba.........', '...abbbbba......', '....aaaaa.......'],
    visor: ['.....aaaaaa.....', '...aabbbbbbaa...', '..abccccbbbbba..', '.abcccbbbbbbbba.', '.abbbbbbbbbbbba.', '.abbbbbbbbbbbba.',
            '.abbbaaaaaaaaaa.', '.abbbddddddddda.', '.abbbbbbbbbbbba.', '..abbbbbbbbbba..', '...abbbbbbbba...', '....aaaaaaaa....'],
    great: ['....aaaaaaaa....', '...abbbbbbbba...', '..abccccbbbbba..', '..abcccbbbbbba..', '..abbbbbddbbba..', '..abbbbbddbbba..',
            '..aaaaaaddaaaa..', '..abbbbbddbbba..', '..abbbbbddbbba..', '..abbbbbbbbbba..', '...abbbbbbbba...', '....aaaaaaaa....'],
    mask: ['................', '................', '.....ddddddd....', '...aadddddddaa..', '..abbbbbbbbbbba.', '..abbaaabbaaaba.',
           '..abbaaabbaaaba.', '..abbbbbbbbbbba.', '...abbbbbbbbba..', '...abcbcbcbcba..', '....a.a.a.a.a...', '................'],
    circlet: ['................', '................', '....d..d..d..d..', '....dddddddddd..', '...abbbbbbbbbba.', '...acccdddcccba.',
              '................', '................', '................', '................', '................', '................'],
  };
  const CHESTS = {
    vest: ['...aa......aa...', '..abba....abba..', '.abbbbaaaabbbba.', '.abcbbbbbbbbbba.', '.abcbbbddbbbbba.', '.abcbbbddbbbbba.',
           '..aabbbddbbbaa..', '...abbbddbbba...', '...abbbbbbbba...', '...abbbbbbbba...', '...addddddddda..', '...aaaaaaaaaa...'],
    plate: ['..aaa......aaa..', '.abcba....abcba.', '.abccbaaaabbcba.', '.abcbbbbbbbbbba.', '.abbcbbbbbbbbba.', '..aabcbbbbbbaa..',
            '...abbcbbbbba...', '...abbbcbbbba...', '...abbbbbbbba...', '...adddddddda...', '...abbbbbbbba...', '...aaaaaaaaaa...'],
    robe: ['...aa......aa...', '..abba....abba..', '.abbbbaddabbbba.', '.abcbbbddbbbbba.', '.abcbbbddbbbbba.', '..aabbbddbbbaa..',
           '...abbbddbbba...', '...adddddddda...', '..abbbbbbbbbba..', '..abcbbbbbbbba..', '.abbcbbbbbbbbba.', '.aaaaaaaaaaaaaa.'],
    scale: ['..aaa......aaa..', '.abbba....abbba.', '.abcbcaaaacbcba.', '.acbcbcbcbcbcba.', '.abcbcbcbcbcbca.', '..aacbcbcbcbaa..',
            '...acbcbcbcba...', '...abcbcbcbca...', '...acbcbcbcba...', '...abcbcbcbca...', '...adddddddda...', '...aaaaaaaaaa...'],
    spiked: ['d.aad....daa.d..', '.dabba..abbad...', '.abcbbaaaabbcba.', '.abcbbbbbbbbbba.', '.abbcbdbbdbbbba.', '..aabbbddbbbaa..',
             '...abbbddbbba...', '...abdbbbbdba...', '...abbbbbbbba...', '...adddddddda...', '...abbbbbbbba...', '...aaaaaaaaaa...'],
  };
  const LEGS = {
    pants: ['................', '...aaaaaaaaaa...', '...abbbbbbbba...', '...abcbbbbbba...', '...abcbaabbba...', '...abcba.abba...',
            '...abba..abba...', '...abba..abba...', '...abba..abba...', '..aaaaa..aaaaa..', '..abbba..abbba..', '..aaaaa..aaaaa..'],
    greaves: ['................', '...aaaaaaaaaa...', '...adddddddda...', '...abcbbbbbba...', '...abcbaabbba...', '...abcba.acba...',
              '...addda.addda..', '...abcba.acba...', '...abcba.acba...', '..aabcba.acbaa..', '..abbbba.abbbba.', '..aaaaaa.aaaaaa.'],
    tasset: ['................', '..aaaaaaaaaaaa..', '..adddddddddda..', '..abcbbaabbbba..', '..abcba..abbba..', '..abba....abba..',
             '...abba..abba...', '...abba..abba...', '...abba..abba...', '..aaaaa..aaaaa..', '..abbba..abbba..', '..aaaaa..aaaaa..'],
    scale: ['................', '...aaaaaaaaaa...', '...acbcbcbcba...', '...abcbcbcbca...', '...acbcaabcba...', '...abcba.acba...',
            '...acba..abca...', '...abca..acba...', '...acba..abca...', '..aaaaa..aaaaa..', '..abcba..abcba..', '..aaaaa..aaaaa..'],
    spiked: ['................', '...aaaaaaaaaa...', '...adddddddda...', '...abcbbbbbba...', '..dabcbaabbbad..', '...abcba.abba...',
             '...abba..abba...', '..dabba..abbad..', '...abba..abba...', '.daaaaa..aaaaad.', '..abbba..abbba..', '..aaaaa..aaaaa..'],
  };
  // Pixels above the helmet: [x, y from the top of the helmet, shade].
  const CRESTS = {
    horns: [[2, -3, 'c'], [2, -2, 'c'], [2, -1, 'b'], [3, -1, 'b'], [3, 0, 'b'], [13, -3, 'c'], [13, -2, 'c'], [13, -1, 'b'], [12, -1, 'b'], [12, 0, 'b']],
    plume: [[6, -1, 'd'], [7, -1, 'd'], [8, -1, 'd'], [5, -2, 'd'], [6, -2, 'd'], [7, -2, 'd'], [4, -3, 'd'], [5, -3, 'd'], [6, -3, 'd'], [3, -3, 'd']],
    spikes: [[4, -1, 'd'], [7, -1, 'd'], [10, -1, 'd'], [7, -2, 'd'], [4, -2, 'c'], [10, -2, 'c'], [7, -3, 'c']],
    wings: [[1, 1, 'c'], [0, 0, 'c'], [1, 0, 'd'], [0, -1, 'd'], [1, -1, 'c'], [14, 1, 'c'], [15, 0, 'c'], [14, 0, 'd'], [15, -1, 'd'], [14, -1, 'c']],
    fins: [[6, -1, 'd'], [7, -1, 'c'], [8, -1, 'd'], [9, -1, 'c'], [7, -2, 'd'], [8, -2, 'd'], [8, -3, 'd']],
  };
  // Emblems for the chest, 5 pixels square.
  const MOTIFS = {
    stitch: ['.....', '.d.d.', '..d..', '.d.d.', '.....'], diamond: ['..d..', '.ddd.', 'ddddd', '.ddd.', '..d..'], cross: ['..d..', '..d..', 'ddddd', '..d..', '..d..'],
    leaf: ['...dd', '..ddd', '.ddd.', 'dd...', 'd....'], claw: ['d.d.d', 'd.d.d', '.d.d.', '.d.d.', '.....'], skull: ['.ddd.', 'd.d.d', 'ddddd', '.d.d.', '.....'],
    shield: ['ddddd', 'ddddd', 'ddddd', '.ddd.', '..d..'], arrow: ['..d..', '.ddd.', '..d..', '..d..', '..d..'], sword: ['..d..', '..d..', '..d..', '.ddd.', '..d..'],
    coin: ['.ddd.', 'dd.dd', 'dd.dd', 'dd.dd', '.ddd.'], eye: ['.....', '.ddd.', 'd.d.d', '.ddd.', '.....'], snow: ['d.d.d', '.ddd.', 'ddddd', '.ddd.', 'd.d.d'],
    flame: ['..d..', '.dd..', '.ddd.', 'ddddd', '.ddd.'], drop: ['..d..', '..d..', '.ddd.', 'ddddd', '.ddd.'], bolt: ['..dd.', '.dd..', 'dddd.', '..dd.', '.dd..'],
    moon: ['.ddd.', 'dd...', 'dd...', 'dd...', '.ddd.'], heart: ['dd.dd', 'ddddd', 'ddddd', '.ddd.', '..d..'], sun: ['d.d.d', '.ddd.', 'ddddd', '.ddd.', 'd.d.d'],
    star: ['..d..', 'ddddd', '.ddd.', '.d.d.', 'd...d'], crown: ['.....', 'd.d.d', 'ddddd', 'ddddd', '.....'], wing: ['d....', 'dd...', 'ddd.d', '.dddd', '..dd.'],
  };
  // A shield's outline: how many pixels each row runs either side of the middle.
  const SHIELD_SHAPES = {
    heater: [6, 7, 7, 7, 7, 7, 7, 7, 6, 6, 5, 4, 3, 2, 1], round: [3, 5, 6, 7, 7, 7, 7, 7, 7, 7, 7, 6, 5, 3],
    kite: [3, 5, 6, 7, 7, 7, 6, 6, 5, 5, 4, 3, 3, 2, 1], tower: [7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 6],
    buckler: [3, 4, 5, 6, 6, 6, 6, 6, 6, 5, 4, 3], tall: [4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4, 2],
  };
  // Which shade one pixel of a shield's face takes. d = how far in from the edge.
  const SHIELD_TRIMS = {
    plain: (x, y, d) => (d === 1 && x < 8 ? 'c' : 'b'),
    rim: (x, y, d) => (d === 1 ? 'd' : d === 2 && x < 8 ? 'c' : 'b'),
    studs: (x, y, d) => (d === 1 && y % 3 === 1 ? 'd' : 'b'),
    quarter: (x, y, d, mid) => ((x < 8) === (y < mid) ? 'c' : 'b'),
    split: (x) => (x < 8 ? 'c' : 'b'),
    band: (x, y, d, mid) => (Math.abs(y - mid) < 2 ? 'd' : d === 1 && x < 8 ? 'c' : 'b'),
    spikes: (x, y, d) => (d === 1 ? 'c' : 'b'),
  };

  // Paint a piece onto a 2D context, one "pixel" being `s` units, top-left at x,y.
  function paintPiece(g, p, x, y, s) {
    const shade = { a: p.pal[0], b: p.pal[1], c: p.pal[2], d: p.pal[3] };
    const dot = (px, py, c) => { g.fillStyle = shade[c]; g.fillRect(x + px * s, y + py * s, s, s); };
    if (p.slot === 'shield') {
      const rows = SHIELD_SHAPES[p.shape], top = Math.floor((16 - rows.length) / 2), mid = Math.floor(rows.length / 2) - 1;
      const trim = SHIELD_TRIMS[p.trim] || SHIELD_TRIMS.plain, width = ry => rows[ry] || 0;
      rows.forEach((w, ry) => {
        for (let rx = 8 - w; rx < 8 + w; rx++) {
          const fromSide = Math.min(rx - (8 - w), 7 + w - rx);
          const fromCap = rx < 8 ? Math.min(...[ry, rows.length - 1 - ry]) : Math.min(ry, rows.length - 1 - ry);
          const edge = fromSide === 0 || fromCap === 0 || width(ry - 1) < Math.abs(rx - 7.5) + 0.5 || width(ry + 1) < Math.abs(rx - 7.5) + 0.5;
          dot(rx, ry + top, edge ? 'a' : trim(rx, ry, Math.min(fromSide, fromCap), mid));
        }
      });
      if (p.trim === 'spikes') for (const [sx, sy] of [[-1, 2], [16, 2], [-1, 6], [16, 6], [7, -1], [8, -1]]) if (sy >= 0 ? rows[sy] : true) dot(sx, sy + top, 'd');
      const m = MOTIFS[p.motif];
      if (m) m.forEach((r, ry) => { for (let rx = 0; rx < 5; rx++) if (r[rx] === 'd') dot(rx + 5, ry + top + Math.max(2, mid - 2), 'd'); });
      return;
    }
    const rows = p.slot === 'head' ? HELMS[p.helm] : p.slot === 'chest' ? CHESTS[p.chest] : LEGS[p.legs];
    const top = p.slot === 'head' ? 3 : 2;     // room for a crest
    rows.forEach((r, ry) => { for (let rx = 0; rx < r.length; rx++) if (r[rx] !== '.') dot(rx, ry + top, r[rx]); });
    if (p.slot === 'head') for (const [cx, cy, c] of CRESTS[p.crest] || []) dot(cx, cy + top, c);
    if (p.slot === 'chest') {
      const m = MOTIFS[p.motif] || [];
      m.forEach((r, ry) => { for (let rx = 0; rx < 5; rx++) if (r[rx] === 'd') dot(rx + 6, ry + top + 3, 'd'); });
    }
  }
  // A piece's icon on a canvas of any size: the art, a dark edge, nothing else.
  function drawIcon(cv, p) {
    const g = cv.getContext('2d'), s = Math.max(1, Math.floor(Math.min(cv.width, cv.height) / 17));
    g.clearRect(0, 0, cv.width, cv.height);
    const ox = Math.floor((cv.width - 16 * s) / 2), oy = Math.floor((cv.height - 16 * s) / 2);
    g.save();
    g.globalAlpha = 0.65;                   // a soft shadow, so light sets stand out on light cards
    const dark = { ...p, pal: ['#000000', '#000000', '#000000', '#000000'] };
    paintPiece(g, dark, ox + s, oy + s, s);
    g.restore();
    paintPiece(g, p, ox, oy, s);
  }

  Armor.HELMS = HELMS; Armor.CHESTS = CHESTS; Armor.LEGS = LEGS; Armor.CRESTS = CRESTS; Armor.MOTIFS = MOTIFS;
  Armor.drawIcon = drawIcon;
  if (typeof module !== 'undefined' && module.exports) module.exports = Armor;
  else root.Armor = Armor;
})(typeof window !== 'undefined' ? window : globalThis);
