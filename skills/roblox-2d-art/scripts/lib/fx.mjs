// Layer effects on float images (see raster.mjs). Every size is in pixels of the image being processed; build.mjs
// converts spec units (design pixels) before calling. Effects return new images unless noted.
import * as R from './raster.mjs';
import * as C from './color.mjs';

// Light direction from a name or an angle (degrees, 0 = from the right, 90 = from the top, screen convention).
export function lightVec(light = 'tl', elevation = 50) {
  const ang = typeof light === 'number' ? light : { tl: 135, top: 90, tr: 45, left: 180, right: 0, bl: 225, br: 315, bottom: 270 }[light] ?? 135;
  const a = ang * Math.PI / 180, e = elevation * Math.PI / 180;
  return [Math.cos(a) * Math.cos(e), -Math.sin(a) * Math.cos(e), Math.sin(e)];   // image y points down
}

// ---- automatic form shading -------------------------------------------------------------------
// Builds a height field from the layer's silhouette (multi-scale blur = an inflated, pillow-free dome whose thin parts
// stay thin), lights it, and pushes each pixel's own colour along a hue-shifted ramp (cool shadows, warm highlights).
// opts: style 'toon' | 'soft' | 'gloss' | 'metal' | 'flat'; form 'round' | 'cyl-x' (tube lying horizontally) | 'cyl-y' | 'flat';
// light, elevation, depth (px, how far the rounding reaches in from the edge; default ~ the shape's half-thickness),
// shadow 0..1, highlight 0..1, spec 0..1, shininess, rim 0..1, rimColor, bands 2 | 3, soft (band edge softness px),
// face (for form 'flat': a fixed tone -1..1, e.g. top face +0.35, side face -0.45), hueShift (degrees), shadowHue.
export function shade(F, o = {}) {
  const { w, h } = F, a = R.alpha(F), n = w * h;
  const style = o.style || 'toon'; if (style === 'flat' && o.face == null) return R.clone(F);
  const L = lightVec(o.light, o.elevation ?? 50), Hv = norm([L[0], L[1], L[2] + 1]);
  const ramp = Object.assign({}, C.SHADE_DEFAULTS, o.hueShift != null ? { hueShift: o.hueShift } : {}, o.shadowHue != null ? { shadowHue: o.shadowHue } : {}, o.lightHue != null ? { lightHue: o.lightHue } : {});
  const sh = o.shadow ?? (style === 'metal' ? 0.85 : 0.6), hi = o.highlight ?? (style === 'soft' ? 0.35 : 0.3), spec = o.spec ?? ({ gloss: 0.9, metal: 1, toon: 0.8, soft: 0.25 }[style] ?? 0);
  const rim = o.rim ?? (style === 'gloss' || style === 'metal' ? 0.35 : 0), shininess = o.shininess ?? (style === 'metal' ? 60 : 30), bands = o.bands ?? 3;
  let s = new Float32Array(n), gmag = new Float32Array(n), Nz = new Float32Array(n), Nx = new Float32Array(n), Ny = new Float32Array(n), dEdge = null;
  const form = o.form || 'round';
  if (form === 'flat' || o.face != null) s.fill(o.face ?? 0);
  else {
    const { dIn } = R.edgeDistances(a, w, h); dEdge = dIn;
    let dmax = 0; for (let i = 0; i < n; i++) if (dIn[i] < 1e8 && dIn[i] > dmax) dmax = dIn[i];
    const depth = Math.max(1.5, o.depth ?? dmax * 0.9), axis = form === 'cyl-x' ? 'y' : form === 'cyl-y' ? 'x' : 'both';
    const m = a, H = new Float32Array(n);
    for (const [sig, wt] of [[depth * 0.18, 0.25], [depth * 0.4, 0.35], [depth * 0.85, 0.4]]) { const b = R.blur(m, w, h, Math.max(0.6, sig), 1, axis); for (let i = 0; i < n; i++) H[i] += b[i] * wt; }
    const K = depth * 1.6;   // bulge: how strongly the height turns into slope
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (a[i] <= 0) continue;
      const gx = (H[y * w + Math.min(w - 1, x + 1)] - H[y * w + Math.max(0, x - 1)]) * 0.5 * K, gy = (H[Math.min(h - 1, y + 1) * w + x] - H[Math.max(0, y - 1) * w + x]) * 0.5 * K;
      const len = Math.hypot(gx, gy, 1), nx = -gx / len, ny = -gy / len, nz = 1 / len;
      Nx[i] = nx; Ny[i] = ny; Nz[i] = nz;
      const ndl = nx * L[0] + ny * L[1] + nz * L[2], flat = L[2];
      s[i] = ndl >= flat ? (ndl - flat) / (1 - flat) : (ndl - flat) / (flat + 0.25);   // +1 lit rim .. 0 facing viewer .. -1 turned away
    }
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; gmag[i] = Math.hypot(s[i + 1] - s[i - 1], s[i + w] - s[i - w]) * 0.5; }
  }
  // Toon band thresholds come from the shape itself: the darkest `shadowArea` of it is in shadow and the brightest
  // `lightArea` gets the highlight band, so every part keeps a readable base colour whatever its size or form.
  let thS = -0.18, thL = 0.42;
  if (style === 'toon' && o.face == null && form !== 'flat') {
    const vals = []; for (let i = 0; i < n; i += Math.max(1, (n / 60000) | 0)) if (a[i] > 0.5) vals.push(s[i]);
    vals.sort((p, q) => p - q);
    if (vals.length > 20) { const P = f => vals[Math.min(vals.length - 1, Math.floor(f * vals.length))]; thS = Math.min(-0.03, P(o.shadowArea ?? 0.32)); thL = Math.max(0.03, P(1 - (o.lightArea ?? 0.1))); if (P(0.95) - P(0.05) < 0.08) { thS = -9; thL = 9; } }
  }
  const out = R.create(w, h), D = out.d, S = F.d, soft = o.soft ?? 0.75;
  const step = (edge, v, g) => { const e = Math.max(1e-4, g * soft + 1e-3); return Math.min(1, Math.max(0, (v - edge + e) / (2 * e))); };
  const rimRgb = o.rimColor ? C.parse(o.rimColor) : [1, 1, 1], specRgb = o.specColor ? C.parse(o.specColor) : [1, 1, 0.97];
  for (let i = 0; i < n; i++) {
    const al = S[i * 4 + 3]; if (al <= 0) continue;
    const r = S[i * 4] / al, g = S[i * 4 + 1] / al, b = S[i * 4 + 2] / al;
    let t = s[i], gm = gmag[i];
    if (style === 'toon') {   // two or three flat bands with anti-aliased borders
      const shadowK = step(-thS, -t, gm), lightK = bands >= 3 ? step(thL, t, gm) : 0;
      t = -sh * shadowK + hi * lightK;
    } else if (style === 'metal') {   // bright sky above a sharp horizon, dark ground below: reads as polished metal
      const ny = Ny[i], hor = step(0.0, -ny + 0.12, gm * 2 + 0.02);
      t = Math.max(-1, Math.min(1, -sh * (1 - hor) * 0.9 + hi * hor * 0.8 + t * 0.35));
    } else t = t >= 0 ? t * hi * 1.6 : t * sh;
    if (o.face != null) t = o.face;
    let [Lc, Cc, hc] = C.rgbToLch(r, g, b);
    let rgb = C.lchToRgb(C.shadeLch([Lc, Cc, hc], Math.max(-1, Math.min(1, t)), ramp));
    if (spec > 0 && Nz[i] > 0) {
      const nh = Nx[i] * Hv[0] + Ny[i] * Hv[1] + Nz[i] * Hv[2]; let sp = Math.pow(Math.max(0, nh), shininess);
      if (style === 'toon' || style === 'gloss') sp = step(0.55, sp, 0.05 + gm);
      sp *= spec; rgb = rgb.map((v, c) => v + (specRgb[c] - v) * Math.min(1, sp));
    }
    if (rim > 0 && dEdge) {   // thin back-light along the edge facing away from the light
      const away = Math.max(0, -(Nx[i] * L[0] + Ny[i] * L[1])) / Math.max(1e-3, Math.hypot(Nx[i], Ny[i]) || 1), band = Math.max(0, 1 - dEdge[i] / Math.max(1.5, (o.rimWidth ?? Math.max(2, w / 110))));
      const k = rim * band * Math.min(1, away * 1.5) * (Math.hypot(Nx[i], Ny[i]) > 0.2 ? 1 : 0);
      rgb = rgb.map((v, c) => v + (rimRgb[c] - v) * k);
    }
    D[i * 4] = rgb[0] * al; D[i * 4 + 1] = rgb[1] * al; D[i * 4 + 2] = rgb[2] * al; D[i * 4 + 3] = al;
  }
  return out;
}
const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };

// ---- outlines -------------------------------------------------------------------------------------
// Even outline around the silhouette from a distance field (round, smooth, constant width, unlike SVG strokes on
// every part). position 'outside' (default) | 'inside' | 'center'. color: hex or 'auto' (each stretch of outline
// takes a dark, hue-shifted version of the colour it borders: "coloured ink"). Returns the image with the line.
export function outline(F, o = {}) {
  const { w, h } = F, a = R.alpha(F), n = w * h, width = o.width ?? 8, pos = o.position || 'outside';
  if (width <= 0) return R.clone(F);
  const { dOut, dIn, nearIn } = R.edgeDistances(a, w, h);
  const auto = !o.color || o.color === 'auto', fixed = auto ? null : C.parse(o.color), op = o.opacity ?? 1;
  const inkCache = new Map(), inkOf = i => { const al = F.d[i * 4 + 3] || 1, key = ((F.d[i * 4] / al * 31) | 0) * 1024 + ((F.d[i * 4 + 1] / al * 31) | 0) * 32 + ((F.d[i * 4 + 2] / al * 31) | 0); let v = inkCache.get(key); if (!v) { v = C.parse(C.ink(C.hex([F.d[i * 4] / al, F.d[i * 4 + 1] / al, F.d[i * 4 + 2] / al]), o.darkness ?? 1)); inkCache.set(key, v); } return v; };
  const line = R.create(w, h), L = line.d;
  const outW = pos === 'outside' ? width : pos === 'center' ? width / 2 : 0, inW = pos === 'inside' ? width : pos === 'center' ? width / 2 : 0;
  for (let i = 0; i < n; i++) {
    let cov = 0;
    if (a[i] < 0.5) cov = Math.min(1, Math.max(0, outW + 0.5 - dOut[i])) || (inW > 0 ? a[i] : 0);
    else if (pos === 'outside') cov = dIn[i] < 2 ? 1 : 0;          // run the line under the shape's anti-aliased rim: no light seam
    else cov = Math.min(1, Math.max(0, inW + 0.5 - dIn[i]));
    if (cov <= 0) continue;
    let rgb = fixed;
    if (!rgb) { const src = a[i] >= 0.5 ? i : nearIn[i]; rgb = src >= 0 ? inkOf(src) : [0.1, 0.08, 0.12]; }
    const k = cov * op; L[i * 4] = rgb[0] * k; L[i * 4 + 1] = rgb[1] * k; L[i * 4 + 2] = rgb[2] * k; L[i * 4 + 3] = k;
  }
  if (pos === 'outside') return R.composite(line, F);           // shape over its outline (fills the AA seam)
  const out = R.clone(F); R.composite(out, line, 'normal', 1, a); return out;
}

// Drop shadow / glow / cast shadow. All return a NEW image of the effect only (caller composites it).
export function shadowOf(F, o = {}) {
  const { w, h } = F, a = R.alpha(F), dx = Math.round(o.dx ?? 0), dy = Math.round(o.dy ?? 6), spread = o.spread ?? 0;
  let m = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sx = x - dx, sy = y - dy; if (sx >= 0 && sy >= 0 && sx < w && sy < h) m[y * w + x] = a[sy * w + sx]; }
  if (spread > 0) { const { dOut } = R.edgeDistances(m, w, h); for (let i = 0; i < w * h; i++) m[i] = Math.max(m[i], Math.min(1, Math.max(0, spread + 0.5 - dOut[i]))); }
  if ((o.blur ?? 0) > 0) m = R.blur(m, w, h, o.blur);
  return R.solid(w, h, m, C.parse(o.color || '#000000'), (o.opacity ?? 0.35) * (o.strength ?? 1));
}
export const glowOf = (F, o = {}) => shadowOf(F, { dx: 0, dy: 0, spread: o.spread ?? 0, blur: o.blur ?? 12, color: o.color || '#ffffff', opacity: o.opacity ?? 0.9 });

// ---- pixel art ---------------------------------------------------------------------------------------
// Turn a (supersampled) render into true pixel art: area-average down to the grid, hard alpha, snap every pixel to
// a palette (given, named, or k-means of the art itself), optional ordered dither for gradients, remove orphan
// pixels, then add a 1 px outline (selective: darker version of the neighbour's colour, or a fixed colour).
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => v / 16 - 0.5);
export function pixelate(F, o = {}) {
  const gw = o.width || o.size || 32, gh = o.height || o.size || 32, small = R.resize(F, gw, gh), n = gw * gh, d = small.d;
  const alphaCut = o.alphaCut ?? 0.5, keep = new Uint8Array(n);
  for (let i = 0; i < n; i++) keep[i] = d[i * 4 + 3] >= alphaCut ? 1 : 0;
  const col = i => { const al = d[i * 4 + 3] || 1; return [d[i * 4] / al, d[i * 4 + 1] / al, d[i * 4 + 2] / al]; };
  let pal = o.palette;
  if (!pal || pal === 'auto') { const samples = []; for (let i = 0; i < n; i++) if (keep[i]) samples.push({ lab: C.oklab(col(i)), w: 1 }); pal = C.kmeans(samples, o.colors || 12).map(c => c.hex); }
  else if (typeof pal === 'string') pal = C.PALETTES[pal] || pal.split(',');
  const P = pal.map(p => ({ hex: p.startsWith('#') ? p : '#' + p })).map(p => Object.assign(p, { lab: C.oklab(p.hex), rgb: C.parse(p.hex) }));
  const nearest = lab => { let bi = 0, bd = Infinity; for (let j = 0; j < P.length; j++) { const q = P[j].lab, dd = (lab[0] - q[0]) ** 2 + (lab[1] - q[1]) ** 2 + (lab[2] - q[2]) ** 2; if (dd < bd) { bd = dd; bi = j; } } return bi; };
  const idx = new Int16Array(n).fill(-1), dither = o.dither ?? 0;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const i = y * gw + x; if (!keep[i]) continue;
    const lab = C.oklab(col(i)); if (dither > 0) lab[0] += BAYER4[(y & 3) * 4 + (x & 3)] * dither * 0.12;
    idx[i] = nearest(lab);
  }
  if (o.cleanup !== false) for (let pass = 0; pass < 2; pass++) for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {   // orphan pixels: a single pixel unlike all 4 neighbours joins the majority
    const i = y * gw + x; if (idx[i] < 0) continue; const nb = [];
    if (x > 0) nb.push(idx[i - 1]); if (x < gw - 1) nb.push(idx[i + 1]); if (y > 0) nb.push(idx[i - gw]); if (y < gh - 1) nb.push(idx[i + gw]);
    const same = nb.filter(v => v === idx[i]).length, solid = nb.filter(v => v >= 0);
    if (same === 0 && solid.length >= 3) { const cnt = {}; solid.forEach(v => cnt[v] = (cnt[v] || 0) + 1); const best = +Object.entries(cnt).sort((p, q) => q[1] - p[1])[0][0]; if (cnt[best] >= 3) idx[i] = best; }
  }
  const rgba = new Uint8Array(n * 4), put = (i, rgb) => { rgba[i * 4] = Math.round(rgb[0] * 255); rgba[i * 4 + 1] = Math.round(rgb[1] * 255); rgba[i * 4 + 2] = Math.round(rgb[2] * 255); rgba[i * 4 + 3] = 255; };
  for (let i = 0; i < n; i++) if (idx[i] >= 0) put(i, P[idx[i]].rgb);
  const ol = o.outline ?? 'selective';
  if (ol && ol !== 'none') {
    const fixed = ol !== 'selective' ? C.parse(ol) : null, add = [];
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const i = y * gw + x; if (idx[i] >= 0) continue; let src = -1;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + ox, Y = y + oy; if (X >= 0 && Y >= 0 && X < gw && Y < gh && idx[Y * gw + X] >= 0) { src = Y * gw + X; break; } }
      if (src >= 0) add.push([i, fixed || C.parse(C.ink(P[idx[src]].hex, 0.9))]);
    }
    for (const [i, rgb] of add) put(i, rgb);
  }
  return { w: gw, h: gh, rgba, palette: P.map(p => p.hex) };
}

// White, alpha-only version for ImageColor3 tinting (keeps interior lines as transparency steps if keepValue).
export function whiteOf(img8, keepValue = false) {
  const out = { w: img8.w, h: img8.h, rgba: new Uint8Array(img8.rgba) };
  for (let i = 0; i < img8.w * img8.h; i++) {
    const r = out.rgba[i * 4], g = out.rgba[i * 4 + 1], b = out.rgba[i * 4 + 2], v = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    out.rgba[i * 4] = out.rgba[i * 4 + 1] = out.rgba[i * 4 + 2] = keepValue ? Math.round(255 * Math.min(1, 0.35 + v)) : 255;
  }
  return out;
}

// Background key for imported art (AI renders, screenshots of a plain backdrop): flood-fill from the border through
// colours close to the border colour and make them transparent, with a soft edge. tolerance in OKLab distance.
export function keyOut(img8, o = {}) {
  const { w, h, rgba } = img8, tol = o.tolerance ?? 0.08, n = w * h;
  const border = []; for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x); for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  const bgLab = (() => { const labs = border.filter((_, k) => k % 7 === 0).map(i => C.oklab([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]].map(v => v / 255))); labs.sort((p, q) => p[0] - q[0]); return labs[labs.length >> 1]; })();
  const key = o.color ? C.oklab(o.color) : bgLab, dist = new Float32Array(n);
  for (let i = 0; i < n; i++) { const l = C.oklab([rgba[i * 4] / 255, rgba[i * 4 + 1] / 255, rgba[i * 4 + 2] / 255]); dist[i] = Math.hypot(l[0] - key[0], l[1] - key[1], l[2] - key[2]); }
  const bg = new Uint8Array(n), stack = border.filter(i => dist[i] < tol * 1.5); stack.forEach(i => bg[i] = 1);
  while (stack.length) { const i = stack.pop(), x = i % w, y = (i / w) | 0; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && !bg[j] && dist[j] < tol * 1.5) { bg[j] = 1; stack.push(j); } }
  const out = { w, h, rgba: new Uint8Array(rgba) };
  for (let i = 0; i < n; i++) if (bg[i]) out.rgba[i * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, (dist[i] - tol * 0.5) / tol)));
  return out;
}
