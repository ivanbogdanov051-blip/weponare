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
