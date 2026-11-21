#!/usr/bin/env node
// Self-test for rmodel. Run: node selftest.cjs   (exits non-zero on failure). Needs only Node.
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const M = require('./lib/math.cjs'), G = require('./lib/geometry.cjs'), MD = require('./lib/model.cjs'), CK = require('./lib/checks.cjs');
const RB = require('./lib/roblox.cjs'), LOD = require('./lib/lod.cjs');
const RN = require('./lib/render.cjs'), EX = require('./lib/export.cjs'), RF = require('./lib/reference.cjs'), PV = require('./lib/preview.cjs');
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
const near = (a, b, e) => Math.abs(a - b) <= (e || 1e-6);
const status = (res, id, st) => res.some(r => r.id === id && r.status === st);

// 1. maths
{
  const e = [30, -50, 70], back = M.quatToEuler(M.quatEuler(e));
  ok(e.every((v, i) => near(v, back[i], 1e-6)), 'euler -> quaternion -> euler round-trips (X then Y then Z)');
  const q = M.quatEuler([90, 0, 0]), v = M.quatRot(q, [0, 1, 0]);
  ok(near(v[2], 1) && near(v[1], 0), '+90° about X turns +Y into +Z (right-handed)');
  const m = M.mat4Compose([1, 2, 3], M.quatEuler([0, 90, 0]), [2, 2, 2]), p = M.mat4Point(m, [1, 0, 0]);
  ok(near(p[0], 1) && near(p[1], 2) && near(p[2], 1), 'TRS matrix applies scale, rotation, translation in order');
}
// 2. every generator makes a closed, outward mesh with the requested size
{
  const cases = { box: { size: [1, 2, 3] }, wedge: { size: [1, 1, 1] }, cylinder: { radius: 0.5, height: 1, segments: 6 }, cone: { radius: 0.5, height: 1, segments: 5 },
    sphere: { radius: 1, segments: [8, 4] }, ico: { radius: 1, detail: 1 }, torus: { radius: 1, tube: 0.2, segments: [8, 4] }, lathe: { profile: [[0, 0], [0.5, 0.1], [0.3, 1]] },
    loft: { stations: [{ at: 0.5, w: 0, h: 0 }, { at: 0, w: 0.4, h: 0.5 }, { at: -0.5, w: 0.1, h: 0.1 }] }, extrude: { outline: [[0, 0], [1, 0], [1, 1], [0.5, 0.4], [0, 1]], depth: 0.2 },
    hollow: { size: [1, 1, 1], hollow: 0.1 }, ring: { size: [1, 0.2, 1], hollow: 0.1, open: 'both' }, chamfer: { size: [1, 1, 1], chamfer: 0.1 }, hull: { points: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.2, 0.2, 0.2]] } };
  let all = true;
  for (const [k, o] of Object.entries(cases)) {
    const shape = k === 'ico' ? 'sphere' : k === 'hollow' || k === 'ring' || k === 'chamfer' ? 'box' : k, m = G.SHAPES[shape](o), e = G.edgeReport(m), vol = G.signedVolume(m);
    if (e.open || e.nonManifold || !(vol > 0)) { all = false; console.log(`   ${k}: open ${e.open}, non-manifold ${e.nonManifold}, volume ${vol}`); }
  }
  ok(all, 'all shapes are watertight and outward-facing');
  ok(near(G.signedVolume(G.SHAPES.box({ size: [1, 1, 1], hollow: 0.1 })), 1 - 0.8 * 0.8 * 0.9, 1e-9), 'hollow box volume = outer - cavity');
  const hb = G.bounds(G.SHAPES.box({ size: [1, 2, 3] }).pos).size; ok(near(hb[0], 1) && near(hb[1], 2) && near(hb[2], 3), 'box has the requested size');
  ok(G.triangulate2D([[0, 0], [2, 0], [2, 2], [1, 0.5], [0, 2]]).length === 3, 'ear clipping handles a concave outline');
  ok(G.convexPlanes(G.SHAPES.box({ size: [1, 1, 1] })) && !G.convexPlanes(G.SHAPES.torus({ radius: 1, tube: 0.2 })), 'convexity detection');
  const ex = G.SHAPES.extrude({ outline: [[0, 0], [1, 0], [1, 1], [0, 1]], depth: 0.1, taper: 0.5, taperAt: [0, 0] });
  ok(near(ex.pos[0][0], ex.pos[4][0], 1e-9) && near(ex.pos[0][1], ex.pos[4][1], 1e-9), 'extrude taperAt keeps the anchored root edge full size (a fin root stays welded)');
}
// 3. hierarchy, pivots, mirror, skinning
{
  const spec = { name: 'T', parts: [
    { name: 'Base', shape: 'box', size: [1, 1, 1], at: [0, 0.5, 0] },
    { name: 'Lid', shape: 'box', size: [1, 0.1, 1], at: [0, 1.05, 0], pivot: [0, 1, -0.5] },
    { name: 'KnobL', parent: 'Lid', shape: 'box', size: [0.1, 0.1, 0.1], at: [-0.3, 1.15, 0.3], mirror: 'x' } ],
    animations: [{ name: 'Open', duration: 1, tracks: [{ part: 'Lid', rot: [[0, [0, 0, 0]], [1, [-90, 0, 0]]] }] }] };
  const m = MD.compile(spec);
  ok(!m.errors.length && m.byName.has('KnobR'), 'mirror makes a right-hand copy named KnobR');
  const posed = MD.posedMeshes(m, m.clips[0], 1), lid = posed.find(x => x.node.name === 'Lid'), knob = posed.find(x => x.node.name === 'KnobL');
  const lb = G.bounds(lid.pos);
  ok(near(lb.lo[2], -0.6, 1e-6) && near(lb.hi[1], 2, 1e-6), 'lid rotates -90° about its back hinge (stands up behind the box)');
  ok(G.bounds(knob.pos).center[2] < -0.5, 'children follow their parent');
  const kr = MD.posedMeshes(m, null, 0).find(x => x.node.name === 'KnobR'); ok(near(G.bounds(kr.pos).center[0], 0.3), 'mirrored part sits on the other side');
  const fish = MD.compile({ name: 'F', ground: false, parts: [
    { name: 'B0', shape: 'none', pivot: [0, 0, 0.5] }, { name: 'B1', parent: 'B0', shape: 'none', pivot: [0, 0, -0.5] },
    { name: 'Body', shape: 'loft', sides: 6, skin: { bones: ['B0', 'B1'], axis: 'z' }, stations: [{ at: -1, w: 0.2, h: 0.2 }, { at: 1, w: 0.2, h: 0.2 }] } ],
    animations: [{ name: 'Bend', duration: 1, tracks: [{ part: 'B1', rot: [[0, [0, 0, 0]], [1, [0, 90, 0]]] }] }] });
  const body = MD.posedMeshes(fish, fish.clips[0], 1)[0], tailTip = body.pos.reduce((a, p) => (p[0] < a[0] ? p : a));
  ok(tailTip[0] < -0.4, 'skinned tail bends with its bone');
  const head = body.pos.filter((p, i) => fish.nodes.find(n => n.name === 'Body').mesh.pos[i][2] > 0.6);
  ok(head.every(p => p[2] > 0.5), 'skinned head stays put');
}
// 4. the checks catch the classic mistakes
{
  const base = { name: 'C', reference: { sources: [{ note: 'x' }], dimensions: { width: 1, height: 1, depth: 1 } } };
  const r1 = CK.run(MD.compile(Object.assign({}, base, { parts: [{ name: 'A', shape: 'box', size: [1, 1, 1], at: [0, 0.5, 0] }, { name: 'B', shape: 'box', size: [0.2, 0.2, 0.2], at: [2, 0.5, 0] }] })));
  ok(status(r1, 'assembly', 'fail'), 'floating part fails');
  const r2 = CK.run(MD.compile(Object.assign({}, base, { parts: [{ name: 'A', shape: 'box', size: [1, 1, 1], at: [0, 0.7, 0] }] })));
  ok(status(r2, 'ground', 'fail'), 'hovering model fails the ground check');
  const r3 = CK.run(MD.compile(Object.assign({}, base, { parts: [{ name: 'A', shape: 'box', size: [1, 1, 1], at: [0, 0.5, 0] }, { name: 'B', shape: 'box', size: [0.5, 1, 0.5], at: [0, 0.5, 0.25] }] })));
  ok(status(r3, 'z-fighting', 'fail'), 'coplanar overlapping faces fail (z-fighting)');
  const r4 = CK.run(MD.compile(Object.assign({}, base, { parts: [{ name: 'A', shape: 'box', size: [2, 1, 1], at: [0, 0.5, 0] }] })));
  ok(status(r4, 'dimensions', 'fail'), 'wrong size against the reference fails');
  const thru = Object.assign({}, base, { parts: [{ name: 'Base', shape: 'box', size: [1, 0.5, 1], at: [0, 0.25, 0] }, { name: 'Lid', shape: 'box', size: [1, 0.1, 1], at: [0, 0.55, 0], pivot: [0, 0.5, 0.5] }],
    animations: [{ name: 'Bad', duration: 1, tracks: [{ part: 'Lid', rot: [[0, [0, 0, 0]], [1, [-60, 0, 0]]] }] }] });
  ok(CK.run(MD.compile(thru)).some(r => r.id === 'anim:Bad' && r.status === 'fail' && /passes through/.test(r.msg)), 'lid rotating the wrong way into the base fails');
  const seam = Object.assign({}, base, { parts: [{ name: 'A', shape: 'box', size: [1, 1, 1], at: [0, 0.5, 0] }], animations: [{ name: 'Loop', duration: 1, loop: true, tracks: [{ part: 'A', rot: [[0, [0, 0, 0]], [1, [0, 45, 0]]] }] }] });
  ok(CK.run(MD.compile(seam)).some(r => r.id === 'anim:Loop' && r.status === 'fail' && /seam/.test(r.msg)), 'loop whose end differs from its start fails');
  // a flap whose hinge is not on its root edge swings off the body; hinged on the root it stays welded
  const flap = pivot => Object.assign({}, base, { ground: false, parts: [{ name: 'Body', shape: 'box', size: [0.2, 0.2, 0.6], at: [0, 0, 0] },
    { name: 'Fin', parent: 'Body', shape: 'box', size: [0.15, 0.01, 0.1], at: [0.17, 0, 0], pivot }],
    animations: [{ name: 'Flap', duration: 1, loop: true, tracks: [{ part: 'Fin', rot: { wave: { axis: 'z', amp: 30, cycles: 1 } } }] }] });
  const off = CK.run(MD.compile(flap([0.3, 0, 0]))), on = CK.run(MD.compile(flap([0.1, 0, 0])));
  ok(off.some(r => r.id === 'anim:Flap' && r.status === 'fail' && /come apart/.test(r.msg)), 'a part hinged away from its joint fails the attachment test');
  ok(on.some(r => r.id === 'anim:Flap' && r.status === 'pass' && /stay joined/.test(r.msg)) && !on.some(r => /come apart/.test(r.msg)), 'hinged on its joint it stays joined');
  // pivot "weld": the hinge is found on the contact with the parent, so a posed fin keeps its root in the body
  const finSpec = extra => ({ name: 'W', ground: false, parts: [
    { name: 'Body', shape: 'box', size: [0.2, 0.2, 0.6] },
    Object.assign({ name: 'Fin', parent: 'Body', shape: 'extrude', plane: 'zy', depth: 0.01, at: [0.095, 0, 0],
      outline: [[0.18, 0.04], [0.13, 0.18], [0.10, 0.12], [0.26, 0.02]] }, extra)],
    animations: [{ name: 'Flap', duration: 1, loop: true, tracks: [{ part: 'Fin', rot: { wave: { axis: 'z', amp: 30, cycles: 1 } } }] }] });
  const welded = MD.compile(finSpec({ pivot: 'weld', rot: [0, 0, -10] })), free = MD.compile(finSpec({ rot: [0, 0, -10] }));
  const wp = welded.byName.get('Fin').pivot;
  ok(near(wp[1], 0.03, 0.015) && near(wp[2], 0.22, 0.03), 'pivot "weld" sits on the root edge, not the fin centre');
  const rw = CK.run(welded), rf = CK.run(free);
  ok(!rw.some(r => /come apart/.test(r.msg)) && rw.some(r => r.id === 'anim:Flap' && /stay joined/.test(r.msg)), 'a fin on a weld pivot keeps its root while it flaps');
  ok(rf.some(r => r.id === 'anim:Flap' && /come apart/.test(r.msg)), 'the same fin on its shape centre swings off the body');
  // fins on a bending body: rigid on one bone drifts; bind or skin follows the surface
  const fishSpec = extra => ({ name: 'S', ground: false, parts: [
    { name: 'B0', shape: 'none', pivot: [0, 0, 0.5] }, { name: 'B1', parent: 'B0', shape: 'none', pivot: [0, 0, -0.5] },
    { name: 'Body', shape: 'loft', sides: 6, skin: { bones: ['B0', 'B1'], axis: 'z' }, stations: [{ at: -1, w: 0.2, h: 0.2 }, { at: 1, w: 0.2, h: 0.2 }] },
    Object.assign({ name: 'Fin', parent: 'B1', shape: 'extrude', plane: 'zy', depth: 0.01, outline: [[-0.24, 0.08], [-0.26, 0.08], [-0.26, 0.18], [-0.24, 0.18]] }, extra)],
    animations: [{ name: 'Bend', duration: 1, tracks: [{ part: 'B1', rot: [[0, [0, 0, 0]], [1, [0, 60, 0]]] }] }] });
  const rigid = CK.run(MD.compile(fishSpec({})));
  ok(rigid.some(r => r.id === 'anim:Bend' && r.status === 'fail' && /drifts/.test(r.msg)), 'a rigid fin on a body blending two bones fails the fin/body sync test');
  const bound = CK.run(MD.compile(fishSpec({ bind: 'Body' }))), skinned = CK.run(MD.compile(fishSpec({ skin: { bones: ['B0', 'B1'], axis: 'z' } })));
  ok(!bound.some(r => /drifts/.test(r.msg)), '"bind": "Body" makes the rigid fin follow the blended surface');
  ok(!skinned.some(r => /drifts/.test(r.msg)), 'a fin skinned with the body bones follows the surface exactly');
  const kiss = CK.run(MD.compile({ name: 'K', ground: false, parts: [
    { name: 'B0', shape: 'none', pivot: [0, 0, 1] }, { name: 'B1', parent: 'B0', shape: 'none', pivot: [0, 0, -1] },
    { name: 'Body', shape: 'box', size: [0.2, 0.2, 2], skin: { bones: ['B0', 'B1'], axis: 'z' } },
    { name: 'Fin', parent: 'B1', shape: 'extrude', plane: 'zy', depth: 0.01, at: [0, 0.002, 0], outline: [[-0.24, 0.1], [-0.26, 0.1], [-0.26, 0.2], [-0.24, 0.2]] }] }));
  ok(kiss.some(r => r.id === 'weld' && /sinks/.test(r.msg)), 'a fin root laid on the surface is reported as not welded');
  const bad = MD.compile({ name: 'E', parts: [{ name: 'A', shape: 'blob' }, { name: 'B', shape: 'box', parent: 'Nope' }], animations: [{ name: 'X', duration: 1, tracks: [{ part: 'Z', rot: [] }] }] });
  ok(bad.errors.length >= 3, 'bad shape, missing parent and missing track part are spec errors');
}
// 4b. rig readiness: edge loops, weight modes, deformation quality
{
  const arm = (skin, angle, elbowY) => ({ name: 'Arm', ground: false, reference: { sources: [{ note: 'x' }] }, parts: [
    { name: 'Upper', shape: 'none', pivot: [0, 0, 0.5] }, { name: 'Lower', parent: 'Upper', shape: 'none', pivot: [0, elbowY || 0, 0] },
    { name: 'Skin', shape: 'loft', sides: 8, skin: Object.assign({ bones: ['Upper', 'Lower'], axis: 'z' }, skin), stations: [{ at: -0.5, w: 0.12, h: 0.12 }, { at: 0.5, w: 0.12, h: 0.12 }] }],
    animations: [{ name: 'Bend', duration: 1, tracks: [{ part: 'Lower', rot: [[0, [0, 0, 0]], [1, [angle, 0, 0]]] }] }] });
  const bare = MD.compile(arm({}, 90)), rb = CK.run(bare);
  ok(status(rb, 'rig', 'warn') && rb.some(r => r.id === 'rig' && /0 edge loops/.test(r.msg)), 'a 90° joint with no edge loops is reported by the rig check');
  ok(rb.some(r => r.id === 'deform:Bend' && /volume/.test(r.msg)), 'the collapsing elbow is reported as volume loss');
  const good = MD.compile(arm({ loops: 3, weights: 'joints' }, 90)), rg = CK.run(good), sk = good.byName.get('Skin');
  ok(sk.loopsAdded.length === 3 && sk.loopsAdded.includes(0), 'skin.loops: 3 inserts rings on the joint and either side');
  ok(status(rg, 'rig', 'pass') && status(rg, 'deform:Bend', 'pass'), 'with loops and joint weights the elbow passes rig and deform');
  const w = sk.weights, zs = sk.mesh.pos.map(p => p[2]), far = zs.map((z, i) => [z, w[i]]).filter(([z]) => Math.abs(z) > 0.2);
  ok(far.every(([, wt]) => wt.some(v => near(v, 1))), '"joints" weights keep each segment rigid away from the joint');
  ok(zs.map((z, i) => [z, w[i]]).filter(([z]) => near(z, 0, 1e-6)).every(([, wt]) => near(wt[0], 0.5) && near(wt[1], 0.5)), '"joints" weights blend 50/50 on the joint');
  const folded = CK.run(MD.compile(arm({}, 170)));
  ok(folded.some(r => r.id === 'deform:Bend' && r.status === 'fail' && /folds through itself/.test(r.msg)), 'a 170° bend on a bare tube fails as a fold');
  ok(CK.run(MD.compile(arm({ loops: 3 }, 60, 0.2))).some(r => r.id === 'rig' && /outside Skin/.test(r.msg)), 'a bone pivot outside the body is reported');
  ok(rb.some(r => r.id === 'rig' && /× the local width apart across a bending zone/.test(r.msg)), 'two stations far apart across a bending joint are reported');
  const tightSpec = arm({ loops: 3, weights: 'joints' }, 90); tightSpec.parts[2].stations = [{ at: -0.5, w: 0.12, h: 0.12 }, { at: -0.4, w: 0.12, h: 0.12 }, { at: -0.395, w: 0.12, h: 0.12 }, { at: 0.5, w: 0.12, h: 0.12 }];
  ok(CK.run(MD.compile(tightSpec)).some(r => r.id === 'rig' && /mm apart .* outside any joint/.test(r.msg)), 'two stations almost on top of each other away from a joint are reported');
  const tipSpec = arm({ weights: 'joints', loops: 3 }, 60); tipSpec.parts[2].stations = [{ at: -0.5, w: 0.12, h: 0.12 }, { at: 0.12, w: 0.12, h: 0.12 }, { at: 0.2, w: 0, h: 0 }];
  ok(CK.run(MD.compile(tipSpec)).some(r => r.id === 'rig' && /pointed end/.test(r.msg)), 'a pointed loft end next to a bending joint is reported');
  // thin skinned sheets (cape strip, long fin): rows of vertices where they bend
  const sheet = outline => ({ name: 'Sheet', ground: false, parts: [
    { name: 'B0', shape: 'none', pivot: [0, 0, 1] }, { name: 'B1', parent: 'B0', shape: 'none', pivot: [0, 0.15, 0] },
    { name: 'Strip', shape: 'extrude', plane: 'zy', depth: 0.01, outline, skin: { bones: ['B0', 'B1'], axis: 'z' } }],
    animations: [{ name: 'Flap', duration: 1, tracks: [{ part: 'B1', rot: [[0, [0, 0, 0]], [1, [0, 60, 0]]] }] }] });
  const bareSheet = CK.run(MD.compile(sheet([[-1, 0], [1, 0], [1, 0.3], [-1, 0.3]])));
  ok(bareSheet.some(r => r.id === 'rig' && r.status === 'warn' && /0 rows of vertices/.test(r.msg)), 'a skinned sheet with no vertices at its joint is reported');
  const rowsSheet = CK.run(MD.compile(sheet([[-1, 0], [-0.2, 0], [0, 0], [0.2, 0], [1, 0], [1, 0.3], [0.2, 0.3], [0, 0.3], [-0.2, 0.3], [-1, 0.3]])));
  ok(status(rowsSheet, 'rig', 'pass') && status(rowsSheet, 'deform:Flap', 'pass'), 'with rows at the joint the sheet passes rig and deform');
}
// 4c. mesh topology: slivers, self-intersections, open and mis-wound surfaces, the Roblox per-mesh limit, triangulation
{
  const one = (part, extra) => CK.run(MD.compile(Object.assign({ name: 'T', ground: false, budget: 100000 }, extra || {}, { parts: [Object.assign({ name: 'P' }, part)] })));
  const geo = (res, st, re) => res.some(r => r.id === 'geometry' && r.status === st && (!re || re.test(r.msg)));
  const TET = [[0, 2, 1], [0, 1, 3], [1, 2, 3], [0, 3, 2]];
  const tet = (c, d) => [[0, 0, 0], [1, 0, 0], c, d || [0.5, 0.4, 0.8]];
  ok(geo(one({ shape: 'mesh', vertices: tet([0.5, 0.8, 0]), faces: TET }), 'pass'), 'a clean tetrahedron passes the geometry check');
  ok(geo(one({ shape: 'mesh', vertices: tet([0.5, 0.004, 0]), faces: TET }), 'warn', /near-flat sliver/), 'a near-flat sliver triangle is reported');
  const two = off => ({ shape: 'mesh', vertices: tet([0.5, 0.8, 0]).concat(tet([0.5, 0.8, 0]).map(p => p.map((v, i) => v + off[i]))), faces: TET.concat(TET.map(f => f.map(i => i + 4))) });
  ok(geo(one(two([0.3, 0.1, 0.2])), 'fail', /cuts through itself/), 'two shells crossing inside one part fail as a self-intersection');
  ok(!geo(one(two([3, 0, 0])), 'fail', /cuts through itself/), 'two separate shells in one part are not a self-intersection');
  const quad = [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]];
  ok(geo(one({ shape: 'mesh', vertices: quad, faces: [[0, 2, 1], [0, 3, 2]] }), 'fail', /open edges/), 'an open surface fails the watertight check');
  ok(!geo(one({ shape: 'mesh', vertices: quad, faces: [[0, 2, 1], [0, 3, 2]], openSurface: true }, { targets: ['blender', 'threejs'] }), 'fail'), '"openSurface": true accepts a deliberately open sheet when Roblox is not a target');
  ok(geo(one({ shape: 'mesh', vertices: quad, faces: [[0, 2, 1], [0, 3, 2]], openSurface: true }), 'fail', /Roblox requires every mesh to be watertight/), 'an open sheet still fails when Roblox is a target (the default)');
  ok(geo(one({ shape: 'mesh', vertices: quad, faces: [[0, 2, 1], [0, 2, 3]], openSurface: true }, { targets: ['blender'] }), 'fail', /wind opposite ways/), 'neighbouring faces wound opposite ways fail, even on an open sheet');
  ok(one({ shape: 'sphere', radius: 1, segments: [160, 70] }).some(r => r.id === 'budget' && r.status === 'fail' && /per-mesh limit/.test(r.msg)), "a part over Roblox's 20,000-triangle mesh limit fails");
  // spiky outlines (fins, flames, leaves) triangulate without slivers
  const spiky = [[0, 0]]; for (let i = 0; i <= 8; i++) spiky.push([i * 0.1, i % 2 ? 0.5 : 0.08]); spiky.push([0.8, 0]);
  const tris = G.triangulate2D(spiky), minAng = Math.min(...tris.map(t => G.triAngles(spiky.map(p => [p[0], p[1], 0]), t)[0]));
  ok(tris.length === spiky.length - 2 && minAng > 5, `a spiky outline triangulates without slivers (smallest angle ${minAng.toFixed(1)}°)`);
}
// 5. exports: glb structure, obj, scripts
{
  const m = MD.compile(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', 'fish.json'), 'utf8')));
  const glb = EX.toGlb(m), errs = EX.validateGlb(glb);
  ok(!errs.length, 'fish .glb passes structural validation' + (errs.length ? ': ' + errs.join('; ') : ''));
  const json = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
  ok(json.skins && json.skins.length >= 1 && json.animations.map(a => a.name).join() === 'Swim,Idle,Die', 'glb carries the skins and all three clips');
  ok(json.accessors.every(a => a.byteOffset == null) && json.bufferViews.every(v => v.byteOffset % 4 === 0), 'buffer views are 4-byte aligned');
  // skins: a weightless root joint above the bones, and every vertex still follows the same dominant bone
  const bin = glb.subarray(28 + glb.readUInt32LE(12)), view = (i, T) => { const a = json.accessors[i], v = json.bufferViews[a.bufferView]; return new T(bin.buffer.slice(bin.byteOffset + v.byteOffset, bin.byteOffset + v.byteOffset + v.byteLength)); };
  const bodyNode = json.nodes.find(n => n.name === 'BodyMesh'), skin = json.skins[bodyNode.skin], prim = json.meshes[bodyNode.mesh].primitives[0];
  const J = view(prim.attributes.JOINTS_0, Uint8Array), W = view(prim.attributes.WEIGHTS_0, Float32Array), body = m.byName.get('Body'), I = view(prim.indices, Uint16Array);
  let same = true, onRoot = 0; const order = [].concat(...body.mesh.tris);
  order.forEach((k, corner) => {
    const v = I[corner];
    let best = 0; for (let c = 1; c < 4; c++) if (W[v * 4 + c] > W[v * 4 + best]) best = c;
    if (W.slice(v * 4, v * 4 + 4).some((w, c) => w > 1e-6 && J[v * 4 + c] === 0)) onRoot++;
    const want = body.skinBones[body.weights[k].indexOf(Math.max(...body.weights[k]))].name;
    if (json.nodes[skin.joints[J[v * 4 + best]]].name !== want) same = false;
  });
  ok(json.nodes[skin.joints[0]].name === 'Fish' && onRoot === 0, "a skin's root joint is the node above its bones (Fish) and carries no weight (Roblox rule)");
  ok(same, 'after the root joint is added every vertex still follows its own bone');
  // Roblox files: the model with vertex colours, then one clip per file for a skinned model
  const rbx = EX.robloxGlbs(m), rerr = rbx.map(r => EX.validateGlb(r.buf).concat(EX.validateRoblox(r.buf))).flat();
  ok(rbx.map(r => r.name).join() === 'Fish.roblox.glb,Fish.Swim.roblox.glb,Fish.Idle.roblox.glb,Fish.Die.roblox.glb,Fish.lod.roblox.glb' && !rerr.length, 'Roblox export: the model plus one file per clip, each within Roblox\'s rules' + (rerr.length ? ': ' + rerr.join('; ') : ''));
  ok(EX.validateRoblox(glb).some(e => /3 animations/.test(e)), 'the Roblox validator rejects several clips in one file');
  const rj = JSON.parse(rbx[0].buf.toString('utf8', 20, 20 + rbx[0].buf.readUInt32LE(12)));
  ok(rj.materials.every(x => x.pbrMetallicRoughness.baseColorFactor.slice(0, 3).every(c => c === 1)) && rj.meshes.every(x => x.primitives[0].attributes.COLOR_0 != null), 'Roblox model file: colours in COLOR_0 on a white base (they survive Merge Meshes)');
  const chest = MD.compile(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', 'treasure_chest.json'), 'utf8')));
  ok(EX.robloxGlbs(chest).length === 1, 'an unrigged model gets the Roblox model file only (Roblox ignores node animations)');
  ok(MD.compile({ name: 'X', targets: ['roblox', 'maya'], parts: [{ name: 'A', shape: 'box', size: [1, 1, 1] }] }).errors.some(e => /unknown target "maya"/.test(e)), 'an unknown export target is a spec error');
  const { obj } = EX.toObj(m); ok(/^o Body$/m.test(obj) && /^f /m.test(obj), 'obj has named objects and faces');
  ok(/import_scene\.gltf/.test(EX.blenderScript(m)) && /GLTFLoader/.test(EX.threeModule(m)), 'Blender script and three.js loader are generated');
  const html = PV.previewHtml([{ name: 'T', title: 'T', description: '', glb: Buffer.alloc(16), clips: [], checks: [], dims: [1, 1, 1], tris: 0, parts: 0, ground: true, refs: [] }]);
  ok(html.includes('window.THREE') && html.includes('const THREE = window.THREE') && !/cdn\.jsdelivr\.net/.test(html), 'preview.html embeds three.js and needs no CDN');
  ok(html.includes('window.RMODEL') && html.includes('type="module"'), 'preview.html carries the models and the viewer module');
}
// 5b. shading and performance: smoothing by angle, indexed meshes, merged static parts, collision classes
{
  const verts = (mesh, a) => RB.renderVertices({ mesh, smoothAngle: a });
  const ico = G.SHAPES.sphere({ radius: 1, detail: 0 }), cyl = G.SHAPES.cylinder({ radius: 1, height: 1, segments: 8 }), box = G.SHAPES.box({ size: [1, 1, 1] });
  ok(verts(ico, 0) === 60 && verts(ico, 60) === 12, 'a smoothed icosphere shares its 12 vertices (flat needs 60)');
  const cn = G.cornerNormals(cyl, 60), flat = G.cornerNormals(cyl, 0);
  ok(cyl.tris.every((t, ti) => Math.abs(flat[ti][0][1]) < 0.99 || cn[ti].every(n => Math.abs(n[1]) > 0.999999)) && verts(cyl, 60) < verts(cyl, 0), 'a smoothed cylinder shades its sides round and keeps its cap edges hard');
  ok(verts(box, 60) === 24, 'edges sharper than the smoothing angle stay hard (a box stays crisp)');
  const spec = sh => ({ name: 'Sh', ground: false, parts: [{ name: 'Ball', shape: 'sphere', radius: 0.5, detail: 0, shading: sh }] });
  ok(MD.compile(spec('smooth')).byName.get('Ball').smoothAngle === 60 && MD.compile(spec(30)).byName.get('Ball').smoothAngle === 30 && MD.compile(spec(undefined)).byName.get('Ball').smoothAngle === 0, 'shading: "smooth" = 60°, a number is the angle, flat is the default');
  ok(MD.compile(spec('glossy')).errors.some(e => /shading must be/.test(e)), 'an unknown shading value is a spec error');
  const ball = EX.toGlb(MD.compile(spec('smooth'))), bj = JSON.parse(ball.toString('utf8', 20, 20 + ball.readUInt32LE(12)));
  ok(bj.accessors[bj.meshes[0].primitives[0].attributes.POSITION].count === 12 && bj.accessors[bj.meshes[0].primitives[0].indices].count === 60, 'the .glb is indexed: a smooth icosphere is 12 vertices, 60 indices');
  ok(/^vn /m.test(EX.toObj(MD.compile(spec('smooth'))).obj) && /^f \d+\/\/\d+/m.test(EX.toObj(MD.compile(spec('smooth'))).obj), 'the .obj carries the normals');
  // merging: the chest's static parts become a few meshes; the lid group stays separate so it can still open
  const chest = MD.compile(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', 'treasure_chest.json'), 'utf8')));
  const plan = RB.meshPlan(chest), rb = EX.robloxGlbs(chest)[0].buf, rj = JSON.parse(rb.toString('utf8', 20, 20 + rb.readUInt32LE(12)));
  ok(plan.length < 10 && rj.meshes.filter(x => x.name !== 'Simple').length === plan.length && plan.some(p => p.name === 'Lid'), `the chest's ${chest.nodes.filter(n => n.mesh).length} parts import as ${plan.length} MeshParts, with the animated lid kept apart`);
  ok(!EX.validateGlb(rb).length && !EX.validateRoblox(rb).length, 'the merged Roblox file is valid');
  const mergedTris = rj.meshes.filter(x => x.name !== 'Simple').reduce((s, x) => s + rj.accessors[x.primitives[0].indices].count / 3, 0), allTris = chest.nodes.filter(n => n.mesh).reduce((s, n) => s + n.mesh.tris.length, 0);
  ok(mergedTris === allTris, 'merging keeps every triangle');
  ok(RB.mergeGroups(chest).every(g => !g.members.some(m => chest.clips.some(c => c.animated.has(m) && m !== g.frame))), 'no animated part is merged into a static group');
  // collision classes from size and shape, and the Studio script that applies them
  const one = p => RB.collisionClass(MD.compile({ name: 'C', parts: [Object.assign({ name: 'P' }, p)] }).byName.get('P'));
  ok(one({ shape: 'box', size: [1, 1, 1] }) === 'box' && one({ shape: 'sphere', radius: 0.5, detail: 1 }) === 'hull' && one({ shape: 'box', size: [1, 1, 1], hollow: 0.1 }) === 'default', 'collision: a box is Box, a ball is Hull, an open crate is Default');
  ok(one({ shape: 'box', size: [0.05, 0.05, 0.05] }) === 'none' && one({ shape: 'box', size: [0.05, 0.05, 0.05], collision: 'hull' }) === 'hull', 'small parts are decoration (no collision) unless the spec says otherwise');
  const lua = RB.setupScript(chest);
  ok(plan.every(p => lua.includes(`["${p.name}"]`)) && /Enum\.CollisionFidelity\[s\[1\]\]/.test(lua) && /CanCollide = s\[2\]/.test(lua), 'the Studio setup script lists every MeshPart with its collision');
  const perf = CK.run(chest).find(r => r.id === 'performance');
  ok(perf && perf.status === 'pass' && /GPU vertices/.test(perf.msg) && new RegExp(`→ ${plan.length} Roblox MeshParts`).test(perf.msg), 'the performance line reports GPU vertices and Roblox MeshParts');
  const pebbles = { name: 'Peb', parts: [{ name: 'Big', shape: 'box', size: [1, 0.2, 1], at: [0, 0.1, 0] }].concat(Array.from({ length: 6 }, (_, i) => ({ name: 'Pebble' + i, shape: 'sphere', radius: 0.012, detail: 1, at: [-0.4 + i * 0.15, 0.21, 0] }))) };
  ok(CK.run(MD.compile(pebbles)).some(r => r.id === 'performance' && r.status === 'warn' && /under ~10 px/.test(r.msg)), 'a model whose triangles are mostly too small to see is reported');
}
// 5c. level of detail: a cheaper version rebuilt from the spec, its test, and the Roblox / engine files
{
  const read = f => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', f), 'utf8'));
  const box = { name: 'B', parts: [{ name: 'A', shape: 'box', size: [1, 1, 1], at: [0, 0.5, 0] }] };
  ok(!LOD.settings(MD.compile(box)).on && LOD.settings(MD.compile(Object.assign({}, box, { lod: true }))).on, 'LOD is off for simple models (under 300 triangles) unless the spec asks for it');
  ok(!LOD.settings(MD.compile(Object.assign(read('treasure_chest.json'), { lod: false }))).on, '"lod": false turns it off');
  ok(MD.compile(Object.assign({}, box, { lod: 'yes' })).errors.some(e => /lod must be/.test(e)) && MD.compile({ name: 'B', parts: [{ name: 'A', shape: 'box', size: [1, 1, 1], lod: 'maybe' }] }).errors.some(e => /lod must be "drop" or "keep"/.test(e)), 'bad lod values are spec errors');
  ok(LOD.reducePart({ shape: 'cylinder', segments: 8 }).segments === 5 && LOD.reducePart({ shape: 'loft', sides: 8, stations: [] }).sides === 6 && LOD.reducePart({ shape: 'sphere', detail: 1 }).detail === 0 && LOD.reducePart({ shape: 'box', chamfer: 0.02 }).chamfer == null, 'reduction: fewer segments, even loft sides, one icosphere level less, no chamfer');
  const star = []; for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.4 : 1, a = (i / 10) * Math.PI * 2; star.push([Math.cos(a) * r, Math.sin(a) * r]); }
  ok(LOD.simplifyClosed(star, 6).length === 6 && (q => q.length === 4 && [[0, 0], [2, 0], [2, 1], [0, 1]].every(c => q.some(p => p[0] === c[0] && p[1] === c[1])))(LOD.simplifyClosed([[0, 0], [1, 0], [1, 0.001], [2, 0], [2, 1], [0, 1]], 4)), 'outline simplification drops the point that matters least first');
  const chest = MD.compile(read('treasure_chest.json')), cl = LOD.build(chest), dropped = new Set(cl.dropped);
  ok(['Coin1', 'Coin2', 'RubyGem'].every(n => dropped.has(n)) && !dropped.has('Lid') && !dropped.has('Base'), 'small parts inside the outline are detail (dropped); the big shapes stay');
  const keepSpec = read('treasure_chest.json'); keepSpec.parts.find(p => p.name === 'Coin1').lod = 'keep';
  ok(!LOD.build(MD.compile(keepSpec)).dropped.includes('Coin1'), '"lod": "keep" keeps a small part');
  const horn = { name: 'H', lod: true, parts: [{ name: 'Body', shape: 'box', size: [1, 1, 1], at: [0, 0.5, 0] }, { name: 'Horn', shape: 'cone', radius: 0.03, height: 0.07, at: [0, 1.035, 0] }] };
  ok(!LOD.build(MD.compile(horn)).dropped.includes('Horn'), 'a small part that sticks out of everything else is kept (it sets the outline)');
  const fish = MD.compile(read('fish.json')), fl = LOD.build(fish).model, tri = m => m.nodes.reduce((s, n) => s + (n.mesh ? n.mesh.tris.length : 0), 0);
  ok(!fl.errors.length && fl.clips.map(c => c.name).join() === 'Swim,Idle,Die' && ['Head', 'Spine1', 'Spine2', 'TailBone'].every(b => fl.byName.has(b)) && tri(fl) < 0.6 * tri(fish), 'the fish LOD keeps its bones and clips with under 60% of the triangles');
  const res = CK.run(chest).find(r => r.id === 'lod');
  ok(res && res.status === 'pass' && /silhouette kept/.test(res.msg), 'the lod test reports triangles and silhouette overlap');
  const lidless = read('treasure_chest.json'); lidless.parts.find(p => p.name === 'Lid').lod = 'drop';
  ok(CK.run(MD.compile(lidless)).some(r => r.id === 'lod' && r.status === 'warn' && /changes the outline/.test(r.msg)), 'dropping a part that carries the silhouette is reported');
  // exports: Simple stand-in for a model without skins, a reduced rig for a skinned one, and .lod.glb for engines
  const cb = EX.robloxGlbs(chest)[0].buf, cj = JSON.parse(cb.toString('utf8', 20, 20 + cb.readUInt32LE(12))), sm = cj.meshes.find(x => x.name === 'Simple');
  ok(sm && cj.accessors[sm.primitives[0].indices].count / 3 === tri(cl.model) && !EX.validateRoblox(cb).length, "the chest's Roblox file carries a one-mesh Simple stand-in with the LOD's triangles");
  const lua = RB.setupScript(chest);
  ok(/AddTag\(holder, "PerfLod"\)/.test(lua) && /detail\.Name = "Detail"/.test(lua) && /simple\.CanQuery = false/.test(lua), 'the setup script builds Detail / Simple and tags the model for the LodController');
  ok(/Fish\.lod\.roblox\.glb/.test(RB.setupScript(fish)) && EX.robloxGlbs(fish).some(r => r.name === 'Fish.lod.roblox.glb'), 'a skinned model gets a separate reduced rig instead');
  const lg = EX.lodGlb(fish), lj = lg && JSON.parse(lg.toString('utf8', 20, 20 + lg.readUInt32LE(12)));
  ok(lg && !EX.validateGlb(lg).length && lj.animations.length === 3, '<Name>.lod.glb is valid and keeps the clips (three.js LOD, Godot, Unity LODGroup)');
}
// 6. rendering and reference tracing round-trip
{
  const m = MD.compile({ name: 'R', parts: [{ name: 'A', shape: 'box', size: [2, 1, 1], at: [0, 0.5, 0] }] });
  const sil = RF.cropMask(RN.silhouette(m, 'front', 200));
  ok(near(sil.aspect, 2, 0.05), 'front silhouette of a 2×1 box has aspect 2');
  const img = new Uint8Array(200 * 100 * 4).fill(255); for (let y = 30; y < 70; y++) for (let x = 20; x < 180; x++) { const o = (y * 200 + x) * 4; img[o] = 200; img[o + 1] = 40; img[o + 2] = 30; }
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rmodel-')), 'ref.png'); fs.writeFileSync(f, RN.png(200, 100, img));
  const tr = RF.extract(RF.loadImage(f)); ok(near(tr.aspect, 4, 0.05), 'tracer finds a 160×40 shape on a white background (aspect 4)');
  const m4 = MD.compile({ name: 'R4', parts: [{ name: 'A', shape: 'box', size: [4, 1, 1], at: [0, 0.5, 0] }] });
  ok(RF.compare(m4, f, { view: 'front' }).score > 0.95, 'matching model scores > 95% against its own silhouette');
  ok(RN.modelSheet(m).readUInt32BE(0) === 0x89504e47, 'review sheet renders to PNG');
}
console.log(fails ? `\n${fails} FAILED` : '\nall self-tests passed');
process.exit(fails ? 1 : 0);
