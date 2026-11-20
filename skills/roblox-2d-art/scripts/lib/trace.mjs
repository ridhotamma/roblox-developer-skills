// Measure references: cut the object out of a reference image, trace its silhouette into a clean SVG path (scaled
// into your canvas, ready to restyle), optionally split it into flat colour regions, and pull its palette.
import fs from 'node:fs';
import path from 'node:path';
import { browser } from './chrome.mjs';
import * as C from './color.mjs';
import * as R from './raster.mjs';

async function load(file, o, maxSide = 640) {
  const b = await browser(); let img = await b.decodeFile(path.resolve(file), maxSide);
  if (o.crop) { const [x0, y0, x1, y1] = String(o.crop).split(',').map(Number); img = R.crop8(img, Math.round(x0 * img.w), Math.round(y0 * img.h), Math.max(1, Math.round((x1 - x0) * img.w)), Math.max(1, Math.round((y1 - y0) * img.h))); }
  if (o.flip) { const { w, h, rgba } = img, out = new Uint8Array(rgba.length); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) out[(y * w + x) * 4 + c] = rgba[(y * w + (w - 1 - x)) * 4 + c]; img = { w, h, rgba: out }; }
  return img;
}
// Object mask: alpha if the image has transparency, else everything not connected to the border through
// background-coloured pixels (so a white shirt on a white backdrop keeps its interior if it is enclosed).
export function objectMask(img, o = {}) {
  const { w, h, rgba } = img, n = w * h, m = new Float32Array(n); let tr = 0;
  for (let i = 0; i < n; i++) if (rgba[i * 4 + 3] < 128) tr++;
  if (tr > n * 0.05) { for (let i = 0; i < n; i++) m[i] = rgba[i * 4 + 3] / 255; return { mask: m, method: 'alpha' }; }
  const lab = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const l = C.oklab([rgba[i * 4] / 255, rgba[i * 4 + 1] / 255, rgba[i * 4 + 2] / 255]); lab[i * 3] = l[0]; lab[i * 3 + 1] = l[1]; lab[i * 3 + 2] = l[2]; }
  const border = []; for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x); for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  const bl = [0, 1, 2].map(c => { const v = border.map(i => lab[i * 3 + c]).sort((p, q) => p - q); return v[v.length >> 1]; });
  const thr = +(o.threshold ?? 0.12), d = i => Math.hypot(lab[i * 3] - bl[0], lab[i * 3 + 1] - bl[1], lab[i * 3 + 2] - bl[2]);
  const bg = new Uint8Array(n), st = border.filter(i => d(i) < thr); st.forEach(i => bg[i] = 1);
  while (st.length) { const i = st.pop(), x = i % w, y = (i / w) | 0; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && !bg[j] && d(j) < thr) { bg[j] = 1; st.push(j); } }
  if (o.holes) {   // also cut enclosed background-coloured areas (the hole in a mug handle, between a chair's legs)
    const seen = new Uint8Array(n);
    for (let s0 = 0; s0 < n; s0++) {
      if (bg[s0] || seen[s0] || d(s0) >= thr) continue;
      const comp = [s0], st2 = [s0]; seen[s0] = 1;
      while (st2.length) { const i = st2.pop(), x = i % w, y = (i / w) | 0; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && !bg[j] && !seen[j] && d(j) < thr) { seen[j] = 1; st2.push(j); comp.push(j); } }
      if (comp.length > n * 0.002) for (const i of comp) bg[i] = 1;
    }
  }
  for (let i = 0; i < n; i++) m[i] = bg[i] ? 0 : 1;
  return { mask: m, method: `background key ${C.hex(C.fromOklab(bl))} (threshold ${thr}${o.holes ? ', holes cut' : ''})` };
}
function largestComponents(m, w, h, keepAll) {
  const lab = new Int32Array(w * h).fill(-1), sizes = []; let id = 0;
  for (let s = 0; s < w * h; s++) { if (m[s] < 0.5 || lab[s] >= 0) continue; const st = [s]; lab[s] = id; let c = 0; while (st.length) { const i = st.pop(); c++; const x = i % w, y = (i / w) | 0; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && m[j] >= 0.5 && lab[j] < 0) { lab[j] = id; st.push(j); } } sizes.push(c); id++; }
  if (!sizes.length) return m;
  const big = Math.max(...sizes), keep = sizes.map(s => keepAll ? s > big * 0.02 : s === big), out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = lab[i] >= 0 && keep[lab[i]] ? 1 : 0;
  return out;
}

// Marching squares at level 0.5 on a (padded) field -> closed loops of [x, y] in pixel units.
export function contours(f, w, h) {
  const W = w + 2, H = h + 2, F = new Float32Array(W * H); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) F[(y + 1) * W + x + 1] = f[y * w + x];
  const lv = 0.5, segs = [], at = (x, y) => F[y * W + x];
  const pt = (e, x, y) => { // edge e of cell (x, y): 0 top, 1 right, 2 bottom, 3 left -> [key, point]
    if (e === 0) { const a = at(x, y), b = at(x + 1, y), t = (lv - a) / (b - a); return [`h${x},${y}`, [x + t, y]]; }
    if (e === 2) { const a = at(x, y + 1), b = at(x + 1, y + 1), t = (lv - a) / (b - a); return [`h${x},${y + 1}`, [x + t, y + 1]]; }
    if (e === 3) { const a = at(x, y), b = at(x, y + 1), t = (lv - a) / (b - a); return [`v${x},${y}`, [x, y + t]]; }
    const a = at(x + 1, y), b = at(x + 1, y + 1), t = (lv - a) / (b - a); return [`v${x + 1},${y}`, [x + 1, y + t]];
  };
  const TABLE = { 1: [[3, 2]], 2: [[2, 1]], 3: [[3, 1]], 4: [[0, 1]], 6: [[0, 2]], 7: [[3, 0]], 8: [[3, 0]], 9: [[0, 2]], 11: [[0, 1]], 12: [[3, 1]], 13: [[2, 1]], 14: [[3, 2]] };
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const c = (at(x, y) > lv ? 8 : 0) | (at(x + 1, y) > lv ? 4 : 0) | (at(x + 1, y + 1) > lv ? 2 : 0) | (at(x, y + 1) > lv ? 1 : 0);
    if (c === 0 || c === 15) continue;
    let pairs = TABLE[c];
    if (c === 5 || c === 10) { const mid = (at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1)) / 4 > lv; pairs = (c === 5) === mid ? [[3, 0], [2, 1]] : [[3, 2], [0, 1]]; }
    for (const [e1, e2] of pairs) segs.push([pt(e1, x, y), pt(e2, x, y)]);
  }
  const byKey = new Map(); segs.forEach((s, i) => { for (const [k] of s) { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(i); } });
  const used = new Uint8Array(segs.length), loops = [];
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue; used[s0] = 1; const loop = [segs[s0][0][1], segs[s0][1][1]]; let key = segs[s0][1][0];
    for (let guard = 0; guard < segs.length; guard++) {
      const next = (byKey.get(key) || []).find(i => !used[i]); if (next == null) break; used[next] = 1;
      const [a, b] = segs[next], far = a[0] === key ? b : a; if (far[0] === segs[s0][0][0]) break; loop.push(far[1]); key = far[0];
    }
    if (loop.length > 3) loops.push(loop.map(([x, y]) => [x - 1, y - 1]));
  }
  return loops;
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts; const [a, b] = [pts[0], pts[pts.length - 1]]; let idx = -1, md = 0;
  for (let i = 1; i < pts.length - 1; i++) { const p = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, d = Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / L; if (d > md) { md = d; idx = i; } }
  return md > eps ? rdp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps)) : [a, b];
}
export function simplifyLoop(loop, eps) {
  let far = 0, md = 0; for (let i = 1; i < loop.length; i++) { const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]); if (d > md) { md = d; far = i; } }
  const A = rdp(loop.slice(0, far + 1), eps), B = rdp(loop.slice(far).concat([loop[0]]), eps);
  return A.slice(0, -1).concat(B.slice(0, -1));
}
const area = l => { let s = 0; for (let i = 0; i < l.length; i++) { const p = l[i], q = l[(i + 1) % l.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; };
const r2 = v => Math.round(v * 10) / 10;
// Closed path through points: smooth Catmull-Rom, except at sharp corners (kept crisp: hard-surface objects).
export function loopPath(pts, smooth = true, corner = 70) {
  const n = pts.length; if (!smooth) return 'M' + pts.map(p => `${r2(p[0])} ${r2(p[1])}`).join('L') + 'Z';
  const P = i => pts[(i + n) % n], sharp = i => { const a = P(i - 1), b = P(i), c = P(i + 1), u = [a[0] - b[0], a[1] - b[1]], v = [c[0] - b[0], c[1] - b[1]], cos = (u[0] * v[0] + u[1] * v[1]) / ((Math.hypot(...u) * Math.hypot(...v)) || 1); return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI < 180 - corner; };
  let d = `M${r2(pts[0][0])} ${r2(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2), k1 = sharp(i) ? 0 : 1 / 6, k2 = sharp(i + 1) ? 0 : 1 / 6;
    d += `C${r2(p1[0] + (p2[0] - p0[0]) * k1)} ${r2(p1[1] + (p2[1] - p0[1]) * k1)} ${r2(p2[0] - (p3[0] - p1[0]) * k2)} ${r2(p2[1] - (p3[1] - p1[1]) * k2)} ${r2(p2[0])} ${r2(p2[1])}`;
  }
  return d + 'Z';
}

export async function trace(file, o = {}) {
  if (!file) throw new Error('usage: trace <image> [--out name] [--box 512] [--pad 0.06] [--crop x0,y0,x1,y1] [--threshold 0.12] [--holes] [--detail 1.5] [--colors 5] [--all] [--flip]');
  const img = await load(file, o), { w, h } = img;
  let { mask, method } = objectMask(img, o);
  mask = largestComponents(mask, w, h, !!o.all);
  const field = R.blur(mask, w, h, 0.9), loops0 = contours(field, w, h);
  const eps = +(o.detail ?? 1.5), bb = R.bbox(mask, w, h, 0.5); if (!bb) throw new Error('no object found: try --threshold, --crop, or an image with a plainer background');
  const minA = bb.w * bb.h * 0.002, loops = loops0.map(l => simplifyLoop(l, eps)).filter(l => l.length >= 3 && Math.abs(area(l)) > minA);
  const box = sizeArg(o.box || 512), pad = +(o.pad ?? 0.06), s = Math.min((box[0] * (1 - 2 * pad)) / bb.w, (box[1] * (1 - 2 * pad)) / bb.h), ox = box[0] / 2 - s * bb.cx, oy = box[1] / 2 - s * bb.cy;
  const T = l => l.map(([x, y]) => [x * s + ox, y * s + oy]);
  const d = loops.map(l => loopPath(T(l), o.smooth !== false)).join(''), dPoly = loops.map(l => loopPath(T(l), false)).join('');
  const base = path.resolve(o.out || path.join(path.dirname(path.resolve(file)), path.basename(file).replace(/\.[^.]+$/, '') + '-trace'));
  const result = { source: path.resolve(file), method, aspect: +(bb.w / bb.h).toFixed(3), box, d, dPoly, points: loops.reduce((a, l) => a + l.length, 0), loops: loops.length };
  // colour regions: k-means inside the mask, majority filter, one path per cluster (a flat "underpainting")
  if (+o.colors > 0) {
    const samples = [], n = w * h; for (let i = 0; i < n; i += 2) if (mask[i] > 0.5) samples.push({ lab: C.oklab([img.rgba[i * 4] / 255, img.rgba[i * 4 + 1] / 255, img.rgba[i * 4 + 2] / 255]), w: 1 });
    const cl = C.kmeans(samples, +o.colors), lab = new Int16Array(n).fill(-1);
    for (let i = 0; i < n; i++) if (mask[i] > 0.5) { const p = C.oklab([img.rgba[i * 4] / 255, img.rgba[i * 4 + 1] / 255, img.rgba[i * 4 + 2] / 255]); let bi = 0, bd = Infinity; cl.forEach((c, j) => { const dd = (p[0] - c.lab[0]) ** 2 + (p[1] - c.lab[1]) ** 2 + (p[2] - c.lab[2]) ** 2; if (dd < bd) { bd = dd; bi = j; } }); lab[i] = bi; }
    for (let pass = 0; pass < 3; pass++) { const nl = new Int16Array(lab); for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (lab[i] < 0) continue; const cnt = new Map(); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const v = lab[i + dy * w + dx]; if (v >= 0) cnt.set(v, (cnt.get(v) || 0) + 1); } let best = lab[i], bc = 0; for (const [v, c] of cnt) if (c > bc) { bc = c; best = v; } if (bc >= 5) nl[i] = best; } lab.set(nl); }
    result.regions = cl.map((c, j) => { const m = new Float32Array(n); for (let i = 0; i < n; i++) m[i] = lab[i] === j ? 1 : 0; const ls = contours(R.blur(m, w, h, 0.7), w, h).map(l => simplifyLoop(l, eps)).filter(l => l.length >= 3 && Math.abs(area(l)) > minA * 0.5); return { color: c.hex, share: +c.w.toFixed(3), d: ls.map(l => loopPath(T(l), o.smooth !== false)).join('') }; }).filter(r => r.d);
  }
  fs.mkdirSync(path.dirname(base), { recursive: true }); fs.writeFileSync(base + '.json', JSON.stringify(result, null, 1));
  const svgOf = inner => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box[0]} ${box[1]}" width="${box[0]}" height="${box[1]}">${inner}</svg>`;
  fs.writeFileSync(base + '.svg', svgOf(`<path d="${d}" fill="#3b3f46" fill-rule="evenodd"/>`));
  if (result.regions) fs.writeFileSync(base + '-colors.svg', svgOf(`<path d="${d}" fill="${result.regions[0].color}" fill-rule="evenodd"/>` + result.regions.slice(1).sort((a, b) => b.share - a.share).map(r => `<path d="${r.d}" fill="${r.color}" fill-rule="evenodd"/>`).join('')));
  // overlay: the reference with the traced outline on top, to judge the fit
  const b = await browser(), src = 'data:image/png;base64,' + (await import('./png.mjs')).encode(img).toString('base64');
  const ov = `<svg xmlns="http://www.w3.org/2000/svg" width="${box[0] * 2}" height="${box[1]}" viewBox="0 0 ${box[0] * 2} ${box[1]}"><rect width="100%" height="100%" fill="#fff"/><image href="${src}" x="${ox}" y="${oy}" width="${w * s}" height="${h * s}" opacity="0.55"/><path d="${d}" fill="none" stroke="#ff2d55" stroke-width="2.5" fill-rule="evenodd"/>` +
    `<g transform="translate(${box[0]} 0)">${result.regions ? `<path d="${d}" fill="${result.regions[0].color}" fill-rule="evenodd"/>` + result.regions.slice(1).sort((a, c) => c.share - a.share).map(r => `<path d="${r.d}" fill="${r.color}" fill-rule="evenodd"/>`).join('') : `<path d="${d}" fill="#3b3f46" fill-rule="evenodd"/>`}</g></svg>`;
  fs.writeFileSync(base + '-overlay.png', (await import('./png.mjs')).encode(await b.render(ov, box[0] * 2, box[1])));
  console.log(`traced ${path.basename(file)} (${method}): aspect w/h ${result.aspect}, ${result.loops} loop(s), ${result.points} points, fitted into ${box.join('x')} with ${pad} padding`);
  console.log(`wrote ${base}.json (path "d" ready for k.path), ${base}.svg${result.regions ? `, ${base}-colors.svg` : ''}, ${base}-overlay.png`);
  console.log('LOOK at the overlay: red outline over the reference (left), filled result (right). Fix with --crop, --threshold, --detail.');
  if (result.regions) console.log('colour regions: ' + result.regions.map(r => `${r.color} ${(r.share * 100).toFixed(0)}%`).join(', '));
  return result;
}
const sizeArg = v => { const s = String(v).split(/[x,]/).map(Number); return [s[0], s[1] || s[0]]; };

export async function palette(file, o = {}) {
  if (!file) throw new Error('usage: palette <image> [--n 6] [--out swatches.png]');
  const img = await load(file, o, 400), { mask, method } = objectMask(img, o), samples = [];
  for (let i = 0; i < img.w * img.h; i++) if (mask[i] > 0.5) samples.push({ lab: C.oklab([img.rgba[i * 4] / 255, img.rgba[i * 4 + 1] / 255, img.rgba[i * 4 + 2] / 255]), w: 1 });
  const cl = C.kmeans(samples, +(o.n || 6));
  console.log(`palette of ${path.basename(file)} (object pixels via ${method}):`);
  for (const c of cl) console.log(`  ${c.hex}  ${(c.w * 100).toFixed(0).padStart(3)}%   ramp ${C.ramp(c.hex, 5).join(' ')}   ink ${C.ink(c.hex)}`);
  const html = `<div style="display:flex;flex-direction:column;gap:6px;padding:10px;background:#222;font:12px monospace;color:#ddd">${cl.map(c => `<div style="display:flex;gap:4px;align-items:center"><div style="width:90px;height:40px;background:${c.hex}"></div>${C.ramp(c.hex, 5).map(r => `<div style="width:40px;height:40px;background:${r}"></div>`).join('')}<div style="width:40px;height:40px;background:${C.ink(c.hex)}"></div><span>${c.hex} ${(c.w * 100).toFixed(0)}%</span></div>`).join('')}</div>`;
  const out = path.resolve(o.out || path.basename(file).replace(/\.[^.]+$/, '') + '-palette.png'), b = await browser(); fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, await b.renderPage(html, 560)); console.log(`wrote ${out} (base | 5-step hue-shifted ramp | ink)`);
  return cl;
}
