'use strict';
// Roblox-specific planning shared by the exporter, the checks and the Studio setup script:
// - collision classes per part (CollisionFidelity + CanCollide), chosen from the part's size and shape;
// - merge groups: parts that never move relative to each other, merged into one MeshPart per material and collision
//   class, so the model costs a few draw calls instead of one per part (every unique mesh asset is a draw call).
const G = require('./geometry.cjs');
const M = require('./math.cjs');
const LOD = require('./lod.cjs');

// Roblox CollisionFidelity for each class ("none" is decoration: Box, with CanCollide and CanTouch off).
const FIDELITY = { none: 'Box', box: 'Box', hull: 'Hull', default: 'Default', precise: 'PreciseConvexDecomposition' };
const DECOR_SIZE = 0.15;   // m: parts smaller than this in every direction are decoration (coins, eyes, rivets, gems)

// The collision class of a part: its "collision" field, or for "auto":
//   skinned / bound parts -> box (Roblox collides with the bind pose, it does not deform the collision shape)
//   smaller than DECOR_SIZE -> none
//   fills >= 90% of its bounding box -> box, fills >= 90% of its convex hull -> hull, otherwise default.
function collisionClass(n) {
  if (n.collision && n.collision !== 'auto') return n.collision;
  if (!n.mesh) return 'none';
  if (n.skin) return 'box';
  const b = G.bounds(n.mesh.pos), s = b.size;
  if (Math.max(...s) < DECOR_SIZE) return 'none';
  const vol = Math.abs(G.signedVolume(n.mesh)), boxVol = s[0] * s[1] * s[2];
  if (boxVol > 0 && vol / boxVol >= 0.9) return 'box';
  let hullVol = 0; try { hullVol = Math.abs(G.signedVolume(G.hull(n.mesh.pos))); } catch (e) { hullVol = 0; }
  if (hullVol > 0 && vol / hullVol >= 0.9) return 'hull';
  return 'default';
}

// Material class for merging: colours travel as vertex colours, and Roblox keeps one material per mesh, so parts
// only need to stay apart when one is metal or glows and the other does not.
const matClass = n => `${(n.material.metalness || 0) >= 0.5 ? 'metal' : 'matte'}${n.material.emissive ? '+glow' : ''}`;

// Parts that can be merged: a visible rigid mesh that no clip animates, that no skin uses as a bone or root joint,
// and that is not the model root. Each merges into its "frame": the nearest ancestor that is not mergeable (the root,
// a bone, or an animated part), so the merged mesh moves exactly like its parts did. Parts merge per frame, material
// class and collidable / decoration; a frame that is itself a rigid mesh part (a lid) takes its children's group
// into its own mesh. A merged group of collidable parts collides as "default" (Box and Hull would fill the gaps
// between its pieces) unless a member asks for "precise".
function mergeGroups(model) {
  const animated = new Set(); for (const c of model.clips) for (const n of c.animated || []) animated.add(n);
  const joints = new Set(); for (const n of model.nodes) if (n.skin && n.skinBones) { n.skinBones.forEach(b => joints.add(b)); for (let p = n.skinBones[0].parent; p; p = p.parent) joints.add(p); }
  const rigid = n => n.mesh && !n.skin && !n.skinBones && !n.hidden && !joints.has(n);
  const can = n => rigid(n) && n.parent && !animated.has(n);
  const frameOf = n => { let p = n.parent; while (p && can(p)) p = p.parent; return p; };
  const keyOf = (f, n) => [f.index, matClass(n), collisionClass(n) === 'none' ? 'decor' : 'solid'].join('|');
  const groups = new Map();
  for (const n of model.nodes) {
    if (!can(n)) continue;
    const f = frameOf(n), k = keyOf(f, n);
    if (!groups.has(k)) groups.set(k, { frame: f, onFrame: false, members: [] });
    groups.get(k).members.push(n);
  }
  for (const g of groups.values()) {           // an animated rigid part absorbs the static children that match it
    const f = g.frame;
    if (rigid(f) && !g.onFrame && keyOf(f, f) === keyOf(f, g.members[0]) && ![...groups.values()].some(o => o.frame === f && o.onFrame)) { g.members.unshift(f); g.onFrame = true; }
  }
  const out = [...groups.values()].filter(g => g.members.length > 1), perFrame = new Map();
  for (const g of out) {
    const cls = g.members.map(collisionClass);
    g.collision = cls.every(c => c === 'none') ? 'none' : cls.includes('precise') ? 'precise' : 'default';
    g.material = g.members[0].material;
    if (g.onFrame) g.name = g.frame.name;
    else { const k = (perFrame.get(g.frame) || 0) + 1; perFrame.set(g.frame, k); g.name = `${g.frame.name}Static${k}`; }
  }
  return out;
}

// What Roblox ends up with after import: one MeshPart per mesh, i.e. per unmerged part plus per merge group.
function meshPlan(model) {
  const groups = mergeGroups(model), merged = new Set(groups.flatMap(g => g.members));
  const parts = model.nodes.filter(n => n.mesh && !merged.has(n)).map(n => ({ name: n.skin ? n.name + 'Mesh' : n.name, collision: collisionClass(n), members: [n] }));
  return parts.concat(groups.map(g => ({ name: g.name, collision: g.collision, members: g.members })));
}

// Vertices the GPU actually stores for a part: corners that share a position and a normal share a vertex; a hard
// edge (flat shading, or a bend over the smoothing angle) splits it.
function renderVertices(n) {
  const nn = G.cornerNormals(n.mesh, n.smoothAngle || 0), seen = new Set();
  n.mesh.tris.forEach((t, ti) => t.forEach((k, c) => seen.add([...n.mesh.pos[k], ...nn[ti][c]].map(v => Math.round(v * 1e5)).join(','))));
  return seen.size;
}

// Studio command-bar script: select the imported model, run it, and every MeshPart gets its collision settings.
// With a Simple stand-in (lod.cjs, models without skins) it also sets up level of detail for the roblox-performance
// LodController: everything else moves into a "Detail" model, the holder is tagged PerfLod, and the stand-in
// neither collides nor takes raycasts. A skinned model's LOD is its separate <Name>.lod.roblox.glb rig.
function setupScript(model) {
  const plan = meshPlan(model), rows = plan.map(p => `  [${JSON.stringify(p.name)}] = { ${JSON.stringify(FIDELITY[p.collision])}, ${p.collision !== 'none'} }, -- ${p.collision}${p.members.length > 1 ? ': ' + p.members.map(m => m.name).join(', ') : ''}`);
  const ls = LOD.settings(model), skinned = model.nodes.some(n => n.mesh && n.skin), simple = ls.on && !skinned && !LOD.build(model).model.errors.length;
  const attrs = [ls.distance != null ? `  holder:SetAttribute("LodDistance", ${ls.distance})` : null, ls.cull != null ? `  holder:SetAttribute("CullDistance", ${ls.cull})` : null].filter(Boolean);
  const lodBlock = !simple ? (ls.on && skinned ? `-- Level of detail: this model is skinned, so its cheaper version is a separate rig, ${model.name}.lod.roblox.glb
-- (same bone names: the clip files animate it). Swap to it at distance, e.g. for crowds and schools.
` : '') : `
-- Level of detail (the roblox-performance skill's LodController): near, the full model in "Detail" shows; far, it is
-- removed and the one-mesh stand-in "Simple" shows instead (${'about half the triangles, 1 draw call'}).
local simple = root:FindFirstChild("Simple", true)
if simple and simple:IsA("MeshPart") then
  local holder = simple.Parent :: Instance
  local detail = holder:FindFirstChild("Detail") or Instance.new("Model")
  detail.Name = "Detail"
  for _, c in ipairs(holder:GetChildren()) do
    if c ~= simple and c ~= detail then c.Parent = detail end
  end
  detail.Parent = holder
  simple.CanCollide = false
  simple.CanTouch = false
  simple.CanQuery = false
  simple.CastShadow = false
  game:GetService("CollectionService"):AddTag(holder, "PerfLod")
${attrs.join('\n')}${attrs.length ? '\n' : ''}  print("[rmodel] LOD set up on " .. holder:GetFullName() .. ": Detail near, Simple far (tag PerfLod)")
else
  warn("[rmodel] no Simple stand-in found: import ${model.name}.roblox.glb (not ${model.name}.glb)")
end
`;
  return `-- ${model.title} - Roblox setup (roblox-modeling skill)
-- Import ${model.name}.roblox.glb with the 3D Importer, select the imported model in the Explorer, then paste this
-- into the command bar (View > Command Bar) and press Enter. It sets CollisionFidelity on every MeshPart and turns
-- collision off on decoration${simple ? ', then sets up level of detail' : ''}. ${plan.length} MeshParts (static parts are merged per material and collision class).
${lodBlock && !simple ? lodBlock : ''}
local SETTINGS = { -- name = { CollisionFidelity, CanCollide }
${rows.join('\n')}
}
local root = game:GetService("Selection"):Get()[1]
assert(root, "select the imported ${model.name} model in the Explorer first")
local done = 0
for _, d in ipairs(root:GetDescendants()) do
  local s = d:IsA("MeshPart") and SETTINGS[d.Name]
  if s then
    d.CollisionFidelity = Enum.CollisionFidelity[s[1]]
    d.CanCollide = s[2]
    if not s[2] then d.CanTouch = false end
    done += 1
  end
end
print(("[rmodel] collision set on %d of ${plan.length} MeshParts"):format(done))
${simple ? lodBlock : ''}`;
}

module.exports = { FIDELITY, DECOR_SIZE, collisionClass, mergeGroups, meshPlan, renderVertices, setupScript };
