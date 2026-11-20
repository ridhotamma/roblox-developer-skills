// A consistent set of inventory / shop item icons (512 px, transparent). Shows: set-wide defaults (one light
// direction, one outline weight, one shading style), automatic shading per part, clipping (liquid inside glass),
// cast shadows between parts, rotation of a part-built object, and the ready-made gem.
//   node <skill>/scripts/rart.mjs build items.art.mjs --out out/items
export default (k) => {
  const rot = (deg, markup) => `<g transform="rotate(${deg} 256 256)">${markup}</g>`;
  return {
    set: { kind: 'item', light: 'tl', outline: { width: 14, color: 'auto' }, shadow: { dy: 10, blur: 6, opacity: 0.28, color: '#1b1028' } },
    assets: [
      {
        name: 'HealthPotion',
        layers: [
          // glass: one path = round body + neck (overlapping subpaths fill as a union)
          { name: 'glass', svg: k.path(k.circleD(256, 318, 138) + k.rrect(214, 120, 84, 120, 10), '#cfeaff'), shade: { style: 'gloss', shadow: 0.35 } },
          { name: 'liquid', clip: 'glass', svg: k.path(`M100 300 Q178 272 256 300 T412 300 V470 H100Z`, '#e8334a'), shade: { style: 'gloss', depth: 70 } },
          { name: 'rim', svg: k.path(k.rrect(198, 108, 116, 34, 14), '#b9d6ea'), shade: 'toon', cast: { dy: 6, blur: 3 } },
          { name: 'cork', svg: k.path(k.rrect(222, 52, 68, 66, 16), '#a8673a'), shade: 'toon' },
          { name: 'glint', svg: k.path('M170 250 Q190 200 230 190 Q200 230 192 300 Z', '#ffffff', { opacity: 0.85 }) + k.sparkle(330, 380, 22, '#fff') },
        ],
      },
      {
        name: 'IronSword',
        layers: [
          { name: 'blade', svg: rot(45, k.path(k.poly([[232, 70], [256, 30], [280, 70], [280, 336], [232, 336]]), '#cdd6e0')), shade: { style: 'metal', form: 'cyl-y' } },
          { name: 'fuller', clip: 'blade', svg: rot(45, k.path(k.rrect(250, 90, 12, 236, 6), '#8e9aaa')) },
          { name: 'guard', svg: rot(45, k.path(k.rrect(164, 330, 184, 36, 18), '#f0b43c')), shade: 'toon', cast: { dy: 6, blur: 4 } },
          { name: 'grip', svg: rot(45, k.path(k.rrect(238, 364, 36, 92, 12), '#7a4a2a') + [384, 408, 432].map(y => k.line(`M240 ${y} L272 ${y + 10}`, '#4e2d17', 7)).join('')), shade: 'toon' },
          { name: 'pommel', svg: rot(45, k.circle(256, 474, 28, '#f0b43c')), shade: 'gloss' },
        ],
      },
      {
        name: 'KnightShield',
        layers: [
          { name: 'body', svg: k.path(k.shield(256, 262, 360, 420), '#2f6fd6'), shade: { style: 'toon', depth: 120 } },
          { name: 'band', clip: 'body', svg: k.path(k.rrect(226, 40, 60, 460, 0), '#e9eef5') + k.path(k.rrect(40, 200, 440, 56, 0), '#e9eef5'), shade: { style: 'toon', face: 0 } },
          { name: 'rim', svg: `<path d="${k.shield(256, 262, 360, 420)}" fill="none" stroke="#f0b43c" stroke-width="30" stroke-linejoin="round"/>`, shade: { style: 'toon', depth: 14 } },
          { name: 'boss', svg: k.circle(256, 240, 44, '#f0b43c'), shade: 'gloss', cast: { dy: 8, blur: 5 } },
        ],
      },
      {
        name: 'BlueGem',
        layers: [
          { name: 'gem', svg: k.gem(256, 270, 380, 330, '#36c3ff') },
          // stage 'front': drawn over the finished icon, outside the outline and the silhouette
          { name: 'sparkle', stage: 'front', svg: k.sparkle(150, 170, 40, '#ffffff') + k.sparkle(380, 352, 26, '#ffffff', { opacity: 0.95 }) },
        ],
      },
      {
        name: 'GoldCoin',
        layers: [{ name: 'coin', svg: k.coin(256, 250, 200, '#ffc531', { symbol: '$' }), shade: { style: 'gloss', depth: 50 } }],
      },
    ],
  };
};
