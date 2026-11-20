// Asset kinds: Roblox sizes, display sizes, safe areas and sensible effect defaults. Numbers come from the Creator
// Docs (see references/roblox-specs.md for sources). A spec's own fields always override these.
export const KINDS = {
  item: {
    desc: 'In-game item / inventory / shop / reward icon (transparent)', size: [512, 512], transparent: true,
    fit: { pad: 0.06 }, outline: { width: 14, color: 'auto' }, shadow: { dy: 8, blur: 6, opacity: 0.28, color: '#1b1028' },
    exports: [256, 128], preview: [128, 64, 48], maxSide: 1024,
  },
  'ui-icon': {
    desc: 'HUD / button glyph (transparent, reads at 24-48 px; can be tinted white)', size: [256, 256], transparent: true,
    fit: { pad: 0.08 }, outline: { width: 9, color: 'auto' }, exports: [128, 64], preview: [48, 32, 24], maxSide: 1024,
  },
  'game-icon': {
    desc: 'Experience icon: square, at least 512x512, opaque; shown at about 150x150 in lists', size: [512, 512], opaque: true,
    fit: null, outline: { width: 12, color: 'auto' }, exports: [], preview: [150, 100, 64], minSide: 512,
  },
  thumbnail: {
    desc: 'Experience thumbnail: 16:9, ideally 1920x1080, under 3 MB; bottom edge gets covered by the player-count bar', size: [1920, 1080], opaque: true,
    fit: null, outline: { width: 14, color: 'auto' }, exports: [], preview: [[480, 270], [256, 144]], safe: { bottom: 0.12, edge: 0.04 }, maxBytes: 3e6,
  },
  badge: {
    desc: 'Badge icon: 512x512 template, cropped to a CIRCLE on upload', size: [512, 512], opaque: true, circle: true,
    fit: null, outline: { width: 12, color: 'auto' }, exports: [], preview: [150, 64], circleSafe: 0.47,
  },
  pass: {
    desc: 'Game pass icon: at most 512x512 (.png/.jpg/.bmp), keep detail inside the circle', size: [512, 512], opaque: true, circle: true,
    fit: null, outline: { width: 12, color: 'auto' }, exports: [], preview: [150, 64], circleSafe: 0.47, maxSide: 512,
  },
  product: {
    desc: 'Developer product icon: at most 512x512, keep detail inside the circle', size: [512, 512], opaque: true, circle: true,
    fit: null, outline: { width: 12, color: 'auto' }, exports: [], preview: [150, 64], circleSafe: 0.47, maxSide: 512,
  },
  logo: {
    desc: 'Game logo / title art (transparent), for menus, thumbnails and loading screens', size: [1024, 512], transparent: true,
    fit: { pad: 0.04 }, outline: null, exports: [512], preview: [[512, 256], [256, 128]], maxSide: 1024,
  },
  banner: { desc: 'Wide UI art: menu backgrounds, promo strips, loading screens', size: [1024, 512], opaque: false, fit: null, outline: null, exports: [], preview: [[512, 256]], maxSide: 1024 },
  panel: {
    desc: '9-slice UI frame / button background (ScaleType.Slice): give `slice` insets', size: [128, 128], transparent: true,
    fit: null, outline: null, exports: [], preview: [], maxSide: 1024,
  },
  texture: { desc: 'Decal / Texture for parts; set tile: true for seamless tiling', size: [512, 512], opaque: true, fit: null, outline: null, exports: [256], preview: [128], maxSide: 1024 },
  sprite: {
    desc: 'Pixel-art sprite (use `pixel` or `pixels`); display with ResampleMode = Pixelated', size: [512, 512], transparent: true,
    fit: { pad: 0.04 }, outline: null, exports: [], preview: [], maxSide: 1024,
  },
  particle: {
    desc: 'ParticleEmitter texture (transparent, soft edges, usually white so Color can tint it)', size: [256, 256], transparent: true,
    fit: { pad: 0.1 }, outline: null, exports: [128], preview: [64, 32], maxSide: 1024,
  },
};
export const ALIASES = { icon: 'item', 'item-icon': 'item', glyph: 'ui-icon', ui: 'ui-icon', gameicon: 'game-icon', 'place-icon': 'game-icon', thumb: 'thumbnail', gamepass: 'pass', 'game-pass': 'pass', devproduct: 'product', 'developer-product': 'product', '9slice': 'panel', 'nine-slice': 'panel', decal: 'texture', pixel: 'sprite', flipbook: 'particle' };
export function kind(name) { const k = ALIASES[name] || name || 'item'; if (!KINDS[k]) throw new Error(`unknown kind "${name}". Kinds: ${Object.keys(KINDS).join(', ')}`); return Object.assign({ name: k }, KINDS[k]); }

// Roblox surfaces to preview on (approximate theme colours of the Roblox app).
export const SURFACES = { dark: '#1b1d1f', card: '#232527', light: '#f2f4f5', white: '#ffffff' };
