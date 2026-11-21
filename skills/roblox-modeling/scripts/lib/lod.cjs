'use strict';
// Level of detail: a cheaper version of the model rebuilt from the same spec, the way a low-poly artist makes LOD1
// by hand: about half the segments and sides on every shape, fewer loft stations and outline points (the ones that
// matter least to the shape go first), no chamfers, and no detail parts (anything too small to see at distance).
// Rebuilding from the spec keeps the silhouette and the flat low-poly look, which generic decimation wrecks.
// The LOD keeps every bone and part name, so the full model's animations drive it unchanged.
const MD = require('./model.cjs');
const G = require('./geometry.cjs');

const DEFAULTS = { ratio: 0.5, minTris: 300, detailSize: 0.08 };

// The spec's "lod" field: false (off), true / { distance, cull } (on), or absent: on when the model has at least
// DEFAULTS.minTris triangles (simple models are not worth a second version). distance / cull are Roblox studs
// for the roblox-performance LodController (LodDistance / CullDistance attributes); null = its defaults.
function settings(model) {
  const v = model.spec.lod, tris = model.nodes.reduce((s, n) => s + (n.mesh ? n.mesh.tris.length : 0), 0);
  if (v === false) return { on: false, why: '"lod": false', tris };
  if (v == null && tris < DEFAULTS.minTris) return { on: false, why: `${tris} triangles, under ${DEFAULTS.minTris}: not worth a second version (set "lod": true to force)`, tris };
  const o = typeof v === 'object' && v ? v : {};
  return { on: true, tris, distance: o.distance == null ? null : +o.distance, cull: o.cull == null ? null : +o.cull };
}

// Detail parts: dropped from the LOD. A part's "lod" field decides ("drop" / "keep"); otherwise a rigid mesh part
// smaller than detailSize × the model's largest dimension in every direction (eyes, rivets, coins, gems) is detail,
// unless it sticks out of everything else: a part that sets the outline (eyes wider than a fish's body, a horn tip)
// stays, since the silhouette is what still reads at distance.
function detailParts(model) {
  const meshes = model.nodes.filter(n => n.mesh), all = []; meshes.forEach(n => all.push(...n.mesh.pos));
  const B = all.length ? G.bounds(all) : null, S = B ? Math.max(...B.size) : 1, out = new Set();
  for (const n of meshes) {
    const src = model.spec.parts.find(p => p.name === n.name || p.name === n.src) || {}, own = src.lod;
    if (own === 'keep') continue;
    if (own === 'drop') { out.add(n.name); continue; }
    if (n.skin || Math.max(...G.bounds(n.mesh.pos).size) >= DEFAULTS.detailSize * S) continue;
    const rest = []; meshes.forEach(m => { if (m !== n) rest.push(...m.mesh.pos); });
    const R = rest.length ? G.bounds(rest) : null;
    const outline = R && [0, 1, 2].some(i => B.lo[i] < R.lo[i] - 0.02 * S || B.hi[i] > R.hi[i] + 0.02 * S);
    if (!outline) out.add(n.name);
  }
  return out;
}

// Visvalingam with an error bound: drop the point whose triangle with its neighbours is smallest, until `keep`
// points are left or the next one sits further than `tol` from the line between its neighbours. The bound keeps
// curves that other parts rest on (a lid's arch under its straps) and only thins runs that are nearly straight.
function simplifyClosed(pts, keep, tol) {
  const p = pts.slice(), area = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  const dev = (a, b, c) => area(a, b, c) * 2 / (Math.hypot(c[0] - a[0], c[1] - a[1]) || 1e-12);
  while (p.length > keep) {
    let best = 0, bestA = Infinity;
    for (let i = 0; i < p.length; i++) { const a = area(p[(i + p.length - 1) % p.length], p[i], p[(i + 1) % p.length]); if (a < bestA) { bestA = a; best = i; } }
    if (tol != null && dev(p[(best + p.length - 1) % p.length], p[best], p[(best + 1) % p.length]) > tol) break;
    p.splice(best, 1);
  }
  return p;
}
// Loft stations: drop the interior station that its neighbours predict best (width, height, offsets), keep the ends.
function simplifyStations(st, keep) {
  const s = st.slice().sort((a, b) => a.at - b.at), g = (x, k, d) => (x[k] == null ? d : x[k]);
  while (s.length > keep && s.length > 3) {
    let best = -1, bestE = Infinity;
    for (let i = 1; i < s.length - 1; i++) {
      const a = s[i - 1], b = s[i], c = s[i + 1], t = (b.at - a.at) / ((c.at - a.at) || 1), size = Math.max(g(b, 'w', 1), g(b, 'h', 1), 1e-6);
      const e = ['w', 'h', 'dx', 'dy'].reduce((q, k) => q + Math.abs(g(b, k, k[0] === 'd' ? 0 : 1) - (g(a, k, k[0] === 'd' ? 0 : 1) + (g(c, k, k[0] === 'd' ? 0 : 1) - g(a, k, k[0] === 'd' ? 0 : 1)) * t)), 0) / size;
      if (b.shape != null && JSON.stringify(b.shape) !== JSON.stringify(a.shape)) continue;   // a section change is a feature
      if (e < bestE) { bestE = e; best = i; }
    }
    if (best < 0) break;
    s.splice(best, 1);
  }
  return s;
}
const half = (v, min) => Math.max(min, Math.ceil(v * 0.55));

// One part's cheaper parameters.
function reducePart(p) {
  const q = JSON.parse(JSON.stringify(p));
  switch (q.shape) {
    case 'cylinder': case 'cone': case 'lathe': q.segments = half(q.segments || 8, 5); break;
    case 'sphere':
      if (q.detail != null || q.ico) q.detail = Math.max(0, (q.detail || 0) - 1);
      else { const [lon, lat] = Array.isArray(q.segments) ? q.segments : [q.segments || 8, Math.max(2, Math.round((q.segments || 8) / 2))]; q.segments = [half(lon, 5), half(lat, 3)]; }
      break;
    case 'torus': { const [a, b] = Array.isArray(q.segments) ? q.segments : [q.segments || 8, 4]; q.segments = [half(a, 5), half(b, 3)]; break; }
    case 'loft':
      { const n = q.sides || 6; q.sides = Math.max(4, 2 * Math.round(n * 0.35)); }   // even counts keep the section symmetric (8 -> 6, 6 -> 4)
      if (q.stations && q.stations.length > 4) q.stations = simplifyStations(q.stations, Math.max(4, Math.ceil(q.stations.length * 0.6)));
      if (q.skin) delete q.skin.loops;
      break;
    case 'extrude':
      if (q.outline && q.outline.length > 5) {
        const xs = q.outline.map(v => v[0]), ys = q.outline.map(v => v[1]), size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
        q.outline = simplifyClosed(q.outline, Math.max(4, Math.ceil(q.outline.length * 0.6)), 0.015 * size);
      }
      break;
    case 'box': delete q.chamfer; break;
    default: break;
  }
  return q;
}

// The LOD model: compiled from the reduced spec, detail parts dropped (a dropped part that still carries children
// becomes an empty pivot, so the hierarchy and the animations stay intact).
function build(model) {
  const drop = detailParts(model), spec = JSON.parse(JSON.stringify(model.spec));
  spec.title = (model.title || model.name) + ' (LOD)'; spec.checks = []; delete spec.lod; spec.budget = Math.max(spec.budget || 2000, 1);
  const parentOf = new Set(spec.parts.map(p => p.parent).filter(Boolean));
  spec.parts = spec.parts.map(p => {
    if (!drop.has(p.name)) return reducePart(p);
    const n = model.byName.get(p.name);
    const hasKids = parentOf.has(p.name) || (p.mirror && parentOf.has(n && n.mirrored ? n.name : (p.mirrorName || '')));
    return hasKids ? { name: p.name, parent: p.parent, shape: 'none', pivot: n ? n.pivot : p.at, mirror: p.mirror, mirrorName: p.mirrorName } : null;
  }).filter(Boolean);
  const lod = MD.compile(spec);
  return { model: lod, dropped: [...drop] };
}

module.exports = { DEFAULTS, settings, detailParts, reducePart, simplifyClosed, simplifyStations, build };
