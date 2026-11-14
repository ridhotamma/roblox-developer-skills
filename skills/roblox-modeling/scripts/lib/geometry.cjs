'use strict';
// Low-poly shape generators. Every generator returns an indexed triangle mesh { pos: [[x,y,z]], tris: [[a,b,c]] }
// centred on its own origin, with outward-facing counter-clockwise triangles (right-handed, +Y up).
const M = require('./math.cjs');
const { add, sub, mul, cross, dot, len, unit, D2R } = M;

const AX = { x: 0, y: 1, z: 2 };
// Map a point built along +Y onto the requested axis (keeps handedness).
const toAxis = (p, axis) => (axis === 'x' ? [p[1], -p[0], p[2]] : axis === 'z' ? [p[0], -p[2], p[1]] : p);

function weld(mesh, eps) {
  eps = eps || 1e-6; const map = new Map(), pos = [], remap = [];
  const key = p => p.map(v => Math.round(v / eps)).join(',');
  mesh.pos.forEach((p, i) => { const k = key(p); if (!map.has(k)) { map.set(k, pos.length); pos.push(p.slice()); } remap[i] = map.get(k); });
  const tris = [];
  for (const t of mesh.tris) { const a = remap[t[0]], b = remap[t[1]], c = remap[t[2]]; if (a !== b && b !== c && a !== c) tris.push([a, b, c]); }
  return { pos, tris };
}
const triNormalRaw = (P, t) => cross(sub(P[t[1]], P[t[0]]), sub(P[t[2]], P[t[0]]));
const triArea = (P, t) => len(triNormalRaw(P, t)) / 2;
function signedVolume(mesh) { let v = 0; for (const t of mesh.tris) { const [a, b, c] = t.map(i => mesh.pos[i]); v += M.dot(a, cross(b, c)) / 6; } return v; }
function flip(mesh) { mesh.tris = mesh.tris.map(t => [t[0], t[2], t[1]]); return mesh; }
function outward(mesh) { if (signedVolume(mesh) < 0) flip(mesh); return mesh; }

// Ear clipping of a simple polygon given as 2D points (any winding). Returns index triples, CCW.
function triangulate2D(pts) {
  const n = pts.length; if (n < 3) return [];
  let area = 0; for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
  const idx = [...Array(n).keys()]; if (area < 0) idx.reverse();
  const out = [], cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p, a, b, c) => cr(a, b, p) >= -1e-12 && cr(b, c, p) >= -1e-12 && cr(c, a, p) >= -1e-12;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
      const a = pts[i0], b = pts[i1], c = pts[i2];
      if (cr(a, b, c) <= 1e-12) continue;
      let ear = true;
      for (const j of idx) if (j !== i0 && j !== i1 && j !== i2 && inside(pts[j], a, b, c)) { ear = false; break; }
      if (!ear) continue;
      out.push([i0, i1, i2]); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) { // degenerate (collinear) leftovers: drop one vertex
      idx.splice(0, 1);
    }
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}
// Triangulate a planar 3D polygon (vertex indices into P) so the result faces along `normal`.
function capPolygon(P, ring, normal) {
  let nn = [0, 0, 0];
  for (let i = 0; i < ring.length; i++) { const a = P[ring[i]], b = P[ring[(i + 1) % ring.length]]; nn = add(nn, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]); }
  if (len(nn) < 1e-12) nn = normal || [0, 1, 0];
  const n = unit(nn), u = unit(cross(Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], n)), v = cross(n, u);
  const pts = ring.map(i => [dot(P[i], u), dot(P[i], v)]);
  const tris = triangulate2D(pts).map(t => t.map(k => ring[k]));
  if (normal && dot(n, normal) < 0) return tris.map(t => [t[0], t[2], t[1]]);
  return tris;
}

// Build a closed tube from rings (arrays of points, or a single point for an apex). Rings run along the shape.
function ringsMesh(rings, opts) {
  opts = opts || {}; const P = [], T = [], ids = [];
  for (const r of rings) { const ii = []; for (const p of (Array.isArray(r[0]) ? r : [r])) { ii.push(P.length); P.push(p); } ids.push(ii); }
  for (let k = 0; k + 1 < ids.length; k++) {
    const A = ids[k], B = ids[k + 1];
    if (A.length === 1 && B.length === 1) continue;
    if (A.length === 1) { for (let i = 0; i < B.length; i++) T.push([A[0], B[(i + 1) % B.length], B[i]]); continue; }
    if (B.length === 1) { for (let i = 0; i < A.length; i++) T.push([A[i], A[(i + 1) % A.length], B[0]]); continue; }
    for (let i = 0; i < A.length; i++) { const i1 = (i + 1) % A.length; T.push([A[i], A[i1], B[i1]], [A[i], B[i1], B[i]]); }
  }
  const mesh = { pos: P, tris: T };
  if (opts.caps !== false) {
    const first = ids[0], last = ids[ids.length - 1];
    // Side triangles use ring edges i -> i+1 on the first ring and i+1 -> i on the last, so the caps take the
    // opposite direction on each: every edge then appears once each way and the whole mesh is consistently wound.
    if (first.length > 2) T.push(...capPolygon(P, first.slice().reverse()));
    if (last.length > 2) T.push(...capPolygon(P, last));
  }
  return mesh;
}
const fixClosed = m => outward(weld(m));

function circle(n, rx, rz, y, phase) {
  const out = []; phase = phase || 0;
  for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI + phase; out.push([Math.cos(a) * rx, y, -Math.sin(a) * rz]); }
  return out;
}

// --- primitives --------------------------------------------------------------------------------
function box(o) {
  const [w, h, d] = o.size || [1, 1, 1], tp = o.taper || [1, 1], hx = w / 2, hy = h / 2, hz = d / 2;
  if (o.chamfer) {
    const c = Math.min(o.chamfer, hx, hy, hz) * 0.999, pts = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const kx = sy > 0 ? tp[0] : 1, kz = sy > 0 ? tp[1] : 1;
      pts.push([sx * (hx * kx - c), sy * hy, sz * (hz * kz - c)], [sx * hx * kx, sy * (hy - c), sz * (hz * kz - c)], [sx * (hx * kx - c), sy * (hy - c), sz * hz * kz]);
    }
    return hull(pts);
  }
  const rect = (ax, az, y) => [[-ax, y, -az], [ax, y, -az], [ax, y, az], [-ax, y, az]];
  const b = rect(hx, hz, -hy), t = rect(hx * tp[0], hz * tp[1], hy);
  if (o.hollow) {
    // container walls of thickness `hollow`: open at the top (tray, chest, crate, drawer) or at both ends (frame, rim, sleeve)
    const k = Math.min(o.hollow, hx * 0.49, hz * 0.49), ti = rect(hx * tp[0] - k, hz * tp[1] - k, hy);
    if (o.open === 'both') return fixClosed(ringsMesh([b, t, ti, rect(hx - k, hz - k, -hy), b], { caps: false }));
    return fixClosed(ringsMesh([b, t, ti, rect(hx - k + (hx * tp[0] - hx) * (k / h), hz - k + (hz * tp[1] - hz) * (k / h), -hy + k)]));
  }
  return fixClosed(ringsMesh([b, t]));
}
function wedge(o) {                       // Roblox-style wedge: full height at the back (-z), sloping to the front edge (+z)
  const [w, h, d] = o.size || [1, 1, 1], hx = w / 2, hy = h / 2, hz = d / 2;
  return hull([[-hx, -hy, -hz], [hx, -hy, -hz], [-hx, -hy, hz], [hx, -hy, hz], [-hx, hy, -hz], [hx, hy, -hz]]);
}
function cylinder(o, isCone) {
  const n = Math.max(3, o.segments || 8), h = o.height == null ? 1 : o.height;
  let rb, rt;
  if (Array.isArray(o.radius)) [rb, rt] = o.radius; else rb = rt = o.radius == null ? 0.5 : o.radius;
  if (isCone && !Array.isArray(o.radius)) rt = 0;
  const sq = o.squash || 1;   // >1 widens along x relative to z (oval)
  const ring = (r, y) => (r <= 1e-9 ? [0, y, 0] : circle(n, r * sq, r, y, o.phase ? o.phase * D2R : Math.PI / n));
  const m = fixClosed(ringsMesh([ring(rb, -h / 2), ring(rt, h / 2)]));
  m.pos = m.pos.map(p => toAxis(p, o.axis || 'y')); return m;
}
function sphere(o) {
  const r = o.radius == null ? 0.5 : o.radius, R = Array.isArray(r) ? r : [r, r, r];
  if (o.detail != null || o.ico) {               // icosphere: the most even low-poly ball
    const t = (1 + Math.sqrt(5)) / 2;
    let P = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(unit);
    let T = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let d = 0; d < (o.detail || 0); d++) {
      const cache = new Map(), mid = (a, b) => { const k = a < b ? a + '_' + b : b + '_' + a; if (!cache.has(k)) { cache.set(k, P.length); P.push(unit(add(P[a], P[b]))); } return cache.get(k); };
      const NT = []; for (const [a, b, c] of T) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); NT.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); } T = NT;
    }
    return outward({ pos: P.map(p => [p[0] * R[0], p[1] * R[1], p[2] * R[2]]), tris: T });
  }
  const [lon, lat] = Array.isArray(o.segments) ? o.segments : [o.segments || 8, Math.max(2, Math.round((o.segments || 8) / 2))];
  const rings = [[0, -R[1], 0]];
  for (let j = 1; j < lat; j++) { const a = -Math.PI / 2 + (j / lat) * Math.PI; rings.push(circle(lon, Math.cos(a) * R[0], Math.cos(a) * R[2], Math.sin(a) * R[1], (j % 2) * (o.stagger ? Math.PI / lon : 0))); }
  rings.push([0, R[1], 0]);
  return fixClosed(ringsMesh(rings));
}
function torus(o) {
  const R = o.radius == null ? 0.5 : o.radius, r = o.tube == null ? 0.15 : o.tube, [nM, nm] = Array.isArray(o.segments) ? o.segments : [o.segments || 8, 4];
  const arc = (o.arc || 360) * D2R, full = (o.arc || 360) >= 360, steps = full ? nM : nM + 1, rings = [];
  for (let i = 0; i < steps; i++) {
    const a = (full ? i / nM : i / nM) * arc, c = [Math.cos(a) * R, 0, -Math.sin(a) * R], out = [Math.cos(a), 0, -Math.sin(a)], ring = [];
    for (let j = 0; j < nm; j++) { const b = (j / nm) * 2 * Math.PI + Math.PI / nm; ring.push(add(c, add(mul(out, Math.cos(b) * r), [0, Math.sin(b) * r, 0]))); }
    rings.push(ring);
  }
  let m;
  if (full) { rings.push(rings[0]); m = ringsMesh(rings, { caps: false }); } else m = ringsMesh(rings);
  m = fixClosed(m); m.pos = m.pos.map(p => toAxis(p, o.axis || 'y')); return m;
}
function lathe(o) {                       // profile [[radius, y], ...] from bottom to top, spun around the axis
  const n = Math.max(3, o.segments || 8), sq = o.squash || 1;
  const rings = (o.profile || []).map(([r, y]) => (r <= 1e-9 ? [0, y, 0] : circle(n, r * sq, r, y, Math.PI / n)));
  const m = fixClosed(ringsMesh(rings)); m.pos = m.pos.map(p => toAxis(p, o.axis || 'y')); return m;
}
// Loft: cross-sections ("stations") along an axis. The workhorse for organic bodies (fish, birds, boats, bottles).
// station: { at, w, h, dy?, dx?, shape?: "ellipse"|"rect"|"diamond"|[[u,v],...] }  (w, h are full widths)
function stationRing(s, n, axis, defShape) {
  const shape = s.shape || defShape || 'ellipse', w = (s.w == null ? 1 : s.w) / 2, h = (s.h == null ? 1 : s.h) / 2, dx = s.dx || 0, dy = s.dy || 0;
  if (w <= 1e-9 && h <= 1e-9) return [[dx, dy, s.at]];
  let uv;
  if (Array.isArray(shape)) uv = shape;
  else if (shape === 'rect') uv = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
  else if (shape === 'diamond') uv = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  else if (shape === 'roundrect') uv = [[1, -0.6], [1, 0.6], [0.6, 1], [-0.6, 1], [-1, 0.6], [-1, -0.6], [-0.6, -1], [0.6, -1]];
  else { uv = []; for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI - Math.PI / 2 + (n % 2 ? 0 : Math.PI / n); uv.push([Math.cos(a), Math.sin(a)]); } }
  return uv.map(([u, v]) => [dx + u * w, dy + v * h, s.at]);
}
function loft(o) {
  const st = (o.stations || []).slice().sort((a, b) => a.at - b.at), n = Math.max(3, o.sides || 6);
  // built along +z, then mapped: axis "z" (default) keeps it, "x" maps z->x, "y" maps z->y
  const rings = st.map(s => stationRing(s, n, o.axis, o.shape));
  const m = fixClosed(ringsMesh(rings));
  const ax = o.axis || 'z';
  m.pos = m.pos.map(p => (ax === 'x' ? [p[2], p[1], -p[0]] : ax === 'y' ? [p[0], p[2], -p[1]] : p));
  return m;
}
// Extrude a 2D outline. plane "xy": outline in x/y, extruded along z (front view outline)
// "zy": outline in z/y (side view: u = z forward, v = y up), extruded along x · "xz": top view (u = x, v = z), extruded along y
function extrude(o) {
  const out = o.outline || [], d = o.depth == null ? 0.1 : o.depth, tp = o.taper == null ? 1 : o.taper, plane = o.plane || 'xy';
  let cx = 0, cy = 0; out.forEach(p => { cx += p[0] / out.length; cy += p[1] / out.length; });
  const ring = (k, w) => out.map(([u, v]) => { const uu = cx + (u - cx) * k, vv = cy + (v - cy) * k; return [uu, vv, w]; });
  let m = fixClosed(ringsMesh([ring(1, -d / 2), ring(tp, d / 2)]));
  m.pos = m.pos.map(([u, v, w]) => (plane === 'zy' ? [w, v, u] : plane === 'xz' ? [u, w, v] : [u, v, w]));
  return outward(m);
}
// Incremental 3D convex hull. Good for gems, rocks, chamfered boxes, wedges.
function hull(points) {
  const P = points.map(p => p.slice()), n = P.length; if (n < 4) return { pos: P, tris: [] };
  const eps = 1e-9 * (1 + Math.max(...P.map(p => len(p))));
  let i0 = 0, i1 = 0; for (let i = 1; i < n; i++) { if (P[i][0] < P[i0][0]) i0 = i; if (P[i][0] > P[i1][0]) i1 = i; }
  if (i0 === i1) i1 = (i0 + 1) % n;
  let i2 = -1, best = -1; const d01 = sub(P[i1], P[i0]);
  for (let i = 0; i < n; i++) { const dd = len(cross(d01, sub(P[i], P[i0]))); if (dd > best) { best = dd; i2 = i; } }
  const nrm = cross(d01, sub(P[i2], P[i0])); let i3 = -1; best = -1;
  for (let i = 0; i < n; i++) { const dd = Math.abs(dot(nrm, sub(P[i], P[i0]))); if (dd > best) { best = dd; i3 = i; } }
  if (best < eps) return { pos: P, tris: [] };
  let faces = [[i0, i1, i2], [i0, i2, i3], [i0, i3, i1], [i1, i3, i2]];
  const cen = mul(add(add(P[i0], P[i1]), add(P[i2], P[i3])), 0.25);
  const plane = f => { const nn = unit(triNormalRaw(P, f)); return { n: nn, d: dot(nn, P[f[0]]) }; };
  faces = faces.map(f => (dot(plane(f).n, sub(P[f[0]], cen)) < 0 ? [f[0], f[2], f[1]] : f));
  for (let i = 0; i < n; i++) {
    if (i === i0 || i === i1 || i === i2 || i === i3) continue;
    const vis = faces.map(f => { const pl = plane(f); return dot(pl.n, P[i]) - pl.d > eps; });
    if (!vis.some(Boolean)) continue;
    const edges = new Map();
    faces.forEach((f, k) => { if (!vis[k]) return; for (let e = 0; e < 3; e++) { const a = f[e], b = f[(e + 1) % 3]; const rk = b + '_' + a; if (edges.has(rk)) edges.delete(rk); else edges.set(a + '_' + b, [a, b]); } });
    faces = faces.filter((f, k) => !vis[k]);
    for (const [a, b] of edges.values()) faces.push([a, b, i]);
  }
  return weld({ pos: P, tris: faces });
}
function rawMesh(o) {                     // { vertices: [[x,y,z]], faces: [[i,j,k,...]] } polygons are fan/ear triangulated
  const P = (o.vertices || []).map(p => p.slice()), T = [];
  for (const f of o.faces || []) { if (f.length === 3) T.push(f.slice()); else T.push(...capPolygon(P, f).map(t => t)); }
  const m = weld({ pos: P, tris: T }); return edgeReport(m).open === 0 ? outward(m) : m;
}

const SHAPES = { box, wedge, cylinder: o => cylinder(o, false), cone: o => cylinder(o, true), sphere, torus, lathe, loft, extrude, hull: o => hull(o.points || []), mesh: rawMesh };

// Open-edge / non-manifold edge count on the welded mesh (0 = watertight).
function edgeReport(mesh) {
  const w = weld(mesh, 1e-5), cnt = new Map();
  for (const t of w.tris) for (let e = 0; e < 3; e++) { const a = t[e], b = t[(e + 1) % 3], k = a < b ? a + '_' + b : b + '_' + a; cnt.set(k, (cnt.get(k) || 0) + 1); }
  let open = 0, nonManifold = 0; for (const c of cnt.values()) { if (c === 1) open++; else if (c > 2) nonManifold++; }
  return { open, nonManifold };
}
function bounds(P) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of P) for (let i = 0; i < 3; i++) { if (p[i] < lo[i]) lo[i] = p[i]; if (p[i] > hi[i]) hi[i] = p[i]; }
  return { lo, hi, size: sub(hi, lo), center: mul(add(lo, hi), 0.5) };
}
// Planes of a closed convex mesh (null if not convex) for penetration tests.
function convexPlanes(mesh, tol) {
  const planes = [], B = bounds(mesh.pos), scale = len(B.size) || 1; tol = (tol || 1e-4) * scale;
  for (const t of mesh.tris) {
    const nr = triNormalRaw(mesh.pos, t); if (len(nr) < 1e-12) continue;
    const nn = unit(nr), d = dot(nn, mesh.pos[t[0]]);
    for (const p of mesh.pos) if (dot(nn, p) - d > tol) return null;
    planes.push({ n: nn, d });
  }
  return planes;
}

module.exports = { SHAPES, weld, flip, outward, signedVolume, triangulate2D, capPolygon, ringsMesh, hull, edgeReport, bounds, convexPlanes, triArea, triNormalRaw, AX };
