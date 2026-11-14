# Using the exports

`build` writes, per model:

| File | What it is |
|---|---|
| `<Name>.glb` | Binary glTF 2.0: node hierarchy with pivots, flat-shaded meshes, PBR materials (base colour, roughness, metalness, emissive), skins, and one animation per clip (baked at 30 fps, linear). Units metres, +Y up, front +Z. Passes the Khronos glTF validator with no errors or warnings. |
| `<Name>.obj` + `.mtl` | Static rest pose, one object per part, for tools that do not read glTF. |
| `<Name>.blender.py` | Imports the .glb into Blender, keeps flat shading, sets the frame rate and frame range, puts each clip on an NLA track, and optionally saves a .blend. |
| `<Name>.three.js` | ES module: `load<Name>(scene)` returns `{ root, mixer, actions, play(name, fade), update(dt) }`, with LoopOnce / clamp set for one-shot clips. |
| `preview.html` | three.js viewer that loads the same .glb with `GLTFLoader` (proof that it works in three.js), with clip buttons, scrubber, speed, 3D / front / side / top views, wireframe, dimensions, test results, reference image overlay and a download button. |
| `sheet-*.png`, `anim-*.png`, `compare-*.png`, `report-*.json` | Review renders, silhouette overlays and the full test report. |

## Blender (3.6 / 4.x)

- **Quick:** File → Import → glTF 2.0 (.glb/.gltf) → pick `<Name>.glb`. Blender converts Y-up to Z-up automatically. Each clip becomes an Action. Switch between them in the Action Editor (Dope Sheet → Action Editor) or the NLA editor.
- **Script:** Scripting tab → Open `<Name>.blender.py` (next to the .glb) → Run Script. Or headless: `blender --background --python <Name>.blender.py -- <Name>.blend` to produce a .blend file.
- Smooth shading would round off the facets; the script sets every face flat. If you import by hand and it looks smooth, select the mesh → right-click → Shade Flat.
- Skinned models import as an armature with the bones named like the spec (`Head`, `Spine1`...), so you can keep animating them in Blender.
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

Scale: one unit is one metre. A 0.3 m fish next to a 1.8 m character is right; scale the scene, not the model, if your world uses other units.

## Roblox Studio

- **3D Importer** (Home / Avatar → Import 3D, or File → Import 3D) accepts .glb / .gltf / .fbx / .obj. Import `<Name>.glb`: it creates a Model with one MeshPart per part, coloured from the materials. Roblox units are studs: set the importer's scale so the size matches your game (a 1.8 m human ≈ 5-6 studs, so roughly ×3.3 for real-world sizes; enter the scale in the importer's file settings).
- Parts face -Z in Roblox; if the model faces backwards after import, rotate it 180° about Y.
- Rigid-part animations: Roblox does not turn glTF node animations of a non-rigged model into Animations. Either drive the parts from a script (for a lid: a `HingeConstraint` with a servo, or `TweenService` on a pivot `CFrame`, using the pivot and angles from the spec), or rig it in Blender (armature with one bone per moving part) and import the FBX as a rig, then use the Animation Editor. Skinned models (an armature) import as a rig with bones; check the Roblox importer's current documentation for skinned-mesh and animation support, since it changes.
- Keep triangle counts low for mobile: the counts the build reports are the final counts.

## Godot 4 and Unity

- **Godot**: drop the .glb into the project; it imports as a scene with an `AnimationPlayer` holding each clip. Set loop mode on looping clips in the import dock (Animation → Loop Mode), using the `loop` flag in `report-<Name>.json`.
- **Unity**: install the glTFast package (com.unity.cloud.gltfast) or import the .obj for static props; with glTFast, clips appear as AnimationClips on the imported prefab. Mark looping clips as Loop Time.

## Re-exporting after edits

Edit the JSON spec and rebuild; do not hand-edit the .glb. The spec is the source of truth and the tests run again on every build.
