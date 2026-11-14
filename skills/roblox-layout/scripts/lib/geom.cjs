// Geometry and random helpers shared by the generators, the checker and the exporters.
// Conventions (same as Roblox): +Y up, an item's front is its local -Z, `rot` is yaw in degrees
// (CFrame.Angles(0, math.rad(rot), 0)), positions are the centre of the footprint with y at the base.
"use strict";

const rad = d => d * Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const round = (v, p = 100) => Math.round(v * p) / p;

// Deterministic PRNG (mulberry32). The Luau kit's Rng module is the same generator.
function rng(seed) {
  let a = (seed >>> 0) || 1;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: arr => arr[Math.floor(next() * arr.length)],
    chance: p => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),
  };
}

// Smooth value noise in 0..1, seeded. Good enough for biome and density fields.
function noise2(seed) {
  const h = (x, z) => {
    let n = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const s = t => t * t * (3 - 2 * t);
  const one = (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z), fx = s(x - xi), fz = s(z - zi);
    return lerp(lerp(h(xi, zi), h(xi + 1, zi), fx), lerp(h(xi, zi + 1), h(xi + 1, zi + 1), fx), fz);
  };
  return (x, z, scale = 100, octaves = 2) => {
    let v = 0, amp = 1, tot = 0, f = 1 / scale;
    for (let o = 0; o < octaves; o++) { v += one(x * f + o * 17.3, z * f - o * 9.1) * amp; tot += amp; amp *= 0.5; f *= 2; }
    return v / tot;
  };
}

// Local (lx, lz) of an item at (x, z) with yaw `rot` -> world.
function l2w(x, z, rot, lx, lz) {
  const c = Math.cos(rad(rot)), s = Math.sin(rad(rot));
  return [x + lx * c + lz * s, z - lx * s + lz * c];
}
function w2l(x, z, rot, wx, wz) {
  const c = Math.cos(rad(rot)), s = Math.sin(rad(rot)), dx = wx - x, dz = wz - z;
  return [dx * c - dz * s, dx * s + dz * c];
}

// Footprint polygon (4 corners) of a resolved item, optionally grown by `g` studs.
function footprint(it, g = 0) {
  const hw = it.fw / 2 + g, hd = it.fd / 2 + g;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(p => l2w(it.x, it.z, it.rot, p[0], p[1]));
}
function rectPoly(x0, z0, x1, z1) { return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]; }

// The free space an item needs on each side to be usable, as polygons.
function clearZones(it) {
  const c = it.clear || {}, hw = it.fw / 2, hd = it.fd / 2, out = [];
  const add = (side, x0, z0, x1, z1) => out.push({ side, poly: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(p => l2w(it.x, it.z, it.rot, p[0], p[1])) });
  if (c.f > 0) add("front", -hw, -hd - c.f, hw, -hd);
  if (c.b > 0) add("back", -hw, hd, hw, hd + c.b);
  if (c.l > 0) add("left", -hw - c.l, -hd, -hw, hd);
  if (c.r > 0) add("right", hw, -hd, hw + c.r, hd);
  return out;
}
// The point a player stands on to use the item.
function usePoint(it) {
  const f = (it.clear && it.clear.f) || 0;
  return l2w(it.x, it.z, it.rot, 0, -(it.fd / 2 + Math.max(1.5, Math.min(f, 3) * 0.6)));
}

function segPoint(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
  const t = l2 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2, 0, 1) : 0;
  const q = [a[0] + dx * t, a[1] + dz * t];
  return { d: Math.hypot(p[0] - q[0], p[1] - q[1]), q };
}

// Distance between two convex polygons. dist = 0 when they overlap, and depth is then how far
// they interpenetrate (0 when only touching).
function polyDist(A, B) {
  let depth = Infinity;
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      let nx = b[1] - a[1], nz = a[0] - b[0];
      const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const p of A) { const v = p[0] * nx + p[1] * nz; a0 = Math.min(a0, v); a1 = Math.max(a1, v); }
      for (const p of B) { const v = p[0] * nx + p[1] * nz; b0 = Math.min(b0, v); b1 = Math.max(b1, v); }
      depth = Math.min(depth, Math.min(a1, b1) - Math.max(a0, b0));
    }
  }
  if (depth > 0) {
    const ca = centroid(A), cb = centroid(B);
    return { dist: 0, depth, pa: ca, pb: cb };
  }
  let best = { dist: Infinity, depth: 0, pa: A[0], pb: B[0] };
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) {
    const r = segPoint(A[i], B[j], B[(j + 1) % B.length]);
    if (r.d < best.dist) best = { dist: r.d, depth: 0, pa: A[i], pb: r.q };
    const r2 = segPoint(B[j], A[i], A[(i + 1) % A.length]);
    if (r2.d < best.dist) best = { dist: r2.d, depth: 0, pa: r2.q, pb: B[j] };
  }
  return best;
}
// True when the gap from pa to pb runs along a thin wall piece's length (the thing sits past the
// end of that piece, not in front of it), so it says nothing about being "off the wall".
function pastWallEnd(wall, pa, pb) {
  if (Math.min(wall.fw, wall.fd) > 1.6) return false;
  const [ux, uz] = wall.fw >= wall.fd ? [Math.cos(rad(wall.rot)), -Math.sin(rad(wall.rot))] : [Math.sin(rad(wall.rot)), Math.cos(rad(wall.rot))];
  const dx = pb[0] - pa[0], dz = pb[1] - pa[1], al = Math.abs(dx * ux + dz * uz), ac = Math.abs(-dx * uz + dz * ux);
  return al > ac;
}
function centroid(P) { let x = 0, z = 0; for (const p of P) { x += p[0]; z += p[1]; } return [x / P.length, z / P.length]; }
function pointInPoly(p, P) {
  let s = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const c = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (Math.abs(c) < 1e-9) continue;
    if (s === 0) s = Math.sign(c); else if (Math.sign(c) !== s) return false;
  }
  return true;
}
function polyBounds(P) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of P) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  return [x0, z0, x1, z1];
}

// Spread things of the given widths along a length so no gap is a "dead gap": every gap ends up
// either closed (touching) or at least `minGap` wide. Returns centre positions, or null if they
// don't fit. mode: "even" (equal gaps incl. both ends), "between" (equal gaps, flush ends),
// "center" (touching, centred), "start" (touching, from the start).
function distribute(length, widths, minGap = 4, mode = "even") {
  const sum = widths.reduce((a, b) => a + b, 0), n = widths.length;
  if (!n || sum > length + 1e-6) return null;
  const free = length - sum;
  const lay = (lead, gap) => { const out = []; let p = lead; for (const w of widths) { out.push(p + w / 2); p += w + gap; } return out; };
  if (mode === "even" && free / (n + 1) >= minGap) return lay(free / (n + 1), free / (n + 1));
  if (mode === "between" && n > 1 && free / (n - 1) >= minGap) return lay(0, free / (n - 1));
  if (mode === "start") return (free <= 0.5 || free >= minGap) ? lay(0, 0) : null;
  // touching and centred, as long as the leftover at each end is usable or negligible
  if (free / 2 >= minGap || free / 2 <= 0.5) return lay(free / 2, 0);
  if (free >= minGap) return lay(0, 0);
  return null;
}
// How many things of width w fit in `length` with at least `gap` between and at both ends.
function fitCount(length, w, gap) { return Math.max(0, Math.floor((length - gap) / (w + gap))); }

// Jump reach in studs (centre travel) when landing dy studs higher than take-off.
function jumpReach(dy, m = {}) {
  const g = m.gravity || 196.2, h = m.jumpHeight || 7.2, s = m.walkSpeed || 16;
  const v0 = Math.sqrt(2 * g * h), disc = v0 * v0 - 2 * g * dy;
  if (disc < 0) return 0;
  return s * (v0 + Math.sqrt(disc)) / g;
}

// How hard one jump is: 0 a comfortable hop, 1 the hardest fair jump, above 1 unfair.
// gap is edge to edge, dy the rise, land the smaller side of the landing platform.
function jumpBand(dy, m) { const reach = jumpReach(dy, m); return { reach, lo: Math.max(2.5, (reach - 2.5) * 0.55), hi: reach - 1.2 }; }
function jumpDifficulty(gap, dy, land, m = {}) {
  const b = jumpBand(dy, m), H = m.jumpHeight || 7.2;
  let r = gap <= 0.3 ? 0 : clamp((gap - b.lo) / Math.max(0.5, b.hi - b.lo), 0, 1.6);
  if (dy > 1) r = Math.max(r, clamp((dy / H - 0.3) / 0.55, 0, 1.6));
  if (land < 4 && gap > 0.3) r += (4 - land) * 0.12;
  return r;
}

// Poisson-disc scatter by dart throwing on a grid. radiusAt(x, z) returns the wanted spacing at a
// point, or 0 / null for "nothing here". Returns [{x, z, r}].
function poisson(R, x0, z0, x1, z1, radiusAt, opts = {}) {
  const rMin = opts.rMin || 4, cell = rMin / Math.SQRT2;
  const gw = Math.ceil((x1 - x0) / cell), gh = Math.ceil((z1 - z0) / cell);
  const grid = new Map(), pts = opts.existing ? opts.existing.slice() : [];
  const key = (i, j) => i * 100003 + j;
  const put = p => { const k = key(Math.floor((p.x - x0) / cell), Math.floor((p.z - z0) / cell)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(p); };
  pts.forEach(put);
  const out = [];
  const tries = opts.tries || Math.ceil(gw * gh * 1.6);
  for (let t = 0; t < tries; t++) {
    const x = R.range(x0, x1), z = R.range(z0, z1), r = radiusAt(x, z);
    if (!r) continue;
    const ci = Math.floor((x - x0) / cell), cj = Math.floor((z - z0) / cell), reach = Math.ceil(Math.max(r, opts.rMax || r) / cell);
    let ok = true;
    for (let i = ci - reach; i <= ci + reach && ok; i++) for (let j = cj - reach; j <= cj + reach && ok; j++) {
      const b = grid.get(key(i, j)); if (!b) continue;
      for (const q of b) { const need = Math.max(r, q.r || 0) ; if ((q.x - x) ** 2 + (q.z - z) ** 2 < need * need) { ok = false; break; } }
    }
    if (!ok) continue;
    const p = { x, z, r }; put(p); out.push(p);
    if (opts.max && out.length >= opts.max) break;
  }
  return out;
}

function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return "#" + [f(0), f(8), f(4)].map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => clamp(Math.round(f > 1 ? v + (255 - v) * (f - 1) : v * f), 0, 255));
  return "#" + c.map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

module.exports = { rad, clamp, lerp, round, rng, noise2, l2w, w2l, footprint, rectPoly, clearZones, usePoint, segPoint, polyDist, pastWallEnd, centroid, pointInPoly, polyBounds, distribute, fitCount, jumpReach, jumpBand, jumpDifficulty, poisson, hsl, shade };
