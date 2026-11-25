// Drawing kit handed to art specs as `k`. Everything returns SVG markup strings (or path `d` strings for the
// shape builders), so pieces compose with template literals. Gradients, clips and filters register their <defs>
// on the kit and the engine adds them to every layer it renders. A fresh kit is made for each asset.
import fs from 'node:fs';
import path from 'node:path';
import * as C from './color.mjs';

const r2 = n => Math.round(n * 100) / 100;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
export function rng(seed = 1) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function makeKit(ctx = {}) {
  const defs = []; let counter = 0;
  const id = (p = 'k') => `${p}${++counter}`;
  const k = { defs, color: C, c: C, rng, r2, W: ctx.w || 512, H: ctx.h || 512, ctx };
  k.defsMarkup = () => defs.join('');
  k.id = id;
  const attrs = o => Object.entries(o || {}).filter(([, v]) => v != null && v !== false).map(([a, v]) => `${a.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}="${esc(v)}"`).join(' ');
  k.attrs = attrs;

  // ---------- path builders (return `d`) ----------
  k.rrect = (x, y, w, h, r = 0) => { r = Math.min(r, w / 2, h / 2); return `M${r2(x + r)} ${r2(y)}H${r2(x + w - r)}A${r2(r)} ${r2(r)} 0 0 1 ${r2(x + w)} ${r2(y + r)}V${r2(y + h - r)}A${r2(r)} ${r2(r)} 0 0 1 ${r2(x + w - r)} ${r2(y + h)}H${r2(x + r)}A${r2(r)} ${r2(r)} 0 0 1 ${r2(x)} ${r2(y + h - r)}V${r2(y + r)}A${r2(r)} ${r2(r)} 0 0 1 ${r2(x + r)} ${r2(y)}Z`; };
  // All closed builders run clockwise (on screen), so several of them in ONE path union instead of cutting holes.
  k.ellipseD = (cx, cy, rx, ry = rx) => `M${r2(cx - rx)} ${r2(cy)}A${r2(rx)} ${r2(ry)} 0 1 1 ${r2(cx + rx)} ${r2(cy)}A${r2(rx)} ${r2(ry)} 0 1 1 ${r2(cx - rx)} ${r2(cy)}Z`;
  k.circleD = (cx, cy, r) => k.ellipseD(cx, cy, r, r);
  k.poly = (pts, closed = true) => 'M' + pts.map(p => `${r2(p[0])} ${r2(p[1])}`).join('L') + (closed ? 'Z' : '');
  // Smooth closed (or open) Catmull-Rom curve through points: the workhorse for organic silhouettes.
  k.smooth = (pts, closed = true, tension = 1) => {
    const n = pts.length, P = i => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))], t = tension / 6;
    let d = `M${r2(pts[0][0])} ${r2(pts[0][1])}`;
    for (let i = 0; i < (closed ? n : n - 1); i++) { const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2); d += `C${r2(p1[0] + (p2[0] - p0[0]) * t)} ${r2(p1[1] + (p2[1] - p0[1]) * t)} ${r2(p2[0] - (p3[0] - p1[0]) * t)} ${r2(p2[1] - (p3[1] - p1[1]) * t)} ${r2(p2[0])} ${r2(p2[1])}`; }
    return closed ? d + 'Z' : d;
  };
  // Wobbly ellipse: rocks, slime, bushes, clouds of smoke. amp = relative radius noise.
  k.blob = (cx, cy, rx, ry = rx, { n = 10, amp = 0.1, seed = 3, rot = 0 } = {}) => { const R = rng(seed), pts = []; for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2 + rot * Math.PI / 180, s = 1 + (R() * 2 - 1) * amp; pts.push([cx + Math.cos(t) * rx * s, cy + Math.sin(t) * ry * s]); } return k.smooth(pts); };
  k.star = (cx, cy, ro, ri, n = 5, rot = -90, { round = 0 } = {}) => { const pts = []; for (let i = 0; i < n * 2; i++) { const t = ((i / (n * 2)) * 360 + rot) * Math.PI / 180, r = i % 2 ? ri : ro; pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]); } return round ? k.roundPoly(pts, round) : k.poly(pts); };
  k.burst = (cx, cy, ro, ri, n = 14, seed = 0) => { const R = rng(seed || 5), pts = []; for (let i = 0; i < n * 2; i++) { const t = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2, r = (i % 2 ? ri : ro) * (seed ? 1 + (R() - 0.5) * 0.12 : 1); pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]); } return k.poly(pts); };
  // Polygon with rounded corners (radius r, clamped per corner): chunky "toy" shapes.
  k.roundPoly = (pts, r = 10) => {
    const n = pts.length; let d = '';
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
      const v1 = [p0[0] - p1[0], p0[1] - p1[1]], v2 = [p2[0] - p1[0], p2[1] - p1[1]], l1 = Math.hypot(...v1), l2 = Math.hypot(...v2), rr = Math.min(r, l1 / 2, l2 / 2);
      const a = [p1[0] + v1[0] / l1 * rr, p1[1] + v1[1] / l1 * rr], b = [p1[0] + v2[0] / l2 * rr, p1[1] + v2[1] / l2 * rr];
      d += (i ? 'L' : 'M') + `${r2(a[0])} ${r2(a[1])}Q${r2(p1[0])} ${r2(p1[1])} ${r2(b[0])} ${r2(b[1])}`;
    }
    return d + 'Z';
  };
  k.heart = (cx, cy, s) => `M${r2(cx)} ${r2(cy + s * 0.42)}C${r2(cx - s * 0.62)} ${r2(cy + s * 0.02)} ${r2(cx - s * 0.56)} ${r2(cy - s * 0.48)} ${r2(cx - s * 0.24)} ${r2(cy - s * 0.46)}C${r2(cx - s * 0.08)} ${r2(cy - s * 0.45)} ${r2(cx)} ${r2(cy - s * 0.33)} ${r2(cx)} ${r2(cy - s * 0.24)}C${r2(cx)} ${r2(cy - s * 0.33)} ${r2(cx + s * 0.08)} ${r2(cy - s * 0.45)} ${r2(cx + s * 0.24)} ${r2(cy - s * 0.46)}C${r2(cx + s * 0.56)} ${r2(cy - s * 0.48)} ${r2(cx + s * 0.62)} ${r2(cy + s * 0.02)} ${r2(cx)} ${r2(cy + s * 0.42)}Z`;
  k.drop = (cx, cy, w, h) => `M${r2(cx)} ${r2(cy - h / 2)}C${r2(cx + w * 0.18)} ${r2(cy - h * 0.18)} ${r2(cx + w / 2)} ${r2(cy)} ${r2(cx + w / 2)} ${r2(cy + h * 0.18)}A${r2(w / 2)} ${r2(w / 2)} 0 0 1 ${r2(cx - w / 2)} ${r2(cy + h * 0.18)}C${r2(cx - w / 2)} ${r2(cy)} ${r2(cx - w * 0.18)} ${r2(cy - h * 0.18)} ${r2(cx)} ${r2(cy - h / 2)}Z`;
  k.shield = (cx, cy, w, h) => `M${r2(cx)} ${r2(cy - h / 2)}C${r2(cx + w * 0.25)} ${r2(cy - h * 0.4)} ${r2(cx + w * 0.42)} ${r2(cy - h * 0.42)} ${r2(cx + w / 2)} ${r2(cy - h * 0.38)}C${r2(cx + w / 2)} ${r2(cy + h * 0.05)} ${r2(cx + w * 0.35)} ${r2(cy + h * 0.32)} ${r2(cx)} ${r2(cy + h / 2)}C${r2(cx - w * 0.35)} ${r2(cy + h * 0.32)} ${r2(cx - w / 2)} ${r2(cy + h * 0.05)} ${r2(cx - w / 2)} ${r2(cy - h * 0.38)}C${r2(cx - w * 0.42)} ${r2(cy - h * 0.42)} ${r2(cx - w * 0.25)} ${r2(cy - h * 0.4)} ${r2(cx)} ${r2(cy - h / 2)}Z`;
  k.bolt = (cx, cy, s) => k.poly([[0.12, -0.5], [-0.3, 0.06], [-0.02, 0.06], [-0.14, 0.5], [0.3, -0.08], [0.02, -0.08], [0.16, -0.5]].map(([x, y]) => [cx + x * s, cy + y * s]));
  k.capsule = (x1, y1, x2, y2, r) => { const a = Math.atan2(y2 - y1, x2 - x1), nx = -Math.sin(a) * r, ny = Math.cos(a) * r; return `M${r2(x1 + nx)} ${r2(y1 + ny)}L${r2(x2 + nx)} ${r2(y2 + ny)}A${r2(r)} ${r2(r)} 0 0 0 ${r2(x2 - nx)} ${r2(y2 - ny)}L${r2(x1 - nx)} ${r2(y1 - ny)}A${r2(r)} ${r2(r)} 0 0 0 ${r2(x1 + nx)} ${r2(y1 + ny)}Z`; };
  k.ring = (cx, cy, ro, ri) => k.ellipseD(cx, cy, ro, ro) + k.ellipseD(cx, cy, ri, ri);   // use fill-rule="evenodd"
  k.scallop = (cx, cy, rx, ry, bumps = 9, bulge = 0.25, rot = -90) => { let d = ''; const pt = i => { const t = (i / bumps) * Math.PI * 2 + rot * Math.PI / 180; return [cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]; }; for (let i = 0; i < bumps; i++) { const a = pt(i), b = pt(i + 1), tm = ((i + 0.5) / bumps) * Math.PI * 2 + rot * Math.PI / 180, c = [cx + Math.cos(tm) * rx * (1 + bulge), cy + Math.sin(tm) * ry * (1 + bulge)]; if (!i) d += `M${r2(a[0])} ${r2(a[1])}`; d += `Q${r2(c[0])} ${r2(c[1])} ${r2(b[0])} ${r2(b[1])}`; } return d + 'Z'; };
  k.cloud = (cx, cy, w, h, seed = 2) => { const R = rng(seed), n = 7, pts = []; for (let i = 0; i < n; i++) { const t = Math.PI + (i / (n - 1)) * Math.PI, r = 0.85 + R() * 0.3; pts.push([cx + Math.cos(t) * w / 2 * r, cy + Math.sin(t) * h * 0.75 * r]); } pts.push([cx + w * 0.45, cy + h * 0.25], [cx - w * 0.45, cy + h * 0.25]); return k.smooth(pts); };
  k.flame = (cx, by, w, h, seed = 1) => { const R = rng(seed), j = () => (R() - 0.5) * w * 0.12; return `M${r2(cx)} ${r2(by)}C${r2(cx - w * 0.55)} ${r2(by)} ${r2(cx - w * 0.62 + j())} ${r2(by - h * 0.42)} ${r2(cx - w * 0.3)} ${r2(by - h * 0.62)}C${r2(cx - w * 0.3)} ${r2(by - h * 0.48)} ${r2(cx - w * 0.18)} ${r2(by - h * 0.42)} ${r2(cx - w * 0.12)} ${r2(by - h * 0.44)}C${r2(cx - w * 0.2 + j())} ${r2(by - h * 0.7)} ${r2(cx - w * 0.02)} ${r2(by - h * 0.86)} ${r2(cx + w * 0.06)} ${r2(by - h)}C${r2(cx + w * 0.06)} ${r2(by - h * 0.78)} ${r2(cx + w * 0.22)} ${r2(by - h * 0.7)} ${r2(cx + w * 0.26)} ${r2(by - h * 0.58)}C${r2(cx + w * 0.32)} ${r2(by - h * 0.66)} ${r2(cx + w * 0.36)} ${r2(by - h * 0.74)} ${r2(cx + w * 0.34)} ${r2(by - h * 0.82)}C${r2(cx + w * 0.62 + j())} ${r2(by - h * 0.56)} ${r2(cx + w * 0.58)} ${r2(by)} ${r2(cx)} ${r2(by)}Z`; };
  // Ribbon banner (for titles / "NEW" tags): body plus folded tails; returns { body, tails } d strings.
  k.ribbon = (cx, cy, w, h, { tail = 0.18, notch = 0.35, curve = 0.08 } = {}) => {
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2, cv = h * curve * 6, tw = w * tail;
    const body = `M${r2(x0)} ${r2(y0)}Q${r2(cx)} ${r2(y0 - cv)} ${r2(x1)} ${r2(y0)}L${r2(x1)} ${r2(y1)}Q${r2(cx)} ${r2(y1 - cv)} ${r2(x0)} ${r2(y1)}Z`;
    const tailD = s => { const xe = s < 0 ? x0 : x1, ya = y0 + h * 0.28, yb = y1 + h * 0.28; return k.poly([[xe - s * tw * 0.35, ya], [xe + s * tw, ya], [xe + s * tw * (1 - notch), (ya + yb) / 2], [xe + s * tw, yb], [xe - s * tw * 0.35, yb]]); };
    return { body, tails: tailD(-1) + tailD(1) };
  };

  // ---------- illustration: curves, brush strokes, limbs, poses, scatter (references/illustration.md) ----------
  // Dense points along the same Catmull-Rom curve k.smooth draws (per = samples per segment).
  k.curve = (pts, closed = false, per = 12) => {
    const n = pts.length, P = i => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))], out = [];
    if (n < 2) return pts.map(p => [p[0], p[1]]);
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      for (let s = 0; s < per; s++) { const t = s / per, t2 = t * t, t3 = t2 * t; out.push([0, 1].map(j => 0.5 * (2 * p1[j] + (p2[j] - p0[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * t3))); }
    }
    if (!closed) out.push([pts[n - 1][0], pts[n - 1][1]]);
    return out;
  };
  const clockwise = pts => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a >= 0 ? pts : pts.slice().reverse(); };
  // Brush stroke: a filled shape along a smooth curve whose width swells and tapers like an inked line. The single
  // biggest step from "programmer art" to illustration: hair strands, grass blades, fur tufts, brows, whiskers,
  // folds, speed lines, line art. width: number, [start, end], or t => px (t 0..1 along the stroke). taper: the
  // fraction of the length over which each end thins to a point ([0, 0] = blunt ends). Returns a `d` (clockwise).
  // Keep the width below the bend radius of the curve (a fat stroke round a tight bend folds over itself).
  k.stroke = (pts, width = 10, { taper = [0.35, 0.35], per = 10, min = 0, wobble = 0, seed = 7 } = {}) => {
    const P = k.curve(pts, false, per), n = P.length, L = [0], R = rng(seed), ph = R() * 6.28;
    for (let i = 1; i < n; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const tot = L[n - 1] || 1, [ta, tb] = Array.isArray(taper) ? taper : [taper, taper], ease = x => Math.sin(Math.min(1, Math.max(0, x)) * Math.PI / 2);
    const prof = typeof width === 'function' ? width : Array.isArray(width) ? t => width[0] + (width[1] - width[0]) * t : () => width;
    const left = [], right = [];
    for (let i = 0; i < n; i++) {
      const t = L[i] / tot, a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)], dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const env = (ta > 0 ? ease(t / ta) : 1) * (tb > 0 ? ease((1 - t) / tb) : 1), w = Math.max(min, prof(t) * env * (1 + wobble * Math.sin(t * 17 + ph) * 0.5)) / 2;
      const nx = -(b[1] - a[1]) / dl, ny = (b[0] - a[0]) / dl;
      left.push([P[i][0] + nx * w, P[i][1] + ny * w]); right.push([P[i][0] - nx * w, P[i][1] - ny * w]);
    }
    return k.poly(clockwise(left.concat(right.reverse())));
  };
  // Tapered limb: two circles joined by their outer tangents (arms, legs, necks, tails, fingers, branches, horns).
  k.limb = (a, b, ra, rb = ra) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy);
    if (d <= Math.abs(ra - rb) + 1e-6) return ra >= rb ? k.circleD(a[0], a[1], ra) : k.circleD(b[0], b[1], rb);
    const th = Math.atan2(dy, dx), ph = Math.acos((ra - rb) / d), at = (c, r, ang) => `${r2(c[0] + Math.cos(ang) * r)} ${r2(c[1] + Math.sin(ang) * r)}`;
    return `M${at(b, rb, th - ph)}A${r2(rb)} ${r2(rb)} 0 ${2 * ph > Math.PI ? 1 : 0} 1 ${at(b, rb, th + ph)}L${at(a, ra, th + ph)}A${r2(ra)} ${r2(ra)} 0 ${2 * Math.PI - 2 * ph > Math.PI ? 1 : 0} 1 ${at(a, ra, th - ph)}Z`;
  };
  // Forward kinematics: joint positions of a chain from a root and [length, angle] per bone. The first angle is
  // absolute (degrees, 0 = right, 90 = down), the rest are relative to the previous bone (bend at each joint).
  // const [shoulder, elbow, hand] = k.fk([300, 260], [[70, 120], [64, -70]])
  k.fk = (root, segs) => { const out = [[root[0], root[1]]]; let a = 0, x = root[0], y = root[1]; for (const [len, ang] of segs) { a += ang * Math.PI / 180; x += Math.cos(a) * len; y += Math.sin(a) * len; out.push([x, y]); } return out; };
  // Natural scatter (Poisson-disc spacing: no clumps that touch, no grid): trees, rocks, flowers, stars, fireflies,
  // coins. Returns [{ x, y, s, rot, r, i }] sorted far to near (by y) so later items overlap earlier ones. Sizes
  // lean small (few big, many small); `inside(x, y)` keeps points in a region. gap defaults from the area and n.
  k.scatter = ({ x = 0, y = 0, w = k.W, h = k.H, n = 30, gap, seed = 1, inside, tries = 40, scale = [1, 1], rot = 0, sort = 'y' } = {}) => {
    const R = rng(seed), g = gap ?? Math.sqrt((w * h) / Math.max(1, n)) * 0.7, pts = []; let tried = 0;
    while (pts.length < n && tried++ < n * tries) { const px = x + R() * w, py = y + R() * h; if (inside && !inside(px, py)) continue; if (pts.some(p => (p.x - px) ** 2 + (p.y - py) ** 2 < g * g)) continue; pts.push({ x: px, y: py }); }
    const [s0, s1] = Array.isArray(scale) ? scale : [scale, scale];
    pts.forEach((p, i) => Object.assign(p, { s: s0 + (s1 - s0) * R() ** 2, rot: (R() * 2 - 1) * rot, r: R(), i }));
    return sort === 'y' ? pts.sort((a, b) => a.y - b.y) : pts;
  };
  // Ground-plane perspective: the scale of something standing at screen height y, given the horizon and the y where
  // scale is 1. Objects further up the ground (closer to the horizon) shrink; use it for scattered trees and rocks.
  k.persp = (y, horizon, refY = k.H) => Math.max(0, (y - horizon) / (refY - horizon));

  // ---------- illustration: faces (eyes, brows and mouths carry the expression) ----------
  // style 'bean' (dark oval + catchlights: cute, reads at icon size) or 'full' (white, iris, pupil, lid line).
  // look: [-1..1, -1..1] gaze; lid: 0..1 of the eye covered from the top (sleepy, smug, determined); tilt: degrees
  // the lid edge leans (positive lowers its right end: on the viewer's left eye that reads angry, on the right eye sad).
  k.eye = (cx, cy, r, { style = 'bean', look = [0, 0], ink = '#1d1430', iris = '#4a7bd8', white = '#ffffff', h = style === 'bean' ? 1.35 : 1.15, lid = 0, tilt = 0, light = 'tl', glint = 1 } = {}) => {
    const rx = r, ry = r * h, lx = /r/.test(light) ? 1 : -1, gx = cx + look[0] * r * 0.3, gy = cy + look[1] * ry * 0.3;
    let s;
    if (style === 'bean') s = `<ellipse cx="${r2(gx)}" cy="${r2(gy)}" rx="${r2(rx)}" ry="${r2(ry)}" fill="${ink}"/>` +
      (glint ? k.circle(gx + lx * rx * 0.3, gy - ry * 0.38, r * 0.36 * glint, white) + k.circle(gx - lx * rx * 0.32, gy + ry * 0.36, r * 0.15 * glint, white, { opacity: 0.85 }) : '');
    else {
      const ir = r * 0.62, ix = cx + look[0] * r * 0.38, iy = cy + look[1] * ry * 0.38, cp = k.clip(k.ellipseD(cx, cy, rx, ry));
      s = `<ellipse cx="${r2(cx)}" cy="${r2(cy)}" rx="${r2(rx)}" ry="${r2(ry)}" fill="${white}"/><g clip-path="${cp}">` +
        k.circle(ix, iy, ir, k.linear([[0, C.shade(iris, -0.6)], [0.55, iris], [1, C.shade(iris, 0.35)]])) + k.circle(ix, iy, ir * 0.5, ink) +
        k.circle(ix + lx * ir * 0.38, iy - ir * 0.4, ir * 0.3 * glint, white) + k.circle(ix - lx * ir * 0.3, iy + ir * 0.4, ir * 0.13 * glint, white, { opacity: 0.85 }) +
        `<path d="M${r2(cx - rx * 1.2)} ${r2(cy - ry * 1.3)}H${r2(cx + rx * 1.2)}V${r2(cy - ry * 0.55)}Q${r2(cx)} ${r2(cy - ry * 0.95)} ${r2(cx - rx * 1.2)} ${r2(cy - ry * 0.55)}Z" fill="${ink}" opacity="0.18"/></g>` +
        `<ellipse cx="${r2(cx)}" cy="${r2(cy)}" rx="${r2(rx)}" ry="${r2(ry)}" fill="none" stroke="${ink}" stroke-width="${r2(r * 0.1)}"/>` +
        k.path(k.stroke([[cx - rx * 1.08, cy + ry * 0.05], [cx - rx * 0.6, cy - ry * 0.86], [cx + rx * 0.5, cy - ry * 0.92], [cx + rx * 1.12, cy - ry * 0.2]], r * 0.3, { taper: [0.25, 0.4] }), ink);
    }
    if (lid > 0 || tilt) {
      const yl = cy - ry * 1.05 + lid * ry * 2.1, t = Math.tan(tilt * Math.PI / 180) * rx * 1.6, cut = k.clip(k.poly([[cx - rx * 1.6, yl - t], [cx + rx * 1.6, yl + t], [cx + rx * 1.6, cy + ry * 2], [cx - rx * 1.6, cy + ry * 2]]));
      s = `<g clip-path="${cut}">${s}</g>` + k.clipped(k.ellipseD(cx, cy, rx * 1.12, ry * 1.12), k.line(`M${r2(cx - rx * 1.6)} ${r2(yl - t)}L${r2(cx + rx * 1.6)} ${r2(yl + t)}`, ink, r * 0.22));
    }
    return `<g>${s}</g>`;
  };
  // Brow: a tapered stroke. angle tilts it (positive raises the outer end on the viewer's right brow: worried /
  // sad when the inner ends rise, angry when they drop); arch bows it up.
  k.brow = (cx, cy, w, { angle = 0, arch = 0.15, thick = w * 0.22, ink = '#1d1430' } = {}) => {
    const a = angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), P = ([x, y]) => [cx + x * ca + y * sa, cy - x * sa + y * ca];
    return k.path(k.stroke([[-w / 2, 0], [0, -w * arch], [w / 2, 0]].map(P), [thick * 1.15, thick * 0.8], { taper: [0.2, 0.45] }), ink);
  };
  // Mouth by mood: 'smile', 'grin' (open, teeth), 'open' (shout / surprise), 'o', 'flat', 'frown', 'smirk', 'wavy'
  // (worried), 'cat' (:3). w = width in px.
  k.mouth = (cx, cy, w, mood = 'smile', { ink = '#1d1430', sw = Math.max(3, w * 0.12), inside = '#7a2236', tongue = '#ff7d95', teeth = '#ffffff' } = {}) => {
    const h = w / 2, L = d => k.line(d, ink, sw);
    const filled = (top, bot) => { const d = `M${r2(cx - h)} ${r2(cy)}Q${r2(cx)} ${r2(cy + top)} ${r2(cx + h)} ${r2(cy)}Q${r2(cx)} ${r2(cy + bot)} ${r2(cx - h)} ${r2(cy)}Z`; return k.path(d, inside) + k.clipped(d, k.ellipse(cx, cy + bot * 0.62, h * 0.55, bot * 0.32, tongue) + (mood === 'grin' ? k.rect(cx - h, cy - w, w, w + top * 0.55, teeth) : '')) + k.path(d, 'none', { stroke: ink, strokeWidth: sw * 0.85, strokeLinejoin: 'round' }); };
    switch (mood) {
      case 'grin': return filled(w * 0.08, w * 0.75);
      case 'open': return filled(-w * 0.12, w * 0.9);
      case 'o': return k.ellipse(cx, cy + w * 0.1, h * 0.55, h * 0.7, inside, { stroke: ink, strokeWidth: sw * 0.85 });
      case 'flat': return L(`M${r2(cx - h)} ${r2(cy)}Q${r2(cx)} ${r2(cy + w * 0.06)} ${r2(cx + h)} ${r2(cy)}`);
      case 'frown': return L(`M${r2(cx - h)} ${r2(cy + w * 0.2)}Q${r2(cx)} ${r2(cy - w * 0.25)} ${r2(cx + h)} ${r2(cy + w * 0.2)}`);
      case 'smirk': return L(`M${r2(cx - h)} ${r2(cy + w * 0.08)}Q${r2(cx + w * 0.1)} ${r2(cy + w * 0.22)} ${r2(cx + h)} ${r2(cy - w * 0.14)}`);
      case 'wavy': return L(k.smooth([[cx - h, cy + w * 0.05], [cx - h * 0.5, cy - w * 0.08], [cx, cy + w * 0.05], [cx + h * 0.5, cy - w * 0.08], [cx + h, cy + w * 0.05]], false));
      case 'cat': return L(`M${r2(cx - h)} ${r2(cy)}Q${r2(cx - h / 2)} ${r2(cy + w * 0.35)} ${r2(cx)} ${r2(cy)}Q${r2(cx + h / 2)} ${r2(cy + w * 0.35)} ${r2(cx + h)} ${r2(cy)}`);
      default: return L(`M${r2(cx - h)} ${r2(cy)}Q${r2(cx)} ${r2(cy + w * 0.45)} ${r2(cx + h)} ${r2(cy)}`);
    }
  };

  // ---------- elements ----------
  k.path =(d, fill = '#000', extra = {}) => `<path d="${d}" ${attrs(Object.assign({ fill }, extra))}/>`;
  k.shape = (d, o = {}) => `<path d="${d}" ${attrs({ fill: o.fill ?? '#000', stroke: o.stroke, strokeWidth: o.sw ?? (o.stroke ? 6 : null), strokeLinejoin: o.stroke ? 'round' : null, strokeLinecap: o.stroke ? 'round' : null, opacity: o.opacity, fillRule: o.evenodd ? 'evenodd' : o.fillRule, transform: o.transform, filter: o.filter, paintOrder: o.stroke && o.under ? 'stroke' : null })}/>`;
  k.line = (d, color = '#000', sw = 6, o = {}) => `<path d="${d}" ${attrs({ fill: 'none', stroke: color, strokeWidth: sw, strokeLinecap: o.cap || 'round', strokeLinejoin: 'round', opacity: o.opacity, strokeDasharray: o.dash })}/>`;
  k.circle = (cx, cy, r, fill = '#000', extra = {}) => `<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(r)}" ${attrs(Object.assign({ fill }, extra))}/>`;
  k.ellipse = (cx, cy, rx, ry, fill = '#000', extra = {}) => `<ellipse cx="${r2(cx)}" cy="${r2(cy)}" rx="${r2(rx)}" ry="${r2(ry)}" ${attrs(Object.assign({ fill }, extra))}/>`;
  k.rect = (x, y, w, h, fill = '#000', extra = {}) => `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" ${attrs(Object.assign({ fill }, extra))}/>`;
  k.g = (a, ...kids) => `<g ${typeof a === 'string' ? a : attrs(a)}>${kids.flat().join('')}</g>`;
  k.tf = (x = 0, y = 0, s = 1, rot = 0) => `translate(${r2(x)} ${r2(y)})${rot ? ` rotate(${r2(rot)})` : ''}${s !== 1 ? ` scale(${Array.isArray(s) ? s.map(r2).join(' ') : r2(s)})` : ''}`;
  // Put a piece drawn in a `box`-sized square (centred on box/2) at (cx, cy) with width `size`.
  k.place = (markup, cx, cy, size, rot = 0, box = 512) => `<g transform="translate(${r2(cx)} ${r2(cy)}) rotate(${r2(rot)}) scale(${r2(size / box)}) translate(${-box / 2} ${-box / 2})">${markup}</g>`;
  // Seamless tiling: draws the markup 9 times shifted by the canvas size, so anything crossing an edge wraps around.
  k.tile = markup => { let s = ''; for (const dx of [-k.W, 0, k.W]) for (const dy of [-k.H, 0, k.H]) s += `<g transform="translate(${dx} ${dy})">${markup}</g>`; return s; };
  k.flipX = (markup, cx) => `<g transform="translate(${r2(2 * cx)} 0) scale(-1 1)">${markup}</g>`;
  // Raster image (screenshot, render, reference) embedded as a data URI. fit: 'cover' | 'contain' | 'fill'.
  k.image = (file, x, y, w, h, { fit = 'cover', opacity, clip } = {}) => {
    const f = path.resolve(ctx.dir || '.', file), ext = path.extname(f).slice(1).toLowerCase(), mime = { jpg: 'jpeg', jpeg: 'jpeg', svg: 'svg+xml' }[ext] || ext;
    const uri = `data:image/${mime};base64,${fs.readFileSync(f).toString('base64')}`, par = { cover: 'xMidYMid slice', contain: 'xMidYMid meet', fill: 'none' }[fit] || fit;
    return `<image href="${uri}" x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" preserveAspectRatio="${par}" ${attrs({ opacity, clipPath: clip })}/>`;
  };
  // Inline an SVG file (e.g. an openly licensed icon from `refs`) as a group scaled into a box.
  k.svgFile = (file, x, y, w, h, { fill } = {}) => {
    let s = fs.readFileSync(path.resolve(ctx.dir || '.', file), 'utf8'); const vb = (s.match(/viewBox="([^"]+)"/) || [])[1] || '0 0 512 512', [vx, vy, vw, vh] = vb.split(/[ ,]+/).map(Number);
    s = s.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, ''); if (fill) s = s.replace(/currentColor/g, fill); else s = s.replace(/currentColor/g, '#000');
    const sc = Math.min(w / vw, h / vh);
    return `<g transform="translate(${r2(x + (w - vw * sc) / 2)} ${r2(y + (h - vh * sc) / 2)}) scale(${r2(sc * 1000) / 1000}) translate(${-vx} ${-vy})">${s}</g>`;
  };

  // ---------- paint servers / filters / clips (register defs, return url(#id)) ----------
  const stopsOf = stops => (Array.isArray(stops[0]) ? stops : stops.map((c, i) => [i / Math.max(1, stops.length - 1), c])).map(([o, c, op = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${op}"/>`).join('');
  k.linear = (stops, { x1 = 0, y1 = 0, x2 = 0, y2 = 1, units } = {}) => { const i = id('lg'); defs.push(`<linearGradient id="${i}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${units ? `gradientUnits="${units}"` : ''}>${stopsOf(stops)}</linearGradient>`); return `url(#${i})`; };
  k.radial = (stops, { cx = 0.5, cy = 0.5, r = 0.5, fx, fy, units } = {}) => { const i = id('rg'); defs.push(`<radialGradient id="${i}" cx="${cx}" cy="${cy}" r="${r}" ${fx != null ? `fx="${fx}" fy="${fy ?? fx}"` : ''} ${units ? `gradientUnits="${units}"` : ''}>${stopsOf(stops)}</radialGradient>`); return `url(#${i})`; };
  k.clip = d => { const i = id('cp'); defs.push(`<clipPath id="${i}"><path d="${d}"/></clipPath>`); return `url(#${i})`; };
  k.clipped = (d, ...kids) => `<g clip-path="${k.clip(d)}">${kids.flat().join('')}</g>`;
  k.blurF = std => { const i = id('bf'); defs.push(`<filter id="${i}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${std}"/></filter>`); return `url(#${i})`; };
  k.glowF = (std = 8, color = '#fff', op = 1) => { const i = id('gf'); defs.push(`<filter id="${i}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur in="SourceAlpha" stdDeviation="${std}"/><feFlood flood-color="${color}" flood-opacity="${op}"/><feComposite operator="in" in2="SourceAlpha"/><feGaussianBlur stdDeviation="${std}"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`); return `url(#${i})`; };
  k.shadowF = (dx = 0, dy = 8, std = 6, color = '#000', op = 0.35) => { const i = id('sf'); defs.push(`<filter id="${i}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${dx}" dy="${dy}" stdDeviation="${std}" flood-color="${color}" flood-opacity="${op}"/></filter>`); return `url(#${i})`; };
  // Hand-drawn edge: displaces the group by smooth noise (amount px, freq = noise frequency per px). Use on a
  // `<g filter>` around foliage, rocks, clouds, paper cut-outs; keep amount small (1-4 px at 512) or it looks broken.
  k.roughF = (amount = 3, freq = 0.03, seed = 1) => { const i = id('rf'); defs.push(`<filter id="${i}" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="${seed}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="${amount * 2}" xChannelSelector="R" yChannelSelector="G"/></filter>`); return `url(#${i})`; };

  // ---------- hand shading helpers (when you want control instead of the automatic `shade` effect) ----------
  // Cel shadow: the shape in its base colour, a shadow crescent (the shape minus a copy shifted toward the light).
  k.cel = (d, base, { shadow, dx = 0.06, dy = 0.08, light = 'tl', inner = '', size } = {}) => {
    // shadow = shape minus a copy of itself moved toward the light
    const sz = size || Math.min(k.W, k.H) * 0.5, tx = (/r/.test(light) ? 1 : -1) * dx * sz, ty = (/b/.test(light) ? 1 : -1) * dy * sz, sh = shadow || C.shade(base, -0.75), cp = k.clip(d);
    return `<path d="${d}" fill="${base}"/><g clip-path="${cp}"><path d="M-9999 -9999H9999V9999H-9999Z${d}" fill="${sh}" fill-rule="evenodd" transform="translate(${r2(tx)} ${r2(ty)})"/>${inner}</g>`;
  };
  // Glossy highlight: a soft white band across the top of a shape, clipped to it (candy / plastic / gem look).
  k.gloss = (d, { x, y, w, h, opacity = 0.55, rot = -12 } = {}) => { const g = k.linear([[0, '#fff', opacity], [1, '#fff', 0]]); return k.clipped(d, `<ellipse cx="${r2(x)}" cy="${r2(y)}" rx="${r2(w / 2)}" ry="${r2(h / 2)}" fill="${g}" transform="rotate(${rot} ${r2(x)} ${r2(y)})"/>`); };
  k.shine = (cx, cy, rx, ry, rot = -30, op = 0.7, fill = '#fff') => `<ellipse cx="${r2(cx)}" cy="${r2(cy)}" rx="${r2(rx)}" ry="${r2(ry)}" fill="${fill}" opacity="${op}" transform="rotate(${rot} ${r2(cx)} ${r2(cy)})"/>`;
  k.sparkle = (cx, cy, r, fill = '#fff', o = {}) => { const q = r * (o.pinch ?? 0.22); return `<path d="M${r2(cx)} ${r2(cy - r)}Q${r2(cx + q)} ${r2(cy - q)} ${r2(cx + r)} ${r2(cy)}Q${r2(cx + q)} ${r2(cy + q)} ${r2(cx)} ${r2(cy + r)}Q${r2(cx - q)} ${r2(cy + q)} ${r2(cx - r)} ${r2(cy)}Q${r2(cx - q)} ${r2(cy - q)} ${r2(cx)} ${r2(cy - r)}Z" fill="${fill}" ${attrs({ opacity: o.opacity, transform: o.rot ? `rotate(${o.rot} ${cx} ${cy})` : null })}/>`; };
  k.groundShadow = (cx, cy, rx, ry, op = 0.25, color = '#1b1028') => k.ellipse(cx, cy, rx, ry, color, { opacity: op });

  // ---------- ready-made pieces that Roblox games need all the time ----------
  k.rays = (cx, cy, r, n = 16, color = '#fff', op = 0.25, rot = 0, width = 0.5) => { let d = ''; for (let i = 0; i < n; i++) { const a0 = ((i / n) * 360 + rot) * Math.PI / 180, a1 = (((i + width) / n) * 360 + rot) * Math.PI / 180; d += `M${r2(cx)} ${r2(cy)}L${r2(cx + Math.cos(a0) * r)} ${r2(cy + Math.sin(a0) * r)}L${r2(cx + Math.cos(a1) * r)} ${r2(cy + Math.sin(a1) * r)}Z`; } return `<path d="${d}" fill="${color}" opacity="${op}"/>`; };
  k.gem = (cx, cy, w, h, color = '#3ad1ff') => {   // cut gem: crown + pavilion facets in a 5-tone ramp
    const [d2, d1, b, l1, l2] = C.ramp(color, 5), t = cy - h / 2, m = cy - h * 0.18, bt = cy + h / 2, x0 = cx - w / 2, x1 = cx + w / 2, xi0 = cx - w * 0.28, xi1 = cx + w * 0.28;
    const P = pts => k.poly(pts);
    return [`<path d="${P([[x0, m], [xi0, t], [xi1, t], [x1, m], [cx, bt]])}" fill="${b}"/>`,
      `<path d="${P([[x0, m], [xi0, t], [cx - w * 0.1, m]])}" fill="${l1}"/>`, `<path d="${P([[xi0, t], [xi1, t], [cx + w * 0.1, m], [cx - w * 0.1, m]])}" fill="${l2}"/>`, `<path d="${P([[xi1, t], [x1, m], [cx + w * 0.1, m]])}" fill="${b}"/>`,
      `<path d="${P([[x0, m], [cx - w * 0.1, m], [cx, bt]])}" fill="${d1}"/>`, `<path d="${P([[cx - w * 0.1, m], [cx + w * 0.1, m], [cx, bt]])}" fill="${b}"/>`, `<path d="${P([[cx + w * 0.1, m], [x1, m], [cx, bt]])}" fill="${d2}"/>`].join('');
  };
  k.coin = (cx, cy, r, color = '#ffc93c', { symbol = '', font = 'Luckiest Guy', edge = 0.14 } = {}) => {
    const [d2, d1, b, l1] = C.ramp(color, 5);
    return `<ellipse cx="${r2(cx)}" cy="${r2(cy + r * edge)}" rx="${r2(r)}" ry="${r2(r)}" fill="${d1}"/><circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(r)}" fill="${b}"/><circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(r * 0.74)}" fill="none" stroke="${d1}" stroke-width="${r2(r * 0.08)}"/>` +
      (symbol ? `<text x="${r2(cx)}" y="${r2(cy + r * 0.32)}" font-family="'${font}'" font-size="${r2(r * 0.95)}" text-anchor="middle" fill="${l1}" stroke="${d2}" stroke-width="${r2(r * 0.07)}" paint-order="stroke">${esc(symbol)}</text>` : '');
  };

  // ---------- text ----------
  // Game title text: thick outline painted under the fill, optional gradient fill, drop shadow and a second
  // outer outline. width forces the text to exactly that width (squash or stretch); arc bends the baseline (px sag).
  k.text = (str, x, y, o = {}) => {
    const size = o.size || 64, font = o.font || 'Luckiest Guy', sw = o.sw ?? size * 0.16, stroke = o.stroke ?? '#22162b', anchor = o.anchor || 'middle';
    let fill = o.fill || '#ffffff'; if (Array.isArray(fill)) fill = k.linear(fill);
    const fit = o.width ? `textLength="${r2(o.width)}" lengthAdjust="spacingAndGlyphs"` : '';
    const base = `font-family="'${font}'" font-size="${r2(size)}" ${o.weight ? `font-weight="${o.weight}"` : ''} text-anchor="${anchor}" ${o.ls ? `letter-spacing="${o.ls}"` : ''} ${fit} stroke-linejoin="round" stroke-linecap="round"`;
    let body = esc(str), pos = `x="${r2(x)}" y="${r2(y)}"`;
    if (o.arc) { const pid = id('tp'), half = (o.width || size * str.length * 0.6) / 2 + size; defs.push(`<path id="${pid}" d="M${r2(x - half)} ${r2(y)}Q${r2(x)} ${r2(y - o.arc * 2)} ${r2(x + half)} ${r2(y)}"/>`); body = `<textPath href="#${pid}" startOffset="50%">${body}</textPath>`; pos = ''; }
    const tf = o.rot || o.skew ? `transform="${o.rot ? `rotate(${o.rot} ${r2(x)} ${r2(y)})` : ''}${o.skew ? ` skewX(${o.skew})` : ''}"` : '';
    const layer = (f, s, w, dy = 0, op = 1) => `<text ${pos} ${base} fill="${f}" ${s ? `stroke="${s}" stroke-width="${r2(w)}" paint-order="stroke"` : ''} ${dy ? `dy="${r2(dy)}"` : ''} ${op < 1 ? `opacity="${op}"` : ''} ${tf}>${body}</text>`;
    let out = '';
    if (o.shadow !== false) out += layer(o.shadowColor || stroke, o.shadowColor || stroke, sw + (o.outer ? o.outer.sw : 0), o.shadow ?? size * 0.08, o.shadowOpacity ?? 1);
    if (o.outer) out += layer(o.outer.color, o.outer.color, sw + o.outer.sw);
    out += layer(fill, stroke, sw);
    if (o.shine) out += `<g clip-path="${k.clip(`M-9999 -9999H9999V${r2(y - size * 0.38)}H-9999Z`)}">${layer('#ffffff', null, 0, 0, o.shine)}</g>`;
    return `<g>${out}</g>`;
  };

  // ---------- layout: composition anchors, margins, safe area, type scale (references/graphic-design.md) ----------
  // k.W / k.H are the asset's canvas inside layer functions; at the top of a spec pass the size: k.at('tl', 1920, 1080).
  // at(): 'center', thirds intersections 'tl' 'tr' 'bl' 'br', thirds lines through the middle 'top' 'bottom' 'left'
  // 'right', and the same on the golden-section grid (0.382 / 0.618) with a 'phi-' prefix ('phi-tl', 'phi-right').
  k.at = (name = 'center', w = k.W, h = k.H) => {
    const phi = name.startsWith('phi-'), f = phi ? 0.382 : 1 / 3, m = { center: 'cc', tl: 'lt', tr: 'rt', bl: 'lb', br: 'rb', top: 'ct', bottom: 'cb', left: 'lc', right: 'rc' }[name.replace(/^phi-/, '')];
    if (!m) throw new Error(`k.at("${name}"): use center, tl, tr, bl, br, top, bottom, left, right (optionally phi-...)`);
    return [{ l: f, c: 0.5, r: 1 - f }[m[0]] * w, { t: f, c: 0.5, b: 1 - f }[m[1]] * h];
  };
  k.margin = (f = 0.05, w = k.W, h = k.H) => f * Math.min(w, h);
  // the box where titles and key elements are safe: inside the margin and above a thumbnail's covered bottom band.
  // Inside a layer the kit knows the kind; at the top of a spec pass the size and, for a thumbnail, bottom = 0.12.
  k.safe = (f = 0.05, w = k.W, h = k.H, bottom = null) => { const m = k.margin(f, w, h), K = k.ctx && k.ctx.asset && k.ctx.asset.K, band = (bottom != null ? bottom : K && K.safe && K.safe.bottom ? K.safe.bottom : 0) * h, y1 = h - Math.max(m, band); return { x: m, y: m, w: w - 2 * m, h: y1 - m, x1: w - m, y1, cx: w / 2, cy: (m + y1) / 2 }; };
  // modular type scale: ts = k.typeScale(64, 1.5); ts(0) = 64 (body), ts(1) = 96, ts(2) = 144 (title)...
  k.typeScale = (base, ratio = 1.5) => step => Math.round(base * Math.pow(ratio, step));

  // ---------- backgrounds and frames ----------
  const W = () => k.W, H = () => k.H;
  k.bg = {
    solid: (c) => `<rect width="${W()}" height="${H()}" fill="${c}"/>`,
    linear: (top, bottom, angle = 90) => { const a = angle * Math.PI / 180; return `<rect width="${W()}" height="${H()}" fill="${k.linear([[0, top], [1, bottom]], { x1: 0.5 - Math.cos(a) / 2, y1: 0.5 - Math.sin(a) / 2, x2: 0.5 + Math.cos(a) / 2, y2: 0.5 + Math.sin(a) / 2 })}"/>`; },
    radial: (inner, outer, { cx = 0.5, cy = 0.45, r = 0.75 } = {}) => `<rect width="${W()}" height="${H()}" fill="${k.radial([[0, inner], [1, outer]], { cx, cy, r })}"/>`,
    rays: ({ color = '#ffffff', n = 18, op = 0.18, cx = W() / 2, cy = H() / 2, rot = 0, width = 0.5 } = {}) => k.rays(cx, cy, Math.hypot(W(), H()), n, color, op, rot, width),
    vignette: (op = 0.45, color = '#000') => `<rect width="${W()}" height="${H()}" fill="${k.radial([[0.55, color, 0], [1, color, op]], { r: 0.75 })}"/>`,
    dots: (color = '#fff', op = 0.12, step = 32, r = 4) => { const pid = id('pt'); defs.push(`<pattern id="${pid}" width="${step}" height="${step}" patternUnits="userSpaceOnUse"><circle cx="${step / 4}" cy="${step / 4}" r="${r}" fill="${color}"/><circle cx="${step * 0.75}" cy="${step * 0.75}" r="${r}" fill="${color}"/></pattern>`); return `<rect width="${W()}" height="${H()}" fill="url(#${pid})" opacity="${op}"/>`; },
    stripes: (color = '#fff', op = 0.1, step = 40, angle = 45) => { const pid = id('pt'); defs.push(`<pattern id="${pid}" width="${step}" height="${step}" patternUnits="userSpaceOnUse" patternTransform="rotate(${angle})"><rect width="${step / 2}" height="${step}" fill="${color}"/></pattern>`); return `<rect width="${W()}" height="${H()}" fill="url(#${pid})" opacity="${op}"/>`; },
    // Rarity card background: glow in the rarity hue behind the subject, falling off to a deeper, calmer rim (so the
    // subject, not the background, is the most saturated thing), soft rays. rarity: common..mythic or a colour.
    rarity: (rarity = 'rare', { rays = true } = {}) => { const c = C.RARITY[rarity] || rarity, [, d1, b, l1, l2] = C.ramp(c, 5), calm = x => C.saturate(x, -0.3), rim = C.saturate(C.shade(c, -0.9), -0.45); return `<rect width="${W()}" height="${H()}" fill="${k.radial([[0, calm(l1)], [0.35, calm(b)], [0.75, calm(d1)], [1, rim]], { r: 0.72 })}"/>` + (rays ? k.bg.rays({ color: l2, op: 0.14, n: 16 }) : ''); },
    // Light pool behind the focal point: raises value contrast exactly where the eye should land.
    glowAt: (x, y, r, color = '#ffffff', op = 0.55) => `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r2(r)}" fill="${k.radial([[0, color, op], [0.45, color, op * 0.45], [1, color, 0]])}"/>`,
    // Haze band: lays the sky colour over far layers (atmospheric perspective) from y0 (full) to y1 (none).
    haze: (y0, y1, color = '#bcdcff', op = 0.6) => `<rect width="${W()}" height="${H()}" fill="${k.linear([[0, color, op], [1, color, 0]], { x1: 0, y1: y0 / H(), x2: 0, y2: y1 / H() })}"/>`,
    // Film / paper grain: grey noise for a front layer with blend 'overlay' or 'soft-light' (op 0.1-0.25). Takes the
    // digital sterility off big flat areas; leave it off icons that are shown small.
    grain: (op = 0.18, freq = 0.8, seed = 4) => { const i = id('gn'); defs.push(`<filter id="${i}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="3" seed="${seed}" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>`); return `<rect width="${W()}" height="${H()}" filter="url(#${i})" opacity="${op}"/>`; },
    // Colour grade: one gradient laid over the finished picture (blend 'soft-light' or 'overlay' on a front layer)
    // pulls every colour toward the light's temperature at the top and the shadow's at the bottom: unifies a scene.
    grade: (top = '#ffcf8a', bottom = '#4a3fa8', op = 0.35, angle = 90) => k.bg.linear(top, bottom, angle).replace('<rect ', `<rect opacity="${op}" `),
  };
  k.frame = {
    // Rounded card border (inventory slots, shop tiles). Draw it on a 'front' layer.
    card: ({ r = 0.14, border = 0.035, color = '#ffffff', inner = null, inset = 0 } = {}) => { const s = Math.min(W(), H()), bw = border * s; return `<path d="${k.rrect(inset + bw / 2, inset + bw / 2, W() - 2 * inset - bw, H() - 2 * inset - bw, r * s)}" fill="none" stroke="${color}" stroke-width="${r2(bw)}"/>` + (inner ? `<path d="${k.rrect(inset + bw * 1.5, inset + bw * 1.5, W() - 2 * inset - 3 * bw, H() - 2 * inset - 3 * bw, r * s - bw)}" fill="none" stroke="${inner}" stroke-width="${r2(bw * 0.35)}"/>` : ''); },
    // Circle rim for badges / passes (Roblox crops these to a circle).
    circle: ({ color = '#ffd34d', width = 0.045, inner = '#ffffff', inset = 0.02 } = {}) => { const s = Math.min(W(), H()), r = s / 2 - s * inset - s * width / 2; return `<circle cx="${W() / 2}" cy="${H() / 2}" r="${r2(r)}" fill="none" stroke="${color}" stroke-width="${r2(width * s)}"/>` + (inner ? `<circle cx="${W() / 2}" cy="${H() / 2}" r="${r2(r - width * s * 0.7)}" fill="none" stroke="${inner}" stroke-width="${r2(width * s * 0.22)}" opacity="0.7"/>` : ''); },
  };
  return k;
}
