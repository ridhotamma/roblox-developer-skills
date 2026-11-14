'use strict';
// The test suite every model runs: geometry health, assembly, reference proportions, and per-animation behaviour.
// Each result: { id, status: "pass" | "fail" | "warn", msg }.
const path = require('path');
const M = require('./math.cjs');
const G = require('./geometry.cjs');
const MD = require('./model.cjs');
const { sub, dot, len } = M;

function pointTriDist(p, a, b, c) {           // distance from point p to triangle abc (Ericson, Real-Time Collision Detection)
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return len(ap);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return len(bp);
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return len(sub(p, M.add(a, M.mul(ab, v)))); }
  const cpp = sub(p, c), d5 = dot(ab, cpp), d6 = dot(ac, cpp); if (d6 >= 0 && d5 <= d6) return len(cpp);
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return len(sub(p, M.add(a, M.mul(ac, w)))); }
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return len(sub(p, M.add(b, M.mul(sub(c, b), w)))); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; return len(sub(p, M.add(a, M.add(M.mul(ab, v), M.mul(ac, w)))));
}
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
// 0 when p is on or inside B, else the distance from p to B's surface.
function distToMesh(p, B) {
  const planes = B.planes !== undefined ? B.planes : (B.planes = G.convexPlanes(B));
  if (planes ? planes.every(pl => dot(pl.n, p) - pl.d <= 1e-9) : insideByRay(p, B)) return 0;
  let d = Infinity; for (const t of B.tris) d = Math.min(d, pointTriDist(p, B.pos[t[0]], B.pos[t[1]], B.pos[t[2]])); return d;
}
function insideByRay(p, B) {
  const dir = M.unit([0.5773, 0.5774, 0.5775]); let hits = 0;
  for (const t of B.tris) {                     // Möller–Trumbore
    const a = B.pos[t[0]], e1 = sub(B.pos[t[1]], a), e2 = sub(B.pos[t[2]], a), h = M.cross(dir, e2), det = dot(e1, h);
    if (Math.abs(det) < 1e-12) continue; const f = 1 / det, s = sub(p, a), u = f * dot(s, h); if (u < 0 || u > 1) continue;
    const q = M.cross(s, e1), v = f * dot(dir, q); if (v < 0 || u + v > 1) continue; if (f * dot(e2, q) > 1e-9) hits++;
  }
  return hits % 2 === 1;
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
  let geomOk = true;
  for (const m of rest) {
    const n = m.node, e = G.edgeReport(n.mesh), vol = G.signedVolume(n.mesh), degenerate = n.mesh.tris.filter(t => G.triArea(n.mesh.pos, t) < 1e-12).length;
    if (n.mesh.pos.some(p => p.some(v => !Number.isFinite(v)))) { add('geometry', 'fail', `${n.name}: NaN/Infinity in vertices`); geomOk = false; continue; }
    if (e.open || e.nonManifold) { add('geometry', 'warn', `${n.name}: ${e.open} open edges, ${e.nonManifold} non-manifold edges (not watertight)`); geomOk = false; }
    else if (vol <= 0) { add('geometry', 'fail', `${n.name}: inside-out (faces point inwards, it will render see-through)`); geomOk = false; }
    if (degenerate) { add('geometry', 'warn', `${n.name}: ${degenerate} zero-area triangles`); geomOk = false; }
    const bs = G.bounds(m.pos).size; if (Math.min(...bs) < size * 0.002) add('geometry', 'warn', `${n.name}: paper-thin (${Math.min(...bs).toFixed(4)} m) — flickers and vanishes edge-on`);
  }
  if (geomOk) add('geometry', 'pass', `${rest.length} parts watertight, outward-facing, no degenerate triangles`);

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
      (A.node.skinBones && A.node.skinBones.some(b => above(b, B.node))) || (B.node.skinBones && B.node.skinBones.some(b => above(b, A.node)));
    for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) {
      if (!linked(rest[i], rest[j]) || meshGap(rest[i], rest[j]) > tol * 1.5) continue;
      // the joint = every vertex of one part that sits on or inside the other at rest; all of it must stay welded
      const ai = rest[i].pos.map((p, k) => (distToMesh(p, rest[j]) <= tol ? k : -1)).filter(k => k >= 0);
      const aj = rest[j].pos.map((p, k) => (distToMesh(p, rest[i]) <= tol ? k : -1)).filter(k => k >= 0);
      attached.push([i, j, ai, aj]);
    }
  }
  for (const clip of model.clips) {
    const id = `anim:${clip.name}`, N = Math.max(12, Math.min(48, Math.round(clip.duration * 24))), frames = [];
    for (let k = 0; k <= N; k++) frames.push((k / N) * clip.duration);
    const poses = frames.map(t => posed(model, clip, t));
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
