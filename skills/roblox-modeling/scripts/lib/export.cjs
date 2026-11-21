'use strict';
// Exporters: binary glTF 2.0 (.glb, with node hierarchy, flat-shaded meshes, PBR colours, skins and animations),
// Wavefront .obj/.mtl (static rest pose), a Blender import script and a three.js loader module.
const M = require('./math.cjs');
const MD = require('./model.cjs');
const { sub, cross, unit, mul } = M;

// ---- glTF --------------------------------------------------------------------------------------
// opts.vertexColors: write each part's colour as COLOR_0 and make the base colour white (glTF multiplies the two),
//   so parts merged into one mesh keep their colours (Roblox allows one material per mesh).
// opts.clips: names of the clips to include (default: all).
function toGltf(model, opts) {
  opts = opts || {};
  const bin = [], bufferViews = [], accessors = [];
  let offset = 0;
  const pushView = (typed, target) => {
    const b = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength), pad = (4 - (b.length % 4)) % 4;
    bufferViews.push(Object.assign({ buffer: 0, byteOffset: offset, byteLength: b.length }, target ? { target } : {}));
    bin.push(b); if (pad) bin.push(Buffer.alloc(pad)); offset += b.length + pad; return bufferViews.length - 1;
  };
  const accessor = (arr, type, comp, target, minmax) => {
    const typed = comp === 5126 ? new Float32Array(arr) : comp === 5123 ? new Uint16Array(arr) : comp === 5121 ? new Uint8Array(arr) : new Uint32Array(arr);
    const k = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[type], a = { bufferView: pushView(typed, target), componentType: comp, count: arr.length / k, type };
    if (minmax) { const lo = new Array(k).fill(Infinity), hi = new Array(k).fill(-Infinity); for (let i = 0; i < arr.length; i++) { const c = i % k; if (arr[i] < lo[c]) lo[c] = arr[i]; if (arr[i] > hi[c]) hi[c] = arr[i]; } a.min = lo.map(v => Math.fround(v)); a.max = hi.map(v => Math.fround(v)); }
    accessors.push(a); return accessors.length - 1;
  };
  const materials = [], matKey = new Map();
  const material = n => {
    const k = JSON.stringify([opts.vertexColors ? null : n.color, n.material]); if (matKey.has(k)) return matKey.get(k);
    const lin = opts.vertexColors ? [1, 1, 1] : n.color.map(M.srgbToLinear), m ={ name: matName(n, materials.length), pbrMetallicRoughness: { baseColorFactor: [...lin, 1], metallicFactor: n.material.metalness || 0, roughnessFactor: n.material.roughness == null ? 0.85 : n.material.roughness } };
    if (n.material.emissive) m.emissiveFactor = n.material.emissive.map(M.srgbToLinear);
    materials.push(m); matKey.set(k, materials.length - 1); return materials.length - 1;
  };
  const nodes = model.nodes.map(n => { const L = MD.localTRS(n, null), o = { name: n.name }; if (M.len(L.t) > 0) o.translation = L.t; return o; });
  model.nodes.forEach((n, i) => { const kids = n.kids.map(k => k.index); if (kids.length) nodes[i].children = kids; });
  const meshes = [], skins = [], extraRoots = [];
  model.nodes.forEach((n, i) => {
    if (!n.mesh) return;
    const P = [], N = [], J = [], Wt = [], Col = [], vcol = n.color.map(M.srgbToLinear);
    const local = n.skin ? (p => p) : (p => sub(p, n.pivot));        // skinned meshes live in model space; rigid ones around their pivot
    // The skin's root joint is the node above its top bone (usually the model root) and carries no weight:
    // Roblox's importer rejects influences on the root joint. Joint 0 is that root, the bones follow from 1.
    const root = n.skin ? skinRoot(n.skinBones) : null, off = root ? 1 : 0;
    for (const t of n.mesh.tris) {
      const A = n.mesh.pos[t[0]], B = n.mesh.pos[t[1]], C = n.mesh.pos[t[2]], nn = unit(cross(sub(B, A), sub(C, A)));
      for (const k of t) {
        P.push(...local(n.mesh.pos[k])); N.push(...nn); if (opts.vertexColors) Col.push(...vcol);
        if (n.skin) { const w = n.weights[k], idx = w.map((v, j) => [v, j]).sort((a, b) => b[0] - a[0]).slice(0, 4); while (idx.length < 4) idx.push([0, -1]); const s = idx.reduce((q, x) => q + x[0], 0) || 1; J.push(...idx.map(x => (x[0] > 0 ? x[1] + off : 0))); Wt.push(...idx.map(x => x[0] / s)); }
      }
    }
    const attributes = { POSITION: accessor(P, 'VEC3', 5126, 34962, true), NORMAL: accessor(N, 'VEC3', 5126, 34962) };
    if (opts.vertexColors) attributes.COLOR_0 = accessor(Col, 'VEC3', 5126, 34962);
    if (n.skin) { attributes.JOINTS_0 = accessor(J, 'VEC4', 5121, 34962); attributes.WEIGHTS_0 = accessor(Wt, 'VEC4', 5126, 34962); }
    meshes.push({ name: n.name, primitives: [{ attributes, material: material(n), mode: 4 }] });
    if (n.skin) {
      // glTF skinned meshes ignore their node transform, so the mesh goes on its own node at the scene root
      const joints = (root ? [root] : []).concat(n.skinBones), ibm = []; joints.forEach(b => ibm.push(...M.mat4Translate(mul(b.pivot, -1))));
      skins.push({ name: n.name + 'Skin', joints: joints.map(b => b.index), inverseBindMatrices: accessor(ibm, 'MAT4', 5126), skeleton: joints[0].index });
      const meshNode = { name: n.name + 'Mesh', mesh: meshes.length - 1, skin: skins.length - 1 };
      extraRoots.push(meshNode);
    } else nodes[i].mesh = meshes.length - 1;
  });
  const extraStart = nodes.length; nodes.push(...extraRoots);
  // animations: baked, linear
  const animations = model.clips.filter(c => !opts.clips || opts.clips.includes(c.name)).map(clip => {
    const bake = MD.bakeClip(model, clip), input = accessor(bake.times, 'SCALAR', 5126, null, true), channels = [], samplers = [];
    for (const nd of bake.nodes) {
      const d = bake.data.get(nd);
      for (const [pathName, arr, type] of [['translation', d.t, 'VEC3'], ['rotation', d.q, 'VEC4'], ['scale', d.s, 'VEC3']]) {
        if (pathName === 'scale' && arr.every(s => Math.abs(s[0] - 1) + Math.abs(s[1] - 1) + Math.abs(s[2] - 1) < 1e-6)) continue;
        if (pathName === 'translation' && arr.every(v => M.dist(v, arr[0]) < 1e-7) && M.dist(arr[0], MD.localTRS(nd, null).t) < 1e-7) continue;
        samplers.push({ input, output: accessor(arr.flat(), type, 5126), interpolation: 'LINEAR' });
        channels.push({ sampler: samplers.length - 1, target: { node: nd.index, path: pathName } });
      }
    }
    return { name: clip.name, channels, samplers, extras: { loop: clip.loop, duration: clip.duration, markers: clip.markers } };
  }).filter(a => a.channels.length);
  const gltf = {
    asset: { version: '2.0', generator: 'roblox-modeling skill (rmodel.cjs)', extras: { title: model.title, units: 'metres, +Y up, front faces +Z' } },
    scene: 0, scenes: [{ name: model.name, nodes: [0, ...extraRoots.map((_, k) => extraStart + k)] }],
    nodes, meshes, materials, accessors, bufferViews, buffers: [{ byteLength: offset }],
  };
  if (skins.length) gltf.skins = skins;
  if (animations.length) gltf.animations = animations;
  return { gltf, bin: Buffer.concat(bin) };
}
const matName = (n, i) => (n.src || n.name).replace(/[RL]$|_R$/, '') + 'Mat' + i;
// The nearest node above every top bone of a skin (a bone whose parent is not in the skin). null when a top bone is
// the scene root itself.
function skinRoot(bones) {
  const set = new Set(bones), tops = bones.filter(b => { for (let p = b.parent; p; p = p.parent) if (set.has(p)) return false; return true; });
  const above = b => { const a = []; for (let p = b.parent; p; p = p.parent) a.push(p); return a; };
  const first = above(tops[0]); return first.find(c => tops.every(t => above(t).includes(c))) || null;
}
function toGlb(model, opts) {
  const { gltf, bin } = toGltf(model, opts);
  let json = Buffer.from(JSON.stringify(gltf)); const jp = (4 - (json.length % 4)) % 4; json = Buffer.concat([json, Buffer.alloc(jp, 0x20)]);
  const bp = (4 - (bin.length % 4)) % 4, b = Buffer.concat([bin, Buffer.alloc(bp)]);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + json.length + 8 + b.length, 8);
  const cj = Buffer.alloc(8); cj.writeUInt32LE(json.length, 0); cj.writeUInt32LE(0x4E4F534A, 4);
  const cb = Buffer.alloc(8); cb.writeUInt32LE(b.length, 0); cb.writeUInt32LE(0x004E4942, 4);
  return Buffer.concat([head, cj, json, cb, b]);
}
// Structural validation of a .glb (what three.js / Blender rely on). Returns a list of problems.
function validateGlb(buf) {
  const errs = [];
  if (buf.readUInt32LE(0) !== 0x46546C67) return ['bad magic'];
  if (buf.readUInt32LE(8) !== buf.length) errs.push('header length mismatch');
  const jl = buf.readUInt32LE(12), g = JSON.parse(buf.toString('utf8', 20, 20 + jl)), bl = buf.readUInt32LE(20 + jl), bin = buf.subarray(28 + jl, 28 + jl + bl);
  if (g.asset.version !== '2.0') errs.push('asset.version must be 2.0');
  if (g.buffers[0].byteLength > bin.length) errs.push('buffer longer than BIN chunk');
  const size = { 5126: 4, 5123: 2, 5121: 1, 5125: 4 }, comps = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 };
  g.accessors.forEach((a, i) => {
    const v = g.bufferViews[a.bufferView]; if (!v) { errs.push(`accessor ${i}: no bufferView`); return; }
    if (a.count * comps[a.type] * size[a.componentType] > v.byteLength) errs.push(`accessor ${i}: overruns its bufferView`);
    if (v.byteOffset % 4) errs.push(`bufferView ${a.bufferView}: not 4-byte aligned`);
    if (a.componentType === 5126) { const f = new Float32Array(bin.buffer.slice(bin.byteOffset + v.byteOffset, bin.byteOffset + v.byteOffset + v.byteLength)); if (f.some(x => !Number.isFinite(x))) errs.push(`accessor ${i}: non-finite floats`); }
  });
  (g.meshes || []).forEach((m, i) => m.primitives.forEach(p => { const a = g.accessors[p.attributes.POSITION]; if (!a.min || !a.max) errs.push(`mesh ${i}: POSITION needs min/max`); if (a.count % 3) errs.push(`mesh ${i}: vertex count not a multiple of 3`); }));
  const parents = new Map(); (g.nodes || []).forEach((n, i) => (n.children || []).forEach(c => { if (parents.has(c)) errs.push(`node ${c} has two parents`); parents.set(c, i); }));
  (g.animations || []).forEach(an => an.samplers.forEach((s, k) => { const inp = g.accessors[s.input]; if (!inp.min || !inp.max) errs.push(`animation ${an.name} sampler ${k}: input needs min/max`); if (g.accessors[s.output].count !== inp.count) errs.push(`animation ${an.name} sampler ${k}: input/output count differ`); }));
  (g.skins || []).forEach((s, i) => { if (g.accessors[s.inverseBindMatrices].count !== s.joints.length) errs.push(`skin ${i}: inverseBindMatrices count != joints`); });
  return errs;
}

// ---- Roblox ----------------------------------------------------------------------------------------
// Roblox's 3D Importer takes one animation track per file and one material per mesh, so Roblox gets its own files:
// <Name>.roblox.glb (the model, vertex colours, no animation) and, for a skinned model, <Name>.<Clip>.roblox.glb
// per clip (the same rig with that one clip). Node animations of unrigged parts are not imported by Roblox, so a
// model without skins gets the model file only (animate it from a script, see integration.md).
function robloxGlbs(model) {
  const out = [{ name: `${model.name}.roblox.glb`, buf: toGlb(model, { vertexColors: true, clips: [] }) }];
  if (model.nodes.some(n => n.mesh && n.skin)) for (const c of model.clips) out.push({ name: `${model.name}.${c.name}.roblox.glb`, clip: c.name, buf: toGlb(model, { vertexColors: true, clips: [c.name] }) });
  return out;
}
// Roblox's mesh rules on a .glb: at most one animation, at most 20,000 triangles and 4 influences per vertex in a
// mesh, no weight on a skin's root joint, vertex colours present. Returns a list of problems.
function validateRoblox(buf) {
  const errs = [], jl = buf.readUInt32LE(12), g = JSON.parse(buf.toString('utf8', 20, 20 + jl)), bin = buf.subarray(28 + jl);
  const read = (i, n) => { const a = g.accessors[i], v = g.bufferViews[a.bufferView], k = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type]; const T = a.componentType === 5126 ? Float32Array : Uint8Array; return new T(bin.buffer.slice(bin.byteOffset + v.byteOffset, bin.byteOffset + v.byteOffset + a.count * k * T.BYTES_PER_ELEMENT)); };
  if ((g.animations || []).length > 1) errs.push(`${g.animations.length} animations in one file (Roblox imports one track per file)`);
  const skinOf = new Map(); (g.nodes || []).forEach(n => { if (n.mesh != null && n.skin != null) skinOf.set(n.mesh, n.skin); });
  (g.meshes || []).forEach((m, mi) => m.primitives.forEach(p => {
    const tris = g.accessors[p.attributes.POSITION].count / 3; if (tris > 20000) errs.push(`mesh ${m.name}: ${tris} triangles (Roblox limit 20,000)`);
    if (p.attributes.COLOR_0 == null) errs.push(`mesh ${m.name}: no vertex colours`);
    if (p.attributes.JOINTS_0 != null) {
      const J = read(p.attributes.JOINTS_0), W = read(p.attributes.WEIGHTS_0); let onRoot = 0;
      for (let i = 0; i < J.length; i++) if (J[i] === 0 && W[i] > 1e-6) onRoot++;
      const root = g.nodes[g.skins[skinOf.get(mi)].joints[0]].name;
      if (onRoot) errs.push(`mesh ${m.name}: ${onRoot} weights on the root joint ${root} (Roblox: no influences on the root)`);
    }
  }));
  return errs;
}

// ---- OBJ -----------------------------------------------------------------------------------------
function toObj(model) {
  const rest = MD.posedMeshes(model, null, 0); let v = 1; const o = [`# ${model.title} - rest pose, metres, +Y up, front +Z (roblox-modeling skill)`, `mtllib ${model.name}.mtl`], mtl = [];
  rest.forEach((m, i) => {
    const mn = `${m.node.name}_mat`; mtl.push(`newmtl ${mn}`, `Kd ${m.node.color.map(c => c.toFixed(4)).join(' ')}`, 'Ka 0 0 0', 'Ks 0.05 0.05 0.05', 'Ns 10', 'illum 2', '');
    o.push(`o ${m.node.name}`, `usemtl ${mn}`, 's off');
    m.pos.forEach(p => o.push(`v ${p.map(x => M.num(x, 5)).join(' ')}`));
    m.tris.forEach(t => o.push(`f ${t.map(k => k + v).join(' ')}`)); v += m.pos.length;
  });
  return { obj: o.join('\n') + '\n', mtl: mtl.join('\n') };
}

// ---- Blender ---------------------------------------------------------------------------------------
function blenderScript(model) {
  const clips = model.clips.map(c => c.name);
  return `# ${model.title} - Blender import script (roblox-modeling skill)
# Run inside Blender:  Scripting tab > Open > this file > Run Script
# or headless:          blender --background --python ${model.name}.blender.py -- [out.blend]
# Imports ${model.name}.glb from the same folder, keeps the low-poly flat shading, puts every animation
# (${clips.join(', ') || 'none'}) on its own NLA strip so you can switch between them, and optionally saves a .blend.
import bpy, os, sys

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.getcwd()
GLB = os.path.join(HERE, "${model.name}.glb")
CLIPS = ${JSON.stringify(clips)}

def main():
    if not os.path.exists(GLB):
        raise SystemExit("missing " + GLB)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=GLB)
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        if o.type == "MESH":
            for p in o.data.polygons:
                p.use_smooth = False          # faceted low-poly look
    scene = bpy.context.scene
    scene.render.fps = ${model.fps}
    # one NLA track per clip, muted except the first (best effort: the importer's action layout differs between Blender versions)
    try:
        for o in new:
            ad = o.animation_data
            if not ad:
                continue
            for act in list(bpy.data.actions):
                clip = next((c for c in CLIPS if act.name == c or act.name.startswith(c + "_") or act.name.startswith(c + "|")), None)
                if clip is None or ad.nla_tracks.get(clip):
                    continue
                tr = ad.nla_tracks.new()
                tr.name = clip
                tr.strips.new(clip, int(act.frame_range[0]), act)
                tr.mute = clip != CLIPS[0]
    except Exception as e:
        print("[rmodel] NLA setup skipped: %s" % e)
    end = max([int(a.frame_range[1]) for a in bpy.data.actions] or [scene.frame_end])
    scene.frame_start, scene.frame_end = 0, end
    print("[rmodel] imported %d objects, %d actions: %s" % (len(new), len(bpy.data.actions), ", ".join(a.name for a in bpy.data.actions)))
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if argv:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(argv[0]))
        print("[rmodel] saved " + argv[0])

main()
`;
}

// ---- three.js ---------------------------------------------------------------------------------------
function threeModule(model) {
  const clips = model.clips.map(c => ({ name: c.name, loop: c.loop, duration: c.duration }));
  return `// ${model.title} - three.js loader (roblox-modeling skill)
// Usage:
//   import { load${model.name} } from './${model.name}.three.js';
//   const fish = await load${model.name}(scene);           // adds it to the scene
//   fish.play('${clips[0] ? clips[0].name : 'Clip'}');                         // cross-fades between clips
//   renderer.setAnimationLoop(() => { fish.update(clock.getDelta()); renderer.render(scene, camera); });
// Units are metres, +Y up, the model faces +Z. Needs three r150+ (GLTFLoader from three/addons).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const CLIPS = ${JSON.stringify(clips)};

export async function load${model.name}(parent, url = new URL('./${model.name}.glb', import.meta.url).href) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene;
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.material.flatShading = true; o.frustumCulled = !o.isSkinnedMesh; } });
  if (parent) parent.add(root);
  const mixer = new THREE.AnimationMixer(root);
  const actions = Object.fromEntries(gltf.animations.map(c => [c.name, mixer.clipAction(c)]));
  for (const c of CLIPS) {
    const a = actions[c.name]; if (!a) continue;
    if (!c.loop) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
  }
  let current = null;
  return {
    root, mixer, actions,
    play(name, fade = 0.2) {
      const next = actions[name]; if (!next) throw new Error('no clip ' + name);
      next.reset().play();
      if (current && current !== next) current.crossFadeTo(next, fade, false);
      current = next; return next;
    },
    update(dt) { mixer.update(dt); },
  };
}
`;
}

module.exports = { toGltf, toGlb, validateGlb, robloxGlbs, validateRoblox, toObj, blenderScript, threeModule };
