'use strict';
// Reference images: decode, cut out the object's silhouette, measure it (aspect, height/width profile along its length)
// and compare it with the model's own silhouette from the same orthographic view.
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib'), cp = require('child_process');
const R = require('./render.cjs');

// ---- decoding ----------------------------------------------------------------------------------
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG file');
  let o = 8, w, h, depth, type, interlace, pal = null, trns = null; const idat = [];
  while (o < buf.length) {
    const L = buf.readUInt32BE(o), t = buf.toString('ascii', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + L); o += 12 + L;
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; interlace = d[12]; }
    else if (t === 'PLTE') pal = d; else if (t === 'tRNS') trns = d; else if (t === 'IDAT') idat.push(d); else if (t === 'IEND') break;
  }
  if (interlace) throw new Error('interlaced PNG: re-save it without interlacing (the convert step does this)');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type], bitsPP = ch * depth, bpp = Math.max(1, bitsPP >> 3), stride = Math.ceil(w * bitsPP / 8);
  const raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = px.subarray(y * stride, (y + 1) * stride), prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, b = prev ? prev[x] : 0, c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      row[x] = v & 255;
    }
  }
  const out = new Uint8Array(w * h * 4);
  const sample = (y, i) => { // i-th sample in row y, scaled to 0..255
    if (depth === 8) return px[y * stride + i]; if (depth === 16) return px[y * stride + i * 2];
    const bit = i * depth, byte = px[y * stride + (bit >> 3)], v = (byte >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    return type === 3 ? v : Math.round(v * 255 / ((1 << depth) - 1));
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o4 = (y * w + x) * 4; let r, g, b, al = 255;
    if (type === 3) { const k = sample(y, x); r = pal[k * 3]; g = pal[k * 3 + 1]; b = pal[k * 3 + 2]; if (trns && k < trns.length) al = trns[k]; }
    else if (type === 0) { r = g = b = sample(y, x); }
    else if (type === 4) { r = g = b = sample(y, x * 2); al = sample(y, x * 2 + 1); }
    else if (type === 2) { r = sample(y, x * 3); g = sample(y, x * 3 + 1); b = sample(y, x * 3 + 2); }
    else { r = sample(y, x * 4); g = sample(y, x * 4 + 1); b = sample(y, x * 4 + 2); al = sample(y, x * 4 + 3); }
    out[o4] = r; out[o4 + 1] = g; out[o4 + 2] = b; out[o4 + 3] = al;
  }
  return { w, h, rgba: out };
}
// JPEG / WebP / GIF / HEIC -> PNG with whatever converter the machine has (sips on macOS, ffmpeg, ImageMagick, Python PIL).
function toPngBuffer(file) {
  const buf = fs.readFileSync(file);
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return buf;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmodel-ref-')), out = path.join(dir, 'ref.png'), opt = { stdio: 'ignore', timeout: 60000 };
  const tries = [
    ['sips', ['-s', 'format', 'png', file, '--out', out]],
    ['ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-frames:v', '1', out]],
    ['magick', [file, out]], ['convert', [file + '[0]', out]],
    ['python3', ['-I', '-c', 'import sys;from PIL import Image;Image.open(sys.argv[1]).convert("RGBA").save(sys.argv[2])', file, out]],
  ];
  for (const [cmd, args] of tries) { try { cp.execFileSync(cmd, args, opt); if (fs.existsSync(out)) return fs.readFileSync(out); } catch (e) { /* next */ } }
  throw new Error(`cannot convert ${path.basename(file)} to PNG: install ffmpeg or ImageMagick, or save it as PNG`);
}
function loadImage(file) { return decodePng(toPngBuffer(file)); }

// ---- silhouette extraction ---------------------------------------------------------------------
function downscale(img, maxSide) {
  const k = Math.max(1, Math.ceil(Math.max(img.w, img.h) / maxSide)); if (k === 1) return img;
  const w = Math.floor(img.w / k), h = Math.floor(img.h / k), out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const acc = [0, 0, 0, 0];
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) { const o = ((y * k + j) * img.w + x * k + i) * 4; for (let c = 0; c < 4; c++) acc[c] += img.rgba[o + c]; }
    for (let c = 0; c < 4; c++) out[(y * w + x) * 4 + c] = acc[c] / (k * k);
  }
  return { w, h, rgba: out };
}
// opts: { crop: [x0, y0, x1, y1] in 0..1 (to isolate one view of a sheet), threshold: 0..1, flip: bool, invert: bool }
function extract(img, opts) {
  opts = opts || {};
  if (opts.crop) {
    const [a, b, c, d] = opts.crop, x0 = Math.round(a * img.w), y0 = Math.round(b * img.h), w = Math.max(1, Math.round(c * img.w) - x0), h = Math.max(1, Math.round(d * img.h) - y0), out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) out[(y * w + x) * 4 + k] = img.rgba[((y0 + y) * img.w + x0 + x) * 4 + k];
    img = { w, h, rgba: out };
  }
  img = downscale(img, 320);
  const { w, h, rgba } = img, N = w * h; let mask = new Uint8Array(N);
  let transparent = 0; for (let i = 0; i < N; i++) if (rgba[i * 4 + 3] < 128) transparent++;
  let method;
  if (transparent > N * 0.05) { for (let i = 0; i < N; i++) mask[i] = rgba[i * 4 + 3] >= 128 ? 1 : 0; method = 'alpha'; }
  else {
    // background = median colour of the border; distance threshold by Otsu's method
    const border = []; for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x); for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
    const med = [0, 1, 2].map(c => { const v = border.map(i => rgba[i * 4 + c]).sort((a, b) => a - b); return v[v.length >> 1]; });
    const dist = new Float32Array(N); for (let i = 0; i < N; i++) dist[i] = Math.hypot(rgba[i * 4] - med[0], rgba[i * 4 + 1] - med[1], rgba[i * 4 + 2] - med[2]) / 441.7;
    let thr = opts.threshold;
    if (thr == null) {
      const hist = new Array(64).fill(0); for (let i = 0; i < N; i++) hist[Math.min(63, Math.floor(dist[i] * 64))]++;
      let best = 0, bi = 8, sum = 0; hist.forEach((c, i) => { sum += c * i; });
      let wB = 0, sB = 0; for (let i = 0; i < 64; i++) { wB += hist[i]; if (!wB || wB === N) continue; sB += i * hist[i]; const mB = sB / wB, mF = (sum - sB) / (N - wB), v = wB * (N - wB) * (mB - mF) * (mB - mF); if (v > best) { best = v; bi = i; } }
      thr = Math.max(0.06, (bi + 0.5) / 64);
    }
    for (let i = 0; i < N; i++) mask[i] = dist[i] > thr ? 1 : 0; method = `background key (threshold ${thr.toFixed(2)})`;
  }
  if (opts.invert) for (let i = 0; i < N; i++) mask[i] ^= 1;
  mask = largestComponent(mask, w, h); mask = fillHoles(mask, w, h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) throw new Error('no object found in the image; try --threshold, --crop or a cleaner reference');
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, crop = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) crop[y * cw + x] = mask[(y0 + y) * w + (opts.flip ? x1 - x : x0 + x)];
  const cover = crop.reduce((s, v) => s + v, 0) / (cw * ch);
  return { mask: crop, w: cw, h: ch, aspect: cw / ch, method, img, box: [x0, y0, x1, y1], cover, touchesEdge: x0 === 0 || y0 === 0 || x1 === w - 1 || y1 === h - 1 };
}
function largestComponent(mask, w, h) {
  const lab = new Int32Array(w * h).fill(-1); let best = -1, bestN = 0, id = 0; const st = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || lab[s] >= 0) continue; let n = 0; st.push(s); lab[s] = id;
    while (st.length) { const i = st.pop(); n++; const x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; const j = Y * w + X; if (mask[j] && lab[j] < 0) { lab[j] = id; st.push(j); } } }
    if (n > bestN) { bestN = n; best = id; } id++;
  }
  const out = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) out[i] = lab[i] === best ? 1 : 0; return out;
}
function fillHoles(mask, w, h) {
  const seen = new Uint8Array(w * h), st = [];
  for (let x = 0; x < w; x++) st.push(x, (h - 1) * w + x); for (let y = 0; y < h; y++) st.push(y * w, y * w + w - 1);
  while (st.length) { const i = st.pop(); if (seen[i] || mask[i]) continue; seen[i] = 1; const x = i % w, y = (i / w) | 0; if (x > 0) st.push(i - 1); if (x < w - 1) st.push(i + 1); if (y > 0) st.push(i - w); if (y < h - 1) st.push(i + w); }
  const out = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) out[i] = seen[i] ? 0 : 1; return out;
}
// Column profile along the long (horizontal) axis: for each station u in 0..1, top and bottom of the shape as 0..1 of height.
function profile(sil, stations) {
  const n = stations || 12, out = [];
  for (let k = 0; k < n; k++) {
    const u = n === 1 ? 0.5 : k / (n - 1), x = Math.min(sil.w - 1, Math.round(u * (sil.w - 1)));
    let top = -1, bot = -1; for (let y = 0; y < sil.h; y++) if (sil.mask[y * sil.w + x]) { if (top < 0) top = y; bot = y; }
    out.push(top < 0 ? { u, top: null, bottom: null, thick: 0 } : { u, top: 1 - top / sil.h, bottom: 1 - (bot + 1) / sil.h, thick: (bot - top + 1) / sil.h });
  }
  return out;
}
// Resample a cropped mask into a g x g grid (stretching it to fill, aspect handled separately).
function grid(sil, g) {
  const out = new Float32Array(g * g);
  for (let y = 0; y < g; y++) for (let x = 0; x < g; x++) {
    let acc = 0, cnt = 0; const xa = Math.floor(x * sil.w / g), xb = Math.max(xa + 1, Math.floor((x + 1) * sil.w / g)), ya = Math.floor(y * sil.h / g), yb = Math.max(ya + 1, Math.floor((y + 1) * sil.h / g));
    for (let j = ya; j < yb && j < sil.h; j++) for (let i = xa; i < xb && i < sil.w; i++) { acc += sil.mask[j * sil.w + i]; cnt++; }
    out[y * g + x] = cnt ? acc / cnt : 0;
  }
  return out;
}
function iou(a, b) { let I = 0, U = 0; for (let i = 0; i < a.length; i++) { I += Math.min(a[i], b[i]); U += Math.max(a[i], b[i]); } return U ? I / U : 0; }
function cropMask(m) {
  let x0 = m.w, y0 = m.h, x1 = -1, y1 = -1;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.mask[y * m.w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return { mask: new Uint8Array(1), w: 1, h: 1, aspect: 1 };
  const w = x1 - x0 + 1, h = y1 - y0 + 1, mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = m.mask[(y0 + y) * m.w + x0 + x];
  return { mask, w, h, aspect: w / h };
}
const flipMask = m => { const o = new Uint8Array(m.w * m.h); for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) o[y * m.w + x] = m.mask[y * m.w + m.w - 1 - x]; return Object.assign({}, m, { mask: o }); };

// Compare the model's silhouette with a reference image. Returns scores and an overlay PNG.
function compare(model, file, opts) {
  opts = opts || {}; const view = opts.view || 'side';
  const ref = extract(loadImage(file), opts);
  const mod = cropMask(R.silhouette(model, view, 384, opts.clip, opts.time));
  const g = 64, gr = grid(ref, g), gm = grid(mod, g), gf = grid(flipMask(mod), g);
  const a = iou(gr, gm), b = iou(gr, gf), flipped = !opts.flip && b > a + 0.01, score = Math.max(a, opts.flip ? a : b);
  const aspectErr = mod.aspect / ref.aspect - 1;
  return { view, score, flipped, refAspect: ref.aspect, modelAspect: mod.aspect, aspectErr, method: ref.method, touchesEdge: ref.touchesEdge,
    overlay: overlayPng(ref, flipped ? flipMask(mod) : mod, score, aspectErr, view), refProfile: profile(ref, 12), modelProfile: profile(flipped ? flipMask(mod) : mod, 12) };
}
// Reference photo (dimmed) with the model fitted to the same box: green = both, red = reference only (model missing), blue = model only (excess).
function overlayPng(ref, mod, score, aspectErr, view) {
  const H = 360, W = Math.max(200, Math.round(H * ref.aspect)), pad = 10, head = 46, SW = Math.max(W + pad * 2, 520), SH = H + pad * 2 + head + 22;
  const img = new Uint8Array(SW * SH * 4); for (let i = 0; i < SW * SH; i++) { img[i * 4] = 38; img[i * 4 + 1] = 42; img[i * 4 + 2] = 50; img[i * 4 + 3] = 255; }
  const src = ref.img, [bx0, by0, bx1, by1] = ref.box;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W, v = (y + 0.5) / H;
    const rx = Math.min(ref.w - 1, Math.floor(u * ref.w)), ry = Math.min(ref.h - 1, Math.floor(v * ref.h)), inR = ref.mask[ry * ref.w + rx];
    const mx = Math.min(mod.w - 1, Math.floor(u * mod.w)), my = Math.min(mod.h - 1, Math.floor(v * mod.h)), inM = mod.mask[my * mod.w + mx];
    const sx = bx0 + Math.min(bx1 - bx0, Math.floor(u * (bx1 - bx0 + 1))), sy = by0 + Math.min(by1 - by0, Math.floor(v * (by1 - by0 + 1))), so = (sy * src.w + sx) * 4;
    const gray = (src.rgba[so] * 0.3 + src.rgba[so + 1] * 0.59 + src.rgba[so + 2] * 0.11) * 0.55 + 30;
    let c = [gray, gray, gray];
    if (inR && inM) c = [gray * 0.5 + 20, gray * 0.5 + 120, gray * 0.5 + 40]; else if (inR) c = [230, 70, 60]; else if (inM) c = [70, 130, 240];
    const o = ((head + pad + y) * SW + pad + x) * 4; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2];
  }
  R.text(img, SW, pad, 8, `${view.toUpperCase()} MATCH ${(score * 100).toFixed(0)}%  ASPECT ${(aspectErr >= 0 ? '+' : '') + (aspectErr * 100).toFixed(0)}%`, 3);
  R.text(img, SW, pad, SH - 18, 'GREEN BOTH  RED REF ONLY  BLUE MODEL ONLY', 2, [200, 205, 215]);
  return R.png(SW, SH, img);
}
// Suggest loft stations from a side-view trace: model length L (along z, front = right of the image) and height H.
function stationsFromTrace(sil, n, L, H, baseY) {
  return profile(sil, n).filter(s => s.top != null).map(s => ({ at: +((s.u - 0.5) * L).toFixed(4), h: +(s.thick * H).toFixed(4), dy: +(((s.top + s.bottom) / 2) * H + (baseY || 0)).toFixed(4) }));
}

module.exports = { decodePng, loadImage, toPngBuffer, extract, profile, grid, iou, compare, cropMask, flipMask, stationsFromTrace, overlayPng };
