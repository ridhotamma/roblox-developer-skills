'use strict';
// The test suite every model runs: geometry health, assembly, reference proportions, and per-animation behaviour.
// Each result: { id, status: "pass" | "fail" | "warn", msg }.
const path = require('path');
const M = require('./math.cjs');
const G = require('./geometry.cjs');
const MD = require('./model.cjs');
const { sub, dot, len } = M;
const { pointTriDist, distToMesh, insideByRay } = G;
const ROBLOX_MESH_TRIS = 20000;   // per-mesh triangle limit of Roblox's 3D Importer (per MeshPart)

// Closest distance between two meshes (vertex-to-triangle both ways; exact enough for low-poly parts). 0 when they overlap.
function meshGap(A, B) {
  const bA = G.bounds(A.pos), bB = G.bounds(B.pos);
  let sep = 0; for (let i = 0; i < 3; i++) sep = Math.max(sep, bA.lo[i] - bB.hi[i], bB.lo[i] - bA.hi[i]);
  if (sep > 0) { const big = sep; if (big > 0.25 * Math.max(len(bA.size), len(bB.size))) return big; }
  if (penetration(A, B) > 0 || penetration(B, A) > 0) return 0;
  let best = Infinity;
  for (const [P, Q] of [[A, B], [B, A]]) for (const p of P.pos) for (const t of Q.tris) { const d = pointTriDist(p, Q.pos[t[0]], Q.pos[t[1]], Q.pos[t[2]]); if (d < best) best = d; }
  return best;
}
// Deepest point of A inside B. Exact for convex B; for concave B uses ray parity inside test and distance to surface.
function penetration(A, B) {
  const planes = B.planes !== undefined ? B.planes : (B.planes = G.convexPlanes(B));
  const bB = G.bounds(B.pos); let deepest = 0;
  for (const p of samplePoints(A)) {
    if (p[0] < bB.lo[0] || p[0] > bB.hi[0] || p[1] < bB.lo[1] || p[1] > bB.hi[1] || p[2] < bB.lo[2] || p[2] > bB.hi[2]) continue;
    if (planes) { let d = Infinity; for (const pl of planes) { const s = pl.d - dot(pl.n, p); if (s < d) d = s; if (d <= 0) break; } if (d > deepest) deepest = d; }
    else if (insideByRay(p, B)) { let d = Infinity; for (const t of B.tris) d = Math.min(d, pointTriDist(p, B.pos[t[0]], B.pos[t[1]], B.pos[t[2]])); if (d > deepest) deepest = d; }
  }
  return deepest;
}
// Vertices alone miss a thin part slicing through a box (its corners end up outside), so also sample along every
// edge and across every face.
function samplePoints(A) {
  if (A.samples) return A.samples;
  const out = A.pos.slice(), seen = new Set(), n = 6;
  for (const t of A.tris) {
    for (let e = 0; e < 3; e++) {
      const a = t[e], b = t[(e + 1) % 3], k = a < b ? a + '_' + b : b + '_' + a; if (seen.has(k)) continue; seen.add(k);
      for (let i = 1; i < n; i++) out.push(M.vlerp(A.pos[a], A.pos[b], i / n));
    }
    const [p, q, r] = t.map(i => A.pos[i]);
    for (const [u, v] of [[1 / 3, 1 / 3], [0.6, 0.2], [0.2, 0.6], [0.2, 0.2]]) out.push(M.add(M.add(M.mul(p, 1 - u - v), M.mul(q, u)), M.mul(r, v)));
  }
  return (A.samples = out);
}
// Coplanar, same-facing, overlapping faces of two different parts flicker ("z-fighting") in every engine.
function zFight(A, B, eps) {
  const bA = G.bounds(A.pos), bB = G.bounds(B.pos);
  for (let i = 0; i < 3; i++) if (bA.lo[i] > bB.hi[i] + eps || bB.lo[i] > bA.hi[i] + eps) return 0;
  let area = 0;
  const fa = A.tris.map(t => face(A.pos, t)).filter(Boolean), fb = B.tris.map(t => face(B.pos, t)).filter(Boolean);
  for (const a of fa) for (const b of fb) {
    if (dot(a.n, b.n) < 0.9999 || Math.abs(a.d - b.d) > eps) continue;
    const u = M.unit(M.cross(Math.abs(a.n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], a.n)), v = M.cross(a.n, u);
    const P = a.p.map(p => [dot(p, u), dot(p, v)]), Q = b.p.map(p => [dot(p, u), dot(p, v)]);
    area += overlap2D(P, Q);
  }
  return area;
}
function face(P, t) { const p = t.map(i => P[i]), nr = M.cross(sub(p[1], p[0]), sub(p[2], p[0])), L = len(nr); if (L < 1e-12) return null; const n = M.mul(nr, 1 / L); return { p, n, d: dot(n, p[0]) }; }
function overlap2D(P, Q) {                     // area of the intersection of two triangles (convex clip)
  const area = poly => { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
  if (area(P) < 0) P = P.slice().reverse(); if (area(Q) < 0) Q = Q.slice().reverse();
  let out = P;
  for (let i = 0; i < 3 && out.length; i++) {
    const a = Q[i], b = Q[(i + 1) % 3], side = p => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]), inp = out; out = [];
    for (let k = 0; k < inp.length; k++) {
      const c = inp[k], d = inp[(k + 1) % inp.length], sc = side(c), sd = side(d);
      if (sc >= 0) out.push(c);
      if ((sc >= 0) !== (sd >= 0)) { const t = sc / (sc - sd); out.push([c[0] + (d[0] - c[0]) * t, c[1] + (d[1] - c[1]) * t]); }
    }
  }
  return out.length >= 3 ? Math.abs(area(out)) : 0;
}
const posed = (model, clip, t) => MD.posedMeshes(model, clip, t).map(m => ({ name: m.node.name, node: m.node, pos: m.pos, tris: m.tris }));
const timeOf = (clip, at) => (at === 'end' || at == null ? clip.duration : at === 'start' ? 0 : at === 'mid' ? clip.duration / 2 : +at);
// Vertices of A on the weld seam against B: inside B and touching a vertex outside B, plus the inside ring next to it.
function seamBand(A, B) {
  const inside = A.pos.map(p => distToMesh(p, B) <= 1e-6), seam = new Set(), edges = [];
  for (const t of A.tris) for (let e = 0; e < 3; e++) {
    const a = t[e], b = t[(e + 1) % 3]; edges.push([a, b]);
    if (inside[a] !== inside[b]) seam.add(inside[a] ? a : b);
  }
  const band = new Set(seam);
  for (const [a, b] of edges) { if (seam.has(a) && inside[b]) band.add(b); if (seam.has(b) && inside[a]) band.add(a); }
  return [...band];
}

function run(model, opts) {
  opts = opts || {}; const out = [], add = (id, status, msg) => out.push({ id, status, msg });
  for (const e of model.errors) add('spec', 'fail', e);
  for (const w of model.warnings) add('spec', 'warn', w);
  if (model.errors.length) return out;
  const rest = posed(model, null, 0), all = []; rest.forEach(m => all.push(...m.pos));
  if (!all.length) { add('geometry', 'fail', 'model has no visible geometry'); return out; }
  const B = G.bounds(all), size = len(B.size) || 1, tol = Math.max(1e-4, size * 0.004);

  // 1. geometry health
  const tris = rest.reduce((s, m) => s + m.tris.length, 0);
  add('budget', tris <= model.budget ? 'pass' : 'fail', `${tris} triangles (budget ${model.budget})`);
  let geomOk = true, openParts = 0;
  for (const m of rest) {
    const n = m.node, P = n.mesh.pos, T = n.mesh.tris;
    if (P.some(p => p.some(v => !Number.isFinite(v)))) { add('geometry', 'fail', `${n.name}: NaN/Infinity in vertices`); geomOk = false; continue; }
    // Roblox imports each part as its own MeshPart, and the importer refuses a mesh over its triangle limit
    if (T.length > ROBLOX_MESH_TRIS) add('budget', 'fail', `${n.name}: ${T.length} triangles in one part, over Roblox's ${ROBLOX_MESH_TRIS} per-mesh limit — the 3D Importer will not take it; split the part or lower its segments / sides / stations`);
    const e = G.edgeReport(n.mesh), vol = G.signedVolume(n.mesh), degenerate = T.filter(t => G.triArea(P, t) < 1e-12).length;
    if (e.open || e.nonManifold) {
      if (n.openSurface && !e.nonManifold && model.targets.includes('roblox')) { add('geometry', 'fail', `${n.name}: an open surface (${e.open} open edges) — Roblox requires every mesh to be watertight with some volume, so "openSurface" is only for specs whose "targets" leave Roblox out. Give the sheet a thickness instead (an extrude with depth 4-6 mm, a loft with a thin section)`); geomOk = false; }
      else if (n.openSurface && !e.nonManifold) openParts++;
      else { add('geometry', 'fail', `${n.name}: ${e.open} open edges, ${e.nonManifold} non-manifold edges — not watertight, so it shows holes or see-through faces and the inside / overlap tests are unreliable. Close the shape (caps on lofts and lathes, every outline point joined) or, for a deliberately open sheet (flag, cape, leaf), add "openSurface": true`); geomOk = false; }
    }
    else if (vol <= 0) { add('geometry', 'fail', `${n.name}: inside-out (faces point inwards, it will render see-through)`); geomOk = false; }
    if (e.flipped) { add('geometry', 'fail', `${n.name}: ${e.flipped} edges where neighbouring faces wind opposite ways — some faces point inwards and render see-through; fix the vertex order of those faces (counter-clockwise seen from outside)`); geomOk = false; }
    if (degenerate) { add('geometry', 'warn', `${n.name}: ${degenerate} zero-area triangles`); geomOk = false; }
    // slivers: near-flat triangles (one corner over 175°, a vertex lying on the opposite edge) and near-duplicate
    // vertices (an edge under 0.1% of the part). Long thin triangles on long thin parts are normal and allowed.
    const diag = len(G.bounds(P).size) || 1; let flat = 0, dup = 0;
    for (const t of T) {
      if (G.triArea(P, t) < 1e-12) continue;
      if (G.triAngles(P, t)[1] > 175) flat++;
      else if (Math.min(M.dist(P[t[0]], P[t[1]]), M.dist(P[t[1]], P[t[2]]), M.dist(P[t[2]], P[t[0]])) < diag * 1e-3) dup++;
    }
    if (flat || dup) { add('geometry', 'warn', `${n.name}: ${flat ? `${flat} near-flat sliver triangle${flat > 1 ? 's' : ''} (a corner over 175°)` : ''}${flat && dup ? ' and ' : ''}${dup ? `${dup} triangle${dup > 1 ? 's' : ''} with an edge under 0.1% of the part (near-duplicate vertices)` : ''} — they shade badly and flip when the mesh bends; remove outline points / stations that almost repeat or lie on a straight line between their neighbours`); geomOk = false; }
    // a part cutting through itself (a loft whose rings cross, a raw mesh with crossing faces)
    const si = G.selfIntersections(n.mesh, size * 1e-5);
    if (si.count) {
      const at = si.tris.slice(0, 3).map(([i]) => { const c = si.welded[i].map(k => si.pos[k]); return '[' + [0, 1, 2].map(a => ((c[0][a] + c[1][a] + c[2][a]) / 3).toFixed(3)).join(', ') + ']'; });
      add('geometry', 'fail', `${n.name}: cuts through itself (${si.count} crossing triangle pair${si.count > 1 ? 's' : ''}, near ${at.join(', ')}) — the surface folds into its own inside; space the stations / profile points out, keep each ring inside its neighbours' offsets, or split it into separate parts`); geomOk = false;
    }
    const bs = G.bounds(m.pos).size; if (Math.min(...bs) < size * 0.002) add('geometry', 'warn', `${n.name}: paper-thin (${Math.min(...bs).toFixed(4)} m) — flickers and vanishes edge-on`);
  }
  if (geomOk) add('geometry', 'pass', `${rest.length} parts watertight${openParts ? ` (except ${openParts} declared open surface${openParts > 1 ? 's' : ''})` : ''}, outward-facing, consistently wound, no degenerate or sliver triangles, no self-intersections`);

  // 1b. z-fighting between parts, at rest and at the end of each clip (an open lid shows its underside)
  {
    const poses = [['rest', rest]].concat(model.clips.map(c => [`${c.name} end`, posed(model, c, c.duration)])), seen = new Map();
    for (const [when, meshes] of poses) for (let i = 0; i < meshes.length; i++) for (let j = i + 1; j < meshes.length; j++) {
      const a = zFight(meshes[i], meshes[j], size * 2e-4), k = meshes[i].name + ' / ' + meshes[j].name;
      if (a > size * size * 1e-5 && !seen.has(k)) seen.set(k, `${k} (${(a * 1e4).toFixed(1)} cm² at ${when})`);
    }
    if (seen.size) add('z-fighting', 'fail', `coplanar overlapping faces will flicker: ${[...seen.values()].join('; ')}. Offset one face by a few mm or make one part slightly smaller.`);
    else add('z-fighting', 'pass', 'no coplanar overlapping faces between parts');
  }
  // 1c. rig readiness of skinned parts: edge loops where they bend, bones inside the body on its centre line.
  // Thin plates (fins, membranes, capes) get the edge-loop and fold/pinch/stretch checks, not the volume ones.
  const thick = m => { const b = G.bounds(m.pos).size; return Math.min(...b) >= 0.1 * Math.max(...b); };
  for (const m of rest) if (m.node.skinBones && !m.node.bindTo) rigCheck(model, m, add, !thick(m));
  // 2. assembly: every part touches the rest (no floating pieces), rests on the ground
  if (rest.length > 1) {
    const adj = rest.map(() => new Set());
    for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) if (meshGap(rest[i], rest[j]) <= tol * 1.5) { adj[i].add(j); adj[j].add(i); }
    const seen = new Set([0]), st = [0]; while (st.length) { const i = st.pop(); for (const j of adj[i]) if (!seen.has(j)) { seen.add(j); st.push(j); } }
    const floating = rest.filter((_, i) => !seen.has(i)).map(m => m.name);
    if (floating.length && floating.length * 2 > rest.length) {   // report the smaller group as the floating one
      const other = rest.filter((_, i) => seen.has(i)).map(m => m.name); add('assembly', 'fail', `parts not connected to each other: [${other.join(', ')}] vs [${floating.join(', ')}]`);
    } else add('assembly', floating.length ? 'fail' : 'pass', floating.length ? `floating parts (touch nothing): ${floating.join(', ')} — move them into contact or overlap slightly` : 'every part touches the assembly');
  }
  if (model.ground) {
    const minY = B.lo[1];
    add('ground', Math.abs(minY) <= tol ? 'pass' : 'fail', Math.abs(minY) <= tol ? 'sits on the ground (y = 0)' : `lowest point is y = ${minY.toFixed(4)} m; it should be 0 (${minY > 0 ? 'hovering' : 'sunk into the floor'}). Set "ground": false for things that float or swim.`);
  }
  // 3. reference dimensions
  const ref = model.reference || {}, dims = ref.dimensions;
  if (dims) {
    const want = [dims.width != null ? dims.width : dims.x, dims.height != null ? dims.height : dims.y, dims.depth != null ? dims.depth : dims.z], dtol = dims.tolerance || 0.06;
    ['width (x)', 'height (y)', 'depth (z)'].forEach((lab, i) => {
      if (want[i] == null) return; const err = B.size[i] / want[i] - 1;
      add('dimensions', Math.abs(err) <= dtol ? 'pass' : 'fail', `${lab}: ${B.size[i].toFixed(3)} m vs reference ${want[i]} m (${err >= 0 ? '+' : ''}${(err * 100).toFixed(1)}%, tolerance ${(dtol * 100).toFixed(0)}%)`);
    });
  } else add('dimensions', 'warn', 'no reference.dimensions: the overall size is unchecked');
  if (!(ref.sources && ref.sources.length)) add('reference', 'warn', 'no reference.sources: record the images you modelled from');

  // 4. animations
  const restOverlap = new Map();
  const pairKey = (a, b) => a.name < b.name ? a.name + '|' + b.name : b.name + '|' + a.name;
  for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) {
    const a = rest[i], b = rest[j]; restOverlap.set(pairKey(a, b), Math.max(penetration(a, b), penetration(b, a)));
  }
  const attached = [];
  {
    const above = (a, n) => { for (let k = n; k; k = k.parent) if (k === a) return true; return false; };   // a is n or one of its ancestors
    const linked = (A, B) => above(A.node, B.node.parent) || above(B.node, A.node.parent) ||
      (A.node.skinBones && A.node.skinBones.some(b => above(b, B.node))) || (B.node.skinBones && B.node.skinBones.some(b => above(b, A.node))) ||
      (A.node.bindTo && A.node.bindTo === B.node.name) || (B.node.bindTo && B.node.bindTo === A.node.name);
    for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) {
      if (!linked(rest[i], rest[j]) || meshGap(rest[i], rest[j]) > tol * 1.5) continue;
      // the joint = the seam band: child vertices inside the parent that have an edge to a vertex outside it, plus
      // one ring inward. A buried fin tip has no outside neighbour and is not part of the weld; the crossing line is.
      // For a rigid appendage on a deforming body, only the root near its pivot is welded: the rest of the fin is
      // free to sweep out of the surface (the seam moves when it flaps).
      const bandFor = (A, B) => {
        const idx = seamBand(A, B);
        if (A.node.skin || A.node.bindTo) return idx;
        if (above(A.node, B.node.parent) || above(B.node, A.node.parent)) return idx;   // direct parent/child hinge
        const r = 0.3 * len(G.bounds(A.pos).size);
        return idx.filter(k => M.dist(A.node.pivot, A.pos[k]) <= r);
      };
      attached.push([i, j, bandFor(rest[i], rest[j]), bandFor(rest[j], rest[i])]);
    }
  }
  // 4a. welding: an appendage that meets a deforming body must sink into it, not kiss it, and its root edge must
  // stay on the body along its whole length (a straight chord across a curved back shows as a cut).
  const ownTracks = new Set(); model.clips.forEach(c => c.tracks.forEach(t => { if (t.rot || t.pos || t.scale) ownTracks.add(t.node); }));
  const soft = m => !!(m.node.skin || m.node.bindTo);
  const above = (a, n) => { for (let k = n; k; k = k.parent) if (k === a) return true; return false; };
  const iIsChild = (i, j) => above(rest[j].node, rest[i].node.parent), jIsChild = (i, j) => above(rest[i].node, rest[j].node.parent);
  const syncTol = Math.max(tol * 1.5, 0.0015);
  const partTol = m => Math.max(1e-4, Math.min(tol, 0.02 * len(G.bounds(m.pos).size)));
  const closestN = (m, other, n) => m.pos.map((p, k) => [distToMesh(p, other), k]).sort((a, b) => a[0] - b[0]).slice(0, n).map(x => x[1]);
  let softPairs = 0, shallowRoots = 0, cutSeams = 0;
  for (const [i, j, ai, aj] of attached) {
    if (!soft(rest[i]) && !soft(rest[j])) continue;
    softPairs++;
    const childIsI = iIsChild(i, j) || (!jIsChild(i, j) && rest[i].pos.length <= rest[j].pos.length);
    const child = childIsI ? rest[i] : rest[j], parent = childIsI ? rest[j] : rest[i];
    const ci = (childIsI ? ai : aj).length ? (childIsI ? ai : aj) : closestN(child, parent, 3);
    const name = `${child.name} / ${parent.name}`;
    const pen = penetration(child, parent);
    const weldTol = partTol(child) * 0.5;
    // spheres (eyes, knobs) are meant to sit half in a socket; only thin/blunt appendages need a sunk root line
    if (child.node.shape !== 'sphere' && child.node.shape !== 'torus' && pen < weldTol) {
      shallowRoots++;
      const hinged = ownTracks.has(child.node);
      add('weld', hinged ? 'fail' : 'warn', `${name}: ${child.name} sinks ${(pen * 1000).toFixed(1)} mm into ${parent.name}${hinged ? '' : ' (a root needs 3-5 mm)'} — its root only touches the surface, so a rotated joint or a bend opens a visible crack; sink the root line 3-5 mm into the body`);
    }
    if (ci.length >= 2 && child.node.shape !== 'sphere' && child.node.shape !== 'torus') {
      let worst = 0; const set = new Set(ci);
      for (const t of child.tris) for (let e = 0; e < 3; e++) {
        const a = t[e], b = t[(e + 1) % 3]; if (!set.has(a) || !set.has(b)) continue;
        for (let s = 1; s < 4; s++) worst = Math.max(worst, distToMesh(M.vlerp(child.pos[a], child.pos[b], s / 4), parent));
      }
      if (worst > weldTol) { cutSeams++; add('seam', worst > weldTol * 2 ? 'fail' : 'warn', `${name}: the root edge leaves ${parent.name} by ${(worst * 1000).toFixed(1)} mm between two welded points — its straight edge cuts through the air; add an outline point that follows the body contour so the whole root stays inside`); }
    }
  }
  if (softPairs && !shallowRoots) add('weld', 'pass', `${softPairs} appendage roots are sunk into their bodies`);
  if (softPairs && !cutSeams) add('seam', 'pass', 'root edges follow the body contour along their whole length');
  // 4b. fins vs body: a part touching a skinned surface must move with the weights under its root. A rigid fin
  // on one bone drifts as soon as that part of the body blends two bones; a fin skinned to different bones does too.
  const syncPairs = [];
  {
    const WmRest = MD.worldMatrices(model, null), seen = new Set();
    const rotates = new Set(), translates = new Set();
    model.clips.forEach(c => c.tracks.forEach(t => { if (t.rot) rotates.add(t.node); if (t.pos || t.scale) translates.add(t.node); }));
    for (const [i, j, ai, aj] of attached) for (const [s, r, idx0] of [[i, j, aj], [j, i, ai]]) {
      const S = rest[s].node, R = rest[r].node;
      if (!S.skinBones || !S.skin || S.bindTo) continue;
      if (R.bindTo) continue;                                   // bound parts follow this surface by construction
      if (translates.has(R)) continue;                          // a part that slides/scales itself is meant to move relative to the body
      if (R.skinBones && rest[r].pos.length > rest[s].pos.length) continue;   // both skinned: compare the appendage
      const k = pairKey(rest[r], rest[s]); if (seen.has(k)) continue; seen.add(k);
      const ax = S.skin.axis || 'z';
      // A hinged part deliberately rotates about its pivot, so its root vertices necessarily move a little. Sample
      // the pivot instead: an unfixed pivot slides along the body, which is the drift that matters.
      const pivotOnly = rotates.has(R);
      const idx = pivotOnly ? [] : (idx0.length ? idx0 : closestN(rest[r], rest[s], 3));
      const pts = pivotOnly ? [R.pivot] : idx.map(n => rest[r].pos[n]);
      const sp = { s, r, idx, pts, pivotOnly, S, R, ax, tol: Math.max(1e-4, Math.min(syncTol, 0.015 * len(G.bounds(rest[r].pos).size))), weights: pts.map(p => MD.weightAt(S, p[G.AX[ax]])) };
      const restMats = S.skinBones.map(b => M.mat4Mul(WmRest.get(b), M.mat4Translate(M.mul(b.pivot, -1))));
      const predict = (mats, p, w) => { let pred = [0, 0, 0]; for (let b = 0; b < mats.length; b++) if (w[b]) pred = M.add(pred, M.mul(M.mat4Point(mats[b], p), w[b])); return pred; };
      sp.restPred = pts.map((p, k2) => predict(restMats, p, sp.weights[k2]));
      sp.restAct = pivotOnly ? [R.pivot.slice()] : idx.map(n => rest[r].pos[n]);   // constant rest offsets are not sliding
      syncPairs.push(sp);
    }
  }

  for (const clip of model.clips) {
    const id = `anim:${clip.name}`, N = Math.max(12, Math.min(48, Math.round(clip.duration * 24))), frames = [];
    for (let k = 0; k <= N; k++) frames.push((k / N) * clip.duration);
    const poses = frames.map(t => posed(model, clip, t));
    const Wms = syncPairs.length ? frames.map(t => MD.worldMatrices(model, MD.poseAt(model, clip, t))) : null;
    const bad = poses.some(p => p.some(m => m.pos.some(v => v.some(x => !Number.isFinite(x)))));
    if (bad) { add(id, 'fail', 'pose produces NaN'); continue; }
    const moved = Math.max(...poses.map(p => maxDev(p, rest)));
    add(id, moved > tol ? 'pass' : 'fail', moved > tol ? `moves (largest displacement ${moved.toFixed(3)} m)` : 'nothing moves: check the track part names and values');
    if (clip.loop) {
      const seam = maxDev(poses[0], poses[poses.length - 1]);
      add(id, seam <= tol * 2 ? 'pass' : 'fail', seam <= tol * 2 ? 'loops seamlessly (first pose = last pose)' : `loop seam jumps ${seam.toFixed(3)} m: make the last key equal the first, or use whole wave cycles`);
    }
    if (model.ground) {
      const low = Math.min(...poses.map(p => Math.min(...p.map(m => Math.min(...m.pos.map(v => v[1])))))) ;
      if (low < -tol * 2) add(id, 'fail', `goes ${(-low).toFixed(3)} m below the floor`);
    }
    // interpenetration between parts that do not overlap at rest
    const hits = new Map();
    poses.forEach((p, fi) => {
      for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
        const a = p[i], b = p[j]; if (!clip.animated.size) continue;
        const r0 = restOverlap.get(pairKey(a, b)) || 0; if (r0 > tol) continue;     // already overlapping at rest by design
        const d = Math.max(penetration(a, b), penetration(b, a));
        if (d > tol * 2.5) { const k = pairKey(a, b), h = hits.get(k); if (!h || d > h.d) hits.set(k, { d, t: frames[fi] }); }
      }
    });
    // attachment: a part that touches its parent (or, for parts hung on bones, the skinned body those bones
    // drive) at rest must keep touching it in every frame, or it visibly comes off
    const detached = new Map();
    for (const [i, j, ai, aj] of attached) poses.forEach((p, fi) => {
      let g = meshGap(p[i], p[j]);
      if (g <= tol * 1.5) { g = 0; for (const k of ai) g = Math.max(g, distToMesh(p[i].pos[k], p[j])); for (const k of aj) g = Math.max(g, distToMesh(p[j].pos[k], p[i])); }
      if (g <= tol * 1.5) return;
      const k = `${p[i].name} / ${p[j].name}`, h = detached.get(k); if (!h || g > h.g) detached.set(k, { g, t: frames[fi] });
    });
    if (detached.size) for (const [k, h] of detached) add(id, 'fail', `${k} come apart by ${(h.g * 1000).toFixed(1)} mm at ${h.t.toFixed(2)} s (their joint opens a gap): put the pivot on the joint where they meet, embed the root deeper, or reduce the angle`);
    else if (attached.length) add(id, 'pass', `${attached.length} attached part pairs stay joined`);
    if (hits.size) for (const [k, h] of hits) add(id, 'fail', `${k.replace('|', ' passes through ')} by ${h.d.toFixed(3)} m at ${h.t.toFixed(2)} s (move the pivot, limit the angle, or add clearance)`);
    else add(id, 'pass', 'no parts pass through each other');
    // sync: every root point must stay where the body's own weights put it
    if (syncPairs.length) {
      const drift = new Map();
      for (const sp of syncPairs) {
        let worst = 0, at = 0;
        poses.forEach((p, fi) => {
          const mats = sp.S.skinBones.map(b => M.mat4Mul(Wms[fi].get(b), M.mat4Translate(M.mul(b.pivot, -1))));
          for (let n = 0; n < sp.pts.length; n++) {
            const w = sp.weights[n];
            let pred = [0, 0, 0];
            for (let b = 0; b < mats.length; b++) if (w[b]) pred = M.add(pred, M.mul(M.mat4Point(mats[b], sp.pts[n]), w[b]));
            const actual = sp.pivotOnly ? (m => [m[12], m[13], m[14]])(Wms[fi].get(sp.R)) : p[sp.r].pos[sp.idx[n]];
            const d = M.dist(M.sub(pred, sp.restPred[n]), M.sub(actual, sp.restAct[n]));
            if (d > worst) { worst = d; at = frames[fi]; }
          }
        });
        if (worst > sp.tol) drift.set(`${sp.R.name} / ${sp.S.name}`, { worst, at, per: sp.weights, S: sp.S, R: sp.R });
      }
      for (const [k, h] of drift) {
        const ranges = h.S.skinBones.map((b, bi) => [b.name, Math.min(...h.per.map(w => w[bi])), Math.max(...h.per.map(w => w[bi]))]).filter(x => x[2] > 0.05);
        const desc = ranges.map(([n, a, z]) => `${n} ${Math.round(a * 100)}-${Math.round(z * 100)}%`).join(' / ');
        const how = h.R.skinBones ? `it is skinned with ${h.R.skinBones.map(b => b.name).join(' / ')}` : `it is rigid on ${h.R.parent ? h.R.parent.name : 'the root'}`;
        const fix = h.R.skinBones ? `give it exactly ${h.S.name}'s bone list and axis (${h.S.skinBones.map(b => b.name).join(' / ')})` : `give it "skin" with ${h.S.name}'s bones and axis, add "bind": "${h.S.name}" (rigid follow), or parent it to the bone that owns its root`;
        add(id, 'fail', `${k}: ${h.R.name} drifts ${(h.worst * 1000).toFixed(1)} mm from ${h.S.name}'s surface at ${h.at.toFixed(2)} s, while the body under its root is weighted ${desc}. ${how.charAt(0).toUpperCase() + how.slice(1)} but the surface is not: ${fix}.`);
      }
      if (!drift.size) add(id, 'pass', `${syncPairs.length} appendages follow the body surface`);
    }
    // deformation quality of skinned parts: folds, pinching, stretching, volume loss
    rest.forEach((m, i) => { if (m.node.skinBones && !m.node.bindTo) deformCheck(model, clip, frames, poses.map(p => p[i]), m, `deform:${clip.name}`, add, !thick(m)); });
    // speed sanity
    let maxW = 0, at = 0;
    for (let k = 1; k < frames.length; k++) for (const tr of clip.tracks) {
      const q0 = MD.localTRS(tr.node, MD.poseAt(model, clip, frames[k - 1])).q, q1 = MD.localTRS(tr.node, MD.poseAt(model, clip, frames[k])).q;
      const w = M.quatAngle(M.quatMul(q1, [-q0[0], -q0[1], -q0[2], q0[3]])) / (frames[k] - frames[k - 1]); if (w > maxW) { maxW = w; at = frames[k]; }
    }
    if (maxW > 1800) add(id, 'warn', `very fast rotation (${maxW.toFixed(0)}°/s near ${at.toFixed(2)} s): it will look like a pop`);
  }
  // 5. custom checks from the spec
  for (const c of model.spec.checks || []) {
    try { custom(model, c, rest, B, tol, add, opts); } catch (e) { add('check', 'fail', `${c.type || '?'}: ${e.message}`); }
  }
  return out;
}
// ---------------------------------------------------------------- skinned meshes
// The joints of a skin: every listed bone that has another listed bone above it (the chain root moves the body
// rigidly, it bends nothing), with its pivot along the skin axis, its blend zone and the largest bend any clip gives it.
function skinJoints(model, n) {
  const ax = G.AX[n.skin.axis || 'z'], vals = n.mesh.pos.map(p => p[ax]), lo = Math.min(...vals), hi = Math.max(...vals);
  const sorted = n.skinBones.map(b => ({ b, c: b.pivot[ax] })).sort((a, b) => a.c - b.c);
  const r = MD.jointHalfWidths(sorted.map(s => s.c), n.skin, lo, hi), inSkin = new Set(n.skinBones);
  return sorted.map((s, k) => {
    let parentInSkin = false; for (let q = s.b.parent; q; q = q.parent) if (inSkin.has(q)) { parentInSkin = true; break; }
    let bend = 0, clipName = '';
    if (parentInSkin) for (const clip of model.clips) if (clip.animated.has(s.b)) for (let f = 0; f <= 24; f++) {
      const p = MD.poseAt(model, clip, (f / 24) * clip.duration).get(s.b), a = p ? M.quatAngle(M.quatEuler(p.rot)) : 0;
      if (a > bend) { bend = a; clipName = clip.name; }
    }
    return { bone: s.b, c: s.c, r: r[k], bend, clip: clipName, inside: s.c > lo + (hi - lo) * 0.01 && s.c < hi - (hi - lo) * 0.01 };
  });
}
const loopsNeeded = bend => (bend < 1 ? 0 : bend <= 20 ? 1 : bend <= 50 ? 2 : bend <= 110 ? 3 : 4);
const loopsHint = need => (need === 1 ? 'skin.loops: 1' : need <= 3 ? 'skin.loops: 3' : 'skin.loops: 5 with a wider skin.blend, or split the bend over another bone');

// plate: a thin skinned sheet (fin, cape strip, membrane). It only needs vertices where it bends; the bone-centre
// and ring-spacing rules are for volumes.
function rigCheck(model, m, add, plate) {
  const n = m.node, ax = G.AX[n.skin.axis || 'z'], axName = n.skin.axis || 'z', P = n.mesh.pos;
  const vals = P.map(p => p[ax]), lo = Math.min(...vals), hi = Math.max(...vals), q = (hi - lo || 1) * 1e-4;
  const rings = [...new Set(vals.map(v => Math.round(v / q)))].map(k => k * q).sort((a, b) => a - b);
  const issues = [], joints = skinJoints(model, n), mesh = { pos: P, tris: n.mesh.tris };
  let bending = 0;
  for (const j of joints) {
    if (!j.inside) continue;
    if (plate) {
      const need = loopsNeeded(j.bend); if (!need) continue;
      bending++;
      const have = rings.filter(c => c >= j.c - j.r - q * 2 && c <= j.c + j.r + q * 2).length;
      if (have < need) issues.push(`${j.bone.name} bends it up to ${j.bend.toFixed(0)}° (${j.clip}) but the sheet has ${have} row${have === 1 ? '' : 's'} of vertices within ±${(j.r * 100).toFixed(1)} cm of the joint (want ${need}): between rows it stays flat and creases — add outline points / rows near ${axName} = ${j.c.toFixed(3)}`);
      continue;
    }
    // bone position: inside the body and near the centre of its cross-section
    const d = distToMesh(j.bone.pivot, mesh);
    if (d > 0) issues.push(`bone ${j.bone.name} sits ${(d * 1000).toFixed(1)} mm outside ${n.name}: move its pivot onto the body's centre line`);
    else {
      const near = rings.reduce((a, c) => (Math.abs(c - j.c) < Math.abs(a - j.c) ? c : a), rings[0]);
      const ring = P.filter(p => Math.abs(p[ax] - near) <= q * 1.5);
      if (ring.length > 2) for (const k of [0, 1, 2]) if (k !== ax) {
        const vs = ring.map(p => p[k]), mid = (Math.min(...vs) + Math.max(...vs)) / 2, half = (Math.max(...vs) - Math.min(...vs)) / 2;
        if (half > 1e-6 && Math.abs(j.bone.pivot[k] - mid) / half > 0.4) issues.push(`bone ${j.bone.name} is off-centre in ${'xyz'[k]} by ${(100 * Math.abs(j.bone.pivot[k] - mid) / half).toFixed(0)}% of the half-${k === 1 ? 'height' : 'width'}: one side will stretch and the other crush (pivot ${'xyz'[k]} ≈ ${mid.toFixed(3)})`);
      }
    }
    // edge loops for the bend this joint makes
    const need = loopsNeeded(j.bend); if (!need) continue;
    bending++;
    const have = rings.filter(c => c >= j.c - j.r - q * 2 && c <= j.c + j.r + q * 2).length;
    if (have < need) issues.push(`${j.bone.name} bends up to ${j.bend.toFixed(0)}° (${j.clip}) but ${n.name} has ${have} edge loop${have === 1 ? '' : 's'} within ±${(j.r * 100).toFixed(1)} cm of it (want ${need}): add stations near ${axName} = ${j.c.toFixed(3)} or set ${loopsHint(need)}`);
  }
  // ring layout of a loft (its stations): even spacing, no slivers, no pointed end next to a joint
  if (!plate && n.shape === 'loft' && rings.length >= 2) {
    const zones = joints.filter(j => j.inside && loopsNeeded(j.bend)), inZone = c => zones.some(j => Math.abs(c - j.c) <= j.r + q * 2);
    const width = c => {
      const ring = P.filter(p => Math.abs(p[ax] - c) <= q * 1.5); let w = 0;
      for (const k of [0, 1, 2]) if (k !== ax) { const vs = ring.map(p => p[k]); w = Math.max(w, Math.max(...vs) - Math.min(...vs)); }
      return w;
    };
    const W = rings.map(width), maxW = Math.max(...W), apex = W.map(w => w <= maxW * 1e-3);
    for (let i = 0; i + 1 < rings.length; i++) {
      const gap = rings[i + 1] - rings[i], w = Math.max(W[i], W[i + 1]), mid = (rings[i] + rings[i + 1]) / 2;
      if (w <= 0) continue;
      if (gap < 0.1 * w && !(inZone(rings[i]) && inZone(rings[i + 1])) && !apex[i] && !apex[i + 1])
        issues.push(`stations at ${axName} = ${rings[i].toFixed(3)} and ${rings[i + 1].toFixed(3)} are only ${(gap * 1000).toFixed(1)} mm apart (${(100 * gap / w).toFixed(0)}% of the local width) outside any joint: the ring between them is a band of slivers that creases when it bends — merge them or spread them out`);
      else if (gap > 3 * w && zones.some(j => mid >= j.c - j.r && mid <= j.c + j.r))
        issues.push(`stations at ${axName} = ${rings[i].toFixed(3)} and ${rings[i + 1].toFixed(3)} are ${(gap / w).toFixed(1)}× the local width apart across a bending zone: the long facets between them shear and flatten — add a station near ${axName} = ${mid.toFixed(3)}`);
    }
    // a pointed end (apex station) inside a joint zone, or with no full ring between it and the zone, makes a fan of
    // thin triangles bend: the tip pinches and folds
    rings.forEach((c, i) => {
      if (!apex[i]) return;
      for (const j of zones) {
        const edge = c < j.c ? j.c - j.r : j.c + j.r, between = rings.filter((r, k) => !apex[k] && (c < j.c ? r > c + q && r < edge - q : r < c - q && r > edge + q)).length;
        if (Math.abs(c - j.c) <= j.r) issues.push(`the pointed end at ${axName} = ${c.toFixed(3)} is inside ${j.bone.name}'s bend zone (±${(j.r * 100).toFixed(1)} cm): the fan of thin triangles at the tip pinches and folds — move the joint away from the tip or end the loft on a small ring instead of a point`);
        else if (!between) issues.push(`the pointed end at ${axName} = ${c.toFixed(3)} has no full ring between it and ${j.bone.name}'s bend zone: add a station between them so the tip moves rigidly`);
      }
    });
  }
  const extra = n.loopsAdded && n.loopsAdded.length ? ` (skin.loops added ${n.loopsAdded.length} ring${n.loopsAdded.length > 1 ? 's' : ''})` : '';
  if (issues.length) for (const s of issues) add('rig', 'warn', `${n.name}: ${s}`);
  else if (plate) add('rig', 'pass', `${n.name}: thin sheet, ${bending} bending joint${bending === 1 ? '' : 's'} with enough rows of vertices`);
  else add('rig', 'pass', `${n.name}: ${bending} bending joint${bending === 1 ? '' : 's'} with enough edge loops, bones inside the body on its centre line${n.shape === 'loft' ? ', evenly spaced stations' : ''}${extra}`);
}

function deformCheck(model, clip, frames, posedList, restMesh, id, add, plate) {
  const n = restMesh.node, P0 = restMesh.pos, T = restMesh.tris, ax = G.AX[n.skin.axis || 'z'];
  const nRaw = (P, t) => M.cross(sub(P[t[1]], P[t[0]]), sub(P[t[2]], P[t[0]]));
  const a0 = T.map(t => len(nRaw(P0, t))), v0 = G.signedVolume({ pos: P0, tris: T });
  // dominant bone of each triangle: its rigid motion is what the triangle "should" follow; folding = facing away from it
  const dom = T.map(t => { const s = new Array(n.skinBones.length).fill(0); t.forEach(i => n.weights[i].forEach((w, j) => { s[j] += w; })); return s.indexOf(Math.max(...s)); });
  const joints = skinJoints(model, n), nearJoint = ti => {
    const c = (P0[T[ti][0]][ax] + P0[T[ti][1]][ax] + P0[T[ti][2]][ax]) / 3;
    return joints.reduce((a, j) => (!a || Math.abs(j.c - c) < Math.abs(a.c - c) ? j : a), null).bone.name;
  };
  const anc = (a, b) => { for (let k = b; k; k = k.parent) if (k === a) return true; return false; };
  const scaled = clip.tracks.some(tr => tr.scale && n.skinBones.some(b => anc(tr.node, b)));   // areas / volume legitimately change
  let fold = null, pinch = { r: 1 }, stretch = { r: 1 }, vol = { d: 0 };
  posedList.forEach((pm, fi) => {
    const P = pm.pos, mats = n.skinBones.map(b => M.mat4Mul(MD.worldMatrices(model, MD.poseAt(model, clip, frames[fi])).get(b), M.mat4Translate(M.mul(b.pivot, -1))));
    let folds = 0, worst = -1;
    T.forEach((t, ti) => {
      if (a0[ti] < 1e-12) return;
      const nr = nRaw(P, t), rigid = nRaw(t.map(i => M.mat4Point(mats[dom[ti]], P0[i])), [0, 1, 2]);
      if (dot(nr, rigid) <= 0) { folds++; worst = ti; return; }
      if (scaled) return;
      const r = len(nr) / a0[ti];
      if (r < pinch.r) pinch = { r, t: frames[fi], ti };
      if (r > stretch.r) stretch = { r, t: frames[fi], ti };
    });
    if (folds && (!fold || folds > fold.n)) fold = { n: folds, t: frames[fi], ti: worst };
    if (!scaled && !plate && v0 > 0) { const d = G.signedVolume({ pos: P, tris: T }) / v0 - 1; if (Math.abs(d) > Math.abs(vol.d)) vol = { d, t: frames[fi] }; }
  });
  const fixes = 'add edge loops there (skin.loops: 3), use skin.weights "joints" or widen skin.blend, model the rest pose half-bent, or reduce the angle';
  let bad = false;
  if (fold) { bad = true; add(id, 'fail', `${n.name} folds through itself (${fold.n} triangle${fold.n > 1 ? 's' : ''} turn inside out) near ${nearJoint(fold.ti)} at ${fold.t.toFixed(2)} s: ${fixes}`); }
  if (pinch.r < 0.3) { bad = true; add(id, 'warn', `${n.name} pinches near ${nearJoint(pinch.ti)} at ${pinch.t.toFixed(2)} s (a face shrinks to ${(pinch.r * 100).toFixed(0)}% of its area): ${fixes}`); }
  if (stretch.r > 2.5) { bad = true; add(id, 'warn', `${n.name} stretches near ${nearJoint(stretch.ti)} at ${stretch.t.toFixed(2)} s (a face grows ×${stretch.r.toFixed(1)}): add loops there or move the bone to the joint`); }
  if (Math.abs(vol.d) > 0.12) { bad = true; add(id, 'warn', `${n.name} ${vol.d < 0 ? 'loses' : 'gains'} ${Math.abs(vol.d * 100).toFixed(0)}% of its volume at ${vol.t.toFixed(2)} s (collapsing joint or candy-wrapper twist): spread the bend or twist over more bones, bulge the joint station 5-10%`); }
  if (!bad) add(id, 'pass', `${n.name} deforms cleanly (no folds${scaled ? '' : `, faces ×${pinch.r.toFixed(2)}-${stretch.r.toFixed(2)}${plate ? '' : `, volume ${vol.d >= 0 ? '+' : ''}${(vol.d * 100).toFixed(1)}%`}`})`);
}

function maxDev(a, b) { let m = 0; for (let i = 0; i < a.length; i++) for (let k = 0; k < a[i].pos.length; k++) { const d = M.dist(a[i].pos[k], b[i].pos[k]); if (d > m) m = d; } return m; }
function partOf(meshes, name) { const m = meshes.find(x => x.name === name); if (!m) throw new Error(`no visible part "${name}"`); return m; }
function clipOf(model, name) { const c = model.clips.find(x => x.name === name); if (!c) throw new Error(`no animation "${name}"`); return c; }

function custom(model, c, rest, B, tol, add, opts) {
  const label = c.label || c.type;
  switch (c.type) {
    case 'size': {
      const i = G.AX[c.axis]; const v = B.size[i], ok = (c.min == null || v >= c.min) && (c.max == null || v <= c.max);
      return add(`check:${label}`, ok ? 'pass' : 'fail', `size ${c.axis} = ${v.toFixed(3)} m (want ${c.min != null ? c.min : '-'}..${c.max != null ? c.max : '-'})`);
    }
    case 'ratio': {
      const v = B.size[G.AX[c.a]] / B.size[G.AX[c.b]], err = v / c.expect - 1, t = c.tol || 0.08;
      return add(`check:${label}`, Math.abs(err) <= t ? 'pass' : 'fail', `${c.a}/${c.b} = ${v.toFixed(3)} vs reference ${c.expect} (${(err * 100).toFixed(1)}%)`);
    }
    case 'gap': case 'contact': {
      const meshes = c.clip ? posed(model, clipOf(model, c.clip), timeOf(clipOf(model, c.clip), c.at)) : rest;
      const g = meshGap(partOf(meshes, c.a), partOf(meshes, c.b)), max = c.max != null ? c.max : tol * 1.5, min = c.min || 0;
      return add(`check:${label}`, g <= max && g >= min ? 'pass' : 'fail', `${c.a} ↔ ${c.b} gap ${g.toFixed(4)} m${c.clip ? ` in ${c.clip} @ ${timeOf(clipOf(model, c.clip), c.at).toFixed(2)} s` : ''} (want ${min}..${max.toFixed(4)})`);
    }
    case 'angle': {
      const clip = clipOf(model, c.clip), t = timeOf(clip, c.at), node = model.byName.get(c.part); if (!node) throw new Error(`no part "${c.part}"`);
      const p = MD.poseAt(model, clip, t).get(node), rot = p ? p.rot : [0, 0, 0], v = c.axis ? rot[G.AX[c.axis]] : M.quatAngle(M.quatEuler(rot));
      const ok = (c.min == null || v >= c.min) && (c.max == null || v <= c.max);
      return add(`check:${label}`, ok ? 'pass' : 'fail', `${c.part} ${c.axis ? 'rot ' + c.axis : 'rotation'} = ${v.toFixed(1)}° in ${c.clip} @ ${t.toFixed(2)} s (want ${c.min != null ? c.min : '-'}..${c.max != null ? c.max : '-'})`);
    }
    case 'pose': {
      const clip = clipOf(model, c.clip), a = posed(model, clip, timeOf(clip, c.at));
      const b = c.equals === 'rest' || !c.equals ? rest : posed(model, clipOf(model, c.equals.clip), timeOf(clipOf(model, c.equals.clip), c.equals.at));
      const d = maxDev(a, b), t = c.tol || tol * 2;
      return add(`check:${label}`, d <= t ? 'pass' : 'fail', `${c.clip} @ ${c.at || 'end'} vs ${c.equals === 'rest' || !c.equals ? 'rest pose' : c.equals.clip + ' @ ' + (c.equals.at || 'end')}: max difference ${d.toFixed(4)} m`);
    }
    case 'above': {
      const clip = c.clip ? clipOf(model, c.clip) : null, N = 24; let low = Infinity, at = 0;
      for (let k = 0; k <= (clip ? N : 0); k++) { const t = clip ? (k / N) * clip.duration : 0, m = partOf(posed(model, clip, t), c.part); const y = Math.min(...m.pos.map(v => v[1])); if (y < low) { low = y; at = t; } }
      return add(`check:${label}`, low >= c.y - tol ? 'pass' : 'fail', `${c.part} lowest y = ${low.toFixed(3)} m${clip ? ` (at ${at.toFixed(2)} s)` : ''}, must stay ≥ ${c.y}`);
    }
    case 'apart': {                             // explicit no-penetration pair throughout a clip
      const clip = clipOf(model, c.clip), N = 32; let worst = 0, at = 0;
      for (let k = 0; k <= N; k++) { const t = (k / N) * clip.duration, ms = posed(model, clip, t), a = partOf(ms, c.a), b = partOf(ms, c.b); const d = Math.max(penetration(a, b), penetration(b, a)); if (d > worst) { worst = d; at = t; } }
      return add(`check:${label}`, worst <= (c.tol || tol * 2) ? 'pass' : 'fail', `${c.a} / ${c.b} in ${c.clip}: deepest overlap ${worst.toFixed(4)} m${worst > 0 ? ` at ${at.toFixed(2)} s` : ''}`);
    }
    case 'silhouette': {
      const Ref = require('./reference.cjs'), file = path.resolve(opts.baseDir || '.', c.image);
      const r = Ref.compare(model, file, { view: c.view || 'side', crop: c.crop, flip: c.flip, threshold: c.threshold });
      const min = c.min || 0.8, aspTol = c.aspectTol || 0.12, ok = r.score >= min && Math.abs(r.aspectErr) <= aspTol;
      if (opts.onOverlay) opts.onOverlay(`compare-${model.name}-${c.view || 'side'}${c.name ? '-' + c.name : ''}.png`, r.overlay);
      return add(`check:${label}`, ok ? 'pass' : 'fail', `${c.view || 'side'} silhouette vs ${path.basename(c.image)}: ${(r.score * 100).toFixed(0)}% match (min ${(min * 100).toFixed(0)}%), aspect ${(r.aspectErr * 100).toFixed(0)}%${r.flipped ? ' (reference faces the other way)' : ''}${r.touchesEdge ? ' [warning: object touches the image edge, likely cropped]' : ''}`);
    }
    default: throw new Error(`unknown check type "${c.type}" (size, ratio, gap, contact, angle, pose, above, apart, silhouette)`);
  }
}

function summary(results) {
  const n = { pass: 0, fail: 0, warn: 0 }; results.forEach(r => n[r.status]++);
  const lines = results.map(r => `${r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : 'WARN'}  ${r.id.padEnd(18)} ${r.msg}`);
  return { text: lines.join('\n') + `\n\n${n.pass} passed, ${n.fail} failed, ${n.warn} warnings`, ...n };
}

module.exports = { run, summary, zFight, distToMesh, meshGap, penetration, pointTriDist, insideByRay };
