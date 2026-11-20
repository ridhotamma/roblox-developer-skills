// Menu / loading banner for the imaginary "Slime Rush": a new world, the Crystal Caves (kind banner, 1024x512).
// Shows a different scheme from the store art: analogous colours in a dark mood with one complementary accent, a
// text column inside the area that survives ScaleType.Crop on phones and tablets, three depth planes and a dark
// foreground frame. references/graphic-design.md sections 8, 9, 12 and 13.
//
// Brief
//   Message: a new world to explore, the Crystal Caves.
//   Reading order: 1 the slime (lit by the crystals), 2 the title, 3 the glowing crystal cluster.
//   Layout: banner template. Text column on the left, hero on the right thirds line, both inside the crop-safe
//     central 75% x 75% (x 128..896, y 64..448). Foreground rocks may bleed off the corners: they frame, they are
//     not information.
//   Value: dark dominates (cave); the slime is the lightest large shape; the strongest light-dark contrast is the
//     slime against the dark cave with a magenta light pool behind it.
//   Colour: k.c.scheme(green slime, 'analogous', { mood: 'dark' }): teal cave (dominant, cool, recedes), dark olive
//     rock (secondary), magenta accent (the slime's complement) for the crystals and the title, ~10%.
//   Type: k.typeScale(37, 1.5) -> 37 / 56 / 83: kicker "NEW WORLD" 37 (open tracking), title 83 in two lines.
//   Depth: far stalactites and crystals hazed toward the cave fog, midground floor and crystal cluster, foreground
//     dark rocks in the bottom corners.
export default (k) => {
  const [W, H] = [1024, 512];
  const S = k.c.scheme('#5ee05a', 'analogous', { mood: 'dark' });
  const fog = S.bgLight, ts = k.typeScale(37, 1.5);
  const crop = { x0: W * 0.125, x1: W * 0.875, y0: H * 0.125, y1: H * 0.875 };   // what survives ScaleType.Crop

  // the mascot (same drawing as store.art.mjs), in a 512 box; look shifts the pupils toward the title
  const slimeBody = k.smooth([[256, 92], [356, 120], [420, 220], [440, 352], [400, 420], [256, 436], [112, 420], [72, 352], [92, 220], [156, 120]]);
  const face = (look = 0) => `<ellipse cx="${200 + look}" cy="270" rx="26" ry="36" fill="#1d1430"/><ellipse cx="${312 + look}" cy="270" rx="26" ry="36" fill="#1d1430"/>` +
    `<circle cx="${208 + look}" cy="258" r="10" fill="#fff"/><circle cx="${320 + look}" cy="258" r="10" fill="#fff"/>` +
    `<path d="M${216 + look * 0.6} 336 Q${256 + look * 0.6} 372 ${296 + look * 0.6} 336" fill="none" stroke="#1d1430" stroke-width="14" stroke-linecap="round"/>` +
    `<ellipse cx="158" cy="322" rx="22" ry="11" fill="#ffadc6"/><ellipse cx="354" cy="322" rx="22" ry="11" fill="#ffadc6"/>`;
  const [hx] = k.at('right', W, H), size = 400, hy = 446 - 0.3516 * size;   // body bottom on the floor at y 446

  // a crystal: hexagonal prism seen from the side, lit facet left, shadow facet right, a glint streak
  const crystal = (x, y, w, h, c, rot = 0) => {
    const [, d1, , l1, l2] = k.c.ramp(c, 5), hw = w / 2, tip = y - h, sh = y - h + w * 0.6;
    return `<g transform="rotate(${rot} ${x} ${y})"><path d="${k.poly([[x - hw, y], [x - hw, sh], [x, tip], [x, y]])}" fill="${l1}"/>` +
      `<path d="${k.poly([[x, y], [x, tip], [x + hw, sh], [x + hw, y]])}" fill="${d1}"/>` +
      `<path d="${k.poly([[x - hw * 0.62, y - h * 0.08], [x - hw * 0.62, sh + h * 0.04], [x - hw * 0.3, tip + h * 0.16], [x - hw * 0.3, y - h * 0.08]])}" fill="${l2}" opacity="0.75"/></g>`;
  };
  const cluster = (x, y, c, s = 1, seed = 1) => { const r = k.rng(seed); return [[-0.9, 0.55, -18], [0.9, 0.7, 16], [-0.35, 0.85, -7], [0.35, 1, 6]].map(([dx, hh, rot]) => crystal(x + dx * 22 * s, y, 34 * s, (110 + 30 * r()) * hh * s, c, rot)).join(''); };
  // irregular rows (even spacing and equal sizes read as a pattern, not a cave): gap, width and length all vary
  const stalactites = (y0, color, seed, { gap = [20, 90], wid = [26, 60], len = [30, 120] } = {}) => {
    const r = k.rng(seed), rr = ([a, b]) => a + (b - a) * r(); let d = `M-10 -10L-10 ${y0}`, x = -10 + rr(gap) * 0.5;
    while (x < W + 10) { const w = rr(wid), l = rr(len) * (r() < 0.2 ? 1.6 : 1); d += `L${x.toFixed(1)} ${y0}L${(x + w * (0.4 + 0.2 * r())).toFixed(1)} ${(y0 + l).toFixed(1)}L${(x + w).toFixed(1)} ${y0}`; x += w + rr(gap); }
    return k.path(d + `L${W + 10} ${y0}L${W + 10} -10Z`, color);
  };

  return {
    name: 'CrystalCavesBanner', kind: 'banner', size: [W, H], light: 'tl', outline: { width: 8, color: 'auto' },
    layers: [
      // ---- background plane: cave gradient, far shapes hazed toward the fog, a light pool behind the hero ----
      // the crystals light the cave: a magenta pool behind the hero (focal contrast), a faint cool fill behind the title
      { name: 'cave', stage: 'back', svg: k => k.bg.linear(S.bgDeep, S.bg) + k.bg.glowAt(300, 250, 300, fog, 0.18) + k.bg.glowAt(hx + 40, 300, 380, S.accent, 0.5) },
      { name: 'far stalactites', stage: 'back', svg: stalactites(40, k.c.atmos(S.bgDeep, 0.35, fog), 3, { gap: [10, 50], wid: [20, 46], len: [24, 80] }) },
      { name: 'far crystals', stage: 'back', svg: cluster(170, 400, k.c.atmos(S.accent, 0.4, fog), 0.55, 2) + cluster(966, 392, k.c.atmos(S.accent, 0.4, fog), 0.5, 5) },
      { name: 'fog', stage: 'back', svg: k => k.bg.haze(300, 470, fog, 0.3) },
      { name: 'near stalactites', stage: 'back', svg: stalactites(-6, S.bgDeep, 9, { gap: [40, 160], wid: [44, 90], len: [40, 110] }) },
      { name: 'floor', stage: 'back', svg: k => k.path('M-20 436 Q300 410 560 428 T1044 418 V540 H-20Z', k.linear([[0, k.c.mix(S.secondary, S.bg, 0.4)], [1, S.bgDeep]])) + k.groundShadow(hx, 444, 170, 14, 0.5, S.ink) },
      { name: 'vignette', stage: 'back', svg: k => k.bg.vignette(0.45) },
      // ---- midground plane: the glowing crystal cluster clearly behind the hero (its tips rise over the right
      //      shoulder: an overlap, not a tangent), then the hero ----
      { name: 'crystals', role: 'support', svg: cluster(hx + 118, 446, S.accent, 1.6, 7), shade: false, glow: { blur: 18, color: S.accent, opacity: 0.6 } },
      { name: 'slime', role: 'hero', svg: k.place(k.path(slimeBody, S.hero), hx, hy, size), shade: { style: 'gloss', depth: 110, rimColor: S.accent, rim: 0.45 } },
      { name: 'face', role: 'hero', svg: k.place(face(-14), hx, hy, size) },
      // ---- foreground plane: dark rocks cropped boldly by the bottom corners (frame the scene, outside crop-safe) ----
      { name: 'foreground', stage: 'front', svg: k.path('M-30 512 L-30 410 Q30 380 70 420 Q110 392 150 470 L170 540Z', k.c.shade(S.bgDeep, -0.7)) + k.path('M1054 512 L1054 380 Q1000 360 968 410 Q930 396 900 470 L880 540Z', k.c.shade(S.bgDeep, -0.7)) },
      // ---- text column: kicker, then the title two steps up the type scale, one block centred in the column ----
      { name: 'kicker', stage: 'front', svg: k.text('NEW WORLD', 300, 152, { size: ts(0), font: 'Luckiest Guy', fill: S.accent, stroke: S.ink, sw: 7, shadow: 3, ls: 3 }) },
      { name: 'title', stage: 'front', glow: { blur: 14, color: S.accent, opacity: 0.45 }, svg: `<g transform="rotate(-3 300 270)">` +
        k.text('CRYSTAL', 300, 240, { size: ts(2), font: 'Luckiest Guy', fill: [[0, S.light], [1, S.accent]], stroke: S.ink, sw: 13, shadow: 7 }) +
        k.text('CAVES', 300, 240 + ts(2) * 0.95, { size: ts(2), font: 'Luckiest Guy', fill: [[0, S.light], [1, S.accent]], stroke: S.ink, sw: 13, shadow: 7 }) + '</g>' },
    ],
    // crop-safe guide for anyone editing the spec: keep text and the hero inside it
    notes: [`crop-safe area: x ${crop.x0}..${crop.x1}, y ${crop.y0}..${crop.y1}`],
  };
};
