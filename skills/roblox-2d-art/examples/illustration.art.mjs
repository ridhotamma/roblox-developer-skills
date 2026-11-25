// Loading-screen illustration (kind banner, 1024x576): an original mascot, "Sprout", sets out at dusk with a lantern.
// Shows the illustration method of references/illustration.md: construction from a posed skeleton (k.fk, k.limb),
// shapes from few smooth points (k.smooth), inked brush strokes (k.stroke) for leaves, scarf, grass and the path,
// natural scatter in ground perspective (k.scatter, k.persp), a face built for expression (k.eye, k.brow, k.mouth),
// a designed light plan (warm lantern key, cool sky rim, cast and contact shadows) and a finishing pass on the
// 'post' stage (lantern light, colour grade, vignette, grain).
//
// Brief
//   Message: a small forest spirit sets out into the evening, curious, not afraid.
//   Reading order: 1 Sprout's face lit by the lantern, 2 the lantern, 3 the path winding into the hills.
//   Layout: hero on the right thirds line, standing on the crest of the near hill, facing left INTO the picture; the
//     lantern pole reaches left so the eye goes face -> lantern -> path -> distance. Dark pines behind the hero give
//     the brightest shape its darkest backdrop.
//   Value: mid-dark dusk dominates; the lantern and the lit face are the only near-white values.
//   Colour: violet-blue dusk (dominant, cool), teal-dark ground (secondary), mossy green hero against the violet
//     (near-complement), warm lantern yellow as the ~10% accent; the grade pulls everything warm near the lantern and
//     cool in the corners.
//   Depth: far ridge (hazed almost to the sky), two mid hills with pines that shrink toward the horizon, the near hill
//     with lit grass, dark foreground grass cropped by the bottom edge.
export default (k) => {
  const [W, H] = [1024, 576];
  const ink = '#1d1430', sky = '#6a5a9a', warm = '#ffc45c', moss = '#8fd672';
  const horizon = 330;

  // ---- ground: hills as functions of x (place anything ON them by reading the height) ----
  const nearY = x => 500 - 34 * Math.exp(-(((x - 700) / 250) ** 2)) + 10 * Math.sin(x / 150);
  const mid1Y = x => 404 + 14 * Math.sin(x / 120 + 1) + 8 * Math.sin(x / 47);
  const mid2Y = x => 372 + 18 * Math.sin(x / 170 + 2.4) + 6 * Math.sin(x / 61);
  const farY = x => 348 - 34 * Math.abs(Math.sin(x / 210 + 0.6)) - 10 * Math.abs(Math.sin(x / 73));
  const ground = (f, step = 12) => { let d = `M-20 ${H + 20}`; for (let x = -20; x <= W + 20; x += step) d += `L${x} ${f(x).toFixed(1)}`; return d + `L${W + 20} ${H + 20}Z`; };

  // ---- pines: stacked rounded triangles; scattered on a hill, sized by ground perspective ----
  const pine = (x, y, h, c) => { const w = h * 0.42; return k.path(k.rrect(x - h * 0.03, y - h * 0.16, h * 0.06, h * 0.18, 1), c) + [0, 1, 2].map(i => k.path(k.roundPoly([[x, y - h + i * h * 0.24], [x + w * (0.6 + i * 0.2), y - h * 0.38 + i * h * 0.17], [x - w * (0.6 + i * 0.2), y - h * 0.38 + i * h * 0.17]], h * 0.04), c)).join(''); };
  const forest = (f, depth, n, seed, size) => k.scatter({ x: -20, y: 0, w: W + 40, h: 1, n, gap: 26, seed, scale: [0.7, 1.3] })
    .map(p => { const y = f(p.x) + 6; return pine(p.x, y, size * p.s * k.persp(y, horizon - 40, H), k.c.atmos('#24304a', depth, sky)); }).join('');

  // ---- the hero, built around its feet (hx, fy) so it can be moved as one ----
  const hx = 690, fy = nearY(690), P = (dx, dy) => [hx + dx, fy + dy];
  const body = k.smooth([P(-10, -190), P(52, -174), P(82, -112), P(78, -42), P(45, -6), P(0, 0), P(-47, -8), P(-78, -47), P(-84, -112), P(-60, -168)]);
  // pose: the near arm reaches forward-left holding the lantern pole (shoulder -> elbow -> hand)
  const [sh, el, hand] = k.fk(P(-70, -52), [[34, 200], [28, -35]]);
  const tip = [hand[0] - 92, hand[1] - 104], lantern = [tip[0], tip[1] + 58];
  const leaf = (pts, w) => k.path(k.stroke(pts, w, { taper: [0.55, 0.45] }), '#9bd96a') ;
  const leafVein = pts => k.path(k.stroke(pts, 3, { taper: [0.1, 0.6] }), '#4f8a3c');
  const leaves = [[P(-6, -186), P(-26, -224), P(-66, -238)], [P(-2, -186), P(16, -228), P(56, -242)]];

  // lantern: hanging cord, cap, glass, bars, base (its core is the lightest value in the picture)
  const [lx, ly] = lantern, lw = 40, lh = 50;
  const lanternFrame = k.line(`M${tip[0]} ${tip[1]}L${lx} ${ly - lh / 2 - 8}`, '#2a1e2c', 3) +
    k.path(k.roundPoly([[lx - lw * 0.32, ly - lh / 2 - 10], [lx + lw * 0.32, ly - lh / 2 - 10], [lx + lw * 0.62, ly - lh / 2 + 2], [lx - lw * 0.62, ly - lh / 2 + 2]], 4), '#3a2a3e') +
    k.path(k.rrect(lx - lw * 0.55, ly + lh / 2 - 4, lw * 1.1, 10, 4), '#3a2a3e') +
    k.line(`M${lx - lw * 0.18} ${ly - lh / 2}V${ly + lh / 2}M${lx + lw * 0.18} ${ly - lh / 2}V${ly + lh / 2}`, '#3a2a3e', 3.5, { cap: 'butt' });
  const lanternGlass = k.path(k.rrect(lx - lw / 2, ly - lh / 2, lw, lh, 10), k.radial([[0, '#fffbe8'], [0.45, '#ffe08a'], [1, '#f39a3c']]));

  // moon: a disc with a mask cut out of it (an occluding disc in the sky colour would show against the gradient)
  const moonMask = k.id('mk'); k.defs.push(`<mask id="${moonMask}"><rect width="${W}" height="${H}" fill="#fff"/><circle cx="187" cy="89" r="21" fill="#000"/></mask>`);

  // the path: brush strokes that narrow with distance (perspective in a width profile). The near part ends at the
  // crest (clipped to the near hill); the far part comes out from behind the crest somewhere else, so the path reads
  // as going OVER the hill instead of as a flat wedge pasted on the picture.
  const pathNear = k.stroke([[500, H + 30], [570, 530], [628, nearY(628) - 20]], t => 118 - 70 * t, { taper: [0, 0] });
  const pathFar = k.stroke([[610, nearY(610) + 12], [530, mid1Y(530) + 22], [420, mid1Y(420) + 12], [300, mid1Y(300) + 8], [200, mid2Y(200) + 10], [130, mid2Y(130) + 6]], t => 40 * (1 - t) ** 1.4 + 3, { taper: [0, 0.2] });

  // ---- the finishing light: a warm pool around the lantern (post, screen) ----
  const stars = k.scatter({ x: 0, y: 0, w: W, h: 240, n: 46, gap: 40, seed: 11, scale: [0.6, 1.8] });
  const flies = k.scatter({ x: 380, y: 250, w: 600, h: 230, n: 14, gap: 48, seed: 5, scale: [0.6, 1.4], inside: (x, y) => y < nearY(x) - 30 && Math.hypot(x - hx, y - (fy - 100)) > 110 });
  const grassTuft = (x, y, h, c, lean = 1, seed = 1) => { const r = k.rng(seed); return [-1, 0, 1].map(i => k.path(k.stroke([[x + i * h * 0.12, y + 2], [x + i * h * 0.16 + lean * h * 0.15, y - h * 0.55], [x + i * h * 0.3 + lean * h * (0.3 + r() * 0.2), y - h * (0.85 + r() * 0.3)]], h * 0.16, { taper: [0, 0.9] }), c)).join(''); };

  return {
    name: 'SproutDusk', kind: 'banner', size: [W, H],
    light: 'left',                                   // the lantern is the key light
    outline: { width: 5, color: 'auto' },            // ink line around the main stage (hero + lantern) only
    layers: [
      // ===== back: sky -> far -> mid -> near, each plane hazier and lower in contrast than the one in front =====
      // dusk: dark at the top (so the hero's head sits on a darker value than the hero), the afterglow low and to
      // the LEFT, where the path goes: the second-brightest area of the sky pulls the eye down the path
      { name: 'sky', stage: 'back', svg: k => `<rect width="${W}" height="${H}" fill="${k.linear([[0, '#0e0d29'], [0.36, '#1d1a4a'], [0.56, '#463873'], [0.67, '#a8738a']])}"/>` + k.bg.glowAt(160, 370, 340, '#f0a07c', 0.5) },
      { name: 'stars', stage: 'back', svg: stars.map(p => p.s > 1.6 ? k.sparkle(p.x, p.y, 5 * p.s, '#fff4dc', { opacity: 0.8 }) : k.circle(p.x, p.y, p.s, '#fff4dc', { opacity: 0.35 + p.r * 0.5 })).join('') },
      { name: 'moon', stage: 'back', svg: k.circle(176, 96, 24, '#fff1d6', { mask: `url(#${moonMask})`, opacity: 0.9 }) },
      { name: 'far ridge', stage: 'back', svg: k.path(ground(farY), k.c.atmos('#3a3470', 0.7, '#c98ca0')) },
      { name: 'mid hill 2', stage: 'back', svg: k.path(ground(mid2Y), k.c.atmos('#2e3562', 0.45, sky)) + forest(mid2Y, 0.45, 26, 3, 46) },
      { name: 'haze', stage: 'back', svg: k => k.bg.haze(300, 420, '#c98ca0', 0.35) },
      { name: 'mid hill 1', stage: 'back', svg: k.path(ground(mid1Y), k.c.atmos('#28344f', 0.22, sky)) },
      { name: 'path far', stage: 'back', svg: k.path(pathFar, k.c.atmos('#8a7186', 0.3, sky)) },
      { name: 'mid forest', stage: 'back', svg: forest(mid1Y, 0.22, 22, 8, 62) },
      // dark pines behind the hero: the darkest value right behind the lightest (focal contrast)
      { name: 'backdrop pines', stage: 'back', svg: pine(856, nearY(856) + 8, 250, '#161a2e') + pine(960, nearY(960) + 8, 300, '#131729') + pine(800, nearY(800) + 8, 170, '#1b2036') },
      { name: 'near hill', stage: 'back', svg: k.path(ground(nearY, 8), k.linear([[0, '#3f6658'], [0.35, '#2a4148'], [1, '#1a2633']], { x1: 0, y1: 0.78, x2: 0, y2: 1 })) },
      { name: 'path near', stage: 'back', clip: 'near hill', svg: k.path(pathNear, '#7d6a74') },
      { name: 'crest grass', stage: 'back', svg: k.scatter({ x: 360, y: 0, w: 664, h: 1, n: 40, gap: 14, seed: 4, scale: [0.6, 1.2] }).map(p => grassTuft(p.x, nearY(p.x) + 3, 20 * p.s, '#4d7a5e', 1, p.i + 1)).join('') },
      // cast shadow: thrown AWAY from the lantern (to the right), darkest where the feet touch the ground
      { name: 'cast shadow', stage: 'back', svg: k.ellipse(hx + 60, fy + 1, 110, 10, '#120f24', { opacity: 0.45, filter: k.blurF(4) }) + k.ellipse(hx, fy, 62, 7, '#0c0a18', { opacity: 0.6 }) },

      // ===== main: the hero, one layer per part, bottom to top =====
      { name: 'far arm', svg: k.path(k.limb(P(72, -54), P(98, -26), 12, 10), k.c.shade(moss, -0.35)), shade: 'toon' },
      { name: 'feet', svg: k.ellipse(...P(-30, -3), 26, 13, '#5a9a52') + k.ellipse(...P(34, -4), 24, 12, '#5a9a52'), shade: 'toon' },
      { name: 'pole', svg: k.path(k.limb(hand, tip, 4.5, 3), '#7a4e34') },
      { name: 'stem', svg: k.path(k.stroke([P(-4, -176), P(-4, -200)], 7, { taper: [0, 0.3] }), '#5a9a52') },
      { name: 'leaves', svg: leaves.map(pts => leaf(pts, 36)).join(''), shade: { style: 'toon', shadowArea: 0.25 } },
      { name: 'leaf veins', svg: leaves.map(leafVein).join(''), clip: 'leaves' },
      { name: 'body', role: 'hero', svg: k.path(body, moss), shade: { style: 'toon', shadowArea: 0.38, rim: 0.5, rimColor: '#a9a3ff', rimWidth: 7 } },
      { name: 'scarf', clip: 'body', svg: k.path(`M${P(-100, -62)}Q${P(0, -42)} ${P(100, -66)}L${P(100, -38)}Q${P(0, -16)} ${P(-100, -36)}Z`.replace(/,/g, ' '), '#c45a44'), shade: { style: 'toon', form: 'cyl-x' }, cast: { dy: 5, blur: 3, opacity: 0.35 } },
      { name: 'scarf tail', svg: k.path(k.stroke([P(66, -50), P(100, -60), P(130, -44), P(166, -58)], [26, 14], { taper: [0, 0.3] }), '#b44d3b'), shade: 'toon' },
      { name: 'near arm', svg: k.path(k.limb(sh, el, 13, 12) + k.limb(el, hand, 12, 11), moss), shade: 'toon', cast: { dx: 4, dy: 4, blur: 3 } },
      { name: 'hand', svg: k.path(k.circleD(hand[0], hand[1], 13), moss), shade: 'toon' },
      { name: 'lantern', svg: lanternGlass + lanternFrame, glow: { blur: 22, color: warm, opacity: 0.9 } },

      // ===== front: the face (drawn last so nothing shades over it), fireflies, foreground grass =====
      { name: 'face', role: 'hero', stage: 'front', svg:
        k.ellipse(...P(-64, -80), 13, 7, '#f7a3a0') + k.ellipse(...P(26, -82), 11, 6, '#f7a3a0') +      // opaque blush
        k.eye(...P(-42, -104), 12, { look: [-0.5, -0.2], light: 'left' }) + k.eye(...P(8, -106), 11, { look: [-0.5, -0.2], light: 'left' }) +
        k.brow(...P(-44, -132), 20, { angle: -8, ink }) + k.brow(...P(8, -134), 18, { angle: 8, ink }) +
        k.mouth(...P(-18, -76), 18, 'smile', { ink, sw: 4 }) },
      { name: 'fireflies', stage: 'front', svg: flies.map(p => k.circle(p.x, p.y, 2.6 * p.s, '#fff3b0')).join(''), glow: { blur: 7, color: warm, opacity: 1 } },
      { name: 'foreground grass', stage: 'front', svg: k.scatter({ x: -20, y: H - 14, w: 330, h: 10, n: 18, gap: 16, seed: 9, scale: [0.7, 1.4] }).map(p => grassTuft(p.x, H + 6, 70 * p.s, '#0f1622', 1, p.i + 3)).join('') +
        k.scatter({ x: 880, y: H - 14, w: 170, h: 10, n: 10, gap: 16, seed: 2, scale: [0.7, 1.3] }).map(p => grassTuft(p.x, H + 6, 64 * p.s, '#0f1622', -1, p.i + 7)).join('') },

      // ===== post: over the finished picture =====
      { name: 'lantern light', stage: 'post', blend: 'screen', svg: k => k.bg.glowAt(lx, ly, 250, '#ff9f4a', 0.5) },
      { name: 'grade', stage: 'post', blend: 'soft-light', svg: k => k.bg.grade('#ffcf8a', '#3b3196', 0.55, 20) },
      { name: 'vignette', stage: 'post', svg: k => k.bg.vignette(0.4, '#0a0816') },
      { name: 'grain', stage: 'post', blend: 'overlay', svg: k => k.bg.grain(0.14) },
    ],
  };
};
