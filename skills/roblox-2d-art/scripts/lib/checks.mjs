// Automatic checks: Roblox upload rules (size, aspect, opacity, circle crop, safe zones, file size) and readability
// heuristics (edges cut off, fill, value contrast, separation from the background, small-size clutter, palette,
// 9-slice stretch bands, seamless tiling) plus consistency across a set. Numbers are reported so they can be judged;
// the review sheet is where the final call is made.
import * as R from './raster.mjs';
import * as C from './color.mjs';

const pct = v => (v * 100).toFixed(1) + '%';
export function runChecks({ a, img8, design, mainA, silA, frontA, backA, bytes, palette, slice, sheet }) {
  const K = a.K, out = [], add = (level, name, msg) => out.push({ level, name, msg });
  const { w, h, rgba } = img8, n = w * h, A = new Float32Array(n);
  for (let i = 0; i < n; i++) A[i] = rgba[i * 4 + 3] / 255;
  const isPixel = !!(a.pixel || a.pixels);

  // ---- Roblox rules ----
  if (K.name === 'game-icon') { if (w !== h) add('FAIL', 'square', `game icons must be square (is ${w}x${h})`); else if (w < (K.minSide || 512)) add('WARN', 'size', `icon is ${w}px; upload at least 512x512`); else add('PASS', 'size', `${w}x${h}`); }
  else if (K.name === 'thumbnail') { const r = w / h; if (Math.abs(r - 16 / 9) > 0.01) add('FAIL', 'aspect', `thumbnails must be 16:9 (is ${r.toFixed(3)}); other ratios get stretched`); else if (w !== 1920) add('WARN', 'size', `${w}x${h}: 1920x1080 is the recommended size`); else add('PASS', 'size', '1920x1080, 16:9'); }
  else if (K.circle) { if (w !== h) add('FAIL', 'square', `${K.name} icons are square templates (is ${w}x${h})`); else if (K.maxSide && w > K.maxSide) add('FAIL', 'size', `${K.name} icons must not exceed ${K.maxSide}x${K.maxSide} (is ${w})`); else add('PASS', 'size', `${w}x${h}`); }
  else if (K.maxSide && Math.max(w, h) > K.maxSide && !isPixel) add('WARN', 'size', `${w}x${h}: keep in-game images at or under ${K.maxSide} px a side (larger ones are downscaled)`);
  if (K.maxBytes && bytes > K.maxBytes) add('FAIL', 'file size', `${(bytes / 1e6).toFixed(2)} MB; keep under ${(K.maxBytes / 1e6).toFixed(0)} MB (save as JPEG or simplify gradients)`);
  let transparent = 0; for (let i = 0; i < n; i++) if (A[i] < 0.999) transparent++;
  if (K.opaque && transparent) add(transparent / n > 0.002 ? 'FAIL' : 'WARN', 'opaque', `${pct(transparent / n)} of pixels are transparent; this kind is shown on a coloured tile: add a background layer (stage: "back")`);
  else if (K.transparent && !transparent) add('WARN', 'transparent', 'no transparent pixels: in-game icons usually need a transparent background');
  else add('PASS', 'background', K.opaque ? 'fully opaque' : 'transparent background, alpha bleed applied (no dark fringes when Roblox scales it)');

  // ---- composition ----
  if ((K.transparent || isPixel) && !a.pixels) {   // hand-placed pixel grids are exactly what the author drew
    let edge = 0; for (let x = 0; x < w; x++) { if (A[x] > 0.1) edge++; if (A[(h - 1) * w + x] > 0.1) edge++; } for (let y = 0; y < h; y++) { if (A[y * w] > 0.1) edge++; if (A[y * w + w - 1] > 0.1) edge++; }
    if (edge > 0 && !a.slice && !a.tile) add('FAIL', 'cut off', `${edge} pixels touch the canvas edge: an outline, shadow or part is clipped. Use fit, shrink the art or add padding`);
    const bb = R.bbox(A, w, h, 0.1);
    if (bb && a.fit !== null && !a.slice) { const f = Math.max(bb.w / w, bb.h / h); add(f < 0.6 ? 'WARN' : f > 0.97 ? 'WARN' : 'PASS', 'fill', `subject spans ${pct(f)} of the canvas${f < 0.6 ? ' (small: it will read tiny in a slot)' : f > 0.97 ? ' (no breathing room)' : ''}`); }
  }
  if (K.circle) {   // detail outside the circle Roblox crops to
    // what matters is the subject and the front layers (text, rims): background rays may run into the corners
    const g = detailMap(rgba, w, h), r = (K.circleSafe || 0.47) * w, cx = w / 2, cy = h / 2; let tot = 0, outside = 0;
    const imp = silA || mainA ? R.blur(Float32Array.from({ length: n }, (_, i) => Math.max((silA || mainA)[i], frontA ? frontA[i] : 0)), w, h, 2) : null;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x, v = g[i] * (imp ? Math.min(1, imp[i] * 1.5) : 1); tot += v; if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) outside += v; }
    const f = outside / (tot || 1); add(f > 0.1 ? 'FAIL' : f > 0.04 ? 'WARN' : 'PASS', 'circle crop', `${pct(f)} of the detail is outside the ${Math.round(r * 2)} px circle Roblox keeps${f > 0.04 ? ': pull text and important parts inward' + (imp ? '' : ' (flat image: background detail such as rays counts too, so judge it on the review sheet)') : ''}`);
  }
  if (K.safe && frontA) {
    const yb = Math.floor(h * (1 - K.safe.bottom)), m = Math.floor(Math.min(w, h) * K.safe.edge); let inBottom = 0, inEdge = 0, tot = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = frontA[y * w + x]; if (v < 0.5) continue; tot++; if (y >= yb) inBottom++; else if (x < m || x >= w - m || y < m) inEdge++; }
    if (tot) add(inBottom / tot > 0.02 ? 'WARN' : 'PASS', 'safe zone', inBottom / tot > 0.02 ? `${pct(inBottom / tot)} of the front layers (title text, badges) sit in the bottom ${pct(K.safe.bottom)}, which the player-count bar can cover` : 'front layers clear of the bottom band');
    if (tot && inEdge / tot > 0.02) add('WARN', 'edge margin', `${pct(inEdge / tot)} of the front layers are within ${m}px of the frame edge`);
  }
  // ---- readability ----
  const subj = new Uint8Array(n); let ns = 0;
  for (let i = 0; i < n; i++) if ((mainA ? mainA[i] > 0.5 : A[i] > 0.5)) { subj[i] = 1; ns++; }
  if (ns > 50 && !isPixel && !['particle', 'texture', 'panel', 'banner'].includes(K.name)) {
    const Ls = []; for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 40000))) if (subj[i]) Ls.push(C.oklab([rgba[i * 4] / 255, rgba[i * 4 + 1] / 255, rgba[i * 4 + 2] / 255])[0]);
    Ls.sort((p, q) => p - q); const spread = Ls[Math.floor(Ls.length * 0.95)] - Ls[Math.floor(Ls.length * 0.05)];
    add(spread < 0.28 ? 'WARN' : 'PASS', 'value range', `subject lightness spans ${spread.toFixed(2)} (OKLab L, 5-95%)${spread < 0.28 ? ': flat values read as a blob at small size; add darker shadows / lighter highlights or an outline' : ''}`);
  }
  if (mainA && backA && ns > 50 && !isPixel) {   // subject (with its outline) vs what is right behind it
    let bgN = 0; for (let i = 0; i < n; i++) if (backA[i] > 0.5) bgN++;
    const S = silA || mainA;
    if (bgN > n * 0.3) {
      const { dOut, dIn } = R.edgeDistances(S, w, h), band = Math.max(3, w / 80); let si = [0, 0, 0, 0], bo = [0, 0, 0, 0];
      for (let i = 0; i < n; i++) {
        const acc = S[i] > 0.5 && dIn[i] < band ? si : S[i] < 0.05 && dOut[i] < band * 2 && dOut[i] > 1 ? bo : null; if (!acc) continue;
        const lab = C.oklab([rgba[i * 4] / 255, rgba[i * 4 + 1] / 255, rgba[i * 4 + 2] / 255]); acc[0] += lab[0]; acc[1] += lab[1]; acc[2] += lab[2]; acc[3]++;
      }
      if (si[3] && bo[3]) { const dE = Math.hypot(si[0] / si[3] - bo[0] / bo[3], si[1] / si[3] - bo[1] / bo[3], si[2] / si[3] - bo[2] / bo[3]), dL = Math.abs(si[0] / si[3] - bo[0] / bo[3]); add(dE < 0.12 ? 'WARN' : 'PASS', 'separation', `subject edge vs background: dE ${dE.toFixed(2)}, dL ${dL.toFixed(2)}${dE < 0.12 ? ': the subject blends into the background; darken/lighten the background behind it, add an outline or a glow' : ''}`); }
    }
  }
  if (design && K.preview && K.preview.length && !isPixel) {   // clutter at the smallest size it is shown
    const p = K.preview[K.preview.length - 1], [sw, sh] = Array.isArray(p) ? p : [p, Math.round(p * h / w)], small = R.toRGBA8(R.resize(design, sw, sh)), g = detailMap(small.rgba, sw, sh, false);
    let busy = 0, cnt = 0;   // interior pixels only: the silhouette edge itself is not clutter
    for (let y = 1; y < sh - 1; y++) for (let x = 1; x < sw - 1; x++) { const i = y * sw + x; let solid = true; for (const j of [i - 1, i + 1, i - sw, i + sw, i - sw - 1, i - sw + 1, i + sw - 1, i + sw + 1]) if (small.rgba[j * 4 + 3] < 250) { solid = false; break; } if (!solid) continue; cnt++; if (g[i] > 0.15) busy++; }
    if (cnt >= 30) { const f = busy / cnt; add(f > 0.5 ? 'WARN' : 'PASS', 'small size', `${pct(f)} of pixels are high-contrast edges at ${sw}x${sh}${f > 0.5 ? ': cluttered when small; merge small details, thicken lines, simplify' : ''}`); }
  }
  if (palette) add(palette.length > 32 ? 'WARN' : 'PASS', 'palette', `${palette.length} colours${palette.length > 32 ? ' (pixel art usually stays under 32)' : ''}`);
  if (slice) out.push(sliceCheck(rgba, w, h, slice.insets));
  if (a.tile) out.push(tileCheck(rgba, w, h));
  if (sheet && Math.max(sheet.w, sheet.h) > 1024) add('WARN', 'sheet size', `${sheet.w}x${sheet.h}: over 1024 px gets downscaled; use fewer or smaller frames, or split the sheet`);
  return out;
}

// Local contrast map: OKLab gradient magnitude (+ alpha edges), 0..~1.
function detailMap(rgba, w, h, withAlpha = true) {
  const L = new Float32Array(w * h), g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { const a = rgba[i * 4 + 3] / 255; L[i] = C.oklab([rgba[i * 4] / 255, rgba[i * 4 + 1] / 255, rgba[i * 4 + 2] / 255])[0] * a + (withAlpha ? 0 : 0); }
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; g[i] = Math.hypot(L[i + 1] - L[i - 1], L[i + w] - L[i - w]) * 0.5 + (withAlpha ? Math.abs(rgba[(i + 1) * 4 + 3] - rgba[(i - 1) * 4 + 3]) / 255 * 0.25 : 0); }
  return g;
}
function sliceCheck(rgba, w, h, [l, t, r, b]) {
  const lab = i => C.oklab([rgba[i * 4] / 255, rgba[i * 4 + 1] / 255, rgba[i * 4 + 2] / 255]).concat(rgba[i * 4 + 3] / 255);
  const diff = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * Math.min(p[3], q[3]) + Math.abs(p[3] - q[3]);
  let worst = 0;
  for (let y = 0; y < h; y++) { const ref = lab(y * w + l); for (let x = l; x < w - r; x++) worst = Math.max(worst, diff(ref, lab(y * w + x))); }   // stretched horizontally: rows constant
  for (let x = 0; x < w; x++) { const ref = lab(t * w + x); for (let y = t; y < h - b; y++) worst = Math.max(worst, diff(ref, lab(y * w + x))); }   // stretched vertically: columns constant
  if (l + r >= w || t + b >= h) return { level: 'FAIL', name: '9-slice', msg: `insets ${[l, t, r, b]} leave no centre on a ${w}x${h} image` };
  return worst > 0.06 ? { level: 'WARN', name: '9-slice', msg: `the stretch bands are not uniform (max dE ${worst.toFixed(2)}): gradients or details between the corners will smear when stretched; keep them inside the corners` } : { level: 'PASS', name: '9-slice', msg: `SliceCenter Rect.new(${l}, ${t}, ${w - r}, ${h - b}): stretch bands uniform` };
}
function tileCheck(rgba, w, h) {
  const lab = i => C.oklab([rgba[i * 4] / 255, rgba[i * 4 + 1] / 255, rgba[i * 4 + 2] / 255]); let s = 0, c = 0;
  for (let y = 0; y < h; y++) { const p = lab(y * w), q = lab(y * w + w - 1); s += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); c++; }
  for (let x = 0; x < w; x++) { const p = lab(x), q = lab((h - 1) * w + x); s += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); c++; }
  const m = s / c; return { level: m > 0.06 ? 'WARN' : 'PASS', name: 'seamless', msg: `mean edge mismatch dE ${m.toFixed(3)}${m > 0.06 ? ': visible seams when tiled; draw with k.tile() so shapes wrap around' : ''}` };
}

// Consistency across a set of the same kind: size in the frame, lightness, saturation.
export function setChecks(results) {
  const out = [], groups = {};
  for (const r of results) if (!r.pixel && r.img8) (groups[r.kind] ||= []).push(r);
  for (const [kind, rs] of Object.entries(groups)) {
    if (rs.length < 3) continue;
    const stats = rs.map(r => { const { w, h, rgba } = r.img8, A = new Float32Array(w * h); for (let i = 0; i < w * h; i++) A[i] = rgba[i * 4 + 3] / 255; const bb = R.bbox(r.mainA || A, w, h, 0.1); let L = 0, Cc = 0, k = 0; for (let i = 0; i < w * h; i += 7) if ((r.mainA ? r.mainA[i] : A[i]) > 0.5) { const l = C.oklch([rgba[i * 4] / 255, rgba[i * 4 + 1] / 255, rgba[i * 4 + 2] / 255]); L += l[0]; Cc += l[1]; k++; } return { name: r.name, area: bb ? (bb.w * bb.h) / (w * h) : 0, L: L / (k || 1), C: Cc / (k || 1) }; });
    const med = key => { const v = stats.map(s => s[key]).sort((p, q) => p - q); return v[v.length >> 1]; }, mA = med('area'), mL = med('L'), mC = med('C');
    const odd = stats.filter(s => s.area < mA * 0.6 || s.area > mA * 1.6).map(s => `${s.name} ${(s.area / mA).toFixed(2)}x`);
    out.push({ level: odd.length ? 'WARN' : 'PASS', name: `${kind} set size`, msg: odd.length ? `visual size differs from the rest: ${odd.join(', ')} (median box area ${pct(mA)})` : `all ${rs.length} fill the frame alike` });
    const dark = stats.filter(s => Math.abs(s.L - mL) > 0.18).map(s => `${s.name} L ${s.L.toFixed(2)}`);
    if (dark.length) out.push({ level: 'WARN', name: `${kind} set value`, msg: `much lighter/darker than the set (median L ${mL.toFixed(2)}): ${dark.join(', ')}` });
    const dull = stats.filter(s => Math.abs(s.C - mC) > 0.09).map(s => `${s.name} C ${s.C.toFixed(2)}`);
    if (dull.length) out.push({ level: 'WARN', name: `${kind} set saturation`, msg: `saturation stands out (median ${mC.toFixed(2)}): ${dull.join(', ')}` });
  }
  return out;
}
