#!/usr/bin/env node
// Self-test for rmodel. Run: node selftest.cjs   (exits non-zero on failure). Needs only Node.
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const M = require('./lib/math.cjs'), G = require('./lib/geometry.cjs'), MD = require('./lib/model.cjs'), CK = require('./lib/checks.cjs');
const RN = require('./lib/render.cjs'), EX = require('./lib/export.cjs'), RF = require('./lib/reference.cjs');
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
  const bad = MD.compile({ name: 'E', parts: [{ name: 'A', shape: 'blob' }, { name: 'B', shape: 'box', parent: 'Nope' }], animations: [{ name: 'X', duration: 1, tracks: [{ part: 'Z', rot: [] }] }] });
  ok(bad.errors.length >= 3, 'bad shape, missing parent and missing track part are spec errors');
}
// 5. exports: glb structure, obj, scripts
{
  const m = MD.compile(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', 'fish.json'), 'utf8')));
  const glb = EX.toGlb(m), errs = EX.validateGlb(glb);
  ok(!errs.length, 'fish .glb passes structural validation' + (errs.length ? ': ' + errs.join('; ') : ''));
  const json = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
  ok(json.skins && json.skins.length === 1 && json.animations.map(a => a.name).join() === 'Swim,Idle,Die', 'glb carries the skin and all three clips');
  ok(json.accessors.every(a => a.byteOffset == null) && json.bufferViews.every(v => v.byteOffset % 4 === 0), 'buffer views are 4-byte aligned');
  const { obj } = EX.toObj(m); ok(/^o Body$/m.test(obj) && /^f /m.test(obj), 'obj has named objects and faces');
  ok(/import_scene\.gltf/.test(EX.blenderScript(m)) && /GLTFLoader/.test(EX.threeModule(m)), 'Blender script and three.js loader are generated');
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
