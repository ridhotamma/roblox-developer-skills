// UI pieces: 9-slice panel and button (ScaleType.Slice, any size without stretching the corners), a HUD glyph with
// a white copy for ImageColor3 tinting, a tileable texture for parts, and a particle flipbook (Grid4x4).
export default (k) => [
  {
    // corners 28 px; everything between the corners is flat in the stretch direction, so it stretches cleanly
    name: 'PanelFrame', kind: 'panel', size: [96, 96], slice: [28, 28, 28, 28],
    layers: [{ name: 'panel', svg: k.path(k.rrect(4, 4, 88, 88, 22), '#2b3a67') + `<path d="${k.rrect(4, 4, 88, 88, 22)}" fill="none" stroke="#f4f4f4" stroke-width="6"/>` + `<path d="${k.rrect(11, 11, 74, 74, 16)}" fill="none" stroke="#5b6ee1" stroke-width="3"/>` }],
  },
  {
    name: 'ButtonGreen', kind: 'panel', size: [96, 64], slice: [30, 28, 30, 30],
    layers: [{ name: 'button', svg: k.path(k.rrect(2, 8, 92, 54, 22), '#2c8a3c') + k.path(k.rrect(2, 2, 92, 52, 22), '#5ee05a') + k.path(k.rrect(10, 8, 76, 14, 7), '#b8f5a4', { opacity: 0.8 }) }],
  },
  {
    name: 'ShopGlyph', kind: 'ui-icon', export: { white: true },
    layers: [
      { name: 'cart', svg: `<path d="M40 60 H78 L104 170 H200 L222 92 H92" fill="none" stroke="#ffc531" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>` + k.circle(116, 206, 18, '#ffc531') + k.circle(190, 206, 18, '#ffc531'), shade: 'toon' },
    ],
  },
  {
    name: 'GrassTile', kind: 'texture', size: 256, tile: true,
    layers: [{
      name: 'grass', svg: k => {
        const R = k.rng(7); let blades = '';
        for (let i = 0; i < 140; i++) { const x = R() * 256, y = R() * 256, h = 10 + R() * 14, c = ['#3e8948', '#63c74d', '#2f7a3a'][i % 3]; blades += `<path d="M${x.toFixed(1)} ${y.toFixed(1)} q${(R() * 6 - 3).toFixed(1)} ${(-h / 2).toFixed(1)} ${(R() * 8 - 4).toFixed(1)} ${(-h).toFixed(1)}" stroke="${c}" stroke-width="3" stroke-linecap="round" fill="none"/>`; }
        for (let i = 0; i < 6; i++) { const x = R() * 256, y = R() * 256; blades += k.circle(x, y, 4, '#fff1e8') + k.circle(x, y, 1.8, '#feae34'); }
        return k.rect(0, 0, 256, 256, '#4fa94d') + k.tile(blades);   // k.tile wraps edge-crossing shapes so it tiles seamlessly
      },
    }],
  },
  {
    name: 'SparkleBurst', kind: 'particle', frames: { count: 16, layout: 'flipbook', fps: 24, mode: 'OneShot' },
    layers: [{
      name: 'spark', svg: (k, ctx) => {
        // white so ParticleEmitter.Color can tint it; grows fast, then fades. Drawn around the canvas centre.
        const c = k.W / 2, t = ctx.t, r = c * (0.15 + 0.7 * Math.sin(Math.min(1, t * 1.6) * Math.PI / 2)), op = 1 - Math.max(0, (t - 0.45) / 0.55);
        return `<g opacity="${op.toFixed(3)}" filter="${k.blurF(3)}">${k.sparkle(c, c, r, '#ffffff', { pinch: 0.12 })}</g>` + `<g opacity="${op.toFixed(3)}">${k.sparkle(c, c, r * 0.8, '#ffffff', { pinch: 0.12 })}</g>`;
      },
    }],
    fit: null,
  },
];
