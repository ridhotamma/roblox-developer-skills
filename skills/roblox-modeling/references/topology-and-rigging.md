# Topology and rig-ready shapes

A model that looks right standing still can still animate badly: elbows collapse into a flat ribbon, tails fold inside out, fins tear off, a neck shrinks to a stick when it turns. Almost always the cause is the shape and the vertex layout, not the animation. This file covers how to build shapes that bend well. Read it before modelling anything that bends: creatures, characters, tails, tentacles, hair, ropes, capes and soft props.

## 1. How this engine deforms a mesh (the facts the rules come from)

- **Rigid parts** move as a whole with their node. Nothing inside them bends, so they never stretch, but you can see the joints between them.
- **Skinned parts** (`"skin"` on a loft or any mesh) move each vertex with a weighted mix of bones. Weights depend only on the vertex's position along the skin `axis`, and each vertex has at most 2 bones (glTF and Roblox allow up to 4).
- **A surface only bends where it has vertices.** Between two rings of vertices the surface is a set of flat triangles. If a joint has no ring near it, the two rings on either side swing apart and the triangles between them shear, flatten or fold. For a `loft`, the rings are its **stations**. For `lathe` along the skin axis they are the profile points. For `extrude` they are the outline points, which have to lie along the bending direction.
- **Linear blend skinning loses volume.** Each blended vertex moves along a straight line between where each bone would carry it, so the inside of a bend shrinks. A twist around the bone axis pinches to a waist (the "candy wrapper"). The fix is more rings, wider blend zones, a bulge at the joint, and spreading big rotations over more bones.
- `rig` (static) and `deform:<Clip>` (per animation) in the test report measure all of this: see section 8.

## 2. Rigid segments or one skinned mesh?

| Use | When | Examples |
|---|---|---|
| **Rigid parts + pivots** | Hard surfaces, mechanical joints, stylised blocky characters, anything where a visible seam is fine or wanted | chest lid, robot, wheel, door, sword, R15-style blocky limbs, crab legs, insect segments |
| **Skinned, `"weights": "smooth"`** | The whole length bends, gradually, with no clear joints | fish, snake, worm, tail, tentacle, hair lock, rope, flag strip, caterpillar, spine |
| **Skinned, `"weights": "joints"`** | Rigid segments with a soft bend at each joint | arm, leg, finger, neck, waist, trunk of an elephant (several joints), a soft-bodied mascot's limbs |
| **Mixed** | Skinned body with rigid attachments | fish body + fins, bird body + wings, creature + horns, eyes, teeth |

Default to rigid parts for props and stylised Roblox-style characters: they are cheaper, never deform badly, and import to Roblox as plain parts. Use skinning only when the model has to read as soft or continuous.

## 3. Rules for a body that bends (lofts)

1. **Same vertex count on every station.** The engine uses `sides` for every ring. Custom `shape` outlines must all have the same number of points, or the rings cannot be joined.
2. **Edge loops at every joint, by bend angle.** The `rig` check uses the same table:

   | Largest bend at the joint | Loops within the blend zone | Spec |
   |---|---|---|
   | ≤ 20° (swim wave, breathing, sway) | 1 | `"loops": 1` or one station near the joint |
   | 20-50° (neck turn, tail flick, wrist) | 2 | `"loops": 2` |
   | 50-110° (elbow, knee, finger, curl) | 3: one on the joint, one at each edge of the blend zone | `"loops": 3` |
   | > 110° (full curl, tentacle wrap) | 4-5 and a wider blend, or split the bend over two bones | `"loops": 5, "blend": …` or another bone |

   `"skin": { …, "loops": 3 }` inserts these stations for you, with width, height and offsets interpolated from the stations around them. It skips any position that already has a station. The report says how many rings it added.
3. **Spend the triangles at the joints, not on straight runs.** A forearm needs 2 rings, an elbow needs 3. Remove stations from long straight segments before raising `sides`.
4. **Even spacing, no slivers.** No two stations closer than about 10% of the local width (except deliberate loops in a joint zone), and no ring spacing bigger than about 3× the local width across a bending zone. The `rig` check reports both.
5. **Round cross-sections where it bends.** `ellipse` with 6-8 sides deforms evenly. `rect` and `diamond` sections crush flat on the inside of a bend and flare on the outside. Keep them for parts that do not bend.
6. **Bulge the joint station 5-10%** (wider and taller than its neighbours) on joints that bend more than 60°. Linear blend skinning loses about that much volume, and the bulge cancels it out. Real elbows and knees are thicker anyway.
7. **Keep pointed ends away from joints.** An apex station (`w: 0, h: 0`) makes a fan of thin triangles. Leave at least one full ring between a joint zone and an apex, or the tip will pinch and fold. The `rig` check reports an apex inside a bend zone or right next to one.
8. **Bones run through the centre.** Put each bone's pivot at the centre of the cross-section at that point (the station's `dy` / `dx`), not on the top or belly surface. An off-centre bone stretches one side and crushes the other. The `rig` check reports any bone outside the body or more than 40% off-centre.
9. **Model the rest pose in the middle of the motion.**
   - A tail that bends both ways: model it straight.
   - An elbow or knee that bends 0-140°: model it bent 15-25°, so the worst deformation is only about 120° away from the modelled shape.
   - A character's arms: model them in an A-pose (30-45° down from horizontal). It deforms better than a T-pose when the arms drop.
10. **Mirror symmetric bodies** (`mirror: "x"`) so the left and right deform the same.

## 4. Weights: `smooth` vs `joints`, and the blend width

- `"weights": "smooth"` (the default) uses piecewise-linear weights between neighbouring bone pivots. The bend spreads over whole segments, which is right for continuous curves. It is wrong for limbs, because the forearm sags halfway to the upper arm.
- `"weights": "joints"` makes each segment follow its own bone rigidly (the bone at the segment's parent end). Across the joint zone the weights cross over with a smoothstep. Rigid between joints, soft at them.
- `"blend"` is the full width of the joint zone in metres. The default is 50% of the shorter neighbouring segment for `joints`. Zones never overlap.

| Joint | Mode | Blend (of the shorter segment) |
|---|---|---|
| Spine, tail, tentacle, hair, rope | smooth | (whole segments) |
| Elbow, knee, finger | joints | 30-50% |
| Neck, waist, shoulder | joints | 50-80% (soft, wide) |
| Mechanical joint with a rubber boot (sleeve on a robot arm) | joints | 10-20% (tight crease) |

Bone count for chains: 3-6 bones for tails, hair locks and tentacles. More bones only help when there are rings for them to bend (at least as many rings as bones + 1). Twist: no single bone should twist more than about 45°. Spread a forearm or neck twist over two bones.

## 5. Rigid segmented joints (robots, blocky characters, mechanical props)

Rigid parts do not deform, so the problems become gaps, poke-through and visible edges. The `anim` attachment and pass-through tests catch them.

- **Pivot at the centre of the joint volume,** not on a surface. An elbow pivots at the middle of the elbow, a knee at the middle of the knee.
- **Ball joint:** put a sphere (`detail 0-1`) of radius ≈ half the limb thickness centred on the pivot, parented to either segment. Both segment ends overlap it by 2-5 mm. The sphere hides the gap at any angle.
- **Hinge:** use a `cylinder` along the hinge axis, centred on the pivot, a little thicker than the parts it joins. Round or chamfer the inner corners of both segments so they do not poke through at full bend.
- **Sleeve / overlap:** the child's end slides 5-15% of its length inside the parent's end (the parent's opening is slightly bigger). This works for telescopic or armoured joints, and gives a crease without gaps.
- **Clearance:** leave 2-5 mm between parts that slide past each other (lid and rim, blade and guard). Add an `apart` check for each such pair.
- **Range of motion:** find the angle where the parts first collide. Use the `render --clip … --highlight` view and the `passes through` test, and keep animations inside that range.

## 6. Attachments on skinned bodies (fins, eyes, ears, horns, hair accessories)

- Parent each attachment to the bone nearest its root, never to the skinned part.
- Embed the root 2-3 mm into the surface, and put its `pivot` on that root edge.
- Keep the root outside joint zones, or keep those joints' bends moderate. A rigid part across a bending zone separates from the surface, and the attachment test reports by how much and when.
- A long attachment that must bend (a long fin, an antenna, a hair lock) should be its own skinned part on its own bone chain, hung from the body bone.

## 7. Hair, capes, tails, ropes (chains that may get runtime physics)

- **Hair lock / ponytail / tail:** a `loft` along its length with a flattened `ellipse` or `roundrect` section, 3-5 bones, `"weights": "smooth"`, `"loops": 1-2`, tapering to a point only after the last bone. Bangs are several short locks (2-3 bones each) hung from a head bone.
- **Cape / flag / skirt panel:** a skinned strip needs rings across its length. Use a loft with a thin `rect` section, or a `mesh` with rows of vertices, and one bone per row of rings. A single-sided `mesh` sheet needs `"openSurface": true`, or the watertight test fails it. Thin skinned sheets get the edge-loop count (`rig`: "rows of vertices") and the fold / pinch / stretch tests (`deform`), not the bone-centre and volume tests.
- **Extra rows on a fin go on a free edge.** Points added along a fin's buried root edge a few mm apart shear its thin rim faces in a narrow blend zone and fold them; one point on the trailing edge inside the zone gives the row without that.
- **Runtime physics** (Roblox spring / Verlet bone scripts such as SmartBone, Godot's `SpringBoneSimulator3D`) drives these same bones. The topology rules are the same, and physics swings further than keyframes, so give the chain 1 extra loop per joint. Name the chain bones consistently (`Hair1`, `Hair2`, …) so a script can find them.

## 8. What the tests report

| Result | Meaning | Usual fix |
|---|---|---|
| `rig` WARN `bends up to N° but … has K edge loops` | Not enough rings in that joint's blend zone for its largest bend in any clip | `"loops"` from the table in 3, or add stations by hand |
| `rig` WARN `bone … sits … outside` / `off-centre` | The bone pivot is not on the body's centre line | Move the pivot to the station's centre (`dy`, `dx`) |
| `deform:<Clip>` FAIL `folds through itself` | Triangles turn inside out: the mesh visibly breaks | More loops, `joints` weights, a wider blend, or less angle |
| `deform:<Clip>` WARN `pinches` | A face shrinks below 30% of its area: a crease or collapse | Loops, a wider blend, a half-bent rest pose, a joint bulge |
| `deform:<Clip>` WARN `stretches` | A face grows more than ×2.5: facets go long and thin | Add rings there, put the bone on the joint |
| `rig` WARN `stations … only N mm apart … outside any joint` | Two rings almost on top of each other: a band of slivers that creases | Merge the stations or spread them out |
| `rig` WARN `stations … N× the local width apart across a bending zone` | Long facets across a bend shear and flatten | Add a station in the gap, or `"loops"` |
| `rig` WARN `the pointed end … is inside … bend zone` / `has no full ring between it and …` | A fan of thin triangles at the tip bends | End the loft on a small ring, add a station before the tip, or move the joint |
| `rig` WARN `the sheet has K rows of vertices` | A thin skinned sheet (fin, cape) has no vertices where it bends, so it creases at one line | Add outline points / rows inside the joint zone, on a free edge |
| `deform:<Clip>` WARN `loses N% of its volume` | More than 12% volume change: the joint collapses or twists like a candy wrapper | Spread the bend or twist over more bones, bulge the joint |

The `deform` pass line prints the range of face-area change and the volume change (thin sheets: area only), which shows how close a joint is to the limits.

The `geometry` test covers the static mesh of every part, rigid or skinned: open or non-manifold edges (FAIL; `"openSurface": true` for a deliberate sheet), inside-out or inconsistently wound faces (FAIL), a part cutting through itself (FAIL, with the positions of the crossing faces), zero-area and near-flat sliver triangles (a corner over 175°) and near-duplicate vertices (an edge under 0.1% of the part) (WARN). Long thin triangles on long thin parts (a pole, a strap's side wall) are normal and not reported. Extrude and polygon caps are triangulated best-ear-first with edge flips, so spiky outlines (fins, flames, leaves) do not produce slivers on their own. The area and volume checks are skipped for clips that scale the bones, since scaling changes them on purpose.

## 9. Taking a rig to Roblox

- A `.glb` with a skin imports through the 3D Importer as a skinned mesh with `Bone` instances named after the spec's bones. Animate it with an `AnimationController` + `Animator` (or a `Humanoid` for characters) and the Animation Editor, or drive the bones from a script (`Bone.Transform`) for procedural motion such as hair physics. The importer's skinning and animation support changes over time, so check the current Roblox documentation.
- Up to 4 bone influences per vertex are supported. This engine uses at most 2, so weights import unchanged.
- Roblox wants no influences on the root joint and frozen bone transforms (rotation 0, scale 1) at bind. The export makes each skin's root joint the node above its bones (usually the model root) with zero weight; bones carry only a translation at rest.
- One animation track per file: import `<Name>.<Clip>.roblox.glb` for each clip (the build writes them for skinned models).
- Keep bone names unique, without spaces or dots.
- The bind pose is the rest pose you modelled, which is another reason to model limbs half-bent and arms in an A-pose.
- Keep each mesh under Roblox's per-mesh triangle limit (20,000 at the time of writing). Each part exports as its own mesh, and the `budget` test fails any part over the limit. Low-poly models are far below it, but mobile performance favours a few hundred to a few thousand triangles per character.
- For full R15 avatar animation (Motor6D poses, KeyframeSequences), use the `roblox-animation` skill. This skill builds the mesh and simple rigs.
