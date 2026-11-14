'use strict';
// Software rasteriser (Node only, no packages): flat-shaded low-poly renders, outlines, a measured floor grid,
// orthographic blueprints and PNG contact sheets you can look at with an image viewer.
const M = require('./math.cjs');
const G = require('./geometry.cjs');
const MD = require('./model.cjs');
const { add, sub, mul, dot, cross, unit, D2R } = M;

// ---- PNG ---------------------------------------------------------------------------------------
function png(w, h, rgba) {
  const zlib = require('zlib'), raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const tbl = png.t || (png.t = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }));
  const crc = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = tbl[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]), cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([l, td, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ---- 3x5 bitmap font ---------------------------------------------------------------------------
const FONT = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100', G: '011100101101011',
  H: '101101111101101', I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101',
  O: '010101101101010', P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010', U: '101101101101111',
  V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010', Z: '111001010100111',
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001', 5: '111100111001111', 6: '111100111101111',
  7: '111001010010010', 8: '111101111101111', 9: '111101111001111', '.': '000000000000010', '-': '000000111000000', ':': '000010000010000', '/': '001001010100100',
  '%': '101001010100101', '(': '010100100100010', ')': '010001001001010', '=': '000111000111000', '*': '000101010101000', ' ': '000000000000000', '_': '000000000000111', '+': '000010111010000', '>': '100010001010100', '<': '001010100010001',
};
function text(img, W, x, y, str, sc, col) {
  sc = sc || 2; col = col || [235, 238, 242];
  for (const ch0 of String(str)) {
    const g = FONT[ch0.toUpperCase()] || FONT[' '];
    for (let k = 0; k < 15; k++) if (g[k] === '1') for (let a = 0; a < sc; a++) for (let b = 0; b < sc; b++) {
      const px = x + (k % 3) * sc + b, py = y + Math.floor(k / 3) * sc + a; if (px < 0 || py < 0 || px >= W || py * W + px >= img.length / 4) continue;
      const o = (py * W + px) * 4; img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2]; img[o + 3] = 255;
    }
    x += 4 * sc;
  }
}
const textWidth = (s, sc) => String(s).length * 4 * (sc || 2);

// ---- camera ------------------------------------------------------------------------------------
const VIEWS = {           // orthographic blueprint views. side: seen from the model's left, so its front (+Z) points right
  front: { dir: [0, 0, 1], up: [0, 1, 0] }, back: { dir: [0, 0, -1], up: [0, 1, 0] },
  side: { dir: [-1, 0, 0], up: [0, 1, 0] }, right: { dir: [1, 0, 0], up: [0, 1, 0] },
  top: { dir: [0, 1, 0], up: [0, 0, -1] }, bottom: { dir: [0, -1, 0], up: [0, 0, 1] },
};
function frameInfo(model) {
  const meshes = MD.posedMeshes(model, null, 0), all = [];
  meshes.forEach(m => all.push(...m.pos));
  const B = all.length ? G.bounds(all) : { lo: [-0.5, 0, -0.5], hi: [0.5, 1, 0.5], size: [1, 1, 1], center: [0, 0.5, 0] };
  return { B, radius: Math.max(1e-3, M.len(B.size) / 2) };
}
// view: { ortho?: "front"|"side"|..., yaw, pitch, dist (multiples of radius), target, w, h, fov }
function camera(model, view, F) {
  F = F || frameInfo(model);
  const target = view.target || F.B.center;
  if (view.ortho) {
    const V = VIEWS[view.ortho]; if (!V) throw new Error('unknown view ' + view.ortho);
    const f = mul(V.dir, -1), up = V.up, r = unit(cross(f, up));
    const span = view.span || (() => { const e = [M.len(M.vmul(F.B.size, r.map(Math.abs))), M.len(M.vmul(F.B.size, up.map(Math.abs)))]; return Math.max(e[0] / (view.w / view.h), e[1]) * 1.25; })();
    return { ortho: true, pos: add(target, mul(V.dir, F.radius * 4)), f, r, up, scale: view.h / span, w: view.w, h: view.h, target };
  }
  const yaw = (view.yaw == null ? 35 : view.yaw) * D2R, pit = (view.pitch == null ? 22 : view.pitch) * D2R;
  const toCam = [Math.sin(yaw) * Math.cos(pit), Math.sin(pit), Math.cos(yaw) * Math.cos(pit)];
  const fov = (view.fov || 35) * D2R, dist = (view.dist || 1) * F.radius / Math.sin(fov / 2) * 1.08;
  const pos = add(target, mul(toCam, dist)), f = mul(toCam, -1), r = unit(cross(f, [0, 1, 0])), up = cross(r, f);
  return { ortho: false, pos, f, r, up, focal: (view.h / 2) / Math.tan(fov / 2), w: view.w, h: view.h, target };
}
function project(C, p) {
  const d = sub(p, C.pos), z = dot(d, C.f);
  if (C.ortho) return [C.w / 2 + dot(d, C.r) * C.scale, C.h / 2 - dot(d, C.up) * C.scale, z];
  return [C.w / 2 + dot(d, C.r) / z * C.focal, C.h / 2 - dot(d, C.up) / z * C.focal, z];
}

// ---- rasteriser --------------------------------------------------------------------------------
function makeTarget(w, h) { return { w, h, col: new Float32Array(w * h * 3), z: new Float32Array(w * h).fill(Infinity), id: new Int32Array(w * h).fill(-1) }; }
function raster(T, a, b, c, id, shade) {          // a, b, c: [sx, sy, z]; shade(u, v, w) -> [r, g, b]; perspective-correct z only
  if (a[2] <= 1e-4 || b[2] <= 1e-4 || c[2] <= 1e-4) return;
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(T.w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(T.h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); if (Math.abs(area) < 1e-9) return;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const px = x + 0.5, py = y + 0.5;
    let w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area, w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area, w2 = 1 - w0 - w1;
    if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
    const z = w0 * a[2] + w1 * b[2] + w2 * c[2], i = y * T.w + x;
    if (z >= T.z[i]) continue;
    const col = shade(w0, w1, w2); if (!col) continue;
    T.z[i] = z; T.id[i] = id; T.col[i * 3] = col[0]; T.col[i * 3 + 1] = col[1]; T.col[i * 3 + 2] = col[2];
  }
}
const LIGHT = unit([0.45, 0.85, 0.55]), FILL = unit([-0.6, 0.2, -0.4]);
// Render a pose. opts: { clip, time, view, grid, outline, highlight: Set(nodeName), silhouette: true (mask only), bg }
function render(model, opts) {
  const view = Object.assign({ w: 400, h: 300 }, opts.view || {}), F = opts.frame || frameInfo(model), C = camera(model, view, F), T = makeTarget(view.w, view.h);
  const day = opts.bg !== 'dark';
  const top = day ? [0.86, 0.89, 0.93] : [0.09, 0.10, 0.12], bot = day ? [0.95, 0.96, 0.97] : [0.14, 0.15, 0.18];
  for (let y = 0; y < T.h; y++) for (let x = 0; x < T.w; x++) { const k = y / T.h, i = (y * T.w + x) * 3; for (let c = 0; c < 3; c++) T.col[i + c] = top[c] + (bot[c] - top[c]) * k; }
  const meshes = MD.posedMeshes(model, opts.clip || null, opts.time || 0);
  // floor with a metric grid
  if (opts.grid !== false && !opts.silhouette && model.ground) {
    const R = F.radius * 3, step = gridStep(F.radius), y0 = 0, gc = day ? [0.80, 0.82, 0.85] : [0.17, 0.18, 0.21], lc = day ? [0.66, 0.69, 0.74] : [0.26, 0.28, 0.33], mc = day ? [0.55, 0.58, 0.64] : [0.36, 0.39, 0.45];
    const cx = F.B.center[0], cz = F.B.center[2];
    const fp = F.B, shadow = (x, z) => { const dx = Math.max(fp.lo[0] - x, 0, x - fp.hi[0]), dz = Math.max(fp.lo[2] - z, 0, z - fp.hi[2]); return 1 - 0.35 * Math.exp(-Math.hypot(dx, dz) / (F.radius * 0.25)); };
    const shadeFloor = p => {
      const pix = C.ortho ? 1 / C.scale : (dot(sub(p, C.pos), C.f) / C.focal);
      const near = (q, s) => { const m = ((q % s) + s) % s; return Math.min(m, s - m) < pix * 0.7; };
      const major = near(p[0], step * 5) || near(p[2], step * 5), minor = near(p[0], step) || near(p[2], step), sh = shadow(p[0], p[2]);
      const base = major ? mc : minor ? lc : gc; return base.map(c => c * sh);
    };
    if (!C.ortho || view.ortho === 'top') {
      // perspective floor: perspective-correct position via per-pixel ray cast
      for (let y = 0; y < T.h; y++) for (let x = 0; x < T.w; x++) {
        let o, d;
        if (C.ortho) { o = add(add(C.pos, mul(C.r, (x + 0.5 - T.w / 2) / C.scale)), mul(C.up, -(y + 0.5 - T.h / 2) / C.scale)); d = C.f; }
        else { o = C.pos; d = unit(add(add(mul(C.f, C.focal), mul(C.r, x + 0.5 - T.w / 2)), mul(C.up, -(y + 0.5 - T.h / 2)))); }
        if (Math.abs(d[1]) < 1e-6) continue; const s = (y0 - o[1]) / d[1]; if (s <= 0) continue;
        const p = add(o, mul(d, s)); if (Math.abs(p[0] - cx) > R || Math.abs(p[2] - cz) > R) continue;
        const i = y * T.w + x, z = C.ortho ? dot(sub(p, C.pos), C.f) : dot(sub(p, C.pos), C.f);
        const col = shadeFloor(p), fade = C.ortho ? 1 : Math.max(0, 1 - Math.hypot(p[0] - cx, p[2] - cz) / R);
        T.z[i] = z + 1e-4; for (let c = 0; c < 3; c++) T.col[i * 3 + c] = T.col[i * 3 + c] * (1 - fade) + col[c] * fade;
      }
    } else {
      const gy = Math.round(project(C, [cx, y0, cz])[1]);             // side-on blueprint: draw the ground line
      for (let y = Math.max(0, gy); y < Math.min(T.h, gy + 2); y++) for (let x = 0; x < T.w; x++) { const i = (y * T.w + x) * 3; for (let c = 0; c < 3; c++) T.col[i + c] = mc[c]; }
    }
  }
  // meshes
  meshes.forEach((m, mi) => {
    const n = m.node, hi = opts.highlight && opts.highlight.has(n.name), base = hi ? [1, 0.35, 0.2] : n.color, em = n.material.emissive;
    for (const t of m.tris) {
      const A = m.pos[t[0]], B = m.pos[t[1]], Cc = m.pos[t[2]], nr = cross(sub(B, A), sub(Cc, A)), L = M.len(nr); if (L < 1e-14) continue;
      const nn = mul(nr, 1 / L), cen = mul(add(add(A, B), Cc), 1 / 3), toEye = C.ortho ? mul(C.f, -1) : unit(sub(C.pos, cen));
      if (dot(nn, toEye) < -1e-6 && !opts.twoSided) continue;      // back-face cull: inside-out parts render as holes, which the checks also catch
      let col;
      if (opts.silhouette) col = [1, 1, 1];
      else {
        const k = 0.42 + 0.55 * Math.max(0, dot(nn, LIGHT)) + 0.12 * Math.max(0, dot(nn, FILL)) + 0.06 * Math.max(0, nn[1]);
        col = base.map((c, i) => Math.min(1.2, c * k + (em ? em[i] * 0.8 : 0)));
      }
      raster(T, project(C, A), project(C, B), project(C, Cc), mi, () => col);
    }
  });
  if (opts.outline !== false && !opts.silhouette) outline(T, day);
  return { T, C, F };
}
function gridStep(radius) { const steps = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]; return steps.find(s => (radius * 2) / s <= 14) || 10; }
function outline(T, day) {                         // dark line where the object id or depth jumps
  const { w, h, z, id, col } = T, ink = day ? [0.16, 0.17, 0.2] : [0.02, 0.02, 0.03], out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x; if (id[i] < 0) { for (const j of [i - 1, i + 1, i - w, i + w]) if (id[j] >= 0) { out[i] = 2; break; } continue; }
    for (const j of [i - 1, i + 1, i - w, i + w]) if (id[j] !== id[i] && id[j] >= 0 && z[j] > z[i] * 1.02) { out[i] = 1; break; }
  }
  for (let i = 0; i < w * h; i++) if (out[i]) for (let c = 0; c < 3; c++) col[i * 3 + c] = out[i] === 2 ? ink[c] : col[i * 3 + c] * 0.55;
}
function toRGBA(T, sheet, ox, oy, SW) {
  for (let y = 0; y < T.h; y++) for (let x = 0; x < T.w; x++) {
    const i = y * T.w + x, o = ((oy + y) * SW + ox + x) * 4;
    for (let c = 0; c < 3; c++) sheet[o + c] = Math.max(0, Math.min(255, Math.round(T.col[i * 3 + c] * 255)));
    sheet[o + 3] = 255;
  }
}
// 0/1 mask of the model seen from an orthographic view, cropped to its bounding box.
function silhouette(model, viewName, size, clip, time) {
  const r = render(model, { view: { ortho: viewName, w: size, h: size }, silhouette: true, grid: false, clip, time });
  const mask = new Uint8Array(size * size); for (let i = 0; i < mask.length; i++) mask[i] = r.T.id[i] >= 0 ? 1 : 0;
  return { mask, w: size, h: size };
}

// ---- sheets --------------------------------------------------------------------------------------
function sheet(cells, cols, tw, th, title) {
  const rows = Math.ceil(cells.length / cols), gap = 6, head = title ? 30 : 0, SW = cols * tw + (cols + 1) * gap, SH = rows * th + (rows + 1) * gap + head;
  const img = new Uint8Array(SW * SH * 4); for (let i = 0; i < SW * SH; i++) { img[i * 4] = 38; img[i * 4 + 1] = 42; img[i * 4 + 2] = 50; img[i * 4 + 3] = 255; }
  if (title) text(img, SW, gap + 4, 8, title, 3);
  cells.forEach((cell, k) => {
    const ox = gap + (k % cols) * (tw + gap), oy = head + gap + Math.floor(k / cols) * (th + gap);
    toRGBA(cell.T, img, ox, oy, SW);
    (cell.labels || []).forEach((l, j) => text(img, SW, ox + 6, oy + 6 + j * 14, l, 2, [40, 44, 52]));
    (cell.footer || []).forEach((l, j) => text(img, SW, ox + 6, oy + th - 16 - j * 14, l, 2, [40, 44, 52]));
  });
  return png(SW, SH, img);
}
const fmt = v => (v >= 1 ? v.toFixed(2) : v.toFixed(3)) + 'M';
function modelSheet(model) {
  const F = frameInfo(model), cam = model.camera || {}, tw = 400, th = 320, B = F.B, cells = [];
  const persp = [[cam.yaw == null ? 35 : cam.yaw, cam.pitch == null ? 22 : cam.pitch, '3/4 FRONT'], [(cam.yaw == null ? 35 : cam.yaw) + 180, 25, '3/4 BACK'], [-60, 8, 'LOW LEFT']];
  for (const [yaw, pitch, lab] of persp) cells.push(Object.assign(render(model, { view: { yaw, pitch, w: tw, h: th, dist: cam.dist }, frame: F }), { labels: [lab] }));
  const dims = { front: [`W ${fmt(B.size[0])}`, `H ${fmt(B.size[1])}`], side: [`D ${fmt(B.size[2])}`, `H ${fmt(B.size[1])}`], top: [`W ${fmt(B.size[0])}`, `D ${fmt(B.size[2])}`] };
  for (const v of ['front', 'side', 'top']) cells.push(Object.assign(render(model, { view: { ortho: v, w: tw, h: th }, frame: F }), { labels: [v.toUpperCase() + (v === 'side' ? ' (FRONT ->)' : v === 'top' ? ' (FRONT DOWN)' : '')], footer: [dims[v].join('  '), `GRID ${gridStep(F.radius)}M`] }));
  return sheet(cells, 3, tw, th, `${model.name}  ${triCount(model)} TRIS  ${model.nodes.length - 1} PARTS`);
}
function clipSheet(model, clip, frames) {
  const F = frameInfo(model), cam = model.camera || {}, n = frames || 8, cells = [], tw = 320, th = 260;
  for (let i = 0; i < n; i++) {
    const t = clip.loop ? (i / n) * clip.duration : (i / (n - 1)) * clip.duration;
    cells.push(Object.assign(render(model, { clip, time: t, view: { yaw: cam.yaw == null ? 35 : cam.yaw, pitch: cam.pitch == null ? 22 : cam.pitch, w: tw, h: th, dist: (cam.dist || 1) * 1.1 }, frame: F }), { labels: [t.toFixed(2) + 'S'] }));
  }
  if (clip.sideView !== false) {
    // a second row from the side shows motion in the other plane (swim waves, lid arcs)
    for (let i = 0; i < n; i += 2) {
      const t = clip.loop ? (i / n) * clip.duration : (i / (n - 1)) * clip.duration;
      cells.push(Object.assign(render(model, { clip, time: t, view: { ortho: 'top', w: tw, h: th }, frame: F }), { labels: ['TOP ' + t.toFixed(2) + 'S'] }));
    }
  }
  return sheet(cells, 4, tw, th, `${model.name} / ${clip.name}  ${clip.duration}S ${clip.loop ? 'LOOP' : 'ONCE'}`);
}
const triCount = model => model.nodes.reduce((s, n) => s + (n.mesh ? n.mesh.tris.length : 0), 0);

module.exports = { png, text, textWidth, render, silhouette, camera, project, frameInfo, modelSheet, clipSheet, sheet, makeTarget, toRGBA, triCount, gridStep, VIEWS };
