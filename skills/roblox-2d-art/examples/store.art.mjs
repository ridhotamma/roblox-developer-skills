// Store-page art for an imaginary game "Slime Rush": game icon (512, opaque), thumbnail (1920x1080), a badge and a
// game pass (both cropped to a circle by Roblox). One mascot and ONE colour scheme across all of them: repetition makes
// the store page read as one brand, and the icon promises what the thumbnail shows. Each asset starts with its design
// brief (references/graphic-design.md, section 13).
export default (k) => {
  // Colour: the hero is a green slime. Split-complementary, bright mood: a calm violet sky (dominant ~60%), a mid
  // violet ground (secondary ~30%), the green hero and a warm yellow accent (title, coins: ~10%).
  const S = k.c.scheme('#5ee05a', 'split', { mood: 'bright' });
  const gold = '#ffc21a';
  // Prop coins are gold one step off the accent: darker and less bright than the title fill, so they stay support.
  const propGold = depth => k.c.shade(k.c.atmos(gold, depth, S.bgLight), -0.1);

  // the mascot, drawn in a 512 box centred on 256,256 (place it anywhere with k.place); look = pupil shift toward x
  const slimeBody = k.smooth([[256, 92], [356, 120], [420, 220], [440, 352], [400, 420], [256, 436], [112, 420], [72, 352], [92, 220], [156, 120]]);
  const face = (look = 0) => `<ellipse cx="${200 + look}" cy="270" rx="26" ry="36" fill="#1d1430"/><ellipse cx="${312 + look}" cy="270" rx="26" ry="36" fill="#1d1430"/>` +
    `<circle cx="${208 + look}" cy="258" r="10" fill="#fff"/><circle cx="${320 + look}" cy="258" r="10" fill="#fff"/>` +
    `<path d="M${216 + look * 0.6} 336 Q${256 + look * 0.6} 372 ${296 + look * 0.6} 336" fill="none" stroke="#1d1430" stroke-width="14" stroke-linecap="round"/>` +
    // blush: OPAQUE light pink. A transparent pink over green mixes to mud (complements cancel to grey-brown).
    `<ellipse cx="158" cy="322" rx="22" ry="11" fill="#ffadc6"/><ellipse cx="354" cy="322" rx="22" ry="11" fill="#ffadc6"/>`;
  const slime = (x, y, size, look = 0) => ({ body: k.place(k.path(slimeBody, S.hero), x, y, size), face: k.place(face(look), x, y, size) });
  const coin = (x, y, r, rot = 0, color = gold) => `<g transform="rotate(${rot} ${x} ${y})">${k.coin(x, y, r, color, { symbol: '$' })}</g>`;

  // ---- thumbnail geometry (1920x1080; k.at / k.safe take the size because this runs outside a layer function;
  // k.safe takes the covered bottom band too, 0.12 = the player-count bar) ----
  const [TW, TH] = [1920, 1080], safe = k.safe(0.05, TW, TH, 0.12);
  // Brief: message "a cute slime rushes to collect coins". Reading order 1 slime face, 2 title, 3 coin trail.
  // Layout: hero + title. Slime on the left thirds line, ~60% of the frame height, looking right into the frame.
  // Title stacked as one block in the right two thirds, top half, inside the safe box. Coins on a leading line from
  // the far right toward the slime, growing as they come closer, hazier with distance and deeper in value than the
  // title fill; the nearest tucks behind the hero. The trail is support: the face is the first read.
  // Value: the mid violet frame dominates, the hero is the lightest thing, and the strongest contrast is the face
  // against the sky. Type: k.typeScale(89, 1.5) -> 89 / 133 / 200: title 200 (two lines), hook 89.
  const [hx] = k.at('left', TW, TH), hero = slime(hx, 548, 952, 12);   // body spans y 250..890, x 298..982
  const ts = k.typeScale(89, 1.5), tx = (safe.x1 + 990) / 2;           // text column centred between hero and margin
  const trail = [[1670, 744, 20], [1550, 768, 26], [1415, 794, 33], [1260, 818, 42], [965, 838, 54]];   // 5 coins, far to near; the nearest tucks behind the hero (overlap, not a tangent)

  return {
    set: { light: 'tl', outline: { width: 12, color: 'auto' } },
    assets: [
      {
        // Brief: one hero, 75% of the canvas, centred slightly low (optical centre); ONE coin in the upper right the
        // face turns toward, darker than the face so it reads as a promise, not a rival; dark violet dominates the
        // frame, with the light pool behind the face as the strongest value contrast; quiet corners. Two coins
        // behind the shoulders read as ears at 150 px, so the icon carries one prop only and the thumbnail tells the
        // collecting story.
        name: 'GameIcon', kind: 'game-icon',
        layers: [
          { name: 'bg', stage: 'back', svg: k => k.bg.radial(S.bgLight, k.c.shade(S.bgDeep, -0.22), { cy: 0.46, r: 0.7 }) + k.bg.rays({ color: '#ffffff', op: 0.06, n: 14, cy: 270 }) + k.bg.glowAt(256, 250, 220, '#ffffff', 0.3) + k.bg.vignette(0.52) },
          // prop on the back stage: no asset outline (line-weight hierarchy), pushed back by an atmosphere pass so its
          // gold never out-contrasts the face
          { name: 'coins', stage: 'back', role: 'support', svg: coin(404, 158, 30, 14, propGold(0.22)), shade: { style: 'gloss', depth: 8 } },
          { name: 'slime', role: 'hero', svg: slime(256, 286, 430, 6).body, shade: { style: 'gloss', depth: 120 } },
          { name: 'face', role: 'hero', svg: slime(256, 286, 430, 6).face },
        ],
      },
      {
        name: 'Thumbnail', kind: 'thumbnail', outline: { width: 14, color: 'auto' },
        layers: [
          // back: sky (dominant), soft rays and a glow centred on the hero, far hills pushed back by atmospheric perspective
          { name: 'sky', stage: 'back', svg: k => k.bg.linear(S.bg, S.bgLight) + k.bg.rays({ color: '#ffffff', op: 0.06, n: 18, cx: hx, cy: 520 }) + k.bg.glowAt(hx, 540, 560, '#ffffff', 0.42) },
          { name: 'far hills', stage: 'back', svg: k.path('M0 760 Q260 650 560 706 T1160 668 T1920 696 V1080 H0Z', k.c.atmos(S.secondary, 0.7, S.bgLight)) },
          { name: 'haze', stage: 'back', svg: k => k.bg.haze(600, 900, S.bgLight, 0.4) },
          // ground: a mid violet value step below the hero (not green, not near-black). A near-black ground gives the
          // bright hero a high-contrast halo underneath, which the attention map reads as a second focal point; the
          // smooth gradient and the soft contact shadow keep the base calm while still anchoring the hero.
          { name: 'ground', stage: 'back', svg: k => k.path('M-40 880 Q600 820 1100 852 T1960 816 V1120 H-40Z', k.linear([[0, k.c.mix(S.secondary, S.bgDeep, 0.3)], [0.5, k.c.mix(S.secondary, S.bgDeep, 0.5)], [1, S.bgDeep]])) +
            // a soft radial contact shadow: a hard ellipse edge under the hero competes with the face
            `<ellipse cx="640" cy="884" rx="400" ry="44" fill="${k.radial([[0, S.ink, 0.2], [0.55, S.ink, 0.1], [1, S.ink, 0]])}"/>` },
          { name: 'vignette', stage: 'back', svg: k => k.bg.vignette(0.35) },
          // main: the coin trail and the hero
          { name: 'coins', role: 'support', svg: trail.map(([x, y, r], i) => coin(x, y, r, i * 9 - 18, propGold(0.26 - i * 0.06))).join(''), shade: { style: 'gloss', depth: 18 } },
          { name: 'slime', role: 'hero', svg: hero.body, shade: { style: 'gloss', depth: 220 } },
          { name: 'face', role: 'hero', svg: hero.face },
          // front: the title block (one group, one rotation), then the hook one step down the type scale
          { name: 'title', stage: 'front', svg: `<g transform="rotate(-4 ${tx} 360)">` +
            k.text('SLIME', tx, 300, { size: ts(2), font: 'Luckiest Guy', fill: [[0, S.light], [1, S.accent]], stroke: S.ink, sw: 34, shadow: 16, outer: { color: '#ffffff', sw: 16 } }) +
            k.text('RUSH!', tx, 300 + ts(2) * 0.95, { size: ts(2), font: 'Luckiest Guy', fill: [[0, S.light], [1, S.accent]], stroke: S.ink, sw: 34, shadow: 16, outer: { color: '#ffffff', sw: 16 } }) + '</g>' },
          { name: 'hook', stage: 'front', svg: k.text('COLLECT THEM ALL', tx, 300 + ts(2) * 0.95 + 150, { size: ts(0), font: 'Luckiest Guy', fill: '#ffffff', stroke: S.ink, sw: 18, shadow: 8, rot: -4 }) },
        ],
      },
      {
        // Brief: symmetric emblem in the middle 70% circle; gold trophy on its near-complement (rare blue), not on gold.
        name: 'FirstWinBadge', kind: 'badge',
        layers: [
          { name: 'bg', stage: 'back', svg: k => k.bg.rarity('rare') },
          { name: 'trophy', role: 'hero', svg: k.path(`M176 140 H336 V200 Q336 300 256 316 Q176 300 176 200Z`, gold) + k.path(k.rrect(232, 300, 48, 56, 6), gold) + k.path(k.rrect(186, 350, 140, 40, 12), '#b0702a'), shade: { style: 'gloss', depth: 50 } },
          { name: 'handles', role: 'hero', svg: `<path d="M180 170 Q120 170 130 220 Q140 262 196 262" fill="none" stroke="${gold}" stroke-width="22"/><path d="M332 170 Q392 170 382 220 Q372 262 316 262" fill="none" stroke="${gold}" stroke-width="22"/>`, shade: { style: 'toon', depth: 10 } },
          { name: 'star', role: 'hero', svg: k.path(k.star(256, 214, 40, 18, 5), '#fff6c8') },
          { name: 'rim', stage: 'front', svg: k => k.frame.circle({ color: '#ffffff', width: 0.03, inner: null, inset: 0.035 }) },
        ],
      },
      {
        // Brief: the perk as an object (crown = VIP), the most saturated thing in the frame; one word in the lower third.
        name: 'VipPass', kind: 'pass',
        layers: [
          { name: 'bg', stage: 'back', svg: k => k.bg.rarity('epic') },
          { name: 'crown', role: 'hero', svg: k.path(k.roundPoly([[120, 330], [140, 170], [200, 250], [256, 140], [312, 250], [372, 170], [392, 330]], 14), gold), shade: { style: 'toon', depth: 60 } },
          { name: 'gems', role: 'hero', svg: k.gem(256, 290, 64, 56, '#ff4d7a') + k.gem(178, 300, 40, 36, '#36c3ff') + k.gem(334, 300, 40, 36, '#36c3ff') },
          { name: 'vip', stage: 'front', svg: k.text('VIP', 256, 440, { size: 110, font: 'Luckiest Guy', fill: [[0, '#ffffff'], [1, '#ffe27a']], stroke: '#3a1f5c', sw: 24, shadow: 8 }) },
        ],
      },
    ],
  };
};
