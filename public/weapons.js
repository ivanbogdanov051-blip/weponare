'use strict';

// ─── Weapon Art ───────────────────────────────────────────────────────────────
// Every weapon is defined once, in its own local space: the grip butt sits at
// (0,0) and the weapon points along +X. The held sprite, the panel icon, the
// unlock preview and the upgrade shop all render the same definition at
// different scales, so a weapon looks like itself everywhere.
//
// Each definition's `box` — its bounding box in that local space, used for
// centring in icons and previews — is measured from the art itself at load, so
// it can never drift out of step with the drawing.

const MAT = {
  wood:      '#6b4326', woodDark: '#42280f', woodLight: '#8f5f36',
  leather:   '#33200f', leatherLt: '#553719',
  steel:     '#b9c4d0', steelDark: '#6a7482', steelLight: '#eef4fb',
  iron:      '#464c56', ironLight: '#79818d',
  gold:      '#d9a520', goldLight: '#ffe58a',
  rope:      '#c9b98e',
  dark:      '#14141c',
};

// Drawing kit bound to a context. In silhouette mode every colour becomes the
// outline colour, which is how the 1px dark edge around held weapons is made.
function artKit(g, silhouette) {
  const C = c => (silhouette ? '#05050b' : c);
  return {
    r(x, y, w, h, c) { g.fillStyle = C(c); g.fillRect(x, y, w, h); },
    poly(pts, c) {
      g.fillStyle = C(c);
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.closePath(); g.fill();
    },
    circ(x, y, r, c) { g.fillStyle = C(c); g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); },
    ring(x, y, r, lw, c, a0, a1) {
      g.strokeStyle = C(c); g.lineWidth = lw;
      g.beginPath(); g.arc(x, y, r, a0 === undefined ? 0 : a0, a1 === undefined ? Math.PI * 2 : a1);
      g.stroke();
    },
    line(x1, y1, x2, y2, lw, c) {
      g.strokeStyle = C(c); g.lineWidth = lw; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    },
    glow(x, y, r, c, a) {
      if (silhouette) return;
      g.save(); g.globalAlpha = a === undefined ? 0.3 : a;
      g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.restore();
    },
  };
}

// Shared parts, so every hafted weapon reads as the same family of objects.
function grip(k, len, c1, c2, wraps) {
  k.r(0, -1.6, len, 3.2, c1 || MAT.leather);
  for (let i = 0; i < (wraps === undefined ? 3 : wraps); i++) {
    k.r(1 + i * (len / 3.4), -1.6, 0.9, 3.2, c2 || MAT.leatherLt);
  }
}
function haft(k, len, thick) {
  const t = thick || 2.4;
  k.r(0, -t / 2, len, t, MAT.wood);
  k.r(0, -t / 2, len, t * 0.35, MAT.woodLight);
  k.r(0, t / 2 - t * 0.2, len, t * 0.2, MAT.woodDark);
}
function collar(k, x, h) {
  k.r(x, -h / 2, 1.8, h, MAT.ironLight);
  k.r(x, -h / 2, 1.8, h * 0.3, MAT.steelLight);
}
// A straight double-edged blade from x0 to the tip, with a bright top bevel.
function blade(k, x0, tip, halfT, wc) {
  k.poly([[x0, -halfT], [tip - halfT * 1.6, -halfT], [tip, 0], [tip - halfT * 1.6, halfT], [x0, halfT]], wc);
  k.poly([[x0, -halfT], [tip - halfT * 1.6, -halfT], [tip - halfT * 2, -halfT * 0.15], [x0, -halfT * 0.15]], MAT.steelLight);
  k.r(x0, -0.35, tip - x0 - halfT, 0.7, MAT.steelDark); // fuller
}

const WEAPON_ART = {

  sword: { draw(k, wc) {
    grip(k, 5.5);
    k.circ(-1, 0, 2.3, MAT.steelDark); k.circ(-1.4, -0.6, 1.1, MAT.steel);
    k.r(5.5, -5, 2.2, 10, MAT.steel);                 // crossguard
    k.r(5.2, -5.8, 2.8, 1.4, MAT.steelLight);
    k.r(5.2, 4.4, 2.8, 1.4, MAT.steelLight);
    blade(k, 8, 27, 2.3, wc);
  }},

  dagger: { draw(k, wc) {
    grip(k, 4, MAT.leather, MAT.leatherLt, 2);
    k.circ(-0.6, 0, 1.6, MAT.steelDark);
    k.r(4, -3.4, 1.8, 6.8, MAT.steel);
    blade(k, 6, 17, 2, wc);
  }},

  axe: { draw(k, wc) {
    haft(k, 17, 2.6);
    collar(k, 12.5, 7);
    // Bearded crescent head with a back spike.
    k.poly([[14, -3], [20, -9.5], [24.5, -4], [25, 4], [20, 9.5], [14, 4]], wc);
    k.poly([[20, -9.5], [24.5, -4], [25, 4], [20, 9.5], [22.5, 0]], MAT.steelLight);
    k.poly([[14, -2.4], [11, -5], [10.5, 2], [14, 2.4]], MAT.iron);
    k.r(14, -3.2, 1.6, 6.4, MAT.steelDark);
  }},

  spear: { draw(k, wc) {
    haft(k, 24, 2.2);
    k.r(6, -1.3, 1, 2.6, MAT.rope); k.r(9, -1.3, 1, 2.6, MAT.rope);
    collar(k, 23.5, 5);
    k.r(21, -2.6, 2.4, 5.2, MAT.ironLight);           // crossbar
    k.poly([[25, -3.2], [30, -2], [34.5, 0], [30, 2], [25, 3.2]], wc);   // leaf head
    k.poly([[25, -3.2], [30, -2], [33, -0.4], [25, -0.6]], MAT.steelLight);
    k.r(25.5, -0.3, 6, 0.6, MAT.steelDark);
  }},

  // Strung bow seen from the side: the belly bows toward the target (+X) and the
  // string spans the limb TIPS behind it, which is where the arrow nocks.
  bow: { draw(k, wc) {
    const cxA = -9, R = 11.5, SPAN = Math.PI * 0.44;
    const tipX = cxA + Math.cos(SPAN) * R, tipY = Math.sin(SPAN) * R;
    k.ring(cxA, 0, R, 2.6, MAT.woodDark, -SPAN, SPAN);
    k.ring(cxA, 0, R - 0.7, 1.1, MAT.woodLight, -SPAN * 0.96, SPAN * 0.96);
    k.poly([[tipX, -tipY], [tipX + 3, -tipY - 2.2], [tipX + 1.4, -tipY + 1.4]], MAT.woodDark);  // recurves
    k.poly([[tipX, tipY], [tipX + 3, tipY + 2.2], [tipX + 1.4, tipY - 1.4]], MAT.woodDark);
    k.line(tipX, -tipY - 1, tipX, tipY + 1, 0.9, MAT.rope);              // string
    k.r(0.4, -4.2, 3.2, 8.4, MAT.leather);            // grip at the riser
    k.r(0.9, -4.2, 0.9, 8.4, MAT.leatherLt);
    k.r(tipX, -0.55, 19, 1.1, MAT.wood);              // arrow, nocked on the string
    k.poly([[12, -2], [16.5, 0], [12, 2]], wc);
    k.poly([[tipX, -2.6], [tipX + 4, -0.7], [tipX, 0]], MAT.steelLight); // fletching
    k.poly([[tipX, 2.6], [tipX + 4, 0.7], [tipX, 0]], MAT.steelLight);
  }},

  staff: { draw(k, wc) {
    k.r(0, -1.4, 17, 2.8, MAT.woodDark);
    k.r(0, -1.4, 17, 1, '#5d3a63');
    k.r(4, -2.1, 1.6, 4.2, MAT.woodDark);             // knots
    k.r(10, -2.1, 1.6, 4.2, MAT.woodDark);
    k.poly([[16, -3], [19, -4.4], [21, 0], [19, 4.4], [16, 3]], MAT.ironLight);  // claw setting
    k.glow(23.5, 0, 7, wc, 0.28);
    k.circ(23.5, 0, 4.4, wc);
    k.circ(22.3, -1.3, 1.7, '#ffffff');
    k.r(19.6, -0.4, 1.6, 0.8, MAT.steelLight);
  }},

  hammer: { draw(k, wc) {
    haft(k, 15, 2.8);
    k.r(4, -1.6, 1, 3.2, MAT.leatherLt);
    collar(k, 13.5, 9);
    k.r(15, -6.5, 8, 13, wc);                          // head block
    k.r(15, -6.5, 8, 2.2, MAT.steelLight);
    k.r(15, 4.6, 8, 1.9, MAT.steelDark);
    k.r(22, -6.5, 1.6, 13, MAT.steelLight);            // striking face
    k.r(17.5, -7.6, 3, 1.1, MAT.iron);
    k.poly([[15, -1.8], [11.5, -3.4], [11, 3.4], [15, 1.8]], MAT.iron);  // back claw
  }},

  wand: { draw(k, wc) {
    k.poly([[0, -1.5], [13, -0.9], [13, 0.9], [0, 1.5]], MAT.woodDark);
    k.r(0, -1.5, 4, 0.9, MAT.woodLight);
    collar(k, 12.5, 3.6);
    k.glow(17, 0, 6, wc, 0.3);
    k.poly([[14, 0], [17, -5], [20.5, 0], [17, 5]], wc);   // crystal star
    k.poly([[15.5, 0], [17, -2.4], [18.6, 0], [17, 2.4]], '#ffffff');
    k.r(21.5, -0.4, 1, 0.8, wc);
  }},

  whip: { draw(k, wc) {
    grip(k, 7, MAT.leather, MAT.leatherLt, 4);
    k.circ(-0.6, 0, 1.7, MAT.ironLight);
    k.r(7, -2.2, 1.6, 4.4, MAT.gold);
    // Tapering coiled lash.
    let px = 8.6, py = 0;
    for (let i = 0; i < 12; i++) {
      const x = 8.6 + i * 2.0;
      const y = Math.sin(i * 0.78) * (2 + i * 0.32);
      k.line(px, py, x, y, Math.max(0.8, 2.6 - i * 0.16), i % 2 ? wc : MAT.leatherLt);
      px = x; py = y;
    }
    k.poly([[px, py - 1.2], [px + 3, py], [px, py + 1.2]], MAT.steelLight);
  }},

  // Prod mounted at the front of the stock, bowing forward; the string sits
  // behind it across the tips, with the bolt nocked against it.
  crossbow: { draw(k, wc) {
    const cxA = 2, R = 11, SPAN = Math.PI * 0.44;
    const tipX = cxA + Math.cos(SPAN) * R, tipY = Math.sin(SPAN) * R;
    k.r(-4, -2.2, 17, 4.6, MAT.wood);                  // stock
    k.r(-4, -2.2, 17, 1.3, MAT.woodLight);
    k.poly([[-4, 2.4], [0, 2.4], [-1.4, 7.4], [-4.6, 7.4]], MAT.woodDark);  // trigger grip
    k.r(-1.4, 2.4, 1.6, 2.6, MAT.ironLight);           // trigger
    k.ring(cxA, 0, R, 2.6, MAT.iron, -SPAN, SPAN);     // prod
    k.ring(cxA, 0, R - 0.8, 1, MAT.ironLight, -SPAN * 0.95, SPAN * 0.95);
    k.line(tipX, -tipY, tipX, tipY, 0.9, MAT.rope);    // string
    k.r(tipX - 1, -1, 15, 2, MAT.woodDark);            // bolt groove
    k.r(tipX, -0.55, 12, 1.1, MAT.wood);               // bolt
    k.poly([[15.5, -2], [20, 0], [15.5, 2]], wc);
    k.poly([[tipX, -2], [tipX + 3, -0.6], [tipX, 0]], MAT.steelLight);      // vanes
    k.poly([[tipX, 2], [tipX + 3, 0.6], [tipX, 0]], MAT.steelLight);
    k.r(1, -3.6, 1.6, 1.8, MAT.gold);                  // sight
  }},

  flail: { draw(k, wc) {
    grip(k, 8, MAT.leather, MAT.leatherLt, 3);
    collar(k, 8, 4);
    for (let i = 0; i < 4; i++) k.ring(11 + i * 2.6, 0, 1.5, 0.9, MAT.ironLight);  // chain
    k.circ(24.5, 0, 4.6, '#7a2020');                   // spiked ball
    k.circ(23.2, -1.2, 1.8, '#a83434');
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3 + 0.3;
      k.poly([
        [24.5 + Math.cos(a) * 3.6 - Math.sin(a) * 1.4, 0 + Math.sin(a) * 3.6 + Math.cos(a) * 1.4],
        [24.5 + Math.cos(a) * 7.6, 0 + Math.sin(a) * 7.6],
        [24.5 + Math.cos(a) * 3.6 + Math.sin(a) * 1.4, 0 + Math.sin(a) * 3.6 - Math.cos(a) * 1.4],
      ], wc);
    }
  }},

  greatsword: { draw(k, wc) {
    grip(k, 8, MAT.leather, MAT.leatherLt, 4);
    k.ring(-2, 0, 2.4, 1.4, MAT.gold);                 // ring pommel
    k.poly([[8, -7], [11, -7.8], [11, 7.8], [8, 7]], MAT.steel);           // guard
    k.r(7.6, -7.8, 1.4, 15.6, MAT.steelLight);
    k.r(11, -1.6, 3, 3.2, MAT.gold);                   // ricasso wrap
    blade(k, 14, 36, 3.4, wc);
    k.r(15, -1.9, 16, 0.7, MAT.steelLight);
  }},

  glaive: { draw(k, wc) {
    haft(k, 22, 2.4);
    k.r(5, -1.3, 1.2, 2.6, MAT.rope); k.r(9, -1.3, 1.2, 2.6, MAT.rope);
    collar(k, 21.5, 6);
    // Long sweeping single-edged blade.
    k.poly([[23, -2.6], [26, -12], [31, -18], [33, -12.5], [30, -4], [23, 2.6]], wc);
    k.poly([[26, -12], [31, -18], [33, -12.5], [29.5, -10]], MAT.steelLight);
    k.poly([[23, 2.4], [20, 6.5], [19, 2], [23, -0.4]], MAT.iron);         // back hook
  }},

  grapple: { draw(k, wc) {
    k.r(-2.5, -3.4, 8, 6.8, MAT.iron);                 // launcher housing
    k.r(-2.5, -3.4, 8, 1.6, MAT.ironLight);
    k.r(-1, -1, 3, 2, MAT.gold);
    k.r(5.5, -2, 4, 4, MAT.steelDark);                 // muzzle
    for (let i = 0; i < 4; i++) k.ring(11 + i * 2.6, 0, 1.4, 0.9, MAT.steel);   // chain
    // Three-pronged hook.
    k.r(20, -1.4, 4, 2.8, MAT.ironLight);
    k.poly([[24, -1.2], [28.5, -6], [26.5, -1.4], [27, 0]], wc);
    k.poly([[24, 1.2], [28.5, 6], [26.5, 1.4], [27, 0]], wc);
    k.poly([[24, -0.9], [29.5, 0], [24, 0.9]], MAT.steelLight);
  }},

  katana: { draw(k, wc) {
    k.r(0, -1.7, 7, 3.4, MAT.dark);                    // tsuka
    for (let i = 0; i < 4; i++) k.poly([[0.6 + i * 1.7, -1.7], [1.8 + i * 1.7, -1.7], [0.9 + i * 1.7, 1.7]], '#4c4258');
    k.circ(7.4, 0, 2.6, MAT.iron); k.circ(7.4, -0.5, 1.7, MAT.ironLight);   // tsuba
    // Slim blade with a gentle curve, built from stepped slivers.
    for (let i = 0; i < 20; i++) {
      const x = 9 + i * 1.02;
      const y = -Math.pow(i / 19, 2) * 2.6;
      k.r(x, y - 1.15, 1.2, 2.2, wc);
      k.r(x, y - 1.15, 1.2, 0.75, MAT.steelLight);     // hamon
    }
    k.poly([[29.4, -3.9], [30, -2.1], [27.6, -1.4]], MAT.steelLight);       // kissaki
  }},

  // Held out to the side of the body rather than centred on the hand, so the
  // ring doesn't sit on top of the player sprite.
  chakram: { draw(k, wc) {
    const c = 9;
    k.ring(c, 0, 8, 2.6, wc);
    k.ring(c, 0, 8, 1, MAT.steelLight);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      k.poly([
        [c + Math.cos(a) * 9 - Math.sin(a) * 1.6, Math.sin(a) * 9 + Math.cos(a) * 1.6],
        [c + Math.cos(a) * 12, Math.sin(a) * 12],
        [c + Math.cos(a) * 9 + Math.sin(a) * 1.6, Math.sin(a) * 9 - Math.cos(a) * 1.6],
      ], wc);
    }
    k.ring(c, 0, 5, 2.2, MAT.leather);                 // inner grip wrap
  }},

  boomerang: { draw(k, wc) {
    k.poly([[-2, -1], [10, -10.5], [13.5, -7], [3.5, 1.5]], MAT.wood);
    k.poly([[-2, 1], [10, 10.5], [13.5, 7], [3.5, -1.5]], MAT.wood);
    k.poly([[-2, -1], [10, -10.5], [12, -8.6], [0.6, -0.4]], wc);           // leading edge
    k.poly([[-2, 1], [10, 10.5], [12, 8.6], [0.6, 0.4]], wc);
    k.r(4.4, -6, 1.2, 4, MAT.woodDark);                // carved bands
    k.r(4.4, 2, 1.2, 4, MAT.woodDark);
    k.circ(1.4, 0, 2.1, MAT.leatherLt);
  }},

  cannon: { draw(k, wc) {
    k.poly([[-1, 2.4], [4, 2.4], [2, 8.5], [-3, 8.5]], MAT.wood);          // grip
    k.r(-2, -4.4, 18, 8.8, MAT.iron);                  // barrel
    k.r(-2, -4.4, 18, 2.2, MAT.ironLight);
    k.r(-2, 3, 18, 1.4, MAT.dark);
    k.r(2, -5.2, 2, 10.4, wc);                         // reinforcing rings
    k.r(9, -5.2, 2, 10.4, wc);
    k.poly([[16, -5.6], [22, -6.6], [22, 6.6], [16, 5.6]], wc);            // flared muzzle
    k.poly([[18, -4], [22, -4.6], [22, 4.6], [18, 4]], MAT.dark);
    k.r(4, -6.2, 1.2, 1.6, MAT.iron);                  // touch hole + fuse spark
    k.glow(4.6, -7, 2.4, '#ff9944', 0.55);
  }},

  reaper: { draw(k, wc) {
    k.r(0, -1.4, 24, 2.8, '#2b1d16');
    k.r(0, -1.4, 24, 0.9, '#453027');
    k.r(7, -2.6, 2.2, 5.2, '#1c1310');                 // hand rest
    k.circ(23.5, 0, 2.6, MAT.ironLight);               // socket
    k.circ(23.5, -0.6, 1.5, MAT.steelLight);
    // Blade sweeping back over the haft.
    k.poly([[24, -2], [22, -11], [13, -19], [5, -18.5], [14, -14], [20, -6], [22, -1]], wc);
    k.poly([[22, -11], [13, -19], [5, -18.5], [13, -16.2], [20.5, -9.5]], '#ffd6ef');
    k.circ(2, 0, 2.2, '#e8e2d2');                      // skull charm
    k.r(1.2, -0.4, 0.7, 0.7, MAT.dark); k.r(2.5, -0.4, 0.7, 0.7, MAT.dark);
  }},

  // Held fanned between the fingers, ready to throw.
  shuriken: { draw(k, wc) {
    for (const [x, y] of [[9, -5], [5, 3]]) {
      k.poly([[x, y - 6], [x + 1.4, y - 1.4], [x + 6, y], [x + 1.4, y + 1.4],
              [x, y + 6], [x - 1.4, y + 1.4], [x - 6, y], [x - 1.4, y - 1.4]], wc);
      k.poly([[x, y - 6], [x + 1.4, y - 1.4], [x, y], [x - 6, y], [x - 1.4, y - 1.4]], MAT.steelLight);
      k.circ(x, y, 1.3, MAT.steelDark);
      k.circ(x, y, 0.6, MAT.dark);
    }
    k.r(-1, -1.5, 3, 3, MAT.leather);                  // wrapped fist
  }},

  frostrod: { draw(k, wc) {
    k.r(0, -1.3, 16, 2.6, '#3c4a66');
    k.r(0, -1.3, 16, 0.9, '#5a6c90');
    k.r(3, -1.8, 1.2, 3.6, MAT.steelLight);           // silver bands
    k.r(10, -1.8, 1.2, 3.6, MAT.steelLight);
    // Cluster of ice crystals.
    k.glow(21, 0, 7, wc, 0.3);
    k.poly([[15.5, -1.5], [19, -7.5], [21, -2]], '#cfefff');
    k.poly([[15.5, 1.5], [19, 7], [21, 2]], '#6ab8e0');
    k.poly([[16, -2.4], [26, 0], [16, 2.4]], wc);
    k.poly([[16, -2.4], [26, 0], [17, -0.4]], '#ffffff');
  }},

  blunderbuss: { draw(k, wc) {
    k.poly([[-3, -1.8], [4, -2.2], [4, 3], [-1, 5.5], [-4, 4]], MAT.wood);   // stock
    k.poly([[-3, -1.8], [4, -2.2], [4, -0.8], [-3, -0.4]], MAT.woodLight);
    k.r(3, -2.4, 14, 4, MAT.iron);                     // barrel
    k.r(3, -2.4, 14, 1.2, MAT.ironLight);
    k.poly([[16, -2.4], [22, -5.5], [22, 5.5], [16, 1.6]], wc);             // bell mouth
    k.poly([[16, -2.4], [22, -5.5], [22, -3.6], [16, -1.2]], MAT.goldLight);
    k.poly([[19, -3], [22, -4.2], [22, 4.2], [19, 2.2]], MAT.dark);
    k.r(6, 1.6, 4, 1.2, MAT.gold);                     // trigger guard
    k.r(7, -3.2, 2, 1, MAT.iron);                      // hammer
  }},

  lance: { draw(k, wc) {
    haft(k, 10, 2.6);
    k.r(1, -1.6, 4, 3.2, MAT.leather);
    k.poly([[9, -5.5], [12, -5.5], [12, 5.5], [9, 5.5]], MAT.steel);       // vamplate
    k.poly([[9, -5.5], [12, -5.5], [12, -3.5], [9, -3.5]], MAT.steelLight);
    // Long tapering spike.
    k.poly([[12, -3.2], [33, 0], [12, 3.2]], wc);
    k.poly([[12, -3.2], [33, 0], [12, -0.6]], '#fff4cc');
    k.r(14, -0.3, 11, 0.6, MAT.woodDark);
    k.poly([[14, 3], [19, 2.2], [19, 5.5], [15, 6]], '#c83a3a');           // pennant
  }},

  stormtome: { draw(k, wc) {
    // A spellbook held open, lightning crackling from its pages.
    k.poly([[0, -6], [8, -7], [8, 7], [0, 6]], '#3a2a6a');
    k.poly([[8, -7], [16, -6], [16, 6], [8, 7]], '#4a3a8a');
    k.poly([[1, -5], [7.6, -6], [7.6, 5.8], [1, 5]], '#efe6cf');
    k.poly([[8.4, -6], [15, -5], [15, 5], [8.4, 5.8]], '#fffaea');
    k.r(7.6, -7, 0.8, 14, MAT.dark);                   // spine
    k.r(2, -3, 4.5, 0.6, '#b8ab88'); k.r(2, -1, 4, 0.6, '#b8ab88'); k.r(2, 1, 4.5, 0.6, '#b8ab88');
    k.glow(12, -1, 7, wc, 0.35);
    k.poly([[11, -9], [13.5, -4], [11.8, -3.6], [14, 2], [10, -3], [11.8, -3.4]], wc);
    k.circ(1, 0, 1.1, MAT.gold);                       // clasp
  }},

  fireglove: { draw(k, wc) {
    // A flared leather cuff, an armoured fist, and fire bursting off the knuckles.
    k.poly([[-3, -5], [4, -4], [4, 4], [-3, 5]], '#5a1c0c');           // cuff
    k.poly([[-3, -5], [4, -4], [4, -2.6], [-3, -3.4]], '#8a3418');
    k.r(-1, -4.6, 1, 9.2, MAT.gold); k.r(2.2, -4.2, 1, 8.4, MAT.gold);  // gold bands
    k.poly([[4, -4.2], [11, -4.6], [13.5, -3], [13.5, 3.4], [11, 4.6], [4, 4.2]], '#b8360e');   // fist
    k.poly([[4, -4.2], [11, -4.6], [13.5, -3], [13.5, -1.6], [4, -2.2]], '#e25a1c');
    for (let i = 0; i < 4; i++) k.r(11.6, -3.6 + i * 2, 2.4, 1.3, MAT.goldLight);   // knuckle plates
    k.poly([[5, 3.2], [8.5, 2], [9.5, 4.2], [6, 5.2]], '#8a260a');     // thumb
    k.glow(16, 0, 7, wc, 0.35);
    k.poly([[13.5, -3.8], [20, -5.5], [17, -1.5], [22, 0], [17, 1.5], [19.5, 5], [13.5, 3.8]], wc);
    k.poly([[13.5, -2], [18, -2.6], [16.2, 0], [18, 2.4], [13.5, 2]], '#ffd84a');
  }},

  vortex: { draw(k, wc) {
    // A round buckler held by its grip, a charged spiral set into its face.
    grip(k, 4, MAT.leather, MAT.leatherLt, 2);
    k.circ(11, 0, 8, '#2a3a58');                       // rim
    k.circ(11, 0, 6.8, '#3e5a86');
    k.circ(10.2, -1, 5.2, '#4e74aa');
    k.glow(11, 0, 9, wc, 0.3);
    k.ring(11, 0, 4.2, 1.2, wc, -0.4, 2.4);            // spiral arms
    k.ring(11, 0, 2.4, 1.1, '#e8fbff', 2.2, 5.2);
    k.circ(11, 0, 1.2, '#ffffff');
    for (const [x, y] of [[11, -7.2], [18.2, 0], [11, 7.2], [3.8, 0]]) k.r(x - 0.6, y - 0.6, 1.2, 1.2, MAT.steelLight);   // studs
  }},

  windwand: { draw(k, wc) {
    // A twisted birch staff: leaf-wrapped grip, silver collars, two feathered
    // wings flaring from the head and a floating orb of caged wind above it.
    k.r(0, -1.5, 5, 3, '#2f6a3a');                       // leaf-wrapped grip
    k.r(0.8, -1.5, 0.9, 3, '#58a864'); k.r(2.6, -1.5, 0.9, 3, '#58a864');
    k.poly([[5, -1.4], [17, -1.1], [17, 1.1], [5, 1.4]], '#d9c79a');   // twisted shaft
    k.poly([[5, -1.4], [17, -1.1], [17, -0.3], [5, 0]], '#f4e8c4');
    for (const x of [7, 10, 13]) k.line(x, -1.3, x + 1.6, 1.3, 0.8, '#9a8456');   // spiral grain
    k.r(4.6, -2.2, 1.4, 4.4, MAT.steelLight);            // collars
    k.r(11.4, -1.9, 1, 3.8, MAT.steel);
    k.r(16.4, -2.3, 1.5, 4.6, MAT.steelLight);
    // Feathered wings.
    k.poly([[16, -2], [19, -7.5], [21.5, -9], [21, -5], [19, -2]], '#eafff6');
    k.poly([[16, -2], [19, -6.5], [20.5, -7.4], [19.6, -4.6], [18.4, -2]], '#aef5dc');
    k.poly([[16, 2], [19, 7.5], [21.5, 9], [21, 5], [19, 2]], '#eafff6');
    k.poly([[16, 2], [19, 6.5], [20.5, 7.4], [19.6, 4.6], [18.4, 2]], '#aef5dc');
    // Caged orb of wind.
    k.glow(24, 0, 9, wc, 0.38);
    k.circ(24, 0, 5.2, '#1f4a40');
    k.circ(24, 0, 4.4, '#3fae92');
    k.ring(24, 0, 3.4, 1.2, '#e8fff6', -0.6, 2.6);       // swirl inside
    k.ring(24, 0, 2, 1, wc, 2.4, 5.6);
    k.circ(24, 0, 1, '#ffffff');
    k.ring(24, 0, 6.6, 0.9, MAT.steelLight, 0.5, 2.5);   // cage arcs
    k.ring(24, 0, 6.6, 0.9, MAT.steelLight, 3.6, 5.6);
    k.line(30.5, -4, 33, -6.5, 0.9, wc);                 // streaks of wind
    k.line(31, 0, 34, 0, 0.9, '#d8fff0');
    k.line(30.5, 4, 33, 6.5, 0.9, wc);
  }},

  revolver: { draw(k, wc) {
    // A heavy six-gun: wooden grip, fat cylinder, long barrel, glowing muzzle
    // (it fires explosive rounds).
    k.poly([[-4, 1.5], [2, -0.5], [4, 3], [0, 7.5], [-4.5, 6.5]], MAT.wood);   // grip
    k.poly([[-4, 1.5], [2, -0.5], [2.6, 0.9], [-3.6, 2.8]], MAT.woodLight);
    k.r(-2.4, 4, 1.2, 1.2, MAT.gold);
    k.r(1, -3, 7.5, 5, MAT.iron);                      // frame
    k.r(1, -3, 7.5, 1.2, MAT.ironLight);
    k.circ(5.2, -0.4, 3, MAT.steelDark);               // cylinder
    k.r(3, -2.6, 4.4, 1, MAT.steelLight);
    k.r(3.2, 0.4, 4, 0.7, MAT.dark);
    k.r(0.5, -4.6, 2.2, 1.8, MAT.iron);                // hammer
    k.r(8, -3, 14, 2.8, MAT.steel);                    // barrel
    k.r(8, -3, 14, 0.9, MAT.steelLight);
    k.r(8, -0.6, 14, 0.4, MAT.steelDark);
    k.r(20, -4.1, 1.4, 1.2, MAT.iron);                 // front sight
    k.poly([[3, 2], [6.5, 2], [6, 4.8], [3.4, 4.2]], MAT.gold);   // trigger guard
    k.glow(23, -1.6, 4.5, wc, 0.45);
    k.r(21.5, -2.9, 1.6, 2.6, wc);                     // hot muzzle
  }},

  stormhammer: { draw(k, wc) {
    // A rune-banded war hammer: leather-wrapped haft, a heavy steel head with
    // gold caps, and lightning crackling off its face.
    k.r(-2, -1.6, 2, 3.2, MAT.gold);                     // pommel
    k.r(0, -1.4, 14, 2.8, MAT.wood);                     // haft
    k.r(0, -1.4, 14, 0.9, MAT.woodLight);
    for (const x of [2, 4.5, 7]) k.r(x, -1.6, 1.2, 3.2, MAT.leather);   // grip wrap
    k.r(10, -1.7, 1, 3.4, MAT.gold);
    k.r(13, -7, 9, 14, '#4a5a6a');                       // head
    k.r(13, -7, 9, 3, '#7a8a9a');
    k.r(13, -7, 1.6, 14, MAT.gold); k.r(20.4, -7, 1.6, 14, MAT.gold);   // gold caps
    k.r(15.5, -2, 4, 4, '#2a3440');                      // rune plate
    k.line(16.5, -1.5, 18.5, 0, 0.8, wc); k.line(18.5, 0, 16.5, 1.5, 0.8, wc);
    k.glow(24, 0, 7, wc, 0.45);
    k.line(22, -5, 25, -3, 0.8, wc); k.line(25, -3, 23.5, -1, 0.8, wc); k.line(23.5, -1, 26.5, 1.5, 0.8, '#e8f6ff');
    k.line(22, 4, 25, 6.5, 0.8, wc);
  }},

  frostscythe: { draw(k, wc) {
    // A long pale haft bound in silver, and a great curved blade of blue ice
    // with frost spikes along its back.
    k.r(-1, -1.2, 20, 2.4, '#d8e8f0');                   // haft
    k.r(-1, -1.2, 20, 0.8, '#ffffff');
    for (const x of [3, 9, 15]) k.r(x, -1.6, 1.2, 3.2, MAT.steelLight);   // silver bands
    k.glow(22, -6, 9, wc, 0.4);
    k.poly([[18, -1.5], [20, -6], [24, -10], [29, -11], [33, -9], [27, -8], [23, -5], [21, -1.5]], '#7ac8e8');   // blade
    k.poly([[20, -6], [24, -10], [29, -11], [33, -9], [28, -9.4], [24, -8]], '#e8faff');
    k.poly([[22, -9], [21, -12], [23.5, -10]], '#bfefff');   // frost spikes
    k.poly([[26, -11], [26, -14], [28, -11.2]], '#bfefff');
    k.r(30, -13, 1, 1, '#ffffff'); k.r(34, -7, 1, 1, wc);
  }},

  sunbow: { draw(k, wc) {
    // A golden recurve bow with a sun disc at the grip, its string drawn
    // with a burning arrow of sunlight.
    k.ring(4, 0, 12, 1.8, MAT.gold, -1.25, 1.25);        // limbs
    k.ring(4, 0, 12, 0.8, MAT.goldLight, -1.15, -0.2);
    k.line(7.6, -11.5, 7.6, 11.5, 0.6, '#fff6c0');       // string
    k.glow(16, 0, 8, wc, 0.45);
    k.circ(15.5, 0, 3.2, '#ff9a2a');                     // sun disc at the grip
    k.circ(15.5, 0, 2, '#ffd24a');
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      k.r(15.5 + Math.cos(a) * 4.6 - 0.5, Math.sin(a) * 4.6 - 0.5, 1, 1, '#ffe08a');
    }
    k.r(7.6, -0.5, 20, 1, '#ffd24a');                    // arrow shaft
    k.poly([[27.6, -2], [31, 0], [27.6, 2]], '#fff6c0'); // burning head
    k.r(8, -1.6, 2.4, 1, '#ff7a1a'); k.r(8, 0.6, 2.4, 1, '#ff7a1a');   // fletching
  }},

  ghostdagger: { draw(k, wc) {
    // A slim, wavy spectral blade on a dark, rune-wrapped hilt: wisps trail off
    // the edge, and a ghostly glow hangs around the whole thing.
    k.r(-2.4, -1.4, 1.6, 2.8, '#c8a040');                 // pommel
    k.r(-1, -1.5, 5, 3, '#2a1a3a');                        // wrapped grip
    k.r(0, -1.5, 0.8, 3, '#5a3a7a'); k.r(2, -1.5, 0.8, 3, '#5a3a7a');
    k.poly([[4, -4], [5.6, -4], [5.6, 4], [4, 4]], '#c8a040');   // guard
    k.r(4.4, -0.6, 0.8, 1.2, '#a8f0ff');                  // gem in the guard
    k.glow(12, 0, 9, wc, 0.4);
    k.poly([[5.6, -2], [10, -2.6], [14, -1.6], [18, -1.2], [21, 0], [18, 1.2], [14, 1.6], [10, 2.6], [5.6, 2]], '#bfeeff');   // blade
    k.poly([[5.6, -2], [10, -2.6], [14, -1.6], [18, -1.2], [21, 0], [14, -0.3], [5.6, -0.3]], '#ffffff');
    k.line(6.5, 0.6, 18, 0.4, 0.6, '#7ac8e0');              // fuller
    k.r(9, -4.4, 1, 1, '#e8fcff'); k.r(13.5, 3.4, 1, 1, wc); k.r(17, -3.6, 0.8, 0.8, '#ffffff');   // wisps
    k.line(20, -2, 23.5, -4, 0.7, wc); k.line(20, 2, 23.5, 4, 0.7, '#e8fcff');
  }},

  portalwand: { draw(k, wc) {
    // The Portal Mage's wand: a dark rune-cut shaft bound in gold, twin gold
    // prongs cradling a swirling portal, and a flicker of his fire inside it.
    k.r(0, -1.6, 5, 3.2, '#2a1440');                     // wrapped grip
    k.r(0.8, -1.6, 0.9, 3.2, '#5a2a8a'); k.r(2.8, -1.6, 0.9, 3.2, '#5a2a8a');
    k.r(-1.2, -1.2, 1.4, 2.4, MAT.gold);                 // pommel
    k.poly([[5, -1.4], [17, -1.1], [17, 1.1], [5, 1.4]], '#1a1026');   // shaft
    k.poly([[5, -1.4], [17, -1.1], [17, -0.4], [5, -0.4]], '#3a2652');
    for (const x of [7.5, 10.5, 13.5]) k.r(x, -0.5, 1, 1, '#c87aff');  // glowing runes
    k.r(4.6, -2.2, 1.3, 4.4, MAT.gold);                  // gold bands
    k.r(16.2, -2.4, 1.5, 4.8, MAT.gold);
    k.poly([[17, -2], [19.5, -7], [22.5, -8.6], [20.8, -3.6]], MAT.gold);   // prongs
    k.poly([[17, 2], [19.5, 7], [22.5, 8.6], [20.8, 3.6]], MAT.gold);
    k.poly([[17.6, -2], [19.8, -6.2], [21.4, -7], [20.2, -3.4]], MAT.goldLight);
    k.glow(25, 0, 10, wc, 0.5);
    k.circ(25, 0, 6, MAT.goldLight);                     // portal ring
    k.circ(25, 0, 5, '#12051f');                         // the void
    k.ring(25, 0, 3.8, 1.2, wc, 0.2, 3.8);               // swirl
    k.ring(25, 0, 2.3, 1, '#e0c8ff', 3.4, 6.8);
    k.circ(25.4, 0.4, 1.3, '#ff7a2a');                   // the mage's fire within
    k.circ(25.2, 0.2, 0.6, '#ffd84a');
    k.r(31.5, -4.5, 1, 1, '#e0c8ff'); k.r(32.5, 2.5, 1, 1, wc); k.r(30.5, 5, 0.8, 0.8, '#ff9a3a');   // sparks
  }},
};

// Run a definition through a kit that records geometry instead of painting, to
// learn its bounds. Glows are skipped: they're soft halos, not silhouette, and
// including them would leave the real weapon floating small inside its slot.
function measureArt(draw) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const pt = (x, y) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  };
  const arcPts = (x, y, r, a0, a1) => {
    const span = a1 - a0, n = Math.max(8, Math.ceil(Math.abs(span) / 0.15));
    for (let i = 0; i <= n; i++) {
      const a = a0 + span * (i / n);
      pt(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
  };
  draw({
    r(x, y, w, h) { pt(x, y); pt(x + w, y + h); },
    poly(pts) { for (const [x, y] of pts) pt(x, y); },
    circ(x, y, r) { pt(x - r, y - r); pt(x + r, y + r); },
    ring(x, y, r, lw, c, a0, a1) {
      const h = (lw || 1) / 2;
      arcPts(x, y, r + h, a0 === undefined ? 0 : a0, a1 === undefined ? Math.PI * 2 : a1);
    },
    line(x1, y1, x2, y2, lw) {
      const h = (lw || 1) / 2;
      pt(x1 - h, y1 - h); pt(x1 + h, y1 + h);
      pt(x2 - h, y2 - h); pt(x2 + h, y2 + h);
    },
    glow() {},
  }, '#ffffff');
  if (minX === Infinity) return { x: 0, y: -1, w: 1, h: 2 };
  const m = 0.4;
  return { x: minX - m, y: minY - m, w: (maxX - minX) + m * 2, h: (maxY - minY) + m * 2 };
}
for (const art of Object.values(WEAPON_ART)) art.box = measureArt(art.draw);

// ─── Monster arms ─────────────────────────────────────────────────────────────
// What each monster carries, in the same local space as the player weapons (grip
// at the origin, pointing +X). Kept out of WEAPON_ART so they never show up as
// pickups or in the shop. Each one reads as its owner's role: a scrappy club for
// the grunt, a quick shiv for the runner, a crushing maul for the brute, a venom
// staff for the spitter, pike and tower shield for the armoured warden, and a
// huge double axe for the behemoth.
const MON_MAT = {
  bone: '#d8cfb0', boneDark: '#9d9274',
  stone: '#8a867c', stoneLight: '#b3aea2', stoneDark: '#57534b',
};

const MONSTER_ARMS_ART = {

  m_club: { draw(k, wc) {
    k.r(0, -1.3, 4, 2.6, MAT.leather);
    k.r(1, -1.3, 0.8, 2.6, MAT.leatherLt);
    k.r(2.6, -1.3, 0.8, 2.6, MAT.leatherLt);
    // Nail spikes first so the knotted head overlaps their roots.
    for (const [x, s] of [[8.5, -1], [11.5, 1], [14.2, -1], [13, 1]]) {
      k.poly([[x - 0.8, s * 2], [x, s * 4.8], [x + 0.8, s * 2]], MAT.steel);
    }
    k.poly([[3.5, -1.5], [13.5, -3.3], [16.5, -2.2], [17, 0], [16.5, 2.2], [13.5, 3.3], [3.5, 1.5]], wc);
    k.poly([[3.5, -1.5], [13.5, -3.3], [16.5, -2.2], [16, -1.1], [4, -0.6]], MAT.woodLight);
    k.poly([[4, 0.9], [13.5, 2.3], [16.5, 2.2], [13.5, 3.3], [3.5, 1.5]], MAT.woodDark);
    k.r(10, -0.6, 1.2, 1.2, MAT.woodDark);            // knot
  }},

  m_shiv: { draw(k, wc) {
    k.r(0, -1.2, 3.8, 2.4, MON_MAT.boneDark);
    k.r(0, -1.2, 3.8, 0.8, MON_MAT.bone);
    k.r(3.6, -2.4, 1.3, 4.8, MAT.iron);
    // Serrated back edge, hooked tip.
    k.poly([[4.9, -1.6], [6.6, -2.1], [7.4, -1.2], [8.8, -1.9], [9.6, -1], [11, -1.6], [13.5, 0.2], [11.5, 1.3], [4.9, 1.4]], wc);
    k.poly([[4.9, -1.6], [6.6, -2.1], [7.4, -1.2], [8.8, -1.9], [9.6, -1], [11, -1.6], [12.4, -0.5], [4.9, -0.3]], MAT.steelLight);
    k.r(5, 0.6, 6, 0.6, MAT.steelDark);
  }},

  m_maul: { draw(k, wc) {
    haft(k, 15, 2.8);
    k.r(1.5, -1.7, 3.5, 3.4, MAT.leather);
    k.r(2.4, -1.7, 0.8, 3.4, MAT.leatherLt);
    // A rough-cut stone block lashed on with iron bands.
    k.poly([[13, -6.5], [14.5, -7.5], [21.5, -7], [22.5, -5.5], [22.5, 6], [21, 7.5], [14, 7], [13, 5.5]], wc);
    k.poly([[13, -6.5], [14.5, -7.5], [21.5, -7], [22.5, -5.5], [13, -4.8]], MON_MAT.stoneLight);
    k.poly([[13, 4.6], [22.5, 4.8], [22.5, 6], [21, 7.5], [14, 7], [13, 5.5]], MON_MAT.stoneDark);
    k.r(15, -7.8, 1.7, 15.4, MAT.iron);
    k.r(19.3, -7.6, 1.7, 15.2, MAT.iron);
    k.r(15, -7.8, 1.7, 1, MAT.ironLight);
    k.r(19.3, -7.6, 1.7, 1, MAT.ironLight);
    k.r(17.4, -2.5, 1, 1, MON_MAT.stoneDark);            // chips
    k.r(21.4, 1.5, 1, 1.2, MON_MAT.stoneDark);
  }},

  m_venom: { draw(k, wc) {
    k.r(0, -1.2, 15, 2.4, MAT.woodDark);
    k.r(0, -1.2, 15, 0.8, '#5c4a2c');
    k.r(4, -1.7, 1.2, 3.4, MAT.rope);
    k.r(6, -1.7, 1.2, 3.4, MAT.rope);
    // Bone prongs cradle a sac of venom that drips from below.
    k.poly([[14, -1.2], [16.5, -5.2], [18, -5], [15.8, -0.6]], MON_MAT.bone);
    k.poly([[14, 1.2], [16.5, 5.2], [18, 5], [15.8, 0.6]], MON_MAT.boneDark);
    k.glow(20, 0, 7, wc, 0.3);
    k.circ(20, 0, 3.8, wc);
    k.circ(19, -1.3, 1.4, '#efffd0');
    k.poly([[19.4, 3.2], [20.4, 6.4], [21, 3.2]], wc);
    k.r(20.2, 7, 0.9, 1, wc);
  }},

  m_pike: { draw(k, wc) {
    haft(k, 22, 2.2);
    k.r(3, -1.3, 1, 2.6, MAT.rope);
    collar(k, 21, 4.6);
    // Halberd head: a thrusting point with a hooked axe blade on top.
    k.poly([[21.5, -1.6], [22.5, -6.5], [25.5, -7], [25, -1.6]], MAT.steel);
    k.poly([[22.5, -6.5], [25.5, -7], [25.3, -5.6], [22.8, -5.2]], MAT.steelLight);
    k.poly([[21.5, 1.2], [21, 3.8], [23.5, 1.2]], MAT.steelDark);
    k.poly([[22.8, -2.6], [28, -1.6], [31.5, 0], [28, 1.6], [22.8, 2.6]], wc);
    k.poly([[22.8, -2.6], [28, -1.6], [30.5, -0.3], [22.8, -0.5]], MAT.steelLight);
    k.r(23.5, -0.3, 5, 0.6, MAT.steelDark);
  }},

  // Carried flat against the body rather than swung, so its origin is its centre.
  m_shield: { draw(k, wc) {
    k.poly([[-4.6, -8], [4.6, -8], [5, 3.5], [0, 9], [-5, 3.5]], MAT.steelDark);
    k.poly([[-3.4, -6.8], [3.4, -6.8], [3.8, 3], [0, 7.4], [-3.8, 3]], wc);
    k.poly([[-3.4, -6.8], [3.4, -6.8], [3.5, -5.4], [-3.5, -5.4]], MAT.steelLight);
    k.r(-0.6, -6.8, 1.2, 14, MAT.steelDark);         // central rib
    k.r(-3.6, -1.2, 7.2, 1.2, MAT.steelDark);
    k.circ(0, -0.6, 1.7, MAT.steel);
    k.circ(-0.4, -1, 0.7, MAT.steelLight);
    for (const [x, y] of [[-3.8, -7.2], [3.8, -7.2], [-4, 2.6], [4, 2.6]]) k.r(x - 0.5, y - 0.5, 1, 1, MAT.steelLight);
  }},

  m_greataxe: { draw(k, wc) {
    haft(k, 21, 3);
    k.r(1, -1.8, 4.5, 3.6, MAT.leather);
    k.r(2, -1.8, 0.9, 3.6, MAT.leatherLt);
    k.r(3.8, -1.8, 0.9, 3.6, MAT.leatherLt);
    k.poly([[21, -1.5], [25.5, 0], [21, 1.5]], MAT.steel);        // top spike
    collar(k, 13.5, 8);
    // Double-bitted head, blood along both edges.
    k.poly([[15.5, -3], [16.5, -12], [21, -13.5], [23, -7], [23, 7], [21, 13.5], [16.5, 12], [15.5, 3]], MAT.iron);
    k.poly([[16.5, -12], [21, -13.5], [20.5, -11.4], [17, -10.2]], MAT.ironLight);
    k.poly([[21, -13.5], [23, -7], [23, 7], [21, 13.5], [22, 0]], MAT.steelLight);
    k.poly([[21.6, -11.5], [22.6, -7.5], [22.4, -4], [21.8, -6]], wc);
    k.poly([[21.6, 11.5], [22.6, 7.5], [22.4, 4], [21.8, 6]], wc);
    k.r(15.5, -1.4, 3, 2.8, MAT.ironLight);
    k.circ(19, 0, 1.4, wc);
  }},

  // ── EXTREME monsters ──
  // Titan: a steel warhammer the size of a door, runes glowing on the face.
  m_warhammer: { draw(k, wc) {
    haft(k, 20, 3.2);
    k.r(1, -2, 5, 4, MAT.leather);
    k.r(2.2, -2, 0.9, 4, MAT.leatherLt);
    k.r(4.2, -2, 0.9, 4, MAT.leatherLt);
    collar(k, 15.5, 7);
    k.poly([[17, -9], [27, -9], [28.5, -7.5], [28.5, 7.5], [27, 9], [17, 9], [16, 7.5], [16, -7.5]], wc);
    k.poly([[17, -9], [27, -9], [28.5, -7.5], [16, -7.5]], MAT.steelLight);
    k.poly([[16, 6], [28.5, 6], [28.5, 7.5], [27, 9], [17, 9], [16, 7.5]], MAT.steelDark);
    k.r(18.5, -6.5, 1.4, 13, MAT.iron);                  // banding
    k.r(25, -6.5, 1.4, 13, MAT.iron);
    k.glow(22, 0, 5, '#8ee8ff', 0.35);
    k.r(21.2, -3.5, 1.6, 7, '#8ee8ff');                  // rune
    k.r(20, -0.8, 4, 1.6, '#8ee8ff');
    k.poly([[20, -9], [22, -12.5], [24, -9]], MAT.steel); // crown spike
  }},

  // Giant: a whole uprooted tree, held by the trunk, roots trailing behind.
  m_tree: { draw(k, wc) {
    k.poly([[-4, -2.5], [-7, -5.5], [-5, -1.5], [-8, 0], [-5, 1.5], [-7, 5], [-3, 2.5]], MAT.woodDark);   // roots
    k.poly([[-3, -2.8], [30, -1.8], [30, 1.8], [-3, 2.8]], MAT.wood);                    // trunk, tapering
    k.poly([[-3, -2.8], [30, -1.8], [30, -0.8], [-3, -1.4]], MAT.woodLight);
    k.poly([[-3, 1.6], [30, 1], [30, 1.8], [-3, 2.8]], MAT.woodDark);
    k.r(6, -2.4, 1, 1, MAT.woodDark); k.r(15, 1, 1.2, 1, MAT.woodDark);               // knots
    k.poly([[16, -1.6], [21, -6], [22, -5], [18, -1.4]], MAT.wood);                     // branches
    k.poly([[22, 1.4], [26, 5.5], [27, 4.5], [24, 1.2]], MAT.wood);
    // Leafy crown: overlapping clumps, dark underneath, lit on top.
    k.circ(34, 0, 8, '#2e5a24');
    k.circ(29, -5, 6, '#2e5a24');
    k.circ(29, 5, 5.5, '#2e5a24');
    k.circ(38, -4, 5.5, '#3e7a30');
    k.circ(33, -3, 6, wc);
    k.circ(28, -6, 3.5, '#6aa84a');
    k.circ(36, -6, 3, '#8ac860');
    k.circ(38, 3, 4, '#3e7a30');
    k.r(31, -7, 1.2, 1.2, '#b8e080'); k.r(35, 1, 1, 1, '#b8e080');
  }},

  // Wraith: a long, thin spectral scythe.
  m_scythe: { draw(k, wc) {
    k.r(0, -1, 22, 2, '#2a2238');
    k.r(0, -1, 22, 0.7, '#4a3a60');
    k.r(4, -1.4, 1, 2.8, '#6a5a8a');
    k.r(11, -1.4, 1, 2.8, '#6a5a8a');
    k.glow(22, -6, 8, wc, 0.3);
    // Hooked blade sweeping back down from the tip.
    k.poly([[20.5, -1.2], [23, -8], [21, -14], [15, -16.5], [9, -15.5], [16, -13.2], [20.5, -9.5], [21.2, -2]], wc);
    k.poly([[21, -14], [15, -16.5], [9, -15.5], [15.5, -15.2], [20, -12.5]], '#e8e0ff');
    k.circ(22, -0.2, 1.5, '#c8b8ff');
  }},

  // Portal Mage: a long ebony staff whose head is a tiny portal held open in a
  // ring of gold, with crescent prongs around it.
  m_portalstaff: { draw(k, wc) {
    k.r(0, -1.2, 19, 2.4, '#1a1026');
    k.r(0, -1.2, 19, 0.8, '#3a2652');
    k.r(3, -1.7, 1.2, 3.4, MAT.gold); k.r(9, -1.7, 1.2, 3.4, MAT.gold); k.r(15, -1.7, 1.2, 3.4, MAT.gold);
    k.poly([[18, -2], [20.5, -7.5], [23, -9], [21.5, -4]], MAT.gold);        // prongs
    k.poly([[18, 2], [20.5, 7.5], [23, 9], [21.5, 4]], MAT.gold);
    k.glow(25, 0, 9, wc, 0.45);
    k.circ(25, 0, 5.6, MAT.goldLight);                                      // gold ring
    k.circ(25, 0, 4.4, '#12051f');                                          // portal void
    k.ring(25, 0, 3.2, 1.1, wc, 0.2, 3.6);                                  // swirl
    k.ring(25, 0, 1.8, 0.9, '#e0c8ff', 3.4, 6.6);
    k.circ(25, 0, 0.8, '#ffffff');
  }},

  // Infernal: a blackened staff crowned with a burning skull.
  m_hellstaff: { draw(k, wc) {
    k.r(0, -1.2, 16, 2.4, '#2a1a14');
    k.r(0, -1.2, 16, 0.8, '#4a2e22');
    k.r(4, -1.7, 1.2, 3.4, MAT.iron);
    k.r(8, -1.7, 1.2, 3.4, MAT.iron);
    k.poly([[15, -1.6], [17, -5], [18.5, -4], [17, -1]], MAT.iron);   // claws
    k.poly([[15, 1.6], [17, 5], [18.5, 4], [17, 1]], MAT.iron);
    k.glow(21, 0, 8, wc, 0.4);
    k.poly([[18.5, -5.5], [22, -8.5], [21, -5], [25, -7], [23, -2.5]], wc);   // flames
    k.circ(21.5, 0, 3.6, MON_MAT.bone);                                     // skull
    k.r(19.5, 2.4, 4, 1.8, MON_MAT.boneDark);
    k.r(20, -0.8, 1.3, 1.3, '#ffd84a');                                     // burning eyes
    k.r(22.4, -0.8, 1.3, 1.3, '#ffd84a');
  }},

  // Bomber: a round black bomb held out in front, its fuse spitting sparks.
  m_bomb: { draw(k, wc) {
    k.r(0, -1, 5, 2, MON_MAT.boneDark);                                     // the arm holding it
    k.circ(9, 0, 5, '#26242a');
    k.circ(7.8, -1.4, 2, '#4a4852');
    k.r(8, -6.5, 2, 2, MAT.iron);                                           // cap
    k.line(9, -6.5, 11, -9, 0.8, '#c8a070');                                // fuse
    k.glow(11.5, -9.5, 4, wc, 0.6);
    k.r(11, -10, 1.4, 1.4, '#ffffff');
    k.r(12.5, -11, 1, 1, wc); k.r(10, -11.5, 1, 1, '#ffd84a');
  }},

  // Shaman: a crooked wooden totem hung with feathers, a green gem on top.
  m_totem: { draw(k, wc) {
    k.r(0, -1.2, 17, 2.4, MAT.wood);
    k.r(0, -1.2, 17, 0.8, MAT.woodLight);
    k.r(5, -1.6, 1.2, 3.2, MAT.leather); k.r(10, -1.6, 1.2, 3.2, MAT.leather);
    k.poly([[9, 1.4], [8, 6], [10, 6.5], [10.5, 1.4]], '#e0c060');          // feathers
    k.poly([[12, 1.4], [12.5, 5.5], [14, 5], [13.4, 1.4]], '#c04a3a');
    k.poly([[16, -3], [19, -4.5], [22, -3], [22, 3], [19, 4.5], [16, 3]], MAT.woodDark);   // head
    k.glow(19, 0, 7, wc, 0.5);
    k.circ(19, 0, 2.4, wc);
    k.r(18.4, -1, 1, 1, '#ffffff');
  }},

  // Necromancer: a black staff topped with a skull wreathed in green flame.
  m_bonestaff: { draw(k, wc) {
    k.r(0, -1.1, 18, 2.2, '#1e1a26');
    k.r(0, -1.1, 18, 0.7, '#3a3248');
    k.r(4, -1.6, 1, 3.2, MON_MAT.bone); k.r(9, -1.6, 1, 3.2, MON_MAT.bone);   // bone rings
    k.glow(22, -1, 8, wc, 0.45);
    k.poly([[19, -4], [21, -9], [22.5, -5], [25, -8.5], [25, -3]], wc);     // ghost flame
    k.circ(22, 0, 3.6, MON_MAT.bone);                                       // skull
    k.r(20, 2.4, 4, 1.8, MON_MAT.boneDark);
    k.r(20.4, -0.8, 1.3, 1.3, wc); k.r(22.8, -0.8, 1.3, 1.3, wc);           // eyes
  }},
};
for (const art of Object.values(MONSTER_ARMS_ART)) art.box = measureArt(art.draw);

// Draw a weapon into `g`, already translated to its origin and oriented +X.
function drawWeaponArt(g, id, scale, color, outline) {
  const art = WEAPON_ART[id];
  if (!art) return;
  g.save();
  g.scale(scale, scale);
  if (outline) {
    const o = 1 / scale;   // one device pixel, whatever the scale
    for (const [dx, dy] of [[-o, 0], [o, 0], [0, -o], [0, o], [o, o]]) {
      g.save(); g.translate(dx, dy); art.draw(artKit(g, true), color); g.restore();
    }
  }
  art.draw(artKit(g, false), color);
  g.restore();
}

// Draw a weapon centred inside a box, scaled to fit. Used for panel icons,
// unlock previews and the upgrade shop. `box.y` is the top of the art, which for
// a scythe or glaive sits well above the grip — centring on the grip instead
// would waste half the slot and clip the blade.
function drawWeaponFitted(g, id, cx, cy, maxW, maxH, color, outline) {
  const art = WEAPON_ART[id];
  if (!art) return;
  const b = art.box;
  const s = Math.min(maxW / b.w, maxH / b.h);
  g.save();
  g.translate(cx - (b.x + b.w / 2) * s, cy - (b.y + b.h / 2) * s);
  drawWeaponArt(g, id, s, color, outline);
  g.restore();
}

if (typeof window !== 'undefined') {
  window.WEAPON_ART = WEAPON_ART;
  window.drawWeaponArt = drawWeaponArt;
  window.drawWeaponFitted = drawWeaponFitted;
}

// ─── Pixel rasterisation ──────────────────────────────────────────────────────
// The same 19 definitions above, rendered into a pixel buffer instead of onto a
// canvas path, so weapons match the rest of the art: hard edges, a dark outline
// and a lit top rim, with no antialiasing at any scale.

const _PK = (typeof window !== 'undefined' && window.PixelKit) ||
            (typeof require !== 'undefined' ? require('./pixel.js') : null);

const WEAPON_EDGE = '#0b0b14';

// A kit that speaks the same primitives as artKit but writes pixels.
function rasterKit(buf, ox, oy, s) {
  const K = _PK;
  const S = (v) => v * s;
  return {
    r(x, y, w, h, c) {
      K.rect(buf, ox + S(x), oy + S(y), Math.max(1, Math.round(S(w))), Math.max(1, Math.round(S(h))), c);
    },
    poly(pts, c) { K.poly(buf, pts.map(([x, y]) => [ox + S(x), oy + S(y)]), c); },
    circ(x, y, r, c) { K.disc(buf, ox + S(x), oy + S(y), Math.max(0.6, S(r)), c); },
    ring(x, y, r, lw, c, a0, a1) {
      K.arcPx(buf, ox + S(x), oy + S(y), S(r), Math.max(1, S(lw)), c,
              a0 === undefined ? 0 : a0, a1 === undefined ? Math.PI * 2 : a1);
    },
    line(x1, y1, x2, y2, lw, c) {
      K.thickLine(buf, ox + S(x1), oy + S(y1), ox + S(x2), oy + S(y2), Math.max(1, S(lw)), c);
    },
    // Glows are soft light, which pixel art conveys with a sparse dither rather
    // than an alpha blur.
    glow(x, y, r, c) {
      const cx = ox + S(x), cy = oy + S(y), rr = S(r);
      for (let py = Math.floor(cy - rr); py <= Math.ceil(cy + rr); py++) {
        for (let px = Math.floor(cx - rr); px <= Math.ceil(cx + rr); px++) {
          const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
          if (d > rr || d < rr * 0.45) continue;
          if (((px * 2 + py) % 4) !== 0) continue;
          K.setPx(buf, px, py, c);
        }
      }
    },
  };
}

// Render a weapon to a pixel buffer at `scale`. Returns { buf, ox, oy } where the
// offsets locate the art origin (the hand) inside the buffer.
function rasterWeapon(id, scale, color) {
  const art = WEAPON_ART[id] || MONSTER_ARMS_ART[id];
  if (!art || !_PK) return null;
  const b = art.box;
  const pad = 2;
  const w = Math.max(1, Math.ceil(b.w * scale) + pad * 2);
  const h = Math.max(1, Math.ceil(b.h * scale) + pad * 2);
  const ox = pad - b.x * scale, oy = pad - b.y * scale;
  const buf = _PK.makeBuf(w, h);
  art.draw(rasterKit(buf, ox, oy, scale), color);
  _PK.rimLight(buf, null, null);          // reserved: shading is baked in the art
  _PK.outline(buf, WEAPON_EDGE);
  return { buf, ox, oy, w, h };
}

// Cached canvas of a weapon at a given scale, plus where its origin sits.
const _weaponSprites = new Map();
function weaponSprite(id, scale, color) {
  const key = `${id}:${scale.toFixed(3)}:${color}`;
  let e = _weaponSprites.get(key);
  if (e !== undefined) return e;
  const r = rasterWeapon(id, scale, color);
  e = r ? { cv: _PK.bufToCanvas(r.buf), ox: r.ox, oy: r.oy, w: r.w, h: r.h } : null;
  _weaponSprites.set(key, e);
  if (_weaponSprites.size > 400) _weaponSprites.delete(_weaponSprites.keys().next().value);
  return e;
}

// Blit a weapon so its origin lands at the current transform's (0,0).
function drawWeaponPixels(g, id, scale, color) {
  const sp = weaponSprite(id, scale, color);
  if (!sp) return;
  g.drawImage(sp.cv, -sp.ox, -sp.oy);
}

// Pixel equivalent of drawWeaponFitted: scale to fit, then blit centred.
function drawWeaponPixelsFitted(g, id, cx, cy, maxW, maxH, color) {
  const art = WEAPON_ART[id];
  if (!art) return;
  const b = art.box;
  const s = Math.min(maxW / b.w, maxH / b.h);
  const sp = weaponSprite(id, s, color);
  if (!sp) return;
  g.drawImage(sp.cv, Math.round(cx - sp.ox - (b.x + b.w / 2) * s),
                     Math.round(cy - sp.oy - (b.y + b.h / 2) * s));
}

if (typeof window !== 'undefined') {
  window.MONSTER_ARMS_ART = MONSTER_ARMS_ART;
  window.rasterWeapon = rasterWeapon;
  window.weaponSprite = weaponSprite;
  window.drawWeaponPixels = drawWeaponPixels;
  window.drawWeaponPixelsFitted = drawWeaponPixelsFitted;
}
if (typeof module !== 'undefined') {
  module.exports = { WEAPON_ART, MONSTER_ARMS_ART, rasterWeapon, drawWeaponArt, drawWeaponFitted };
}
