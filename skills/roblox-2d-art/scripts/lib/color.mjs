// Colour maths for game art: parsing, OKLab / OKLCH, hue-shifted shade ramps, mixing, contrast, palettes, k-means.
// Colours are [r, g, b] in 0..1 sRGB unless noted. Hex strings are accepted everywhere a colour is.

export function parse(c) {
  if (Array.isArray(c)) return c.length >= 3 && c.some(v => v > 1) ? c.slice(0, 3).map(v => v / 255) : c.slice(0, 3);
  if (typeof c !== 'string') throw new Error('bad colour ' + c);
  let s = c.trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s];
  const m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) return m[1].split(/[ ,/]+/).slice(0, 3).map(v => (v.endsWith('%') ? parseFloat(v) * 2.55 : +v) / 255);
  if (s[0] === '#') s = s.slice(1);
  if (s.length === 3 || s.length === 4) s = s.split('').map(ch => ch + ch).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(s)) throw new Error('bad colour ' + c);
  return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16) / 255);
}
export const alphaOf = c => { if (typeof c === 'string') { const s = c.replace('#', ''); if (/^[0-9a-f]{8}$/i.test(s)) return parseInt(s.slice(6), 16) / 255; } return 1; };
export const hex = rgb => '#' + rgb.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
const NAMED = { white: '#ffffff', black: '#000000', red: '#ff0000', green: '#00a000', blue: '#0000ff', yellow: '#ffff00', none: '#000000', transparent: '#000000', gold: '#ffd700', orange: '#ffa500', purple: '#800080', gray: '#808080', grey: '#808080', pink: '#ffc0cb' };

const toLin = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
const toSrgb = v => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055;
export function oklab(c) {
  const [r, g, b] = parse(c).map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export function fromOklabRaw([L, a, b]) {   // may be out of gamut
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(toSrgb);
}
export const fromOklab = lab => fromOklabRaw(lab).map(v => Math.max(0, Math.min(1, v)));
export function oklch(c) { const [L, a, b] = oklab(c); return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180 / Math.PI) + 360) % 360]; }
const inGamut = rgb => rgb.every(v => v >= -0.0015 && v <= 1.0015);
// OKLCH -> sRGB, reducing chroma (not lightness or hue) until it fits: keeps the intended value.
export function fromOklch([L, C, h]) {
  L = Math.max(0, Math.min(1, L)); const hr = h * Math.PI / 180, f = c => fromOklabRaw([L, c * Math.cos(hr), c * Math.sin(hr)]);
  let rgb = f(C); if (inGamut(rgb)) return rgb.map(v => Math.max(0, Math.min(1, v)));
  let lo = 0, hi = C; for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (inGamut(f(mid))) lo = mid; else hi = mid; }
  return f(lo).map(v => Math.max(0, Math.min(1, v)));
}
const hueToward = (h, target, amount) => { let d = ((target - h + 540) % 360) - 180; const step = Math.sign(d) * Math.min(Math.abs(d), amount); return (h + step + 360) % 360; };

// Shade a colour along a hue-shifted ramp. t = -1 (deep shadow) .. 0 (base) .. +1 (bright highlight).
// Shadows get darker, slightly more saturated and cooler (hue moves toward blue-violet); highlights get lighter,
// less saturated and warmer (toward yellow). This is the "hue shifting" pixel artists use instead of black/white mixing.
export const SHADE_DEFAULTS = { shadowHue: 285, lightHue: 95, hueShift: 22, darken: 0.5, lighten: 0.6 };
export function shadeLch(lch, t, o = SHADE_DEFAULTS) {
  let [L, C, h] = lch; const grey = C < 0.02;
  if (t < 0) {
    const k = -t; L = L * (1 - o.darken * k); C = C * (1 + 0.15 * k) + (grey ? 0.02 * k : 0);
    if (!grey) h = hueToward(h, o.shadowHue, o.hueShift * k); else h = o.shadowHue;
  } else if (t > 0) {
    L = L + (1 - L) * o.lighten * t; C = C * (1 - 0.4 * t);
    if (!grey) h = hueToward(h, o.lightHue, o.hueShift * 0.8 * t);
  }
  return [L, C, h];
}
export const shade = (c, t, o) => hex(fromOklch(shadeLch(oklch(c), t, Object.assign({}, SHADE_DEFAULTS, o))));
// n-step ramp from shadow to highlight around a base colour (base sits in the middle for odd n).
export function ramp(c, n = 5, o) { const out = []; for (let i = 0; i < n; i++) out.push(shade(c, n === 1 ? 0 : -1 + 2 * i / (n - 1), o)); return out; }
// Dark line colour for a fill ("coloured ink"): far darker, a little desaturated, cool-shifted. Reads cleaner than black.
export function ink(c, k = 1) { const [L, C, h] = oklch(c); return hex(fromOklch([0.16 + 0.12 * (1 - k) + L * 0.12, Math.min(C * 0.7, 0.09), C < 0.02 ? 285 : hueToward(h, 300, 25)])); }
export function mix(a, b, t = 0.5) { const A = oklab(a), B = oklab(b); return hex(fromOklab(A.map((v, i) => v + (B[i] - v) * t))); }
export const lighten = (c, k = 0.2) => { const [L, C, h] = oklch(c); return hex(fromOklch([L + (1 - L) * k, C, h])); };
export const darken = (c, k = 0.2) => { const [L, C, h] = oklch(c); return hex(fromOklch([L * (1 - k), C, h])); };
export const saturate = (c, k = 0.2) => { const [L, C, h] = oklch(c); return hex(fromOklch([L, C * (1 + k), h])); };
export const rotate = (c, deg) => { const [L, C, h] = oklch(c); return hex(fromOklch([L, C, (h + deg + 360) % 360])); };
export const lum = c => { const [r, g, b] = parse(c).map(toLin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
export const deltaE = (a, b) => { const A = oklab(a), B = oklab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
// Complement / analogous / triad helpers for picking a background that makes the subject pop.
export const complement = c => rotate(c, 180);
export const harmony = (c, kind = 'complement') => ({ complement: [c, rotate(c, 180)], analogous: [rotate(c, -30), c, rotate(c, 30)], triad: [c, rotate(c, 120), rotate(c, 240)], split: [c, rotate(c, 150), rotate(c, 210)] })[kind];

// Per-pixel fast paths (r, g, b in 0..1) used by the shading effect.
export function rgbToLch(r, g, b) {
  r = toLin(r); g = toLin(g); b = toLin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180 / Math.PI) + 360) % 360];
}
export const lchToRgb = lch => fromOklch(lch);

// Named palettes (Lospec classics) for pixel art; 'lospec:<slug>' palettes are fetched by the CLI.
export const PALETTES = {
  pico8: ['000000', '1d2b53', '7e2553', '008751', 'ab5236', '5f574f', 'c2c3c7', 'fff1e8', 'ff004d', 'ffa300', 'ffec27', '00e436', '29adff', '83769c', 'ff77a8', 'ffccaa'],
  sweetie16: ['1a1c2c', '5d275d', 'b13e53', 'ef7d57', 'ffcd75', 'a7f070', '38b764', '257179', '29366f', '3b5dc9', '41a6f6', '73eff7', 'f4f4f4', '94b0c2', '566c86', '333c57'],
  endesga32: ['be4a2f', 'd77643', 'ead4aa', 'e4a672', 'b86f50', '733e39', '3e2731', 'a22633', 'e43b44', 'f77622', 'feae34', 'fee761', '63c74d', '3e8948', '265c42', '193c3e', '124e89', '0099db', '2ce8f5', 'ffffff', 'c0cbdc', '8b9bb4', '5a6988', '3a4466', '262b44', '181425', 'ff0044', '68386c', 'b55088', 'f6757a', 'e8b796', 'c28569'],
  gameboy: ['0f380f', '306230', '8bac0f', '9bbc0f'],
};
export const RARITY = { common: '#9aa4ad', uncommon: '#4cc35a', rare: '#3b8ef0', epic: '#a64df0', legendary: '#ffb21e', mythic: '#ff3d6e', secret: '#1f1f2e', divine: '#fff2a8' };

// k-means in OKLab on weighted samples [{lab, w}]; returns clusters sorted by weight: [{hex, lab, w}].
export function kmeans(samples, k, iters = 12) {
  if (!samples.length) return [];
  k = Math.min(k, samples.length);
  const cent = [samples[0].lab.slice()];          // k-means++ style seeding (deterministic: farthest point)
  while (cent.length < k) {
    let best = null, bd = -1;
    for (const s of samples) { let d = Infinity; for (const c of cent) d = Math.min(d, (s.lab[0] - c[0]) ** 2 + (s.lab[1] - c[1]) ** 2 + (s.lab[2] - c[2]) ** 2); d *= s.w; if (d > bd) { bd = d; best = s; } }
    cent.push(best.lab.slice());
  }
  let assign = new Int32Array(samples.length);
  for (let it = 0; it < iters; it++) {
    const acc = cent.map(() => [0, 0, 0, 0]);
    samples.forEach((s, i) => {
      let bi = 0, bd = Infinity; cent.forEach((c, j) => { const d = (s.lab[0] - c[0]) ** 2 + (s.lab[1] - c[1]) ** 2 + (s.lab[2] - c[2]) ** 2; if (d < bd) { bd = d; bi = j; } });
      assign[i] = bi; const a = acc[bi]; a[0] += s.lab[0] * s.w; a[1] += s.lab[1] * s.w; a[2] += s.lab[2] * s.w; a[3] += s.w;
    });
    acc.forEach((a, j) => { if (a[3] > 0) cent[j] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
  }
  const wsum = cent.map(() => 0); samples.forEach((s, i) => wsum[assign[i]] += s.w);
  const total = wsum.reduce((a, b) => a + b, 0) || 1;
  return cent.map((lab, j) => ({ lab, hex: hex(fromOklab(lab)), w: wsum[j] / total })).filter(c => c.w > 0).sort((a, b) => b.w - a.w);
}
