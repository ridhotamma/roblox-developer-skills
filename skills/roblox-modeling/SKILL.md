---
name: roblox-modeling
description: Build low-poly 3D models with animations from real reference images, then test them, look at them and export them for Blender, three.js and Roblox. Finds openly licensed reference photos and drawings online, measures the object's proportions and silhouette from them, plans the parts, pivots and hierarchy, generates flat-shaded geometry (boxes, hollow containers, lathes, lofted organic bodies, extruded outlines, hulls), rigs hinges and skinned spines with rig-ready topology (edge loops at joints, smooth or per-joint weights, bones on the centre line), attaches fins, wings and ears so their roots are welded and they follow the body, bakes clips (open/close, swim, idle, die, flap, spin...), runs an automatic test suite (watertight, z-fighting, floating parts, ground contact, reference dimensions, silhouette match, parts passing through each other, seamless loops, welded fin roots and fin/body sync, edge loops per joint, folding / pinching / volume loss while deforming), renders review sheets, and exports .glb (with node animations and skins), .obj, a Blender import script, a three.js loader and an interactive three.js preview. Use this whenever the user wants a 3D model, low-poly asset, prop, creature, game object or animated mesh ("build me a chest that opens", "low poly fish with swimming, idle and dying animation", "make a sword / tree / barrel / lantern / bird"), wants a .glb / glTF / .obj for Blender, three.js, React Three Fiber, Godot, Unity or Roblox's 3D Importer, wants a room, house, cabin or other place players walk into (it checks the avatar reaches every spot, fits the doors, has camera headroom and cannot get stuck), or asks to fix the shape, proportions, topology, rigging or animation of such a model (collapsing elbows, tails that fold, parts tearing off a joint, fins sliding out of sync with the body).
---

# Low-poly modeling (reference → measure → model → test → export)

You author a model as a JSON **model spec**: parts built from low-poly shape generators, placed in one shared coordinate system, linked into a hierarchy with pivots, plus animation clips and checks. The bundled engine (`scripts/rmodel.cjs`, Node only, no packages) builds the geometry, runs the test suite, renders review sheets you look at, and exports files that load in Blender, three.js and Roblox.

The difference between a good model and a guessed one is **looking at the real thing first and measuring it**. Never model from memory alone when a reference can be found: proportions recalled from memory are routinely off by 20-50% (fish too long, chests too tall, swords with tiny guards) and the user notices immediately.

The loop: **find references → measure → plan parts → write the spec → build → read the test report → look at the sheets → fix → deliver.** Do not skip the looking step: a model can pass every numeric test and still look wrong (the bundled chest example passed its tests while being a solid block with no inside; only the render showed it).

## Workflow

1. **Pin down the request.** What the object is, its style (stylised game prop vs realistic), size in real life, which animations and what each must show, the target (Blender, three.js, Roblox, all), and a triangle budget (default 2000; props 200-1500, characters/creatures 500-3000). For a clear request, start straight away and state your assumptions.
   **Is it a place players walk into** (a room, house, shop, cabin, ruin, dungeon, cave, ship deck)? Then read `references/playspace.md` before planning. Real sizes are too tight for a Roblox avatar and its camera, so set `"roblox": { "studsPerMetre": 4.5 }` (4 to 5), model doorways at 1.1-1.3 m and ceilings at 2.7 m or more, and add a `playspace` block (where players arrive, the spots they must reach, the door-open poses). Furniture stays at real size.

2. **Find references** (read `references/reference-research.md`). Run
   `node <skill>/scripts/refsearch.cjs "<object> side view" --out refs` (add a second query for another angle, e.g. "<object> front"). It downloads openly licensed images from Wikimedia Commons and Openverse, records source, licence and author in `refs/sources.json`, and writes `refs/contact-sheet.png`. **Look at the contact sheet** with the Read tool and pick the clearest views: a true side view (profile) is the most valuable, then front, then top; for anything that opens or moves, an image of the open / moving state too. If the search finds nothing useful, search the web for the object's typical dimensions and describe the shape from what you find; say that you did.

3. **Measure.** Write down the real-world size (from the reference text, product listings, or the common sizes table in the research reference). Then trace the best side view:
   `node <skill>/scripts/rmodel.cjs trace refs/refNN.jpg [--flip] [--crop x0,y0,x1,y1] --length <m> --stations 12`
   It cuts the object out of the image, prints its aspect ratio and the top/bottom profile along its length, suggests loft stations in metres, and writes a mask PNG. **Look at the mask** before trusting the numbers (the background key can grab shadows or text; use `--crop` or `--threshold`). The trace includes fins, handles and other appendages, so decide which part of the profile belongs to the main body.

4. **Plan the structure** before writing JSON: list the parts, which shape generator makes each, the dimensions and positions from your measurements, the hierarchy (what moves with what), every pivot (hinge line, joint, spine bone), and for each animation the parts it moves, the axis, the angle range and the sign. Write the plan out briefly; it catches mistakes such as a lid hinged at the wrong edge or a strap that crosses an opening. Read `references/modeling-cookbook.md` for the shape recipes and `references/animation-cookbook.md` for pivots and clip recipes.
   **If anything bends** (creature, character, tail, hair, rope, limb), plan the rig with the topology too, and read `references/topology-and-rigging.md`. Decide rigid parts or skin (and `smooth` or `joints` weights) for each part. Note the largest bend at each joint, which sets how many edge loops it needs. Put bones on the body's centre line. Choose the rest pose (straight for things that bend both ways, half-bent for elbows and knees, A-pose arms).
   **For anything that grows out of a deforming surface** (fins, wings, ears, leaves, straps), decide how it attaches: skinned with the body's bones, bound to the surface, or rigid on the bone that owns its root. Its root line must sit 3-5 mm inside the body and the pivot must be on that line (`"pivot": "weld"` finds it). A rigid fin on a bone in a blend zone will slide even though it stays attached.

5. **Write the spec** to `<name>.json`. Start from the closest file in `examples/` (`treasure_chest.json`: rigid parts, hinge, hollow container, mirrored parts; `fish.json`: lofted body traced from a reference, skinned spine, welded/skinned/bound fins, travelling-wave swim, one-shot death; `cabin.json`: a walkable building with a Roblox scale, a hinged door and a `playspace` block).

6. **Build:** `node <skill>/scripts/rmodel.cjs build <name>.json --out out` (several specs become tabs in one preview; `--fast` skips the PNG sheets).

7. **Read the test report** on stdout. Every FAIL needs a fix; a WARN needs a fix or a reason. The suite:
   - **geometry**: every part watertight (open or non-manifold edges fail; a deliberately open sheet sets `"openSurface": true`, which still fails while Roblox is a target, since Roblox requires watertight meshes with volume), outward-facing and consistently wound (neighbouring faces that wind opposite ways fail, open sheets included), no self-intersections (a part cutting through itself fails), no zero-area, near-flat sliver (a corner over 175°) or near-duplicate-vertex triangles, no paper-thin parts.
   - **budget**: the whole model within `budget`, and every part under Roblox's 20,000-triangle per-mesh limit (each part imports as its own MeshPart).
   - **performance**: triangles and GPU vertices (hard edges split vertices; smoothed parts share them), how many Roblox MeshParts the model becomes after static parts are merged (each is a draw call; WARN above 25), and detail too small to see: triangles under ~10 px when the model is 200 px tall on screen (WARN when they are over a quarter of the model).
   - **lod**: the level-of-detail version (rebuilt from the spec with about half the segments, no chamfers, no small detail parts) compiles, saves a real share of the triangles (WARN above 75%) and keeps the outline (silhouette overlap front / side / top, WARN under 90%). Off for models under 300 triangles.
   - **z-fighting**: no two parts with coplanar, same-facing, overlapping faces, at rest and at the end of each clip. These flicker in every engine.
   - **rig** (skinned parts): every joint has enough edge loops for its largest bend in any clip (1 up to 20°, 2 up to 50°, 3 up to 110°, 4 beyond), and every bone sits inside the body near the centre of its cross-section. On lofts it also checks the stations: no two closer than 10% of the local width outside a joint, no gap over 3× the width across a bending zone, and no pointed end inside a bend zone or without a full ring between it and one. Thin skinned sheets (fins, capes, strips) get the edge-loop part only: rows of vertices where they bend.
   - **weld**: a part rooted in a deforming body must sink 3-5 mm into it (a root laid on the surface warns, a hinged one fails); **seam**: its root edge must stay inside the parent along its whole length (a straight edge cutting across a curved back fails, so add a point on the contour).
   - **assembly**: every part touches the rest (nothing floats); **ground**: lowest point at y = 0 (set `"ground": false` for swimming / flying things).
   - **sync**: every part attached to a skinned body must follow that body's own bone weights under its root. A rigid fin on one bone while the body blends two fails with the drift in millimetres and the frame; fix it with `skin` (same bones + axis) or `bind`.
   - **dimensions** against `reference.dimensions`, and **silhouette** checks against a reference image (`compare-<Name>-<view>.png` shows green = both, red = reference only, blue = model only).
   - **per animation**: something moves, loops are seamless, nothing goes below the floor, no parts pass through each other (pairs that do not overlap at rest), **attached parts stay welded** (every vertex where a part meets its parent, or the skinned body its bone drives, at rest must stay in contact in every frame: catches fins, lids, wings and limbs that swing off their joint), no popping-fast rotations.
   - **deform** per animation (skinned parts): no triangle folds inside out (FAIL), no face pinches below 30% or stretches beyond ×2.5 of its area, and the volume changes by no more than 12% (collapsing joints, candy-wrapper twists). Each result names the joint and the time.
   - **playspace** (specs with a `playspace` block: rooms, houses, anything players walk into), measured in studs at the Roblox scale with the avatar standing on what Roblox will collide with: the start has room; every spot is reachable on foot (FAIL if not at all, WARN if only with a jump) and the narrowest gap on the way (WARN under 3.5 studs); headroom under doorways and beams (WARN under 7.5) and ceilings for the camera (WARN when over a quarter of the covered floor is under 12); **traps**: places players can drop or jump into but never leave (FAIL); unguarded drops over 5 studs (WARN). Each result gives the place in model metres. See `references/playspace.md` for the fixes.
   - your own **checks** (angle at a time, poses that must match, gaps, ratios, parts kept apart through a clip).

8. **Look at the sheets** with the Read tool: `sheet-<Name>.png` (three perspective views plus front / side / top orthographic blueprints with a metric grid and the overall size) and `anim-<Name>-<Clip>.png` (eight moments plus top views). Compare them with the reference images, not just with the plan: proportions, silhouette, where each part sits, how the motion reads. On creatures, check that every fin/wing/ear shows no straight cut where it meets the body and that the top-view row bends together with the body (a fin that stays straight while the body curves is out of sync even if the numeric test is close). For a close look at a detail use `rmodel.cjs render <spec> --clip Open --time 0.4 --yaw 120 --highlight Lid`.

9. **Fix and rebuild** until the tests pass and the renders match the references. Two to four rounds is normal. Tighten your own checks as you learn (for example add an `apart` check for a lid you saw clipping).

10. **Deliver**: `out/<Name>.glb` (the main asset), `out/preview.html` (interactive three.js viewer: clips, orthographic views, wireframe, dimensions, test results, drag-in reference overlay; three.js is bundled inline so the single file works offline; publish it as an artifact or send the file), `<Name>.roblox.glb` + `<Name>.<Clip>.roblox.glb` (what to import into Roblox: in studs, so the importer's default Scale Unit "Stud" gives the right size; vertex colours, static parts merged, one clip per file), `<Name>.roblox.lua` (Studio command-bar script that scales the model back if it came in at another size, sets each MeshPart's collision and sets up level of detail), `<Name>.lod.glb` (the LOD version for other engines; skinned models also get `<Name>.lod.roblox.glb`), `<Name>.blender.py`, `<Name>.three.js`, `<Name>.obj/.mtl`, the review sheets, and the reference list with licences. Tell the user, briefly: size (metres, and studs in Roblox) and triangle count, for a walkable model what the playspace test found, the clips and their lengths, which references it was measured from, anything you approximated, and how to use it (read `references/integration.md` for Blender, three.js / React Three Fiber, Roblox, Godot and Unity steps).

## Model spec

```json
{
  "name": "TreasureChest",                 // file and root node name (letters, digits, _)
  "title": "Low-poly treasure chest",
  "description": "Shown in the preview.",
  "ground": true,                          // false for things that swim or fly (skips the floor checks)
  "budget": 1500,                          // triangle budget
  "lod": { "distance": 160, "cull": 600 },   // optional: LOD on/off (true / false) and LodController distances in studs
  "targets": ["roblox", "blender", "threejs"], // default; Roblox's mesh rules apply while "roblox" is listed (also godot, unity)
  "roblox": { "studsPerMetre": 3.57 },     // optional: scale of the Roblox files (default 3.57 = Roblox's 1 stud = 0.28 m; 4-5 for walkable places)
  "playspace": { "start": [0, 0, 1], "spots": [ ... ], "poses": [ ... ] },   // optional: for places players walk into (below)
  "reference": {
    "sources": [ { "url": "https://...", "note": "side view, lid open ~105°", "file": "refs/ref03.jpg" } ],
    "dimensions": { "width": 0.92, "height": 0.63, "depth": 0.56, "tolerance": 0.05 },
    "notes": "What you measured and how."
  },
  "palette": { "wood": "#9a6236", "iron": "#4b5058" },
  "camera": { "yaw": 32, "pitch": 24 },    // review-sheet viewpoint (yaw 0 = looking at the front)
  "parts": [ ... ], "animations": [ ... ], "checks": [ ... ]
}
```
(Comments are explanation only; the file must be plain JSON.)

**Roblox scale.** The `.roblox.glb` files are written in studs (`roblox.studsPerMetre`, default 3.57, Roblox's own 1 stud = 0.28 m), because Roblox's 3D Importer reads files with Scale Unit = Stud by default: a file in metres would arrive 3.57 times too small. Every other export stays in metres.

**Coordinates.** Metres, +Y up, the model's **front faces +Z**, its right is +X, and the floor is y = 0. Every position in the spec (`at`, `pivot`, outlines, stations, points) is in this one **model space at the rest pose**, whatever the hierarchy. That keeps measurements from the reference directly usable. These are glTF's conventions, so three.js and Blender's importer read them unchanged.

### Parts

Common fields: `name`, `shape`, `color` (hex or palette key), `material` (`roughness`, `metalness`, `emissive`), `parent` (default: the root), `pivot` (the point the part rotates about, in model space; default the part's centre; `"weld"` finds it on the contact with the parent), `at` (move), `rot` (degrees, applied X then Y then Z around the pivot when the part has one, so a fin posed at an angle stays on its hinge, otherwise around the shape's own centre), `scale`, `mirror: "x"` (adds a left/right copy: `FinL` → `FinR`, mirrored children follow), `jitter` (metres of seeded random wobble for organic or rocky looks), `bind` (name of a skinned body whose surface a rigid part should follow), `hidden`, `note`, `shading` (`"flat"`, the default faceted look; `"smooth"`: edges under 60° shade round; or the auto-smooth angle in degrees; a top-level `"shading"` sets the default for every part), `collision` (Roblox: `auto` default, `none` for decoration, `box`, `hull`, `default`, `precise`), `lod` (`"drop"`: leave this part out of the LOD version, `"keep"`: never drop it; by default small parts inside the outline are dropped), `openSurface: true` (a deliberately open sheet: flag, cape, single-sided leaf, for specs whose `targets` leave out Roblox; it skips the watertight test but must still be consistently wound).

| shape | fields | use for |
|---|---|---|
| `box` | `size [w,h,d]`, `taper [x,z]` (top face scale), `chamfer` (bevel size), `hollow` (wall thickness: open-top container), `open: "both"` (open at top and bottom: a frame or rim) | crates, chest bases, planks, rims, buildings |
| `wedge` | `size` (full height at the back, sloping to the front) | roofs, ramps, blades |
| `cylinder` / `cone` | `radius` or `[bottom, top]`, `height`, `segments` (5-8 reads as low-poly), `axis` | barrels, posts, bottles, horns |
| `sphere` | `radius` or `[rx, ry, rz]`; `detail 0-2` (icosphere) or `segments [lon, lat]` | eyes, heads, fruit, gems |
| `torus` | `radius`, `tube`, `segments [major, minor]`, `arc` (degrees), `axis` | rings, handles, hoops |
| `lathe` | `profile [[r, y], ...]` bottom to top, `segments`, `axis` | vases, bottles, mushrooms, goblets, tree trunks |
| `loft` | `stations [{at, w, h, dx?, dy?, shape?}]` along `axis` (default z), `sides` | fish, birds, boats, bodies, limbs: anything traced from a profile |
| `extrude` | `outline [[u, v], ...]` (concave is fine), `plane` (`xy` front outline, `zy` side outline, `xz` top outline), `depth`, `taper` (toward `taperAt`, default the outline centre) | fins, blades, lids with arched profiles, signs, U-shaped straps |
| `hull` | `points [[x,y,z], ...]` (convex hull) | rocks (+ `jitter`), gems, treasure piles, chunky custom forms |
| `mesh` | `vertices`, `faces` (polygons) | anything else, as a last resort |
| `none` | `pivot` | empty pivots and skeleton bones |

**Skinned parts**: `"skin": { "bones": ["Head", "Spine1", "Spine2", "Tail"], "axis": "z" }` on a loft (or any mesh) weights each vertex between the two nearest bones along the axis, so the surface bends smoothly. Bones are `none` parts chained parent to child; animate the bones, never the skinned part, and parent fins and eyes to bones (or skin/bind them, below), not to the skinned part. Options:
- `"weights"`: `"smooth"` (default) spreads the bend over whole segments (tails, spines, hair, tentacles). `"joints"` keeps each segment rigid and blends only around each joint (arms, legs, fingers, necks).
- `"blend"`: the full width in metres of each joint's blend zone for `joints` (default: half the shorter neighbouring segment).
- `"loops"`: on a loft, inserts 1-5 interpolated stations (edge loops) around every bone pivot inside the body, because a surface only bends where it has vertices. Use 3 for joints that bend more than 50°.
See `references/topology-and-rigging.md`.

**Fins and appendages (weld, skin, bind)** — the most common source of "cut off" and "fins not synced with the body" results:

- **Sink the root 3-5 mm into the body.** The root edge is the outline edge nearest the body: give it 2-4 points that follow the body contour and all lie inside the surface, so no part of the seam can show. Never lay the root line on the surface, and never rotate a fin about its own centre. `"pivot": "weld"` finds the pivot on the contact with the parent (or, for a fin parented to a bone, the nearest skinned body), so build-time `rot` keeps the root planted. Declare the parent/body earlier in `parts` so it exists when the weld is measured.
- **Match the way the surface moves.** If the root lies where the body blends two bones (a dorsal fin spanning the back, a wing on a ribcage, a leg on a torso), a rigid part on one bone drifts by several millimetres while the body bends. Either skin the part with the body's own `bones` and `axis`, or use `"bind": "Body"` when it must stay rigid (pectoral, pelvic, ears). Rigid on one bone is only correct where that bone owns 100% of the surface under the root. The sync test fails with the drift in mm and the time.
- **Skinned and bound parts cannot have their own tracks** (they follow the body). A fin that must flap independently needs a bone-dominant root and must be parented to that bone.
- **Bind vs skin:** bind gives every vertex one constant weight from the root centroid, so use it for small/narrow roots; a root spanning a long blend zone must be skinned, because a constant weight cannot follow the weight gradient along it.
- **Thin plates need thickness and taper** (`depth` 4-6 mm, `taper` 0.7). Put `taperAt` on the root line: the default shrinks the outer face toward the outline centre, which can pull a fin's root back out of the body.
- **Thin, plate-like skinned parts get lighter `rig`/`deform` checks**: rows of vertices at each bending joint, and folds / pinching / stretching per clip, but no bone-centre or volume tests (those are for volumes). `weld`, `seam` and `sync` cover how they sit on the body. Put the extra outline points on a free edge (the trailing edge of a fin), not on the buried root edge: rows a few mm apart along the root shear its thin rim faces and fold.
- `examples/fish.json` shows all four cases: dorsal/anal skinned with the body bones, pelvic bound with `pivot: "weld"`, pectoral rigid on a 100% head region, tail rigid behind the TailBone pivot.

### Animations

```json
{ "name": "Open", "duration": 0.9, "loop": false, "description": "...",
  "tracks": [ { "part": "Lid", "rot": [[0, [0,0,0]], [0.9, [-105,0,0], "backOut"]] } ],
  "markers": [ { "t": 0.12, "name": "Creak" } ] }
```
A track moves one part with `rot` (degrees, relative to rest), `pos` (metres offset) and/or `scale` (multiplier). Each channel is either keys `[time, [x, y, z], ease]` (the ease shapes the segment arriving at that key: `linear`, `in`, `out`, `inOut`, `sine`, `backIn`, `backOut`, `bounceOut`, `elasticOut`, `step`) or a wave: `{ "wave": { "axis": "y", "amp": 12, "cycles": 2, "phase": 0.25, "offset": [0,0,0], "envelope": [[t, k], ...], "shape": "sin"|"saw"|"bounce" } }` (`hz` instead of `cycles` for one-shots). Several tracks on the same part add up. `"mirror": true` on a track drives the mirrored partner too (rotations about Y and Z flip). The root (the model's `name`) can be animated too. Loops must use whole cycles and end where they start (the tests check this).

**Sign of a rotation** (right hand rule): `+X` tips the top toward the front (+Z), `+Y` turns the front toward the right (+X), `+Z` rolls the top toward the left (-X). So a lid hinged at the back opens with **negative** X, and a fish's tail sweeps with Y.

### Checks (in addition to the automatic suite)

| type | fields | example |
|---|---|---|
| `angle` | `clip`, `at` (seconds, `start`, `mid`, `end`), `part`, `axis`, `min`, `max` | lid opens 100-110° |
| `pose` | `clip`, `at`, `equals`: `"rest"` or `{clip, at}`, `tol` | Close ends shut; Close starts where Open ends |
| `gap` / `contact` | `a`, `b`, optional `clip` + `at`, `max`, `min` | lid sits on the rim; tail still attached at full bend |
| `apart` | `a`, `b`, `clip` | the lid never passes through the base |
| `above` | `part`, `y`, optional `clip` | the paw never goes below the floor |
| `size` / `ratio` | `axis`, `min`, `max` / `a`, `b`, `expect`, `tol` | length:height = 2.0 like the reference |
| `silhouette` | `image` (path relative to the spec), `view` (`side`, `front`, `top`), `min` (0.70-0.85 depending on how soft the reference is), `crop`, `flip`, `threshold` | side profile matches the traced photo |

Every check takes an optional `label`. Add checks for every promise the user's request makes ("opens", "swims", "dies belly-up").

### Walkable models (playspace)

For anything players walk into, add a `playspace` block and a Roblox scale. The build then stands an R15-sized avatar on everything Roblox will collide with, at the Roblox scale, and reports what a player would hit. Positions are model metres; sizes are studs. Read `references/playspace.md` for the numbers, choosing the scale, and what to do about each result.

```json
"roblox": { "studsPerMetre": 4.5 },
"playspace": {
  "start": [0.3, 0.3, 1.4],                          // on the floor where players arrive (required)
  "poses": [{ "clip": "DoorOpen", "at": "end" }],    // moving parts in these poses (doors open); rest pose otherwise
  "spots": [{ "name": "Bedside", "at": [-1.3, 0.3, -1.3] }, { "name": "Yard", "at": [0, 0, 5.6] }],
  "avatar": { "width": 2, "height": 5, "step": 2, "jump": 7.2 },                  // optional, studs (R15 defaults)
  "minimum": { "passage": 3.5, "headroom": 7.5, "ceiling": 12, "drop": 5 }     // optional, studs
}
```

Give one spot per room and per exit, plus anything the game needs players to reach. Decoration above head height (shelves, lamps, beams) should be `"collision": "none"`, or it counts as a beam the avatar hits.

## Limits to be honest about

- Models are low-poly with one colour per part (flat-shaded by default, smoothed by angle per part with `shading`): no textures, UV maps, normal maps or subdivision. Detail comes from shape and palette.
- Animation is per-part transforms plus simple bone chains with automatic weights along one axis (`smooth` or `joints`, at most 2 bones per vertex). No branching skins (one skin cannot cover a torso and four limbs: use one skinned part per chain, or rigid parts), no IK, no blend shapes, no hand-painted weights, no full humanoid rigs (for Roblox character animation, the `roblox-animation` skill does that). `bind` samples one constant weight vector, so a long root that crosses a blend zone needs `skin` instead.
- The silhouette score compares outlines only, and a photo in perspective never matches an orthographic view exactly. Use it with views that are close to straight-on, and treat 75-85% as a good match for a clean silhouette and 70%+ for a detailed illustration with soft fins or fur. Always look at the overlay.
- The review sheets come from a simple software renderer (no shadows except a soft floor contact, no reflections). `preview.html` shows the real three.js look.
- Reference search depends on the network and on Wikimedia / Openverse rate limits (HTTP 429: wait a minute, use the other source, or use the browser to find images). Respect licences: references are for measuring, not for copying textures or reproducing a specific copyrighted design.
- The playspace test models the avatar as a 2-stud-wide body that climbs 2 studs, jumps 7.2 and drops any height, on a 0.25-stud grid. Ladders, TrussParts, seats, swimming and moving platforms are not simulated. A model with a `playspace` block collides precisely in Roblox (PreciseConvexDecomposition on merged and Default parts), because Default fidelity fills doorways in a concave building mesh.
- The Blender script was generated for Blender's built-in glTF importer (3.6+). It runs without Blender-specific setup, but the NLA arrangement differs between Blender versions and is best effort.

## Files

- `scripts/rmodel.cjs`: CLI (`build`, `test`, `trace`, `compare`, `render`); also a module (`require(...).MD.compile(spec)` etc.).
- `scripts/refsearch.cjs`: reference image search, download, sources file and contact sheet.
- `scripts/lib/`: `geometry` (shape generators, hull, triangulation, smoothing normals), `model` (parts, hierarchy, skins, animation sampling), `checks` (the test suite), `render` (rasteriser, sheets, PNG), `reference` (PNG decode, silhouette extraction, profile, comparison), `export` (glb, obj, Blender, three.js, the Roblox files), `roblox` (static-part merging, collision classes, the stud scale, the Studio setup script), `playspace` (the walkable-space test: Roblox colliders per grid cell, avatar clearance, reachability, traps, drops), `lod` (the level-of-detail version: reduction rules, detail parts), `preview` (three.js viewer).
- `scripts/selftest.cjs`: checks the maths, every generator, hierarchy and skinning (edge loop insertion, joint weights, `taperAt`), that the test suite catches floating parts / z-fighting / clipping lids / broken loops / missing edge loops / folding and collapsing joints / bones outside the body / shallow fin roots / rigid fins drifting / fins hinged off their root, the exports (Roblox files in studs, the setup script's size check, each Blender clip only on the objects it moves), the playspace test (the cabin passes; a closed door, a narrow gap, a jump-only ledge, a pit trap and an unguarded drop are caught) and the tracer. Run it after editing the engine.
- `examples/`: `treasure_chest.json`, `fish.json` (+ `refs/sea-perch-side.png`, CC BY 2.0, source in the spec), `cabin.json` (walkable building: Roblox scale, hinged door, playspace block).
- `references/reference-research.md`: finding, choosing and measuring references; common real-world sizes.
- `references/modeling-cookbook.md`: low-poly style rules, shape recipes by object type, pitfalls.
- `references/animation-cookbook.md`: pivots, hinges, waves, skinned chains, clip recipes (open/close, swim/idle/die, fly, walk, spin, bob, hit).
- `references/topology-and-rigging.md`: rig-ready shapes. Rigid parts vs skinning, edge loops per bend angle, weight modes and blend widths, bone placement, rest pose, joint designs for rigid segments, hair / capes / ropes, what the `rig` and `deform` results mean, and taking rigs to Roblox.
- `references/integration.md`: using the exports in Blender, three.js / React Three Fiber, Roblox, Godot and Unity.
- `references/playspace.md`: walkable models in Roblox: choosing studs per metre, the avatar / door / ceiling / stair numbers, the playspace block, each result and its fix, rules for safe spaces.
