// Graphic-design analysis of composed images (thumbnails, banners, game icons, badges, passes, logos): where the eye
// lands first (a centre-surround attention map, the classic saliency model), balance of visual weight, the value plan
// (3-value notan), colour proportions (60-30-10) and harmony, saturation hierarchy, text size / contrast / type scale,
// and tangents (shapes that nearly touch the frame or each other). The numbers feed checks and the review sheet's
// composition row; references/graphic-design.md explains the theory behind each one.
import * as R from './raster.mjs';
import * as C from './color.mjs';
import { SURFACES } from './presets.mjs';

export const COMPOSED = new Set(['thumbnail', 'banner', 'game-icon', 'badge', 'pass', 'product']);
export const TEXTUAL = new Set([...COMPOSED, 'logo']);
const MAXS = 320;            // analysis resolution (long side)
const CAP = 0.7;             // cap height / font size of display faces
const pct = v => Math.round(v * 100) + '%';

// blur that does not darken toward the borders (the raster blur pads with zeros)
function nblur(arr, w, h, s, ones) { const a = R.blur(arr, w, h, s), o = ones || R.blur(new Float32Array(w * h).fill(1), w, h, s); for (let i = 0; i < a.length; i++) a[i] /= Math.max(1e-6, o[i]); return a; }

export const analysisSize = (W, H) => { const s = Math.min(1, MAXS / Math.max(W, H)); return [Math.max(8, Math.round(W * s)), Math.max(8, Math.round(H * s))]; };
// Downscale a layer's alpha (from a premultiplied float image) to the analysis grid.
export function maskOf(F, aw, ah) { return R.alpha(R.resize(F, aw, ah)); }

// OKLab planes of the image at analysis size; transparent pixels sit on the dark Roblox theme.
function planes(F) {
  const [w, h] = analysisSize(F.w, F.h), S = R.resize(F, w, h), n = w * h, bg = C.parse(SURFACES.dark);
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n), Ch = new Float32Array(n), Hu = new Float32Array(n), rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.min(1, S.d[i * 4 + 3]), r = S.d[i * 4] + (1 - a) * bg[0], g = S.d[i * 4 + 1] + (1 - a) * bg[1], b = S.d[i * 4 + 2] + (1 - a) * bg[2];
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
    const lab = C.oklab([Math.min(1, r), Math.min(1, g), Math.min(1, b)]); L[i] = lab[0]; A[i] = lab[1]; B[i] = lab[2];
    Ch[i] = Math.hypot(lab[1], lab[2]); Hu[i] = (Math.atan2(lab[2], lab[1]) * 180 / Math.PI + 360) % 360;
  }
  return { w, h, L, A, B, Ch, Hu, rgb };
}

// Attention: centre-surround differences of lightness and colour at two scales (what pops out of its surroundings),
// with a mild centre bias (people look at the middle first). raw = per pixel, smooth = blobs for peak finding.
function attention(P) {
  const { w, h, L, A, B } = P, n = w * h, diag = Math.hypot(w, h), S = new Float32Array(n), one = new Float32Array(n).fill(1), cache = {};
  const ones = s => cache[s] ||= R.blur(one, w, h, s);
  // the fine scale (edges, eyes, detail) counts more than the coarse one (big areas against their surroundings)
  for (const [c, s, wt] of [[0.006, 0.05, 1], [0.016, 0.13, 0.6]]) {
    const cs = Math.max(0.6, c * diag), ss = s * diag, Lc = nblur(L, w, h, cs, ones(cs)), Ls = nblur(L, w, h, ss, ones(ss)), Ac = nblur(A, w, h, cs, ones(cs)), As = nblur(A, w, h, ss, ones(ss)), Bc = nblur(B, w, h, cs, ones(cs)), Bs = nblur(B, w, h, ss, ones(ss));
    for (let i = 0; i < n; i++) S[i] += wt * (Math.abs(Lc[i] - Ls[i]) + 1.4 * Math.hypot(Ac[i] - As[i], Bc[i] - Bs[i]));
  }
  // centre bias, and border suppression: an area touching the frame only sees the image on one side, which inflates
  // its contrast with the surround (and people rarely fixate the very edge)
  const edge = 0.08 * Math.min(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const dx = (x + 0.5) / w - 0.5, dy = (y + 0.5) / h - 0.5, d = Math.min(x + 0.5, y + 0.5, w - x - 0.5, h - y - 0.5); S[y * w + x] *= (1 - 0.6 * (dx * dx + dy * dy)) * Math.min(1, 0.45 + 0.55 * d / edge); }
  const sm = nblur(S, w, h, 0.025 * diag);
  // peaks: greedy non-maximum suppression
  const peaks = [], taken = new Uint8Array(n), rad = 0.14 * diag;
  let top = 0;
  for (let k = 0; k < 4; k++) {
    let bi = -1, bv = 0; for (let i = 0; i < n; i++) if (!taken[i] && sm[i] > bv) { bv = sm[i]; bi = i; }
    if (bi < 0 || (k && bv < top * 0.4)) break; if (!k) top = bv;
    const px = bi % w, py = (bi / w) | 0; peaks.push({ x: (px + 0.5) / w, y: (py + 0.5) / h, v: bv / top, i: bi });
    const r = Math.ceil(rad);
    for (let y = Math.max(0, py - r); y < Math.min(h, py + r + 1); y++) for (let x = Math.max(0, px - r); x < Math.min(w, px + r + 1); x++) if (Math.hypot(x - px, y - py) < rad) taken[y * w + x] = 1;
  }
  return { raw: S, smooth: sm, peaks };
}

// Colour families: k-means in OKLab, then clusters merged by hue (chromatic) or by lightness (neutrals).
export const hueName = h => [[15, 'pink'], [40, 'red'], [70, 'orange'], [112, 'yellow'], [130, 'lime'], [165, 'green'], [190, 'teal'], [225, 'cyan'], [262, 'blue'], [285, 'indigo'], [315, 'violet'], [345, 'magenta'], [361, 'pink']].find(([e]) => h < e)[1];
export const isWarm = h => h < 115 || h >= 345;
function families(P) {
  const { w, h, L, A, B } = P, n = w * h, samples = [], step = n > 30000 ? 2 : 1;
  for (let i = 0; i < n; i += step) samples.push({ lab: [L[i], A[i], B[i]], w: 1 });
  const cl = C.kmeans(samples, 9, 10), chrom = [], neut = { dark: null, mid: null, light: null };
  for (const c of cl) {
    const Cc = Math.hypot(c.lab[1], c.lab[2]), hh = (Math.atan2(c.lab[2], c.lab[1]) * 180 / Math.PI + 360) % 360;
    if (Cc < 0.035) { const key = c.lab[0] < 0.45 ? 'dark' : c.lab[0] > 0.82 ? 'light' : 'mid'; const f = neut[key] ||= { name: { dark: 'near-black', mid: 'grey', light: 'near-white' }[key], neutral: true, share: 0, L: 0, C: 0, h: 0, members: [] }; f.members.push(c); }
    else chrom.push({ c, C: Cc, h: hh });
  }
  // merge chromatic clusters into hue families (single linkage around the wheel, 28 degree gaps)
  chrom.sort((p, q) => p.h - q.h); const groups = [];
  for (const e of chrom) { const g = groups[groups.length - 1]; if (g && e.h - g[g.length - 1].h <= 28) g.push(e); else groups.push([e]); }
  if (groups.length > 1 && groups[0][0].h + 360 - groups[groups.length - 1].slice(-1)[0].h <= 28) groups[0].unshift(...groups.pop());
  const fams = groups.map(g => { let sw = 0, sx = 0, sy = 0, sL = 0, sC = 0; for (const e of g) { sw += e.c.w; sx += Math.cos(e.h * Math.PI / 180) * e.c.w; sy += Math.sin(e.h * Math.PI / 180) * e.c.w; sL += e.c.lab[0] * e.c.w; sC += e.C * e.c.w; } const hh = (Math.atan2(sy, sx) * 180 / Math.PI + 360) % 360; return { name: hueName(hh), neutral: false, share: sw, L: sL / sw, C: sC / sw, h: hh, members: g.map(e => e.c) }; });
  for (const f of Object.values(neut)) if (f) { let sw = 0, sL = 0; for (const c of f.members) { sw += c.w; sL += c.lab[0] * c.w; } f.share = sw; f.L = sL / sw; fams.push(f); }
  for (const f of fams) { const m = f.members.slice().sort((p, q) => q.w - p.w)[0]; f.hex = m.hex; delete f.members; }
  return fams.sort((p, q) => q.share - p.share);
}
// Name the colour scheme formed by the chromatic families that matter (>= 4% of the image).
export function harmonyOf(hues) {
  const n = hues.length, d = (p, q) => { const x = Math.abs(p - q) % 360; return x > 180 ? 360 - x : x; };
  if (!n) return 'neutral (no strong hue)';
  if (n === 1) return 'monochromatic';
  const s = hues.slice().sort((p, q) => p - q), gaps = s.map((v, i) => (i + 1 < n ? s[i + 1] : s[0] + 360) - v), span = 360 - Math.max(...gaps);
  if (span <= 75) return 'analogous';
  if (n === 2) return d(s[0], s[1]) >= 140 ? 'complementary' : 'contrasting pair';
  if (n === 3) {
    if (gaps.every(g => g >= 90 && g <= 150)) return 'triadic';
    for (let i = 0; i < 3; i++) { const o = s.filter((_, j) => j !== i); if (d(o[0], o[1]) <= 75) { const mid = Math.atan2(Math.sin(o[0] * Math.PI / 180) + Math.sin(o[1] * Math.PI / 180), Math.cos(o[0] * Math.PI / 180) + Math.cos(o[1] * Math.PI / 180)) * 180 / Math.PI; if (d((mid + 360) % 360, s[i]) >= 140) return d(o[0], o[1]) >= 35 ? 'split-complementary' : 'analogous + complementary accent'; } }
    return 'three contrasting hues';
  }
  return span <= 120 ? 'analogous' : n >= 5 ? 'many hues' : 'tetradic';
}

// Parse the <text> elements of a layer's markup: what it says, size, font, fill / outline colours.
export function textsIn(markup, defs = '') {
  const out = new Map(), re = /<text\b([^>]*)>([\s\S]*?)<\/text>/g, at = (s, k) => { const m = s.match(new RegExp(`\\s${k}="([^"]*)"`)); return m ? m[1] : null; };
  let m; while ((m = re.exec(markup))) {
    const attrs = m[1], str = m[2].replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim(); if (!str) continue;
    const size = +(at(attrs, 'font-size') || 16), key = str + '|' + size, font = (at(attrs, 'font-family') || '').replace(/['"]/g, '').split(',')[0].trim();
    const e = out.get(key) || { str, size, font, fills: null, stroke: null, sw: 0 };
    if (!/\sopacity=|\sdy=/.test(attrs)) {   // the main fill layer (k.text also draws shadow / outer / shine copies)
      let fill = at(attrs, 'fill') || '#000000'; const g = fill.match(/url\(#([^)]+)\)/);
      if (g) { const def = defs.match(new RegExp(`<(?:linear|radial)Gradient id="${g[1]}"[\\s\\S]*?</(?:linear|radial)Gradient>`)); e.fills = def ? [...def[0].matchAll(/stop-color="([^"]+)"/g)].map(x => x[1]) : null; }
      else e.fills = [fill];
      e.stroke = at(attrs, 'stroke'); e.sw = +(at(attrs, 'stroke-width') || 0);
    }
    out.set(key, e);
  }
  return [...out.values()];
}

// Full analysis. F: final design image (premultiplied float). layers: [{ name, stage, role, text, mask, bbox, texts, scale }]
export function analyze(F, { a, layers = [], outlineWidth = 0 } = {}) {
  const P = planes(F), { w, h, L, Ch } = P, n = w * h, att = attention(P), K = a.K, sx = w / a.W;
  // ownership: which layer is on top at each analysis pixel (main layers grow by the asset outline, which wraps them)
  const owner = new Int16Array(n).fill(-1), grow = Math.max(0.6, outlineWidth * sx * 0.8);
  layers.forEach((Lr, li) => { if (!Lr.mask) return; const m = Lr.stage === 'main' && outlineWidth ? R.blur(Lr.mask, w, h, grow) : Lr.mask; for (let i = 0; i < n; i++) if (m[i] > (Lr.stage === 'main' && outlineWidth ? 0.18 : 0.45)) owner[i] = li; });
  const anyHero = layers.some(l => l.role === 'hero');
  const groupOf = li => { if (li < 0) return 'background'; const Lr = layers[li]; if (Lr.role === 'text' || Lr.role === 'title' || (Lr.text && Lr.stage === 'front')) return 'text'; if (Lr.role === 'hero' || (!anyHero && Lr.stage === 'main')) return 'hero'; if (Lr.stage === 'back' || Lr.role === 'bg') return 'background'; return 'support'; };
  const groups = layers.map((_, i) => groupOf(i)), gOf = i => owner[i] < 0 ? 'background' : groups[owner[i]];
  const share = { hero: 0, text: 0, support: 0, background: 0 }, area = { hero: 0, text: 0, support: 0, background: 0 }; let tot = 0;
  for (let i = 0; i < n; i++) { const g = gOf(i); share[g] += att.raw[i]; area[g]++; tot += att.raw[i]; }
  for (const g in share) { share[g] /= tot || 1; area[g] /= n; }
  const peakAt = p => { const li = owner[p.i]; return { ...p, layer: li >= 0 ? layers[li].name : null, group: gOf(p.i) }; };
  const peaks = att.peaks.map(peakAt);

  // balance: visual weight = attention + area of the foreground (size) + darkness and saturation (heavier)
  const meanS = tot / n || 1; let wx = 0, wy = 0, ws = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, fg = owner[i] >= 0 && layers[owner[i]].stage !== 'back' ? 1 : 0;
    const wt = att.raw[i] / meanS + 0.6 * fg + 0.25 * Math.min(1, Ch[i] / 0.15);
    wx += (x + 0.5) / w * wt; wy += (y + 0.5) / h * wt; ws += wt;
  }
  const balance = { x: wx / ws, y: wy / ws };

  // value plan (3-value notan) and full range
  const notanMap = new Uint8Array(n); const vs = [0, 0, 0];
  for (let i = 0; i < n; i++) { const v = L[i] < 0.48 ? 0 : L[i] < 0.74 ? 1 : 2; notanMap[i] = v; vs[v]++; }
  const values = { dark: vs[0] / n, mid: vs[1] / n, light: vs[2] / n };
  const Ls = Float32Array.from(L).sort(), valueRange = Ls[Math.floor(n * 0.97)] - Ls[Math.floor(n * 0.03)];

  // colour proportions and harmony
  const fams = families(P), chromatic = fams.filter(f => !f.neutral && f.share >= 0.04), harmony = harmonyOf(chromatic.map(f => f.h));
  let warm = 0, cool = 0; for (const f of fams) if (!f.neutral && f.C > 0.05) (isWarm(f.h) ? (warm += f.share) : (cool += f.share));

  // saturation hierarchy: subject vs background. The subject's own colours come from its interior (its layers'
  // masks), not the dark outline ring that ownership adds around it.
  const heroL = layers.filter((_, li) => groups[li] === 'hero'), core = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (gOf(i) === 'hero' && heroL.some(l => l.mask && l.mask[i] > 0.5)) core[i] = 1;
  let fgC = 0, fgN = 0, bgC = 0, bgN = 0;
  for (let i = 0; i < n; i++) { if (core[i]) { fgC += Ch[i]; fgN++; } else if (gOf(i) === 'background') { bgC += Ch[i]; bgN++; } }
  const sat = layers.length && fgN > n * 0.02 && bgN > n * 0.1 ? { subject: fgC / fgN, background: bgC / bgN } : null;
  // camouflage: how much of the area right around the subject has its hue AND its value (green slime on green grass)
  let camo = null;
  if (sat) {
    const sites = new Uint8Array(n); let hx = 0, hy = 0, hL = 0, hw = 0;
    for (let i = 0; i < n; i++) if (gOf(i) === 'hero') { sites[i] = 1; if (!core[i]) continue; const wt = Ch[i]; hx += Math.cos(P.Hu[i] * Math.PI / 180) * wt; hy += Math.sin(P.Hu[i] * Math.PI / 180) * wt; hL += L[i]; hw++; }
    hw = Math.max(1, hw);
    const hh = (Math.atan2(hy, hx) * 180 / Math.PI + 360) % 360, mL = hL / hw, dd = R.edt(sites, w, h).d, ring = 0.06 * Math.hypot(w, h);
    let rn = 0, same = 0; for (let i = 0; i < n; i++) if (!sites[i] && dd[i] < ring && gOf(i) === 'background') { rn++; const dh = Math.abs(((P.Hu[i] - hh) % 360 + 540) % 360 - 180); if (Ch[i] > 0.05 && dh < 30 && Math.abs(L[i] - mL) < 0.15) same++; }
    if (rn > 20 && Math.hypot(hx, hy) / hw > 0.05) camo = { share: same / rn, hue: hueName(hh) };
  }

  // text meant to be read: front-stage or role text / title layers (a "$" on a coin is a graphic, not copy)
  const texts = [];
  for (const Lr of layers) for (const t of Lr.texts || []) if (Lr.role === 'text' || Lr.role === 'title' || (Lr.stage === 'front' && /[\p{L}\p{N}]{2,}/u.test(t.str))) texts.push({ ...t, layer: Lr.name, px: t.size * (Lr.scale || 1) });
  // margins: readable copy and front elements keep a consistent distance from the frame edge
  const margins = [], m = 0.05 * Math.min(a.W, a.H);
  for (const Lr of layers) {
    if (!Lr.bbox || !(Lr.text || Lr.role === 'text' || Lr.role === 'title')) continue;
    const b = Lr.bbox, d = [['left', b.x0], ['top', b.y0], ['right', a.W - b.x1], ['bottom', a.H - b.y1]].filter(([, v]) => v > 0.5 && v < m);
    if (d.length) margins.push({ layer: Lr.name, sides: d.map(([s, v]) => `${s} ${Math.round(v)}px`) });
  }

  // tangents: layers whose box nearly touches the frame, and separate shapes that nearly touch each other
  const tangents = [], near = Math.max(3, 0.012 * Math.min(a.W, a.H));
  for (const Lr of layers) {
    if (Lr.stage === 'back' || !Lr.bbox || Lr.area < 0.004) continue;
    const b = Lr.bbox, sides = [['left', b.x0], ['top', b.y0], ['right', a.W - b.x1], ['bottom', a.H - b.y1]].filter(([, d]) => d > 0.5 && d <= near);
    if (sides.length) tangents.push({ kind: 'frame', layer: Lr.name, sides: sides.map(([s, d]) => `${s} ${Math.round(d)}px`) });
  }
  const big = layers.map((l, i) => ({ l, i })).filter(({ l }) => l.stage !== 'back' && l.mask && l.area >= 0.01).slice(0, 14);
  const ow = outlineWidth * sx, thr = Math.max(1, 0.008 * Math.min(w, h));
  const dist = big.map(({ l }) => { const s = new Uint8Array(n); for (let i = 0; i < n; i++) if (l.mask[i] > 0.5) s[i] = 1; return R.edt(s, w, h).d; });
  for (let p = 0; p < big.length; p++) for (let q = p + 1; q < big.length; q++) {
    const A_ = big[p].l, B_ = big[q].l; if (!(A_.text || B_.text || A_.role === 'hero' || B_.role === 'hero' || (A_.stage === 'main' && B_.stage === 'main'))) continue;
    let gap = Infinity, overlap = 0; for (let i = 0; i < n; i++) if (B_.mask[i] > 0.5) { if (A_.mask[i] > 0.5) overlap++; else gap = Math.min(gap, dist[p][i]); }
    if (overlap > 2 || gap === Infinity) continue;
    const fused = (A_.stage === 'main') + (B_.stage === 'main'), limit = fused * ow + thr;   // main shapes share the asset outline
    if (gap > 0.5 && gap <= limit + 1) tangents.push({ kind: 'pair', layer: A_.name, other: B_.name, gap: gap / sx });
  }
  return { w, h, rgb: P.rgb, L, attention: att, peaks, share, area, balance, values, notanMap, valueRange, families: fams, chromatic, harmony, warm, cool, sat, camo, texts, margins, marginPx: m, tangents, hasLayers: layers.length > 0, anyHero };
}

// Checks from the analysis. Levels: WARN for design problems (they are judgement calls), PASS with the numbers.
export function designChecks(D, a) {
  const K = a.K, out = [], add = (level, name, msg) => out.push({ level, name, msg }), composed = COMPOSED.has(K.name), wide = a.W / a.H > 1.3, P = D.peaks[0];
  const where = p => `${pct(p.x)}, ${pct(p.y)}`;
  if (composed && P) {
    const on = P.layer ? `layer "${P.layer}"` : 'the background';
    if (D.hasLayers && !['hero', 'text'].includes(P.group)) add('WARN', 'focal point', `the eye lands first on ${on} at ${where(P)}${D.anyHero ? ', not the hero' : ', not the subject'}: give the hero the strongest value and colour contrast in the image, and calm what is there (lower contrast, less saturation, smaller)`);
    else add('PASS', 'focal point', `the eye lands first on ${P.layer ? `"${P.layer}"` : 'the area'} at ${where(P)}${D.peaks[1] ? `, then ${D.peaks[1].layer ? `"${D.peaks[1].layer}"` : 'the area'} at ${where(D.peaks[1])}` : ''}`);
    // rivals: strong image areas far from the lead, one per layer; parts of a declared hero never rival each other
    const lead = D.peaks.find(p => p.group !== 'text'), seen = new Set([lead && lead.layer]), rivals = [];
    for (const p of lead ? D.peaks : []) {
      if (p === lead || p.v < lead.v * 0.78 || p.group === 'text' || seen.has(p.layer) || Math.hypot((p.x - lead.x) * a.W / a.H, p.y - lead.y) <= 0.25) continue;
      if (D.anyHero && p.group === 'hero' && lead.group === 'hero') continue;
      seen.add(p.layer); rivals.push(p);
    }
    if (lead && rivals.length) { add('WARN', 'hierarchy', `${rivals.length + 1} areas pull the eye about equally (${[lead, ...rivals].map(p => `"${p.layer || 'background'}" ${where(p)}`).join(' vs ')}): make one clearly dominant (bigger, more contrast, more saturated) and quieten the others (smaller, lower contrast, partly behind the hero)`); }
    else if (lead) add('PASS', 'hierarchy', `one dominant image area ("${lead.layer || 'background'}"), others clearly secondary`);
    if (D.hasLayers && D.area.background > 0.15) {
      const dens = D.share.background / D.area.background, fgDens = (D.share.hero + D.share.text + D.share.support) / Math.max(0.01, 1 - D.area.background);
      add(dens > fgDens * 0.75 ? 'WARN' : 'PASS', 'figure / ground', `background holds ${pct(D.share.background)} of the attention on ${pct(D.area.background)} of the area${dens > fgDens * 0.75 ? ': it is as busy as the subject. Lower its contrast (fewer, softer rays and patterns), push it darker or lighter than the subject, blur or desaturate it' : ''}`);
    }
    const dx = D.balance.x - 0.5, dy = D.balance.y - 0.5, lim = wide ? 0.13 : 0.09;
    add(Math.abs(dx) > lim || Math.abs(dy) > lim + 0.05 ? 'WARN' : 'PASS', 'balance', `visual weight centres at ${where(D.balance)}${Math.abs(dx) > lim ? `: ${dx < 0 ? 'left' : 'right'}-heavy; move the hero toward the centre third or counter it with a smaller, bright element on the ${dx < 0 ? 'right' : 'left'}` : Math.abs(dy) > lim + 0.05 ? `: ${dy < 0 ? 'top' : 'bottom'}-heavy; ${dy > 0 ? 'lift the subject or lighten the ground' : 'anchor the bottom with a darker ground or a base shape'}` : ' (balanced)'}`);
    const v = D.values, maxV = Math.max(v.dark, v.mid, v.light), dom = v.dark === maxV ? 'dark' : v.mid === maxV ? 'mid' : 'light';
    add(maxV < 0.42 ? 'WARN' : 'PASS', 'value plan', `dark ${pct(v.dark)} / mid ${pct(v.mid)} / light ${pct(v.light)}${maxV < 0.42 ? ': no value dominates, so the image reads busy at a glance. Let one value group (usually the background, dark or light) take about half the frame and keep the strongest light-dark contrast at the focal point' : ` (${dom} dominates)`}`);
    if (D.valueRange < 0.45) add('WARN', 'value range', `the whole image spans only ${D.valueRange.toFixed(2)} in lightness: add true darks (outlines, shadows, a darker ground) and true lights (highlights, glow behind the focal point)`);
    const f = D.families, top = f[0], chrom = D.chromatic;
    const prop = f.slice(0, 4).map(x => `${x.name} ${pct(x.share)}`).join(' / ');
    if (top && top.share < 0.33) add('WARN', 'colour proportion', `${prop}: no colour family dominates. Give one family (usually the background) about 60%, a second about 30%, and keep the loudest colour to about 10%`);
    else add('PASS', 'colour proportion', `${prop} (aim for roughly 60 / 30 / 10)`);
    const loud = chrom.slice().sort((p, q) => q.C - p.C)[0];
    if (loud && wide && loud.share > 0.4 && loud.C > 0.13) add('WARN', 'accent', `the most saturated colour (${loud.name}) covers ${pct(loud.share)} of the frame: saturated colour is heavy (contrast of extension); keep it to the hero and accents and make the large areas calmer`);
    add(chrom.length >= 5 ? 'WARN' : 'PASS', 'harmony', `${D.harmony}: ${chrom.map(x => x.name).join(', ') || 'neutrals'}${D.warm + D.cool > 0.2 ? `; warm ${pct(D.warm)} / cool ${pct(D.cool)}` : ''}${chrom.length >= 5 ? '. Too many hue families compete: limit to 2-3 plus neutrals (pick a scheme with k.c.scheme)' : ''}`);
    if (D.camo) add(D.camo.share > 0.3 ? 'WARN' : 'PASS', 'figure hue', `${pct(D.camo.share)} of the background around the ${D.camo.hue} subject has the same hue and value${D.camo.share > 0.3 ? ': it camouflages the subject. Put a complementary or contrasting hue behind it (k.c.scheme), or a clear value step (darker ground, glow behind the subject)' : ''}`);
    if (D.sat) { const bad = D.sat.background > D.sat.subject + (wide ? 0.01 : 0.03); add(bad ? 'WARN' : 'PASS', 'saturation', `subject chroma ${D.sat.subject.toFixed(3)} vs background ${D.sat.background.toFixed(3)}${bad ? ': the background is more saturated than the subject and competes with it. Deepen it toward the edges (darker, less chroma), lower the ray contrast, or set the subject on a complementary hue' : ''}`); }
  }
  if (TEXTUAL.has(K.name) && !K.circle && D.margins.length) add('WARN', 'margins', `${D.margins.map(t => `"${t.layer}" (${t.sides.join(', ')})`).join('; ')} sits closer to the edge than the ${Math.round(D.marginPx)} px (5%) margin: text crammed against the frame looks cut off and gets clipped by rounded corners. Pull it in and use the same margin on every side`);
  if (TEXTUAL.has(K.name) && D.texts.length) {
    const prev = (K.preview || []).map(p => Array.isArray(p) ? p[1] : Math.round(p * a.H / a.W)), ph = prev.length ? Math.min(...prev) : a.H;
    const small = D.texts.filter(t => t.px * CAP * ph / a.H < 8);
    add(small.length ? 'WARN' : 'PASS', 'text size', small.length ? `${small.map(t => `"${t.str}" (${(t.px * CAP * ph / a.H).toFixed(1)} px)`).join(', ')} below 8 px cap height at ${ph} px tall, the smallest size players see: make it bigger (about ${Math.ceil(8 * a.H / ph / CAP)} px font size) or cut it` : `smallest text is ${(Math.min(...D.texts.map(t => t.px)) * CAP * ph / a.H).toFixed(1)} px tall at ${ph} px`);
    const words = D.texts.reduce((s, t) => s + t.str.split(/\s+/).filter(Boolean).length, 0), maxW = { thumbnail: 6, banner: 10, 'game-icon': 2, badge: 2, pass: 2, product: 2, logo: 6 }[K.name] ?? 8;
    if (words > maxW) add('WARN', 'word count', `${words} words of text: ${K.name === 'thumbnail' ? 'thumbnails read best with 2-5 big words (the title plus at most a short hook)' : K.name === 'game-icon' ? 'icons read at 150 px: no text, or one short brand word' : 'cut to the essential words'}`);
    const fonts = [...new Set(D.texts.map(t => t.font).filter(Boolean))]; if (fonts.length > 2) add('WARN', 'typefaces', `${fonts.length} typefaces (${fonts.join(', ')}): use one display face for titles and at most one for supporting text`);
    const sizes = [...new Set(D.texts.map(t => Math.round(t.px)))].sort((p, q) => q - p), close = [];
    for (let i = 1; i < sizes.length; i++) { const r = sizes[i - 1] / sizes[i]; if (r > 1.06 && r < 1.3) close.push(`${sizes[i - 1]} / ${sizes[i]}`); }
    if (close.length) add('WARN', 'type scale', `text sizes ${close.join(', ')} are too close to read as different levels: step at least 1.5x between levels (k.typeScale) or make them equal`);
    else if (sizes.length > 1) add('PASS', 'type scale', `sizes ${sizes.join(' / ')} (steps ${sizes.slice(1).map((s, i) => (sizes[i] / s).toFixed(2) + 'x').join(', ')})`);
    const weak = []; for (const t of D.texts) if (t.stroke && t.sw > 0 && t.fills) { const cr = Math.min(...t.fills.map(fc => { try { return C.contrast(fc, t.stroke); } catch { return 21; } })); if (cr < 3) weak.push(`"${t.str}" ${cr.toFixed(1)}:1`); }
    if (weak.length) add('WARN', 'text contrast', `fill vs outline ${weak.join(', ')}: large text needs at least 3:1 (WCAG) against what touches it; darken the outline or lighten the fill`);
  }
  if (composed || K.name === 'logo') {
    const fr = D.tangents.filter(t => t.kind === 'frame'), pr = D.tangents.filter(t => t.kind === 'pair');
    if (fr.length) add('WARN', 'tangent', `${fr.map(t => `"${t.layer}" (${t.sides.join(', ')})`).join('; ')} nearly touches the frame edge: crop it boldly past the edge or pull it well inside (tangents make the eye snag on the edge)`);
    if (pr.length) add('WARN', 'kissing shapes', `${pr.map(t => `"${t.layer}" and "${t.other}" (${Math.round(t.gap)} px apart)`).join('; ')} nearly touch: overlap them clearly or leave a visible gap (at least 2% of the frame)`);
  }
  return out;
}

// ---- review-sheet images (RGBA8 at analysis size) ----
const img8 = (w, h, f) => { const rgba = new Uint8Array(w * h * 4); for (let i = 0; i < w * h; i++) { const [r, g, b] = f(i); rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255; } return { w, h, rgba }; };
export function notanImage(D) { const v = [[24, 24, 28], [128, 128, 132], [238, 238, 240]]; return img8(D.w, D.h, i => v[D.notanMap[i]]); }
export function heatImage(D) {
  const s = D.attention.smooth; let mx = 0; for (const v of s) mx = Math.max(mx, v);
  const ramp = t => t < 0.33 ? [40 + 300 * t, 20, 90 + 200 * t] : t < 0.66 ? [140 + 300 * (t - 0.33), 20 + 300 * (t - 0.33), 150 - 300 * (t - 0.33)] : [240, 120 + 390 * (t - 0.66), 40 + 400 * (t - 0.66)];
  return img8(D.w, D.h, i => { const t = Math.pow(s[i] / (mx || 1), 1.3), g = (D.rgb[i * 3] * 0.3 + D.rgb[i * 3 + 1] * 0.59 + D.rgb[i * 3 + 2] * 0.11) * 255 * 0.35, c = ramp(t); return c.map(v => Math.min(255, g * (1 - t) + v * t)); });
}
