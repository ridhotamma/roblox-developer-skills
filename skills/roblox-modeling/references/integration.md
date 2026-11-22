# Using the exports

`build` writes, per model:

| File | What it is |
|---|---|
| `<Name>.glb` | Binary glTF 2.0: node hierarchy with pivots, indexed meshes with normals (flat, or smoothed per part), PBR materials (base colour, roughness, metalness, emissive), skins, and one animation per clip (baked at 30 fps, linear). Units metres, +Y up, front +Z. Passes the Khronos glTF validator with no errors or warnings. |
| `<Name>.roblox.glb` | The Roblox import file (when `targets` includes `roblox`, the default): the same model with each part's colour in vertex colours on a white base, so parts merged with the importer's **Merge Meshes** keep their colours (Roblox allows one material per mesh), and no animation. |
| `<Name>.roblox.lua` | Studio command-bar script: select the imported model, run it, and every MeshPart gets its CollisionFidelity (and CanCollide off on decoration). |
| `<Name>.<Clip>.roblox.glb` | Skinned models only: the same rig with one clip each, because Roblox imports one animation track per file. Rigid-part models get no clip files: Roblox does not import node animations of unrigged parts. |
| `<Name>.lod.glb` | The level-of-detail version (models of 300+ triangles): same nodes, bones and clips, about half the triangles, small detail parts dropped. For three.js `THREE.LOD`, Godot and Unity `LODGroup`. |
| `<Name>.lod.roblox.glb` | Skinned models only: the LOD version as a Roblox rig, same bone names, so the clip files animate it. |
| `<Name>.obj` + `.mtl` | Static rest pose, one object per part, for tools that do not read glTF. |
| `<Name>.blender.py` | Imports the .glb into Blender, keeps its shading (the file's normals), sets the frame rate and frame range, puts each clip on an NLA track, and optionally saves a .blend. |
| `<Name>.three.js` | ES module: `load<Name>(scene)` returns `{ root, mixer, actions, play(name, fade), update(dt) }`, with LoopOnce / clamp set for one-shot clips. |
| `preview.html` | self-contained three.js viewer that loads the same .glb with `GLTFLoader` (proof that it works in three.js), with clip buttons, scrubber, speed, 3D / front / side / top views, wireframe, dimensions, test results, reference image overlay and a download button. three.js is bundled inline, so the page works offline with no CDN or install. |
| `sheet-*.png`, `anim-*.png`, `compare-*.png`, `report-*.json` | Review renders, silhouette overlays and the full test report. |

## Blender (3.6 / 4.x)

- **Quick:** File → Import → glTF 2.0 (.glb/.gltf) → pick `<Name>.glb`. Blender converts Y-up to Z-up automatically. Each clip becomes an Action. Switch between them in the Action Editor (Dope Sheet → Action Editor) or the NLA editor.
- **Script:** Scripting tab → Open `<Name>.blender.py` (next to the .glb) → Run Script. Or headless: `blender --background --python <Name>.blender.py -- <Name>.blend` to produce a .blend file.
- Shading comes from the file's normals: faceted parts have hard edges, `smooth` parts soft ones. Blender's importer keeps them as custom normals, so do not run Shade Flat / Shade Smooth on import (it would overwrite them); to change a part's shading, change `shading` in the spec and rebuild.
- Skinned models import as an armature with the bones named like the spec (`Head`, `Spine1`...), so you can keep animating them in Blender. Parts using `skin` or `bind` import as their own skinned meshes; keep them bound to the armature that carries the body's bones (if the importer created one armature per skin, re-bind or join them to a single one) so the fins and the body cannot drift apart.
- Export back from Blender to glTF for engines, or to FBX for Roblox if you edit there.

## three.js

```js
import * as THREE from 'three';
import { loadFish } from './Fish.three.js';          // generated next to Fish.glb

const fish = await loadFish(scene);                   // adds it to the scene
fish.play('Swim');                                    // later: fish.play('Die')
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => { fish.update(clock.getDelta()); renderer.render(scene, camera); });
```

Or directly: `new GLTFLoader().load('Fish.glb', gltf => { scene.add(gltf.scene); const mixer = new THREE.AnimationMixer(gltf.scene); mixer.clipAction(gltf.animations[0]).play(); })`. Set `material.flatShading = true` if you replace materials. Skinned meshes need `frustumCulled = false` if they animate far from their bind pose (the loader module sets it).

**React Three Fiber** (`@react-three/drei`):

```jsx
function Fish(props) {
  const { scene, animations } = useGLTF('/Fish.glb');
  const { actions } = useAnimations(animations, scene);
  useEffect(() => { actions.Swim?.reset().fadeIn(0.2).play(); }, [actions]);
  return <primitive object={scene} {...props} />;
}
```

Scale: one unit is one metre in every file except the `.roblox.glb` files, which are in studs (see Roblox Studio below). A 0.3 m fish next to a 1.8 m character is right; scale the scene, not the model, if your world uses other units.

## Roblox Studio

- **3D Importer** (Home / Avatar → Import 3D, or File → Import 3D) accepts .glb / .gltf / .fbx / .obj. Import `<Name>.roblox.glb` (not the main `.glb`, which carries every clip in one file): it creates a Model with one MeshPart per moving part plus one per group of merged static parts (named `<Frame>Static1`, `<Frame>Static2`…), coloured from vertex colours. Leave the importer's own **Merge Meshes** off: it would merge the moving parts too. **Scale:** the Roblox files are already in studs (`roblox.studsPerMetre`, default 3.57: Roblox's own 1 stud = 0.28 m; the build prints the size in studs), so keep the importer's **Scale Unit** on **Stud**, its default. Choosing Meter would scale them a second time. If the model arrives at another size anyway, `<Name>.roblox.lua` scales it back with `Model:ScaleTo`. Places players walk into need 4 to 5 studs per metre and widened doorways (`playspace.md`).
- **Animations:** import each `<Name>.<Clip>.roblox.glb` separately and keep its animation (one track per file is Roblox's rule), or animate the imported rig in the Animation Editor.
- **Rules the export already follows** (from Roblox's mesh specifications): every mesh watertight with volume (the `geometry` test fails open parts while Roblox is a target), at most 20,000 triangles per mesh (`budget` test), at most 4 bone influences per vertex (this engine uses 2), no weight on the root joint (each skin's root joint is the node above its bones, usually the model root, with zero weight), bones with rotation 0 and scale 1 at the bind pose.
- Parts face -Z in Roblox; if the model faces backwards after import, rotate it 180° about Y.
- Rigid-part animations: Roblox does not turn glTF node animations of a non-rigged model into Animations. Either drive the parts from a script (for a lid: a `HingeConstraint` with a servo, or `TweenService` on a pivot `CFrame`, using the pivot and angles from the spec), or rig it in Blender (armature with one bone per moving part) and import the FBX as a rig, then use the Animation Editor. Skinned models (an armature) import as a rig with bones; check the Roblox importer's current documentation for skinned-mesh and animation support, since it changes. The bind pose is the rest pose in the spec, and weights use at most 2 bones per vertex (Roblox allows 4). See `topology-and-rigging.md` § 9 for bone naming, animating with an `AnimationController`, and driving bones from scripts (hair or tail physics).
- Parts that use `skin` or `bind` are extra skinned meshes that share the body's joints. Import them together into the same rig: if each one ends up with its own copy of the bones, the body animates and the fins do not.
- **Collision:** with the imported model selected, paste `<Name>.roblox.lua` into the command bar (View → Command Bar) and press Enter. It checks the size first (and scales the model back if needed), then sets each MeshPart's CollisionFidelity (Box / Hull / Default / PreciseConvexDecomposition) and turns CanCollide and CanTouch off on decoration. Per-part overrides go in the spec (`collision`).
- **Level of detail:** for a model without skins, `<Name>.roblox.glb` also carries `Simple`, the whole LOD version as one mesh. Running `<Name>.roblox.lua` moves everything else into a `Detail` model, tags the model `PerfLod` and sets `LodDistance` / `CullDistance` from the spec's `lod`. The roblox-performance skill's `LodController` (install its kit) then shows `Detail` near and only `Simple` far: about half the triangles and one draw call at distance, decided on each client. Code that drives parts (a lid hinge) should find them under `Detail`. A skinned model's LOD is `<Name>.lod.roblox.glb`: swap to it at distance yourself (crowds, schools of fish), or rely on `RenderFidelity`.
- **Performance:** each MeshPart is a draw call, so the `performance` line of the report says how many the model costs. Place copies by cloning the imported model (clones share the MeshId), not by importing again. `RenderFidelity` stays Automatic: Roblox lowers detail by itself at 250 and 500 studs.
- Keep triangle counts low for mobile: the counts the build reports are the final counts.

## LOD in three.js, Godot and Unity

- **three.js:** load both files and add them to a `THREE.LOD`: `lod.addLevel(full.scene, 0); lod.addLevel(low.scene, 20)` (distance in metres). For animated models, play the same clip on both mixers (the node and bone names match).
- **Godot 4:** import both; switch with `visibility_range_begin` / `visibility_range_end` on the two instances (Godot also generates its own mesh LODs on import).
- **Unity:** put both under one object with an `LODGroup` (LOD0 = `<Name>.glb`, LOD1 = `<Name>.lod.glb`).

## Godot 4 and Unity

- **Godot**: drop the .glb into the project; it imports as a scene with an `AnimationPlayer` holding each clip. Set loop mode on looping clips in the import dock (Animation → Loop Mode), using the `loop` flag in `report-<Name>.json`.
- **Unity**: install the glTFast package (com.unity.cloud.gltfast) or import the .obj for static props; with glTFast, clips appear as AnimationClips on the imported prefab. Mark looping clips as Loop Time.

## Re-exporting after edits

Edit the JSON spec and rebuild; do not hand-edit the .glb. The spec is the source of truth and the tests run again on every build.
