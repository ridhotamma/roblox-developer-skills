// Store-page art for an imaginary game "Slime Rush": game icon (512, opaque), thumbnail (1920x1080), a badge and a
// game pass (both cropped to a circle by Roblox). One mascot drawn once and reused everywhere keeps the funnel
// consistent: the icon promises the thing the thumbnail shows.
export default (k) => {
  // the mascot, drawn in a 512 box centred on 256,256 (place it anywhere with k.place)
  const slimeBody = k.smooth([[256, 92], [356, 120], [420, 220], [440, 352], [400, 420], [256, 436], [112, 420], [72, 352], [92, 220], [156, 120]]);
  const face = `<ellipse cx="200" cy="270" rx="26" ry="36" fill="#1d1430"/><ellipse cx="312" cy="270" rx="26" ry="36" fill="#1d1430"/>` +
    `<circle cx="208" cy="258" r="10" fill="#fff"/><circle cx="320" cy="258" r="10" fill="#fff"/>` +
    `<path d="M216 336 Q256 372 296 336" fill="none" stroke="#1d1430" stroke-width="14" stroke-linecap="round"/>` +
    `<ellipse cx="160" cy="320" rx="22" ry="12" fill="#ff7aa8" opacity="0.6"/><ellipse cx="352" cy="320" rx="22" ry="12" fill="#ff7aa8" opacity="0.6"/>`;
  const slime = (x, y, size, color = '#5ee05a') => ({
    body: k.place(k.path(slimeBody, color), x, y, size),
    face: k.place(face, x, y, size),
  });
  const coin = (x, y, r, rot = 0) => `<g transform="rotate(${rot} ${x} ${y})">${k.coin(x, y, r, '#ffc531', { symbol: '$' })}</g>`;

  const icon = slime(256, 270, 400);
  const thumb = slime(700, 640, 760);
  return {
    set: { light: 'tl', outline: { width: 12, color: 'auto' } },
    assets: [
      {
        name: 'GameIcon', kind: 'game-icon',
        layers: [
          { name: 'bg', stage: 'back', svg: k => k.bg.radial('#4fc3ff', '#1a4fd6', { cy: 0.4, r: 0.8 }) + k.bg.rays({ color: '#ffffff', op: 0.16, n: 14, cy: 230 }) + k.bg.vignette(0.35) },
          { name: 'coins', svg: coin(92, 120, 46, -20) + coin(430, 150, 38, 18), shade: { style: 'gloss', depth: 16 } },
          { name: 'slime', svg: icon.body, shade: { style: 'gloss', depth: 120 } },
          { name: 'face', svg: icon.face },
        ],
      },
      {
        name: 'Thumbnail', kind: 'thumbnail', outline: { width: 14, color: 'auto' },
        layers: [
          { name: 'sky', stage: 'back', svg: k => k.bg.linear('#7fd8ff', '#2f8fff') + k.bg.rays({ color: '#ffffff', op: 0.12, n: 20, cx: 700, cy: 520 }) },
          { name: 'hills', stage: 'back', svg: k.path('M0 820 Q480 700 960 800 T1920 760 V1080 H0Z', '#4cc35a') + k.path('M0 900 Q600 820 1200 900 T1920 880 V1080 H0Z', '#35a447'), shade: { style: 'toon', depth: 60 } },
          { name: 'pile', svg: [[1300, 800, 70], [1420, 790, 64], [1360, 720, 66], [1520, 820, 60], [1230, 860, 58], [1470, 720, 54]].map(([x, y, r], i) => coin(x, y, r, i * 13 - 30)).join(''), shade: { style: 'gloss', depth: 22 } },
          { name: 'slime', svg: thumb.body, shade: { style: 'gloss', depth: 220 } },
          { name: 'face', svg: thumb.face },
          { name: 'title', stage: 'front', svg: k.text('SLIME RUSH!', 1310, 330, { size: 210, font: 'Luckiest Guy', fill: [[0, '#fff7b0'], [1, '#ffb800']], stroke: '#3a1f5c', sw: 36, shadow: 18, rot: -4, outer: { color: '#ffffff', sw: 18 } }) },
          { name: 'tag', stage: 'front', svg: k.text('COLLECT EVERYTHING', 1310, 470, { size: 74, font: 'Luckiest Guy', fill: '#ffffff', stroke: '#3a1f5c', sw: 18, shadow: 8, rot: -4 }) },
        ],
      },
      {
        name: 'FirstWinBadge', kind: 'badge',
        layers: [
          { name: 'bg', stage: 'back', svg: k => k.bg.rarity('legendary') },
          { name: 'trophy', svg: k.path(`M176 140 H336 V200 Q336 300 256 316 Q176 300 176 200Z`, '#ffcf3a') + k.path(k.rrect(232, 300, 48, 56, 6), '#ffcf3a') + k.path(k.rrect(186, 350, 140, 40, 12), '#b0702a'), shade: { style: 'gloss', depth: 50 } },
          { name: 'handles', svg: `<path d="M180 170 Q120 170 130 220 Q140 262 196 262" fill="none" stroke="#ffcf3a" stroke-width="22"/><path d="M332 170 Q392 170 382 220 Q372 262 316 262" fill="none" stroke="#ffcf3a" stroke-width="22"/>`, shade: { style: 'toon', depth: 10 } },
          { name: 'star', svg: k.path(k.star(256, 214, 40, 18, 5), '#fff6c8') },
          { name: 'rim', stage: 'front', svg: k => k.frame.circle({ color: '#ffffff', width: 0.03, inner: null, inset: 0.035 }) },
        ],
      },
      {
        name: 'VipPass', kind: 'pass',
        layers: [
          { name: 'bg', stage: 'back', svg: k => k.bg.rarity('epic') },
          { name: 'crown', svg: k.path(k.roundPoly([[120, 330], [140, 170], [200, 250], [256, 140], [312, 250], [372, 170], [392, 330]], 14), '#ffcf3a'), shade: { style: 'gloss', depth: 60 } },
          { name: 'gems', svg: k.gem(256, 290, 64, 56, '#ff4d7a') + k.gem(178, 300, 40, 36, '#36c3ff') + k.gem(334, 300, 40, 36, '#36c3ff') },
          { name: 'vip', stage: 'front', svg: k.text('VIP', 256, 440, { size: 110, font: 'Luckiest Guy', fill: [[0, '#ffffff'], [1, '#ffe27a']], stroke: '#3a1f5c', sw: 24, shadow: 8 }) },
        ],
      },
    ],
  };
};
