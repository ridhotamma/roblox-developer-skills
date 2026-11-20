// Pixel art three ways: (1) vector art auto-converted (render big -> snap to a 32 px grid, Lospec palette, selective
// 1 px outline, orphan cleanup), (2) hand-placed pixels from a character grid (full control for tiny sprites),
// (3) an animated 8-frame coin spin packed into a sprite sheet with a Luau player module.
// In Roblox: ImageLabel.ResampleMode = Enum.ResamplerMode.Pixelated, or the pixels blur.
export default (k) => [
  {
    name: 'PotionPixel', kind: 'sprite', light: 'tl',
    pixel: { size: 32, palette: 'sweetie16', outline: 'selective', dither: 0 },
    layers: [
      { name: 'glass', svg: k.path(k.circleD(256, 318, 138), '#94b0c2') + k.path(k.rrect(214, 120, 84, 120, 10), '#94b0c2'), shade: 'toon' },
      { name: 'liquid', clip: 'glass', svg: k.path('M100 300 H412 V470 H100Z', '#b13e53'), shade: 'toon' },
      { name: 'cork', svg: k.path(k.rrect(222, 60, 68, 66, 12), '#ef7d57'), shade: 'toon' },
      { name: 'shine', svg: k.path('M170 250 Q190 210 226 200 Q204 236 196 290Z', '#f4f4f4') },
    ],
  },
  {
    name: 'HeartPixel', kind: 'sprite',
    pixels: {
      palette: { '.': null, k: '#1a1c2c', r: '#b13e53', R: '#ef7d57', w: '#f4f4f4', d: '#5d275d' },
      rows: [
        '..kkk...kkk..',
        '.kRRRk.krrrk.',
        'kRwwRRkrrrrdk',
        'kRwRRRRrrrrdk',
        'kRRRRRrrrrrdk',
        '.krRRrrrrrdk.',
        '..krrrrrrdk..',
        '...krrrrdk...',
        '....krrdk....',
        '.....kdk.....',
        '......k......',
      ],
    },
  },
  {
    name: 'CoinSpin', kind: 'sprite', light: 'tl',
    pixel: { size: 16, palette: 'endesga32', outline: 'selective' },
    frames: { count: 8, fps: 12 },
    // ctx.t runs 0 .. 1 over the loop: squash the coin horizontally by |cos| to fake the spin
    layers: [{ name: 'coin', svg: (k, ctx) => { const sx = Math.max(0.12, Math.abs(Math.cos(ctx.t * Math.PI * 2))); return `<g transform="translate(256 256) scale(${sx.toFixed(3)} 1) translate(-256 -256)">${k.coin(256, 256, 210, '#feae34', { symbol: sx > 0.5 ? '$' : '' })}</g>`; }, shade: 'toon' }],
    fit: { pad: 0.02 },
  },
];
