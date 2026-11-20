// Float image maths. An image is { w, h, d: Float32Array(w*h*4) } holding PREMULTIPLIED sRGB in 0..1
// (premultiplied so blurs, resizes and compositing never drag in the colour of transparent pixels).

export const create = (w, h) => ({ w, h, d: new Float32Array(w * h * 4) });
export const clone = F => ({ w: F.w, h: F.h, d: new Float32Array(F.d) });
export function fromRGBA8(img) {
  const { w, h, rgba } = img, F = create(w, h), d = F.d;
  for (let i = 0; i < w * h; i++) { const a = rgba[i * 4 + 3] / 255; d[i * 4] = rgba[i * 4] / 255 * a; d[i * 4 + 1] = rgba[i * 4 + 1] / 255 * a; d[i * 4 + 2] = rgba[i * 4 + 2] / 255 * a; d[i * 4 + 3] = a; }
  return F;
}
export function toRGBA8(F) {
  const { w, h, d } = F, rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = d[i * 4 + 3];
    if (a <= 1e-6) continue;
    const k = 1 / a; rgba[i * 4] = Math.round(Math.min(1, d[i * 4] * k) * 255); rgba[i * 4 + 1] = Math.round(Math.min(1, d[i * 4 + 1] * k) * 255);
    rgba[i * 4 + 2] = Math.round(Math.min(1, d[i * 4 + 2] * k) * 255); rgba[i * 4 + 3] = Math.round(Math.min(1, a) * 255);
  }
  return { w, h, rgba };
}
export function alpha(F) { const a = new Float32Array(F.w * F.h); for (let i = 0; i < a.length; i++) a[i] = F.d[i * 4 + 3]; return a; }
// Solid colour image whose alpha is a (times opacity).
export function solid(w, h, a, rgb, opacity = 1) {
  const F = create(w, h), d = F.d;
  for (let i = 0; i < w * h; i++) { const k = Math.min(1, a[i]) * opacity; d[i * 4] = rgb[0] * k; d[i * 4 + 1] = rgb[1] * k; d[i * 4 + 2] = rgb[2] * k; d[i * 4 + 3] = k; }
  return F;
}
export function multiplyAlpha(F, m) { const d = F.d; for (let i = 0; i < F.w * F.h; i++) { const k = m[i]; d[i * 4] *= k; d[i * 4 + 1] *= k; d[i * 4 + 2] *= k; d[i * 4 + 3] *= k; } return F; }

// ---- compositing (W3C compositing spec, separable blend modes, on premultiplied data) ----
const BLEND = {
  normal: (b, s) => s, multiply: (b, s) => b * s, screen: (b, s) => b + s - b * s,
  overlay: (b, s) => b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s),
  'soft-light': (b, s) => s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * ((b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)) - b),
  'hard-light': (b, s) => s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s),
  darken: Math.min, lighten: Math.max, add: (b, s) => Math.min(1, b + s), 'color-dodge': (b, s) => s >= 1 ? 1 : Math.min(1, b / (1 - s)),
};
// dst <- src over dst. mask (Float32Array) multiplies src alpha (clipping masks). In place, returns dst.
export function composite(dst, src, mode = 'normal', opacity = 1, mask = null) {
  const D = dst.d, S = src.d, f = BLEND[mode] || BLEND.normal, n = dst.w * dst.h;
  if (src.w !== dst.w || src.h !== dst.h) throw new Error('composite size mismatch');
  for (let i = 0; i < n; i++) {
    const k = opacity * (mask ? mask[i] : 1), as = S[i * 4 + 3] * k; if (as <= 0) continue;
    const ab = D[i * 4 + 3];
    for (let c = 0; c < 3; c++) {
      const Cs = S[i * 4 + c] * k, Cb = D[i * 4 + c];
      if (mode === 'normal' || ab <= 0) D[i * 4 + c] = Cs + Cb * (1 - as);
      else { const cs = Cs / as, cb = Cb / ab; D[i * 4 + c] = (1 - ab) * Cs + (1 - as) * Cb + as * ab * f(cb, cs); }
    }
    D[i * 4 + 3] = as + ab * (1 - as);
  }
  return dst;
}
export const under = (dst, src) => { const t = clone(src); composite(t, dst); dst.d.set(t.d); return dst; };   // src behind dst

// ---- blur: three box passes approximate a Gaussian of the given sigma ----
function boxes(sigma, n = 3) { const wi = Math.sqrt(12 * sigma * sigma / n + 1); let wl = Math.floor(wi); if (wl % 2 === 0) wl--; const wu = wl + 2, m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4)); return Array.from({ length: n }, (_, i) => ((i < m ? wl : wu) - 1) / 2); }
function boxH(src, dst, w, h, r, ch) {
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) for (let c = 0; c < ch; c++) {
    let acc = 0; const row = y * w;
    for (let x = -r - 1; x < r; x++) acc += x >= 0 && x < w ? src[(row + x) * ch + c] : 0;
    for (let x = 0; x < w; x++) { const add = x + r, sub = x - r - 1; acc += add < w ? src[(row + add) * ch + c] : 0; acc -= sub >= 0 ? src[(row + sub) * ch + c] : 0; dst[(row + x) * ch + c] = acc * iarr; }
  }
}
function boxV(src, dst, w, h, r, ch) {
  const iarr = 1 / (r + r + 1);
  for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) {
    let acc = 0;
    for (let y = -r - 1; y < r; y++) acc += y >= 0 && y < h ? src[(y * w + x) * ch + c] : 0;
    for (let y = 0; y < h; y++) { const add = y + r, sub = y - r - 1; acc += add < h ? src[(add * w + x) * ch + c] : 0; acc -= sub >= 0 ? src[(sub * w + x) * ch + c] : 0; dst[(y * w + x) * ch + c] = acc * iarr; }
  }
}
// Blur a single-channel (ch = 1) or RGBA (ch = 4) Float32Array. axis: 'both' | 'x' | 'y'.
export function blur(arr, w, h, sigma, ch = 1, axis = 'both') {
  if (sigma < 0.3) return new Float32Array(arr);
  let a = new Float32Array(arr), b = new Float32Array(arr.length);
  for (const r0 of boxes(sigma)) {
    const r = Math.max(0, Math.round(r0)); if (!r) continue;
    if (axis !== 'y') { boxH(a, b, w, h, r, ch); [a, b] = [b, a]; }
    if (axis !== 'x') { boxV(a, b, w, h, r, ch); [a, b] = [b, a]; }
  }
  return a;
}
export const blurImage = (F, sigma) => ({ w: F.w, h: F.h, d: blur(F.d, F.w, F.h, sigma, 4) });

// ---- Euclidean distance transform (Felzenszwalb) with nearest-site index ----
// sites: Uint8Array (1 = site). Returns { d: distance in px, idx: index of nearest site (-1 if none) }.
export function edt(sites, w, h) {
  const INF = 1e20, f = new Float64Array(Math.max(w, h)), fi = new Int32Array(Math.max(w, h)), v = new Int32Array(Math.max(w, h)), z = new Float64Array(Math.max(w, h) + 1);
  const D = new Float64Array(w * h), I = new Int32Array(w * h).fill(-1);
  function pass(n, get, setOut) {   // 1-D lower envelope of parabolas over f / fi
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF; let q0 = 0;
    while (q0 < n && f[q0] >= INF) q0++;
    if (q0 === n) { for (let q = 0; q < n; q++) setOut(q, INF, -1); return; }
    v[0] = q0;
    for (let q = q0 + 1; q < n; q++) {
      if (f[q] >= INF) continue;
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; setOut(q, (q - v[k]) ** 2 + f[v[k]], fi[v[k]]); }
  }
  for (let x = 0; x < w; x++) {      // columns
    for (let y = 0; y < h; y++) { const s = sites[y * w + x]; f[y] = s ? 0 : INF; fi[y] = s ? y * w + x : -1; }
    pass(h, null, (q, val, id) => { D[q * w + x] = val; I[q * w + x] = id; });
  }
  for (let y = 0; y < h; y++) {      // rows
    for (let x = 0; x < w; x++) { f[x] = D[y * w + x]; fi[x] = I[y * w + x]; }
    pass(w, null, (q, val, id) => { D[y * w + q] = val; I[y * w + q] = id; });
  }
  const out = new Float32Array(w * h); for (let i = 0; i < w * h; i++) out[i] = D[i] >= INF ? 1e9 : Math.sqrt(D[i]);
  return { d: out, idx: I };
}
// Distance from every pixel to the shape's edge, outside (dOut) and inside (dIn), with a sub-pixel correction from
// coverage so outlines and bevels stay smooth along curves. Both are ~0 at the anti-aliased edge.
export function edgeDistances(a, w, h) {
  const inside = new Uint8Array(w * h), outside = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { if (a[i] >= 0.5) inside[i] = 1; else outside[i] = 1; }
  const o = edt(inside, w, h), n = edt(outside, w, h), dOut = new Float32Array(w * h), dIn = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    // inside pixel: the edge sits between it and its nearest outside pixel s, at s's border (a[s] = 0) .. centre (a[s] = 0.5)
    if (inside[i]) { const s = n.idx[i]; dIn[i] = s < 0 ? 1e9 : Math.max(0, n.d[i] - 0.5 + a[s]); dOut[i] = 0; }
    else { const s = o.idx[i]; dOut[i] = s < 0 ? 1e9 : Math.max(0, o.d[i] - (a[s] - 0.5)); dIn[i] = 0; }
  }
  return { dOut, dIn, nearIn: o.idx, nearOut: n.idx };
}

// ---- resampling ----
// Area-average resize (good for downscaling; also fine for mild upscaling). Works on premultiplied data.
export function resize(F, W, H) {
  if (W === F.w && H === F.h) return clone(F);
  const tmp = new Float32Array(W * F.h * 4), out = create(W, H);
  const axis = (n, N) => { const s = n / N, spans = []; for (let i = 0; i < N; i++) { const a = i * s, b = Math.max(a + 1e-6, (i + 1) * s), list = []; if (s < 1) { const c = (i + 0.5) * s - 0.5, x0 = Math.floor(c), t = c - x0; list.push([Math.max(0, x0), 1 - t], [Math.min(n - 1, x0 + 1), t]); } else for (let x = Math.floor(a); x < Math.ceil(b); x++) { const wgt = Math.min(b, x + 1) - Math.max(a, x); if (wgt > 0) list.push([Math.min(n - 1, x), wgt / s]); } spans.push(list); } return spans; };
  const sx = axis(F.w, W), sy = axis(F.h, H);
  for (let y = 0; y < F.h; y++) for (let x = 0; x < W; x++) for (const [xs, wgt] of sx[x]) { const si = (y * F.w + xs) * 4, di = (y * W + x) * 4; for (let c = 0; c < 4; c++) tmp[di + c] += F.d[si + c] * wgt; }
  for (let y = 0; y < H; y++) for (const [ys, wgt] of sy[y]) for (let x = 0; x < W; x++) { const si = (ys * W + x) * 4, di = (y * W + x) * 4; for (let c = 0; c < 4; c++) out.d[di + c] += tmp[si + c] * wgt; }
  return out;
}
export function nearestUp(img8, k) {     // integer nearest-neighbour upscale of a { w, h, rgba } image
  const W = img8.w * k, H = img8.h * k, rgba = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = ((Math.floor(y / k)) * img8.w + Math.floor(x / k)) * 4, o = (y * W + x) * 4; for (let c = 0; c < 4; c++) rgba[o + c] = img8.rgba[s + c]; }
  return { w: W, h: H, rgba };
}
export function bbox(a, w, h, thr = 0.03) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (a[y * w + x] > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1, w: x1 + 1 - x0, h: y1 + 1 - y0, cx: (x0 + x1 + 1) / 2, cy: (y0 + y1 + 1) / 2 };
}
// Alpha bleeding: give every fully transparent pixel the colour of the nearest visible pixel. Roblox (and any
// bilinear / mipmapped sampler) blends transparent pixels' RGB into edges when scaling: black RGB = dark fringes.
export function bleed(img8) {
  const { w, h, rgba } = img8, sites = new Uint8Array(w * h); let any = false;
  for (let i = 0; i < w * h; i++) if (rgba[i * 4 + 3] > 0) { sites[i] = 1; any = true; }
  if (!any) return img8;
  const { idx } = edt(sites, w, h);
  for (let i = 0; i < w * h; i++) if (!sites[i] && idx[i] >= 0) { const s = idx[i]; rgba[i * 4] = rgba[s * 4]; rgba[i * 4 + 1] = rgba[s * 4 + 1]; rgba[i * 4 + 2] = rgba[s * 4 + 2]; }
  return img8;
}
export function crop8(img8, x0, y0, w, h) {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const sx = x + x0, sy = y + y0; if (sx < 0 || sy < 0 || sx >= img8.w || sy >= img8.h) continue; const s = (sy * img8.w + sx) * 4, o = (y * w + x) * 4; for (let c = 0; c < 4; c++) rgba[o + c] = img8.rgba[s + c]; }
  return { w, h, rgba };
}
