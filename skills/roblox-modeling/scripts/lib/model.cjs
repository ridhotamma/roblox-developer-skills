'use strict';
// Model spec -> compiled model: nodes (hierarchy + pivots), meshes in model space, skins, baked animation clips.
// Authoring convention: every position in the spec is in MODEL space at the rest pose (metres, +Y up, front faces +Z,
// right is +X). Hierarchy only decides what moves with what; a node rotates about its pivot.
const M = require('./math.cjs');
const G = require('./geometry.cjs');
const { add, sub, mul, D2R } = M;

const PART_KEYS = new Set(('name parent pivot shape at rot scale color material mirror mirrorName jitter seed skin hidden note ' +
  'size taper chamfer hollow open radius height segments axis squash phase detail ico stagger tube arc profile stations sides outline depth plane points vertices faces').split(' '));
const TOP_KEYS = new Set('name title description units reference palette budget ground parts animations checks camera fps seed tags'.split(' '));
const EASE = {
  linear: t => t, step: t => (t < 1 ? 0 : 1), in: t => t * t, out: t => 1 - (1 - t) * (1 - t), inOut: t => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
  sine: t => 0.5 - 0.5 * Math.cos(Math.PI * t), backOut: t => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  backIn: t => { const c = 1.70158; return (c + 1) * t * t * t - c * t * t; },
  bounceOut: t => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375; return n * (t -= 2.625 / d) * t + 0.984375; },
  elasticOut: t => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1),
};

function color(v, palette, E, where) {
  if (v == null) return [0.75, 0.75, 0.75];
  const c = M.hexColor(palette && palette[v] != null ? palette[v] : v);
  if (!c) { E.push(`${where}: color "${v}" is not a #hex colour or palette name`); return [1, 0, 1]; }
  return c;
}
const vec3 = (v, def) => (v == null ? def.slice() : typeof v === 'number' ? [v, v, v] : v.slice());
const mirrorName = n => (/L$/.test(n) ? n.replace(/L$/, 'R') : /Left/.test(n) ? n.replace(/Left/, 'Right') : /_l$/.test(n) ? n.replace(/_l$/, '_r') : n + '_R');

function buildPartMesh(p, E, warn) {
  const gen = G.SHAPES[p.shape];
  if (!gen) { E.push(`part "${p.name}": unknown shape "${p.shape}" (use ${Object.keys(G.SHAPES).join(', ')}, or "none" for an empty pivot/bone)`); return null; }
  let m;
  try { m = gen(p); } catch (e) { E.push(`part "${p.name}": ${p.shape} failed: ${e.message}`); return null; }
  if (!m.tris.length) { E.push(`part "${p.name}": ${p.shape} produced no triangles (check its dimensions)`); return null; }
  const s = vec3(p.scale, [1, 1, 1]), q = M.quatEuler(vec3(p.rot, [0, 0, 0])), at = vec3(p.at, [0, 0, 0]);
  if (p.jitter) {                                    // organic wobble, seeded per part, applied before transform
    const r = M.rng(M.hash(p.name) ^ (p.seed || 0)), amt = p.jitter;
    m.pos = m.pos.map(v => [v[0] + (r() * 2 - 1) * amt, v[1] + (r() * 2 - 1) * amt, v[2] + (r() * 2 - 1) * amt]);
  }
  // rot and scale act around the part's pivot when it has one (a fin posed on its hinge stays on its hinge),
  // otherwise around the shape's own centre (a tilted fin stays where it was drawn); at then moves it
  const c = p.pivot ? sub(p.pivot, at) : p.shape === 'extrude' || p.shape === 'hull' || p.shape === 'mesh' || p.shape === 'loft' || p.shape === 'lathe' ? G.bounds(m.pos).center : [0, 0, 0];
  m.pos = m.pos.map(v => add(add(M.quatRot(q, M.vmul(sub(v, c), s)), c), at));
  if (s[0] * s[1] * s[2] < 0) G.flip(m);
  return m;
}

function compile(spec) {
  const E = [], W = [], palette = spec.palette || {};
  for (const k of Object.keys(spec)) if (!TOP_KEYS.has(k)) W.push(`unknown top-level field "${k}"`);
  const name = String(spec.name || 'Model').replace(/[^A-Za-z0-9_]/g, '') || 'Model';
  const rootName = name;
  const nodes = [{ name: rootName, parent: null, pivot: [0, 0, 0], mesh: null, kids: [] }];
  const byName = new Map([[rootName, nodes[0]]]);

  // expand mirrors first so mirrored parts can be parents / animation targets
  const parts = [];
  for (const p0 of spec.parts || []) {
    if (!p0 || !p0.name) { E.push('every part needs a "name"'); continue; }
    for (const k of Object.keys(p0)) if (!PART_KEYS.has(k)) W.push(`part "${p0.name}": unknown field "${k}"`);
    parts.push(Object.assign({}, p0, { _src: p0.name }));
    if (p0.mirror) {
      if (p0.mirror !== 'x') { E.push(`part "${p0.name}": only mirror "x" (left/right) is supported`); continue; }
      const q = JSON.parse(JSON.stringify(p0)); delete q.mirror;
      q.name = p0.mirrorName || mirrorName(p0.name); q._src = p0.name; q._mirrored = true;
      parts.push(q);
    }
  }
  const mirrorOf = new Map(); parts.forEach(p => { if (p._mirrored) mirrorOf.set(p._src, p.name); });
  // a mirrored child hangs from the mirrored parent when there is one
  for (const p of parts) if (p._mirrored && p.parent && mirrorOf.has(p.parent)) p.parent = mirrorOf.get(p.parent);

  for (const p of parts) {
    if (byName.has(p.name)) { E.push(`duplicate part name "${p.name}"`); continue; }
    const where = `part "${p.name}"`;
    let mesh = null;
    if (p.shape && p.shape !== 'none') { mesh = buildPartMesh(p, E, W); }
    else if (!p.shape) E.push(`${where}: needs a "shape" (or "none" for a pivot / bone)`);
    if (mesh && p._mirrored) { mesh.pos = mesh.pos.map(v => [-v[0], v[1], v[2]]); G.flip(mesh); }
    let pivot = p.pivot ? p.pivot.slice() : mesh ? G.bounds(mesh.pos).center : vec3(p.at, [0, 0, 0]);
    if (p._mirrored && (p.pivot || !mesh)) pivot = [-pivot[0], pivot[1], pivot[2]];   // mesh bounds are already mirrored
    const node = { name: p.name, parentName: p.parent || rootName, pivot, mesh, kids: [], src: p._src, mirrored: !!p._mirrored, hidden: !!p.hidden,
      color: color(p.color, palette, E, where), material: Object.assign({ roughness: 0.85, metalness: 0, emissive: null }, p.material || {}), skin: p.skin || null, shape: p.shape || 'none' };
    if (node.material.emissive) node.material.emissive = color(node.material.emissive, palette, E, where + ' emissive');
    nodes.push(node); byName.set(node.name, node);
  }
  for (const n of nodes.slice(1)) {
    const par = byName.get(n.parentName);
    if (!par) { E.push(`part "${n.name}": parent "${n.parentName}" does not exist`); n.parent = nodes[0]; } else n.parent = par;
    n.parent.kids.push(n);
  }
  // cycle check
  for (const n of nodes) { let k = n, steps = 0; while (k && steps < nodes.length + 2) { k = k.parent; steps++; } if (steps > nodes.length) { E.push(`part "${n.name}": parent chain loops`); break; } }
  // order nodes so parents come first
  const ordered = []; (function walk(n) { ordered.push(n); n.kids.forEach(walk); })(nodes[0]);
  ordered.forEach((n, i) => { n.index = i; });

  // skins: weights by position along an axis between the listed bones (piecewise linear "hat" weights)
  for (const n of ordered) {
    if (!n.skin || !n.mesh) continue;
    const bones = (n.skin.bones || []).map(b => byName.get(b));
    if (bones.some(b => !b)) { E.push(`part "${n.name}": skin lists a bone that does not exist`); n.skin = null; continue; }
    if (bones.length < 1) { E.push(`part "${n.name}": skin needs at least one bone`); n.skin = null; continue; }
    const ax = G.AX[n.skin.axis || 'z'];
    const sorted = bones.map((b, i) => ({ i, c: b.pivot[ax] })).sort((a, b) => a.c - b.c);
    n.skinBones = bones;
    n.weights = n.mesh.pos.map(p => {
      const w = new Array(bones.length).fill(0), c = p[ax];
      if (c <= sorted[0].c) w[sorted[0].i] = 1;
      else if (c >= sorted[sorted.length - 1].c) w[sorted[sorted.length - 1].i] = 1;
      else for (let k = 0; k + 1 < sorted.length; k++) if (c >= sorted[k].c && c <= sorted[k + 1].c) {
        const t = (c - sorted[k].c) / ((sorted[k + 1].c - sorted[k].c) || 1); w[sorted[k].i] = 1 - t; w[sorted[k + 1].i] = t; break;
      }
      return w;
    });
    if (n.kids.length) W.push(`part "${n.name}": a skinned part should not have children; parent them to its bones instead`);
  }

  const model = { name, title: spec.title || name, description: spec.description || '', spec, nodes: ordered, byName, errors: E, warnings: W, palette,
    fps: spec.fps || 30, ground: spec.ground !== false, budget: spec.budget || 2000, reference: spec.reference || null, camera: spec.camera || {} };
  model.clips = (spec.animations || []).map(a => compileClip(model, a, E, W));
  const names = new Set(); for (const c of model.clips) { if (names.has(c.name)) E.push(`duplicate animation name "${c.name}"`); names.add(c.name); }
  return model;
}

// ---------------------------------------------------------------- animation
// track: { part, rot?, pos?, scale?, mirror? } each channel is keys [[t, [x,y,z], ease?], ...] or { wave: {...} }
// wave: { amp: number | [x,y,z], axis?: "x"|"y"|"z", hz?: cycles per second, cycles?: cycles per clip, phase?: 0..1, offset?: [x,y,z], envelope?: [[t, k], ...] }
function channel(ch, kind, dur, E, where) {
  if (ch == null) return null;
  if (Array.isArray(ch)) {
    const keys = ch.map(k => {
      if (!Array.isArray(k) || typeof k[0] !== 'number') { E.push(`${where}.${kind}: keys must look like [time, [x, y, z], "ease"?]`); return null; }
      const v = typeof k[1] === 'number' ? (kind === 'scale' ? [k[1], k[1], k[1]] : null) : k[1];
      if (!Array.isArray(v) || v.length !== 3) { E.push(`${where}.${kind}: key at t=${k[0]} needs [x, y, z]`); return null; }
      if (k[2] && !EASE[k[2]]) E.push(`${where}.${kind}: unknown ease "${k[2]}" (${Object.keys(EASE).join(', ')})`);
      if (k[0] < -1e-9 || k[0] > dur + 1e-9) E.push(`${where}.${kind}: key time ${k[0]} is outside 0..${dur}`);
      return { t: k[0], v, ease: EASE[k[2]] || EASE.linear };
    }).filter(Boolean).sort((a, b) => a.t - b.t);
    return keys.length ? { keys } : null;
  }
  if (ch.wave) {
    const w = ch.wave, axis = w.axis || 'y', A = typeof w.amp === 'number' ? [0, 0, 0].map((_, i) => (i === G.AX[axis] ? w.amp : 0)) : vec3(w.amp, [0, 0, 0]);
    const hz = w.hz != null ? w.hz : (w.cycles || 1) / dur;
    const env = w.envelope ? w.envelope.map(([t, k, e]) => ({ t, v: [k, k, k], ease: EASE[e] || EASE.linear })) : null;
    return { wave: { A, hz, phase: w.phase || 0, offset: vec3(w.offset, [0, 0, 0]), env, shape: w.shape || 'sin' } };
  }
  E.push(`${where}.${kind}: expected a key list or { "wave": {...} }`); return null;
}
function sampleKeys(keys, t) {
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 1; i < keys.length; i++) if (t <= keys[i].t) { const a = keys[i - 1], b = keys[i], u = b.ease((t - a.t) / ((b.t - a.t) || 1)); return M.vlerp(a.v, b.v, u); }
  return keys[keys.length - 1].v;
}
function sampleChannel(ch, t) {
  if (!ch) return null;
  if (ch.keys) return sampleKeys(ch.keys, t);
  const w = ch.wave, x = 2 * Math.PI * (w.hz * t + w.phase), s = w.shape === 'saw' ? ((w.hz * t + w.phase) % 1) * 2 - 1 : w.shape === 'bounce' ? Math.abs(Math.sin(x)) : Math.sin(x);
  const k = w.env ? sampleKeys(w.env, t)[0] : 1;
  return add(w.offset, mul(w.A, s * k));
}
function compileClip(model, a, E, W) {
  const name = String(a.name || 'Clip'), where = `animation "${name}"`, dur = a.duration;
  if (!(dur > 0)) E.push(`${where}: needs "duration" > 0 (seconds)`);
  const tracks = [];
  for (const tr of a.tracks || []) {
    const node = model.byName.get(tr.part);
    if (!node) { E.push(`${where}: track part "${tr.part}" does not exist`); continue; }
    if (node.skin) E.push(`${where}: "${tr.part}" is skinned; animate its bones instead`);
    const t = { node, rot: channel(tr.rot, 'rot', dur || 1, E, `${where} ${tr.part}`), pos: channel(tr.pos, 'pos', dur || 1, E, `${where} ${tr.part}`), scale: channel(tr.scale, 'scale', dur || 1, E, `${where} ${tr.part}`) };
    tracks.push(t);
    if (tr.mirror) {                                  // mirrored copy: x stays, y/z rotations and x offsets flip
      const mn = [...model.byName.values()].find(n => n.mirrored && n.src === node.src && n !== node) || [...model.byName.values()].find(n => n.src === node.name && n.mirrored);
      if (!mn) { W.push(`${where}: "${tr.part}" has "mirror": true but no mirrored partner`); continue; }
      const flipCh = (ch, kind) => {
        if (!ch) return null; const f = kind === 'rot' ? [1, -1, -1] : kind === 'pos' ? [-1, 1, 1] : [1, 1, 1];
        if (ch.keys) return { keys: ch.keys.map(k => ({ t: k.t, v: M.vmul(k.v, f), ease: k.ease })) };
        return { wave: Object.assign({}, ch.wave, { A: M.vmul(ch.wave.A, f), offset: M.vmul(ch.wave.offset, f), phase: ch.wave.phase + (tr.mirrorPhase || 0) }) };
      };
      tracks.push({ node: mn, rot: flipCh(t.rot, 'rot'), pos: flipCh(t.pos, 'pos'), scale: flipCh(t.scale, 'scale') });
    }
  }
  const clip = { name, duration: dur || 1, loop: !!a.loop, tracks, markers: a.markers || [], description: a.description || '' };
  clip.animated = new Set(tracks.map(t => t.node));
  return clip;
}
// Local pose of every node at time t: { q, t (offset from rest), s }. Several tracks on one node add up.
function poseAt(model, clip, time) {
  const pose = new Map();
  if (!clip) return pose;
  for (const tr of clip.tracks) {
    const cur = pose.get(tr.node) || { rot: [0, 0, 0], pos: [0, 0, 0], scale: [1, 1, 1] };
    const r = sampleChannel(tr.rot, time), p = sampleChannel(tr.pos, time), s = sampleChannel(tr.scale, time);
    if (r) cur.rot = add(cur.rot, r); if (p) cur.pos = add(cur.pos, p); if (s) cur.scale = M.vmul(cur.scale, s);
    pose.set(tr.node, cur);
  }
  return pose;
}
// Local TRS for glTF: translation = pivot - parent pivot + offset, rotation from euler, scale.
function localTRS(node, pose) {
  const p = pose && pose.get(node), parentPivot = node.parent ? node.parent.pivot : [0, 0, 0];
  const base = node.parent ? sub(node.pivot, parentPivot) : node.pivot.slice();
  if (!p) return { t: base, q: [0, 0, 0, 1], s: [1, 1, 1] };
  return { t: add(base, p.pos), q: M.quatEuler(p.rot), s: p.scale };
}
// World matrices of all nodes for a pose.
function worldMatrices(model, pose) {
  const W = new Map();
  for (const n of model.nodes) {
    const L = localTRS(n, pose), m = M.mat4Compose(L.t, L.q, L.s);
    W.set(n, n.parent ? M.mat4Mul(W.get(n.parent), m) : m);
  }
  return W;
}
// Posed geometry in model space: [{ node, pos: [[x,y,z]], tris }]
function posedMeshes(model, clip, time) {
  const pose = poseAt(model, clip, time), Wm = worldMatrices(model, pose), out = [];
  for (const n of model.nodes) {
    if (!n.mesh || n.hidden) continue;
    let pos;
    if (n.skin && n.skinBones) {
      const mats = n.skinBones.map(b => M.mat4Mul(Wm.get(b), M.mat4Translate(mul(b.pivot, -1))));
      pos = n.mesh.pos.map((p, i) => { let acc = [0, 0, 0]; n.weights[i].forEach((w, j) => { if (w) acc = add(acc, mul(M.mat4Point(mats[j], p), w)); }); return acc; });
    } else {
      const m = M.mat4Mul(Wm.get(n), M.mat4Translate(mul(n.pivot, -1)));
      pos = n.mesh.pos.map(p => M.mat4Point(m, p));
    }
    out.push({ node: n, pos, tris: n.mesh.tris });
  }
  return out;
}
// Baked samples for export: per animated node, arrays of times and local TRS (also bones that skins use).
function bakeClip(model, clip) {
  const fps = model.fps, n = Math.max(2, Math.round(clip.duration * fps) + 1), times = [];
  for (let i = 0; i < n; i++) times.push(Math.min(clip.duration, i / fps));
  if (times[times.length - 1] < clip.duration - 1e-6) times.push(clip.duration);
  const nodes = [...clip.animated], data = new Map(nodes.map(nd => [nd, { t: [], q: [], s: [] }]));
  for (const tm of times) {
    const pose = poseAt(model, clip, tm);
    for (const nd of nodes) {
      const L = localTRS(nd, pose), d = data.get(nd), prev = d.q[d.q.length - 1];
      let q = L.q; if (prev && M.dot(prev, q) + prev[3] * q[3] < 0) q = q.map(v => -v);   // keep quaternions continuous
      d.t.push(L.t); d.q.push(q); d.s.push(L.s);
    }
  }
  return { times, nodes, data };
}

module.exports = { compile, poseAt, localTRS, worldMatrices, posedMeshes, bakeClip, sampleChannel, EASE };
