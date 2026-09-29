'use strict';

(function () {

// ─── Sprites ──────────────────────────────────────────────────────────────────
// Every character, pickup and hazard is authored as pixels here and cached as a
// bitmap, instead of being redrawn from vector paths each frame. Fixed-size
// things (player, items) are written as character grids; things whose size varies
// with the game (monsters, traps) are built procedurally from the same ramps so
// they stay consistent at any scale.

const K = (typeof window !== 'undefined' && window.PixelKit) || require('./pixel.js');
const { shade, ramp, MAT5, makeBuf, setPx, rect, ditherRect, poly, line, disc,
        ringPx, outline, rimLight, tint, fromGrid, sprite } = K;

const EDGE = '#0b0b14';   // shared outline colour for everything

// ─── Player ───────────────────────────────────────────────────────────────────
// 16x22, facing right. The grid is authored without its outer outline — that is
// traced on at the end, after hats and outfit parts are painted, so anything
// sticking out of the silhouette (a plume, horns, a cape) is edged too.
//
//  H/h hair           F/f face / shade   W eye white   E pupil
//  3/2/1 tunic light / base / dark       k interior edge
//  G/g glove          B belt  b buckle   P/p trousers  T/t boot

const PLAYER_PAD = 7;   // headroom above the head for tall hats, horns and flames

const HEAD_ROWS = [
  '    hHHHHH      ',
  '   hHHHHHHHH    ',
  '  hHHHHHHHHHH   ',
  '  hHHHHHHHHHHH  ',
  '  hhHHHHFHFFH   ',
  '  hhHHFFFFWEF   ',
  '  hhHFFFFFWEF   ',
  '  hhhFFFFFFFFF  ',
  '   hhfFFFFFFf   ',
  '    hffFFFff    ',
  '     kffffk     ',
];
const BODY_ROWS = [
  '   22333333222  ',
  '  1k23333332k21 ',
  '  1k22333322k21 ',
  '  1k22233222k21 ',
  '  Gk12222221kGG ',
  '  gkBBBBbBBBkgg ',
];
const LEG_ROWS = [
  '    PPPPPPPP    ',
  '    PPp  PPp    ',
  '    PPp  PPp    ',
  '    TTT  TTTT   ',
  '   tTTt  tTTTt  ',
];
const HEAD_Y = 0, BODY_Y = 11, LEG_Y = 17;

// ── Outfits: the ten skins bought with coins ──
// Each one may swap the head, torso or leg rows, recolour any key, and paint
// extras. `hat: false` means it has its own headgear, so the free hat choice is
// hidden under it. `c` is the ramp of the player's chosen colour, which some
// outfits use as an accent (the knight's plume, the wizard's robe).
const OUTFITS = {

  knight: {
    hat: false,
    head: [
      '    SSSSSS      ',
      '   SSLLLSSSS    ',
      '  sSSLLSSSSSS   ',
      '  sSSSSSSSSSSS  ',
      '  sSSSSSSSSSSS  ',
      '  sSSSSSSkkkkk  ',
      '  sSSSSSSSkSkS  ',
      '  ssSSSSSSSSSS  ',
      '   ssSSSSSSSs   ',
      '    ssSSSSss    ',
      '     kssssk     ',
    ],
    key: (c) => ({
      S: MAT5.steel[2], s: MAT5.steel[1], L: MAT5.steel[4],
      3: MAT5.steel[3], 2: MAT5.steel[2], 1: MAT5.steel[1],
      G: MAT5.steel[2], g: MAT5.steel[1],
      P: MAT5.iron[2], p: MAT5.iron[1], T: MAT5.iron[2], t: MAT5.iron[0],
    }),
    paint(b, T, c) {
      // Tabard in the player's colour over the plate, and a plume.
      rect(b, 6, T + 12, 4, 4, c[2]);
      rect(b, 6, T + 12, 4, 1, c[3]);
      setPx(b, 7, T + 13, MAT5.gold[3]);
      poly(b, [[5, T + 1], [3, T - 3], [0, T - 2], [1, T], [4, T + 1]], c[2]);
      setPx(b, 3, T - 2, c[4]); setPx(b, 2, T - 2, c[3]); setPx(b, 1, T - 1, c[1]);
    },
  },

  ninja: {
    hat: false,
    head: [
      '    NNNNNN      ',
      '   NNNNNNNNN    ',
      '  nNNNNNNNNNN   ',
      '  nRRRRRRRRRRR  ',
      '  nNNNNNNNNNNN  ',
      '  nNNNNNFFWEF   ',
      '  nNNNNNNNNNN   ',
      '  nnNNNNNNNNNN  ',
      '   nnNNNNNNN    ',
      '    nnNNNNn     ',
      '     knnnnk     ',
    ],
    key: () => ({
      N: '#2a2a38', n: '#1b1b26', R: '#d0303a',
      3: '#3a3a4c', 2: '#2a2a38', 1: '#1d1d28',
      G: '#2a2a38', g: '#1b1b26', B: '#d0303a', b: '#ff6a6a',
      P: '#2a2a38', p: '#1b1b26', T: '#1d1d28', t: '#121218',
    }),
    paint(b, T) {
      // Headband tails streaming behind.
      setPx(b, 1, T + 4, '#d0303a'); setPx(b, 0, T + 5, '#d0303a');
      setPx(b, 1, T + 5, '#a82530'); setPx(b, 0, T + 6, '#a82530');
      // Wrapped sash across the chest.
      for (let i = 0; i < 5; i++) setPx(b, 5 + i, T + 11 + i, '#3f3f55');
    },
  },

  wizard: {
    hat: false,
    key: (c) => ({
      H: '#dcdce6', h: '#a8a8b8',
      3: c[3], 2: c[2], 1: c[1],
      B: MAT5.gold[2], b: MAT5.gold[4],
    }),
    legs: [
      '    22333222    ',
      '   2223332221   ',
      '   2223332221   ',
      '  122233322211  ',
      '  1111111111111 ',
    ],
    paint(b, T, c) {
      // Long white beard over the chin and chest.
      poly(b, [[6, T + 7], [13, T + 7], [12, T + 10], [10, T + 14], [8, T + 12], [6, T + 9]], '#e8e8f0');
      setPx(b, 11, T + 8, '#c4c4d4'); setPx(b, 10, T + 11, '#c4c4d4'); setPx(b, 9, T + 12, '#c4c4d4');
      // Pointed hat in the robe colour, leaning back, with a star.
      rect(b, 1, T + 1, 13, 2, c[1]);
      rect(b, 2, T + 1, 11, 1, c[2]);
      poly(b, [[3, T + 1], [11, T + 1], [6, T - 5], [2, T - 7]], c[2]);
      poly(b, [[7, T + 1], [11, T + 1], [6, T - 5]], c[1]);
      setPx(b, 6, T - 2, MAT5.gold[4]); setPx(b, 5, T - 2, MAT5.gold[2]);
      setPx(b, 7, T - 2, MAT5.gold[2]); setPx(b, 6, T - 3, MAT5.gold[2]); setPx(b, 6, T - 1, MAT5.gold[2]);
      // Stars on the robe.
      setPx(b, 5, T + 13, MAT5.gold[4]); setPx(b, 9, T + 19, MAT5.gold[4]); setPx(b, 5, T + 20, MAT5.gold[3]);
    },
  },

  pirate: {
    hat: false,
    key: () => ({
      H: '#2b1a10', h: '#1c110a',
      3: '#d6474a', 2: '#b02a30', 1: '#7c1c22',
      G: MAT5.leather[3], g: MAT5.leather[2],
      B: '#1c1c24', b: MAT5.gold[4],
      P: '#e4dcc8', p: '#b4ab94', T: '#1c1c24', t: '#0f0f16',
    }),
    paint(b, T) {
      // Tricorn with gold trim.
      rect(b, 1, T + 1, 14, 2, '#1c1c24');
      rect(b, 1, T + 2, 14, 1, MAT5.gold[2]);
      poly(b, [[3, T + 1], [5, T - 3], [10, T - 3], [12, T + 1]], '#24242e');
      setPx(b, 7, T - 1, '#e8e8f0'); setPx(b, 8, T - 1, '#e8e8f0');   // skull badge
      setPx(b, 7, T, '#b8b8c4');
      // Eyepatch and its strap.
      rect(b, 10, T + 5, 2, 2, '#0f0f16');
      for (let x = 4; x < 10; x++) setPx(b, x, T + 4, '#0f0f16');
      // Gold coat buttons and cuffs.
      for (const y of [12, 14]) setPx(b, 9, T + y, MAT5.gold[4]);
      rect(b, 13, T + 14, 2, 1, MAT5.gold[3]);
    },
  },

  skeleton: {
    hat: true,
    head: [
      '    SSSSSS      ',
      '   SSSSLLSSS    ',
      '  sSSSSSLSSSS   ',
      '  sSSSSSSSSSSS  ',
      '  sSSSSSSSSSSS  ',
      '  sSSSSSSkkSSS  ',
      '  sSSSSSSkkSSk  ',
      '  ssSSSSSSSSSS  ',
      '   ssSkSkSkSs   ',
      '    ssSSSSss    ',
      '     kssssk     ',
    ],
    key: () => ({
      S: MAT5.bone[3], s: MAT5.bone[1], L: MAT5.bone[4],
      3: '#26262e', 2: '#1c1c24', 1: '#141419',
      G: MAT5.bone[3], g: MAT5.bone[1], B: MAT5.bone[1], b: MAT5.bone[3],
      P: MAT5.bone[2], p: MAT5.bone[1], T: MAT5.bone[3], t: MAT5.bone[1],
    }),
    paint(b, T) {
      // Ribcage and spine over the dark torso.
      for (const y of [11, 13, 15]) rect(b, 4, T + y, 8, 1, MAT5.bone[3]);
      for (const y of [12, 14])     rect(b, 5, T + y, 6, 1, MAT5.bone[1]);
      rect(b, 7, T + 11, 1, 5, MAT5.bone[4]);
      // Glowing eye light in the socket.
      setPx(b, 10, T + 5, '#6affc8');
    },
  },

  robot: {
    hat: false,
    head: [
      '     SSSSS      ',
      '   SSSSSSSSS    ',
      '  sSSSSSSSSSs   ',
      '  sSSSSSSSSSSs  ',
      '  sSSSVVVVVVVs  ',
      '  sSSSVCCVCCVs  ',
      '  sSSSVVVVVVVs  ',
      '  sSSSSSSSSSSs  ',
      '  ssSSkSkSkSSs  ',
      '   ssssssssss   ',
      '     kiiiik     ',
    ],
    key: () => ({
      S: MAT5.steel[2], s: MAT5.steel[1], V: '#10313c', C: '#5ff0ff', i: MAT5.iron[1],
      3: MAT5.iron[3], 2: MAT5.iron[2], 1: MAT5.iron[1],
      G: MAT5.steel[1], g: MAT5.iron[0], B: MAT5.iron[0], b: '#ffcc33',
      P: MAT5.iron[2], p: MAT5.iron[1], T: MAT5.steel[1], t: MAT5.iron[0],
    }),
    paint(b, T) {
      rect(b, 7, T - 3, 1, 3, MAT5.iron[2]);            // antenna
      setPx(b, 7, T - 4, '#ff4a4a'); setPx(b, 8, T - 4, '#ff9a9a');
      rect(b, 6, T + 12, 3, 2, '#10313c');              // chest core
      setPx(b, 7, T + 12, '#5ff0ff'); setPx(b, 7, T + 13, '#2aa8c0');
      setPx(b, 5, T + 11, MAT5.steel[4]); setPx(b, 10, T + 11, MAT5.steel[4]);  // rivets
    },
  },

  viking: {
    hat: false,
    key: () => ({
      H: MAT5.iron[3], h: MAT5.iron[1],
      3: '#9a6a3c', 2: '#7a5030', 1: '#553620',
      G: MAT5.leather[2], g: MAT5.leather[1],
      P: '#4a5a7a', p: '#34405a', T: MAT5.leather[2], t: MAT5.leather[0],
    }),
    paint(b, T) {
      // Helmet band and horns.
      rect(b, 2, T + 3, 12, 1, MAT5.gold[2]);
      rect(b, 7, T + 3, 1, 4, MAT5.iron[2]);           // nose guard
      poly(b, [[3, T + 1], [0, T - 3], [1, T - 5], [2, T - 2], [5, T]], MAT5.bone[2]);
      poly(b, [[11, T + 1], [14, T - 3], [13, T - 5], [12, T - 2], [9, T]], MAT5.bone[2]);
      setPx(b, 1, T - 4, MAT5.bone[4]); setPx(b, 13, T - 4, MAT5.bone[4]);
      // Braided ginger beard.
      poly(b, [[6, T + 7], [13, T + 7], [12, T + 10], [10, T + 13], [8, T + 10], [6, T + 9]], '#d0682a');
      setPx(b, 10, T + 11, '#a04a1a'); setPx(b, 10, T + 12, '#e8904a'); setPx(b, 11, T + 8, '#e8904a');
      // Shaggy fur on the vest.
      ditherRect(b, 4, T + 11, 8, 4, '#7a5030', '#9a6a3c', 'sparse');
      rect(b, 3, T + 11, 10, 1, '#c8b08a');            // fur collar
    },
  },

  shadow: {
    hat: true,
    key: () => ({
      H: '#2c1d48', h: '#1c1230', F: '#241838', f: '#1a1128', W: '#e070ff', E: '#ffffff',
      3: '#3a2660', 2: '#2c1d48', 1: '#1c1230',
      G: '#2c1d48', g: '#1c1230', B: '#150d24', b: '#a050e0',
      P: '#241838', p: '#1a1128', T: '#1c1230', t: '#120b1e',
    }),
    paint(b, T) {
      setPx(b, 11, T + 6, '#e070ff');                  // tall glowing eye
      // The body frays into smoke toward the feet.
      for (let y = T + 18; y <= T + 21; y++) {
        for (let x = 0; x < b.w; x++) {
          if (((x + y) & 1) && y > T + 19) b.data[(y * b.w + x) * 4 + 3] = 0;
        }
      }
      for (const [x, y] of [[3, T + 12], [12, T + 16], [4, T + 18]]) setPx(b, x, y, '#6a3aa8');
    },
    edge: '#150b24',
  },

  inferno: {
    hat: false,
    key: () => ({
      H: '#ff9a1a', h: '#e0461a', F: '#3a2420', f: '#2a1814', W: '#ffe066', E: '#ffffff',
      3: '#4a2e26', 2: '#3a2420', 1: '#2a1814',
      G: '#3a2420', g: '#2a1814', B: '#2a1814', b: '#ffcc33',
      P: '#3a2420', p: '#2a1814', T: '#2a1814', t: '#1a0e0a',
    }),
    paint(b, T) {
      // Flames licking up from the head.
      for (const [x, h, c] of [[3, 3, '#e0461a'], [5, 6, '#ff9a1a'], [7, 4, '#ffcc33'],
                               [9, 5, '#ff9a1a'], [11, 3, '#e0461a']]) {
        rect(b, x, T - h + 1, 2, h, c);
        setPx(b, x, T - h + 1, '#ffe8a0');
      }
      // Magma cracks glowing through the charred body.
      for (const [x, y] of [[5, 12], [6, 13], [6, 14], [9, 12], [10, 13], [8, 15], [5, 18], [10, 19], [7, 8]]) {
        setPx(b, x, T + y, '#ff7a1a');
      }
      setPx(b, 6, T + 13, '#ffcc33'); setPx(b, 10, T + 13, '#ffcc33');
    },
  },

  golden: {
    hat: false,
    head: [
      '    SSSSSS      ',
      '   SSLLLSSSS    ',
      '  sSSLLSSSSSS   ',
      '  sSSSSSSSRSSS  ',
      '  sSSSSSSSSSSS  ',
      '  sSSSSSSkkkkk  ',
      '  sSSSSSSSSSSS  ',
      '  ssSSSSSSSSSS  ',
      '   ssSSSSSSSs   ',
      '    ssSSSSss    ',
      '     kssssk     ',
    ],
    key: () => ({
      S: MAT5.gold[2], s: MAT5.gold[1], L: MAT5.gold[4], R: '#e02a4a',
      3: MAT5.gold[3], 2: MAT5.gold[2], 1: MAT5.gold[1],
      G: MAT5.gold[3], g: MAT5.gold[1], B: '#8a1a2a', b: '#ff5a7a',
      P: MAT5.gold[2], p: MAT5.gold[1], T: MAT5.gold[1], t: MAT5.gold[0],
    }),
    paint(b, T) {
      // A white cape behind, and a white plume.
      rect(b, 1, T + 11, 2, 10, '#e8e8f0');
      rect(b, 1, T + 11, 1, 10, '#c4c4d4');
      setPx(b, 0, T + 20, '#c4c4d4'); setPx(b, 2, T + 21, '#e8e8f0');
      poly(b, [[5, T + 1], [3, T - 3], [0, T - 2], [1, T], [4, T + 1]], '#f4f4fa');
      setPx(b, 2, T - 2, '#c4c4d4');
      rect(b, 6, T + 12, 4, 1, MAT5.gold[4]);          // polished breastplate
      setPx(b, 7, T + 13, '#e02a4a');
    },
  },
};

// The skin shop list: id, display name, coin price. The server owns the real
// prices and ownership; this copy is for drawing previews before it answers.
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

function playerBuf(color, hatIdx, flash, outfitId) {
  const c = ramp(color);
  const fit = OUTFITS[outfitId] || null;
  const hair = ramp('#4a3322');
  const key = {
    k: EDGE,
    H: hair[2], h: hair[1],
    F: MAT5.flesh[2], f: MAT5.flesh[1], W: '#f4f4f4', E: '#1a1a24',
    3: c[3], 2: c[2], 1: c[1],
    G: MAT5.leather[3], g: MAT5.leather[2],
    B: MAT5.leather[1], b: MAT5.gold[3],
    P: '#3d4466', p: '#2a2f4a',
    T: MAT5.darkwood[2], t: MAT5.darkwood[0],
    ...(fit && fit.key ? fit.key(c) : {}),
  };
  const pad = Array(PLAYER_PAD).fill(' '.repeat(16));
  const rows = [
    ...pad,
    ...(fit && fit.head || HEAD_ROWS),
    ...(fit && fit.body || BODY_ROWS),
    ...(fit && fit.legs || LEG_ROWS),
  ];
  const b = fromGrid(rows, key);
  const T = PLAYER_PAD;

  if (!fit) {
    // Cloth weave and a lit shoulder so the tunic reads as fabric.
    ditherRect(b, 5, T + 13, 4, 2, c[2], c[3], 'sparse');
    setPx(b, 4, T + 11, c[4]); setPx(b, 5, T + 11, c[4]); setPx(b, 3, T + 12, c[4]);
    setPx(b, 9, T + 3, hair[3]); setPx(b, 6, T + 2, hair[3]);   // hair shine
  }
  if (fit && fit.paint) fit.paint(b, T, c);
  if (!fit || fit.hat) drawHatPixels(b, hatIdx, c);
  outline(b, fit && fit.edge || EDGE);
  if (flash) tint(b, '#ffffff', 0.78);
  return b;
}

function drawHatPixels(b, hatIdx, c) {
  const hat = ['NONE', 'CAP', 'CROWN', 'HORNS', 'SPIKY'][hatIdx | 0] || 'NONE';
  const T = PLAYER_PAD;   // the head's first row
  if (hat === 'CAP') {
    rect(b, 3, T - 1, 10, 3, '#27384d');
    rect(b, 4, T - 1, 8, 1, '#375273');
    rect(b, 3, T + 2, 12, 1, '#1d2937');          // brim, out over the face
    setPx(b, 14, T + 2, '#375273');
    setPx(b, 7, T, '#e8e8f0');                     // badge
  } else if (hat === 'CROWN') {
    rect(b, 4, T - 1, 8, 3, MAT5.gold[2]);
    rect(b, 4, T - 1, 8, 1, MAT5.gold[3]);
    for (const [x, h] of [[4, 2], [7, 3], [11, 2]]) {
      rect(b, x, T - 1 - h, 1, h, MAT5.gold[2]);
      setPx(b, x, T - 1 - h, MAT5.gold[4]);
    }
    rect(b, 6, T - 3, 3, 2, MAT5.gold[2]);
    setPx(b, 7, T, '#d04a5a');                     // set stone
    setPx(b, 5, T, '#4a8ad0'); setPx(b, 10, T, '#4a8ad0');
  } else if (hat === 'HORNS') {
    poly(b, [[4, T + 2], [0, T - 5], [2, T - 5], [6, T + 1]], MAT5.blood[1]);
    poly(b, [[10, T + 1], [13, T - 5], [15, T - 5], [12, T + 2]], MAT5.blood[1]);
    setPx(b, 1, T - 4, MAT5.blood[3]);
    setPx(b, 14, T - 4, MAT5.blood[3]);
  } else if (hat === 'SPIKY') {
    for (const [x, hh] of [[3, 3], [5, 5], [7, 6], [9, 5], [11, 3]]) {
      rect(b, x, T + 1 - hh, 2, hh, c[3]);
      setPx(b, x, T + 1 - hh, c[4]);
    }
  }
}

function playerSprite(color, hatIdx, facing, flash, outfitId) {
  const fit = OUTFITS[outfitId] ? outfitId : '';
  return sprite(`pl:${color}:${hatIdx}:${facing}:${flash ? 1 : 0}:${fit}`, () => {
    const b = playerBuf(color, hatIdx, flash, fit);
    return facing === 1 ? b : mirror(b);
  });
}

function mirror(b) {
  const o = makeBuf(b.w, b.h);
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      const si = (y * b.w + x) * 4, di = (y * b.w + (b.w - 1 - x)) * 4;
      for (let c = 0; c < 4; c++) o.data[di + c] = b.data[si + c];
    }
  }
  return o;
}

// ─── Monsters ─────────────────────────────────────────────────────────────────
// Built at whatever size the game asks for. Each type has its own silhouette
// routine over shared shading: a lit top-left, a dithered midtone band and a
// darker underside, plus a hard outline.

const MONSTER_SKIN = {
  grunt:    { base: '#44cc44', eye: '#ff3322', eyes: 2 },
  runner:   { base: '#c8e04a', eye: '#ff5522', eyes: 1 },
  brute:    { base: '#cc5533', eye: '#ffdd44', eyes: 2 },
  spitter:  { base: '#a65cd0', eye: '#d6ff5c', eyes: 3 },
  warden:   { base: '#7f93b8', eye: '#8ee8ff', eyes: 2 },
  behemoth: { base: '#8a3a6a', eye: '#ff4466', eyes: 4 },
};

// Body outlines in normalised 0..1 space, scaled to whatever size the wave asks
// for. Giving each type its own silhouette is what makes them tell apart at a
// glance — colour alone reads poorly once several are on screen.
const MONSTER_SHAPE = {
  grunt: {
    body: [[0.14,0.10],[0.30,0.00],[0.70,0.00],[0.86,0.10],[0.96,0.38],[0.92,0.76],[0.72,0.86],[0.28,0.86],[0.08,0.76],[0.04,0.38]],
    legs: [[0.16,0.34],[0.64,0.34]], legTop: 0.82, headV: 0.40,
  },
  runner: {
    // Long, low and pitched forward: a body built to sprint.
    body: [[0.02,0.40],[0.14,0.20],[0.40,0.12],[0.66,0.16],[0.86,0.26],[1.00,0.36],[0.86,0.46],[0.64,0.52],[0.34,0.62],[0.12,0.58]],
    legs: [[0.16,0.34],[0.60,0.34]], legTop: 0.56, headV: 0.34, lean: true,
  },
  brute: {
    // Small head above enormous shoulders, tapering to stubby legs.
    body: [[0.30,0.00],[0.70,0.00],[0.76,0.18],[1.00,0.30],[1.00,0.62],[0.82,0.74],[0.18,0.74],[0.00,0.62],[0.00,0.30],[0.24,0.18]],
    legs: [[0.14,0.30],[0.56,0.30]], legTop: 0.72, headV: 0.24,
  },
  spitter: {
    // Venom sac over a narrow abdomen; the sac is added as a disc.
    body: [[0.34,0.46],[0.66,0.46],[0.72,0.74],[0.60,0.88],[0.40,0.88],[0.28,0.74]],
    legs: [[0.14,0.16],[0.44,0.16],[0.72,0.16]], legTop: 0.80, headV: 0.44, sac: true,
  },
  warden: {
    // Domed helm and a squared, plated torso.
    body: [[0.32,0.00],[0.68,0.00],[0.82,0.08],[0.86,0.22],[0.94,0.28],[0.94,0.78],[0.80,0.88],[0.20,0.88],[0.06,0.78],[0.06,0.28],[0.14,0.22],[0.18,0.08]],
    legs: [[0.18,0.26],[0.56,0.26]], legTop: 0.86, headV: 0.28,
  },
  behemoth: {
    // Hunched slab with horns and heavy arms.
    body: [[0.30,0.08],[0.70,0.08],[0.84,0.18],[1.00,0.32],[0.96,0.62],[0.84,0.76],[0.16,0.76],[0.04,0.62],[0.00,0.32],[0.16,0.18]],
    legs: [[0.12,0.30],[0.58,0.30]], legTop: 0.74, headV: 0.32,
  },
};

// Shade every filled pixel by how far down the body it sits, dithering the
// transitions so the volume reads without a gradient.
function shadeByHeight(b, c, top, bottom) {
  const span = Math.max(1, bottom - top);
  for (let y = 0; y < b.h; y++) {
    const v = (y - top) / span;
    for (let x = 0; x < b.w; x++) {
      if (K.getA(b, x, y) === 0) continue;
      let idx = v < 0.14 ? 3 : v < 0.34 ? 2 : v < 0.62 ? 2 : v < 0.84 ? 1 : 0;
      // Dither the two busiest bands so the steps are not hard lines.
      if (v >= 0.28 && v < 0.40 && ((x + y) & 1)) idx = 3;
      if (v >= 0.58 && v < 0.70 && ((x + y) & 1)) idx = 2;
      if (v >= 0.80 && v < 0.90 && ((x + y) & 1)) idx = 1;
      setPx(b, x, y, c[idx]);
    }
  }
}

// Padding around the body box, sized so horns and shields are never clipped.
// Callers must blit at (x - pad, y - pad) to line the body up with the hitbox.
function monsterPad(w, h) {
  return Math.max(4, Math.ceil(h * 0.26));
}

function monsterBuf(type, w, h) {
  const skin = MONSTER_SKIN[type] || MONSTER_SKIN.grunt;
  const shp = MONSTER_SHAPE[type] || MONSTER_SHAPE.grunt;
  const c = ramp(skin.base);
  const M = monsterPad(w, h);
  const b = makeBuf(w + M * 2, h + M * 2);
  const X = (u) => M + u * w, Y = (v) => M + v * h;
  const P = (pts) => pts.map(([u, v]) => [X(u), Y(v)]);

  // Legs first so the body overlaps them.
  const legW = Math.max(1, Math.round(w * 0.17));
  for (const [u, lh] of shp.legs) {
    rect(b, X(u), Y(shp.legTop), legW, Math.max(2, Math.round(h * lh)), c[1]);
    rect(b, X(u), Y(shp.legTop) + Math.round(h * lh) - 1, legW, 1, c[0]);
  }
  poly(b, P(shp.body), c[2]);
  if (shp.sac) {
    const r = Math.max(3, w * 0.42);
    disc(b, X(0.5), Y(0.30), r, c[2]);
  }

  shadeByHeight(b, c, M, M + h);

  // ── Per-type features, drawn after shading so they stay crisp ──
  if (type === 'grunt') {
    rect(b, X(0.0) - 2, Y(0.16), 2, Math.max(2, h * 0.16), c[1]);      // ear stubs
    rect(b, X(1.0), Y(0.16), 2, Math.max(2, h * 0.16), c[1]);
    K.ditherRect(b, X(0.22), Y(0.50), w * 0.56, h * 0.22, c[2], c[3], 'sparse');
  } else if (type === 'runner') {
    poly(b, P([[0.86,0.28],[1.06,0.36],[0.86,0.44]]), c[1]);            // snout
    poly(b, P([[0.30,0.14],[0.38,-0.02],[0.46,0.16]]), c[3]);           // swept-back crest
    poly(b, P([[0.52,0.14],[0.60,0.00],[0.66,0.18]]), c[3]);
    K.ditherRect(b, X(0.18), Y(0.40), w * 0.46, h * 0.14, c[2], c[3], 'vert');
    rect(b, X(0.04), Y(0.42), Math.max(2, w * 0.14), 1, c[3]);          // flank stripe
  } else if (type === 'brute') {
    const ty = Y(0.20);
    poly(b, [[X(0.24), ty + 3], [X(0.28), ty - 4], [X(0.33), ty + 3]], MAT5.bone[3]);   // tusks
    poly(b, [[X(0.67), ty + 3], [X(0.72), ty - 4], [X(0.76), ty + 3]], MAT5.bone[3]);
    rect(b, X(0.28), Y(0.02), w * 0.44, Math.max(2, h * 0.09), c[1]);   // heavy brow
    K.ditherRect(b, X(0.10), Y(0.42), w * 0.80, h * 0.22, c[2], c[1], 'dense');
    rect(b, X(0.0), Y(0.30), Math.max(2, w * 0.1), 1, c[3]);
  } else if (type === 'spitter') {
    const r = Math.max(3, w * 0.42);
    K.ringPx(b, X(0.5), Y(0.30), r - 1, 1, c[1]);
    K.ditherRect(b, X(0.28), Y(0.30), w * 0.44, h * 0.22, c[1], MAT5.venom[2], 'checker');
    rect(b, X(0.44), Y(0.52), Math.max(2, w * 0.12), Math.max(2, h * 0.1), MAT5.venom[2]);
    setPx(b, X(0.5), Y(0.62), MAT5.venom[4]);
  } else if (type === 'warden') {
    const bands = 3, y0 = Y(0.32), bh = Math.max(2, (h * 0.5) / bands);
    for (let i = 0; i < bands; i++) {
      const y = y0 + i * bh;
      rect(b, X(0.10), y, w * 0.80, 1, MAT5.steel[3]);
      rect(b, X(0.10), y + 1, w * 0.80, 1, MAT5.iron[1]);
      setPx(b, X(0.14), y, MAT5.steel[4]);
      setPx(b, X(0.84), y, MAT5.steel[4]);
    }
    const shH = Math.max(5, h * 0.52);
    rect(b, X(-0.02) - 2, Y(0.26), 3, shH, MAT5.steel[2]);              // tower shield
    rect(b, X(-0.02) - 2, Y(0.26), 3, 1, MAT5.steel[4]);
    rect(b, X(-0.02) - 2, Y(0.26) + shH - 1, 3, 1, MAT5.iron[0]);
    setPx(b, X(-0.02) - 1, Y(0.26) + Math.round(shH / 2), MAT5.gold[3]);
    rect(b, X(0.34), Y(0.02), w * 0.32, Math.max(1, h * 0.05), MAT5.steel[3]);   // helm crest
  } else if (type === 'behemoth') {
    // Horns grow out of the skull rather than hovering over it: each starts
    // inside the head and sweeps up and outward.
    const hornH = Math.max(4, h * 0.26);
    const hy = Y(0.16);
    poly(b, [[X(0.34), hy], [X(0.30), hy - hornH * 0.55], [X(0.16), hy - hornH],
             [X(0.24), hy - hornH * 0.45], [X(0.26), hy]], MAT5.bone[2]);
    poly(b, [[X(0.66), hy], [X(0.70), hy - hornH * 0.55], [X(0.84), hy - hornH],
             [X(0.76), hy - hornH * 0.45], [X(0.74), hy]], MAT5.bone[2]);
    line(b, X(0.30), hy - hornH * 0.5, X(0.18), hy - hornH * 0.9, MAT5.bone[4]);
    line(b, X(0.70), hy - hornH * 0.5, X(0.82), hy - hornH * 0.9, MAT5.bone[4]);
    line(b, X(0.32), Y(0.34), X(0.52), Y(0.60), '#ff7a3c');             // molten cracks
    line(b, X(0.52), Y(0.60), X(0.42), Y(0.74), '#ff9a4c');
    line(b, X(0.70), Y(0.38), X(0.64), Y(0.56), '#ff7a3c');
    K.ditherRect(b, X(0.10), Y(0.52), w * 0.80, h * 0.20, c[1], c[0], 'checker');
  }

  // Eyes last, so they stay the brightest thing on the sprite.
  const ey = Y(shp.headV) - Math.max(1, Math.round(h * 0.06));
  const es = Math.max(1, Math.round(w * 0.15));
  const eyeAt = (u) => {
    rect(b, X(u), ey, es, es, skin.eye);
    setPx(b, X(u), ey, shade(skin.eye, 0.55));
  };
  if (skin.eyes === 1) {
    rect(b, X(0.40), ey, es * 2, es, skin.eye);
    setPx(b, X(0.40), ey, shade(skin.eye, 0.55));
  } else if (skin.eyes === 3) {
    eyeAt(0.22); eyeAt(0.46); eyeAt(0.70);
  } else if (skin.eyes === 4) {
    for (const u of [0.14, 0.36, 0.56, 0.76]) eyeAt(u);
  } else {
    eyeAt(0.20); eyeAt(0.66);
  }

  outline(b, EDGE);
  return b;
}

function monsterSprite(type, w, h, state) {
  return sprite(`mo:${type}:${w}x${h}:${state}`, () => {
    const b = monsterBuf(type, w, h);
    if (state === 'flash') tint(b, '#ffffff', 0.8);
    else if (state === 'slow') tint(b, '#4fd8ff', 0.42);
    return b;
  });
}

// ─── Items ────────────────────────────────────────────────────────────────────
// A faceted gem casing with the effect's symbol cut into it. Authored at 18x18,
// the size the game spawns them at.
//
//  o outline   4/3/2/1 gem light..dark   S symbol   s symbol shadow   W spark

const ITEM_ROWS = [
  '       oooo       ',
  '     oo4444oo     ',
  '    o44444444o    ',
  '   o4433333344o   ',
  '  o443322223344o  ',
  ' o44332SSSS233 4o ',
  'o4433 2SSSS2 3344o',
  'o433 22SSSS22 334o',
  'o43 2223SS3222 33o',
  'o43 2223SS3222 33o',
  'o433 22SSSS22 334o',
  'o4433 2SSSS2 3344o',
  ' o44332SSSS233 4o ',
  '  o443322223344o  ',
  '   o4433333344o   ',
  '    o44111111o    ',
  '     oo1111oo     ',
  '       oooo       ',
];

// Each symbol is drawn over the gem rather than encoded in the grid, so the same
// casing carries every effect.
function itemSymbol(b, type, c) {
  const cx = 9, cy = 9, ink = '#0c0c16', hi = '#ffffff';
  if (type === 'speed') {
    for (const ox of [-3, 1]) {
      line(b, cx + ox - 1, cy - 4, cx + ox + 2, cy, ink);
      line(b, cx + ox + 2, cy, cx + ox - 1, cy + 4, ink);
      line(b, cx + ox, cy - 4, cx + ox + 3, cy, ink);
      line(b, cx + ox + 3, cy, cx + ox, cy + 4, ink);
    }
  } else if (type === 'strength') {
    rect(b, cx - 4, cy + 1, 3, 3, ink);      // fist
    rect(b, cx - 1, cy - 1, 3, 4, ink);
    rect(b, cx + 1, cy - 4, 4, 3, ink);      // raised forearm
    rect(b, cx + 2, cy - 5, 3, 1, ink);
    setPx(b, cx - 3, cy + 1, hi);
  } else if (type === 'shield') {
    poly(b, [[cx, cy - 5], [cx + 4, cy - 3], [cx + 3, cy + 3], [cx, cy + 5], [cx - 3, cy + 3], [cx - 4, cy - 3]], ink);
    poly(b, [[cx, cy - 4], [cx + 2, cy - 3], [cx, cy + 1]], hi);
  } else if (type === 'haste') {
    poly(b, [[cx + 1, cy - 5], [cx - 3, cy + 1], [cx, cy + 1], [cx - 1, cy + 5], [cx + 3, cy - 1], [cx, cy - 1]], ink);
    setPx(b, cx, cy - 4, hi); setPx(b, cx - 1, cy - 3, hi);
  } else if (type === 'heal') {
    rect(b, cx - 1, cy - 5, 3, 11, ink);
    rect(b, cx - 5, cy - 1, 11, 3, ink);
    rect(b, cx - 1, cy - 5, 1, 4, hi);
  } else if (type === 'magnet') {
    // Horseshoe magnet with bright poles.
    rect(b, cx - 4, cy - 4, 3, 7, ink);
    rect(b, cx + 2, cy - 4, 3, 7, ink);
    rect(b, cx - 3, cy + 2, 7, 3, ink);
    rect(b, cx - 4, cy - 5, 3, 2, hi);
    rect(b, cx + 2, cy - 5, 3, 2, hi);
  } else if (type === 'regen') {
    // Heart with a small plus.
    poly(b, [[cx - 5, cy - 2], [cx - 3, cy - 5], [cx, cy - 3], [cx + 3, cy - 5], [cx + 5, cy - 2], [cx, cy + 5]], ink);
    rect(b, cx - 3, cy - 3, 1, 2, hi);
    rect(b, cx, cy - 1, 1, 3, hi); rect(b, cx - 1, cy, 3, 1, hi);
  } else if (type === 'vampire') {
    // Two fangs.
    rect(b, cx - 5, cy - 5, 11, 3, ink);
    poly(b, [[cx - 4, cy - 2], [cx - 1, cy - 2], [cx - 2.5, cy + 4]], ink);
    poly(b, [[cx + 1, cy - 2], [cx + 4, cy - 2], [cx + 2.5, cy + 4]], ink);
    setPx(b, cx - 3, cy - 1, hi); setPx(b, cx + 2, cy - 1, hi);
  } else if (type === 'bomb') {
    // Round bomb with a lit fuse.
    disc(b, cx - 0.5, cy + 1, 4.2, ink);
    rect(b, cx + 1, cy - 4, 2, 2, ink);
    line(b, cx + 3, cy - 5, cx + 4, cy - 6, '#ffe070');
    setPx(b, cx - 2, cy - 1, hi); setPx(b, cx - 3, cy, hi);
  } else if (type === 'frost') {
    // Snowflake.
    rect(b, cx, cy - 5, 1, 11, ink);
    rect(b, cx - 5, cy, 11, 1, ink);
    line(b, cx - 3, cy - 3, cx + 3, cy + 3, ink);
    line(b, cx + 3, cy - 3, cx - 3, cy + 3, ink);
    setPx(b, cx, cy, hi); setPx(b, cx, cy - 5, hi); setPx(b, cx - 5, cy, hi);
  }
}

function itemSprite(type, color) {
  return sprite(`it:${type}`, () => {
    const c = ramp(color);
    const b = fromGrid(ITEM_ROWS, {
      o: EDGE, 4: c[4], 3: c[3], 2: c[2], 1: c[1],
      S: c[2], W: '#ffffff',
    });
    // Facet sheen across the top-left before the symbol goes on.
    ditherRect(b, 4, 3, 7, 4, c[4], c[3], 'sparse');
    itemSymbol(b, type, c);
    setPx(b, 5, 3, '#ffffff'); setPx(b, 6, 2, '#ffffff');
    return b;
  });
}

// ─── Coins ────────────────────────────────────────────────────────────────────
// Eight frames of a spinning disc, so the pickup animates without any blur.

function coinSprite(frame) {
  return sprite(`coin:${frame}`, () => {
    const b = makeBuf(10, 10);
    const g = MAT5.gold;
    // Width follows a cosine so the disc reads as rotating edge-on and back.
    const hw = Math.max(1, Math.round(Math.abs(Math.cos(frame / 8 * Math.PI)) * 4));
    for (let y = 1; y <= 8; y++) {
      const dy = (y - 4.5) / 4;
      const wide = Math.max(1, Math.round(hw * Math.sqrt(Math.max(0, 1 - dy * dy))));
      rect(b, 5 - wide, y, wide * 2, 1, g[2]);
    }
    if (hw >= 2) {
      rect(b, 5 - hw + 1, 2, 1, 6, g[4]);                   // lit edge
      rect(b, 4 + hw - 1, 3, 1, 4, g[0]);                   // shadowed edge
      if (hw >= 3) { rect(b, 4, 4, 2, 2, g[3]); setPx(b, 4, 4, g[4]); }
    }
    outline(b, EDGE);
    return b;
  });
}

// ─── Traps ────────────────────────────────────────────────────────────────────
// Sized by the game, so these are procedural. Each is built from the same
// material ramps as the weapons, with dithering standing in for texture.

function trapBuf(type, size, armed) {
  const s = size;
  const b = makeBuf(s + 4, s + 4);
  const o = 2;

  if (type === 'spike') {
    // Timber pressure plate: planks with grain, iron corner braces, spikes that
    // rise out of it as the trap arms.
    const wd = MAT5.wood, dw = MAT5.darkwood;
    rect(b, o, o, s, s, dw[1]);
    rect(b, o + 1, o + 1, s - 2, s - 2, wd[1]);
    const planks = 3, ph = Math.floor((s - 2) / planks);
    for (let i = 0; i < planks; i++) {
      const y = o + 1 + i * ph;
      ditherRect(b, o + 1, y, s - 2, ph - 1, wd[1], wd[2], 'grain');
      rect(b, o + 1, y, s - 2, 1, wd[3]);
      rect(b, o + 1, y + ph - 1, s - 2, 1, dw[1]);
    }
    for (const [cx2, cy2] of [[o + 1, o + 1], [o + s - 4, o + 1], [o + 1, o + s - 4], [o + s - 4, o + s - 4]]) {
      rect(b, cx2, cy2, 3, 3, MAT5.iron[2]);
      setPx(b, cx2, cy2, MAT5.iron[4]);
      setPx(b, cx2 + 1, cy2 + 1, MAT5.iron[0]);
    }
    const st = MAT5.steel;
    const up = armed ? 1 : 0.42;
    const grid = s >= 28 ? 3 : 2;
    const step = s / (grid + 1);
    for (let gy = 1; gy <= grid; gy++) {
      for (let gx = 1; gx <= grid; gx++) {
        const px = o + Math.round(gx * step), py = o + Math.round(gy * step);
        const hgt = Math.max(2, Math.round(s * 0.26 * up));
        poly(b, [[px - 3, py + 2], [px, py - hgt], [px + 3, py + 2]], st[1]);
        poly(b, [[px - 1, py + 2], [px, py - hgt], [px + 1, py + 2]], st[3]);
        setPx(b, px, py - hgt + 1, st[4]);
      }
    }
  } else if (type === 'mine') {
    // Cast-iron sphere with trigger prongs and a blinking eye.
    const ir = MAT5.iron, r = s * 0.42;
    const cx2 = o + s / 2, cy2 = o + s / 2;
    for (let a = 0; a < 8; a++) {
      const an = a * Math.PI / 4;
      const x1 = cx2 + Math.cos(an) * r * 0.9, y1 = cy2 + Math.sin(an) * r * 0.9;
      const x2 = cx2 + Math.cos(an) * (r + 4), y2 = cy2 + Math.sin(an) * (r + 4);
      line(b, x1, y1, x2, y2, ir[2]);
      disc(b, x2, y2, 1.6, MAT5.blood[2]);
      setPx(b, Math.round(x2), Math.round(y2), MAT5.blood[3]);
    }
    disc(b, cx2, cy2, r, ir[1]);
    disc(b, cx2 - r * 0.22, cy2 - r * 0.24, r * 0.66, ir[2]);
    disc(b, cx2 - r * 0.34, cy2 - r * 0.36, r * 0.32, ir[3]);
    ditherRect(b, cx2 - r * 0.6, cy2 + r * 0.1, r * 1.2, r * 0.6, ir[1], ir[0], 'checker');
    // Rivet band around the equator.
    for (let a = 0; a < 6; a++) {
      const an = a * Math.PI / 3 + 0.3;
      setPx(b, Math.round(cx2 + Math.cos(an) * r * 0.78), Math.round(cy2 + Math.sin(an) * r * 0.78), ir[4]);
    }
    const lamp = armed ? '#ffe9a0' : '#ff4a4a';
    disc(b, cx2, cy2, Math.max(1.4, r * 0.2), lamp);
    setPx(b, Math.round(cx2), Math.round(cy2 - 1), '#ffffff');
  } else if (type === 'snare') {
    // Woven rope net pegged at the corners, with a tension ring at the middle.
    const rp = MAT5.rope, cells = s >= 30 ? 5 : 4, step = (s - 2) / cells;
    for (let i = 0; i <= cells; i++) {
      const p = o + 1 + Math.round(i * step);
      line(b, p, o + 1, p, o + s - 2, rp[1]);
      line(b, o + 1, p, o + s - 2, p, rp[2]);
    }
    // Over/under weave: brighten one strand at every crossing.
    for (let i = 0; i <= cells; i++) {
      for (let j = 0; j <= cells; j++) {
        const px = o + 1 + Math.round(i * step), py = o + 1 + Math.round(j * step);
        setPx(b, px, py, (i + j) & 1 ? rp[3] : rp[0]);
      }
    }
    rect(b, o, o, s, 1, rp[3]); rect(b, o, o + s - 1, s, 1, rp[0]);
    rect(b, o, o, 1, s, rp[3]); rect(b, o + s - 1, o, 1, s, rp[0]);
    for (const [px, py] of [[o, o], [o + s - 3, o], [o, o + s - 3], [o + s - 3, o + s - 3]]) {
      rect(b, px, py, 3, 3, MAT5.iron[2]);
      setPx(b, px, py, MAT5.iron[4]);
    }
    const cx2 = o + s / 2, cy2 = o + s / 2;
    ringPx(b, cx2, cy2, Math.max(2, s * 0.14), 1.6, MAT5.iron[3]);
    disc(b, cx2, cy2, Math.max(1, s * 0.06), armed ? '#9be7ff' : MAT5.iron[1]);
  }

  outline(b, EDGE);
  return b;
}

function trapSprite(type, size, armed) {
  return sprite(`tr:${type}:${size}:${armed ? 1 : 0}`, () => trapBuf(type, size, armed));
}

const Sprites = {
  monsterPad, PLAYER_PAD, OUTFITS, SKIN_SHOP,
  EDGE, playerBuf, playerSprite, monsterBuf, monsterSprite,
  itemSprite, ITEM_ROWS, itemSymbol, coinSprite, trapBuf, trapSprite, mirror,
  MONSTER_SKIN,
};

// Export the namespace plus just the entry points the game calls by bare name.
// Everything else stays private to this file, so it can never clash with another
// script's top-level names.
if (typeof window !== 'undefined') {
  window.Sprites = Sprites;
  for (const k of ['playerSprite', 'monsterSprite', 'monsterPad', 'PLAYER_PAD', 'SKIN_SHOP',
                   'itemSprite', 'coinSprite', 'trapSprite']) {
    window[k] = Sprites[k];
  }
}
if (typeof module !== 'undefined') module.exports = Sprites;
})();
