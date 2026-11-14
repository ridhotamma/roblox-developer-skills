---
name: roblox-modeling
description: Build low-poly 3D models with animations from real reference images, then test them, look at them and export them for Blender, three.js and Roblox. Finds openly licensed reference photos and drawings online, measures the object's proportions and silhouette from them, plans the parts, pivots and hierarchy, generates flat-shaded geometry (boxes, hollow containers, lathes, lofted organic bodies, extruded outlines, hulls), rigs hinges and skinned spines, bakes clips (open/close, swim, idle, die, flap, spin...), runs an automatic test suite (watertight, z-fighting, floating parts, ground contact, reference dimensions, silhouette match, parts passing through each other, seamless loops), renders review sheets, and exports .glb (with node animations and skins), .obj, a Blender import script, a three.js loader and an interactive three.js preview. Use this whenever the user wants a 3D model, low-poly asset, prop, creature, game object or animated mesh ("build me a chest that opens", "low poly fish with swimming, idle and dying animation", "make a sword / tree / barrel / lantern / bird"), wants a .glb / glTF / .obj for Blender, three.js, React Three Fiber, Godot, Unity or Roblox's 3D Importer, or asks to fix the shape, proportions or animation of such a model.
---

# Low-poly modeling (reference → measure → model → test → export)

You author a model as a JSON **model spec**: parts built from low-poly shape generators, placed in one shared coordinate system, linked into a hierarchy with pivots, plus animation clips and checks. The bundled engine (`scripts/rmodel.cjs`, Node only, no packages) builds the geometry, runs the test suite, renders review sheets you look at, and exports files that load in Blender, three.js and Roblox.

The difference between a good model and a guessed one is **looking at the real thing first and measuring it**. Never model from memory alone when a reference can be found: proportions recalled from memory are routinely off by 20-50% (fish too long, chests too tall, swords with tiny guards) and the user notices immediately.

The loop: **find references → measure → plan parts → write the spec → build → read the test report → look at the sheets → fix → deliver.** Do not skip the looking step: a model can pass every numeric test and still look wrong (the bundled chest example passed its tests while being a solid block with no inside; only the render showed it).

## Workflow

1. **Pin down the request.** What the object is, its style (stylised game prop vs realistic), size in real life, which animations and what each must show, the target (Blender, three.js, Roblox, all), and a triangle budget (default 2000; props 200-1500, characters/creatures 500-3000). For a clear request, start straight away and state your assumptions.

2. **Find references** (read `references/reference-research.md`). Run
   `node <skill>/scripts/refsearch.cjs "<object> side view" --out refs` (add a second query for another angle, e.g. "<object> front"). It downloads openly licensed images from Wikimedia Commons and Openverse, records source, licence and author in `refs/sources.json`, and writes `refs/contact-sheet.png`. **Look at the contact sheet** with the Read tool and pick the clearest views: a true side view (profile) is the most valuable, then front, then top; for anything that opens or moves, an image of the open / moving state too. If the search finds nothing useful, search the web for the object's typical dimensions and describe the shape from what you find; say that you did.

3. **Measure.** Write down the real-world size (from the reference text, product listings, or the common sizes table in the research reference). Then trace the best side view:
   `node <skill>/scripts/rmodel.cjs trace refs/refNN.jpg [--flip] [--crop x0,y0,x1,y1] --length <m> --stations 12`
   It cuts the object out of the image, prints its aspect ratio and the top/bottom profile along its length, suggests loft stations in metres, and writes a mask PNG. **Look at the mask** before trusting the numbers (the background key can grab shadows or text; use `--crop` or `--threshold`). The trace includes fins, handles and other appendages, so decide which part of the profile belongs to the main body.

4. **Plan the structure** before writing JSON: list the parts, which shape generator makes each, the dimensions and positions from your measurements, the hierarchy (what moves with what), every pivot (hinge line, joint, spine bone), and for each animation the parts it moves, the axis, the angle range and the sign. Write the plan out briefly; it catches mistakes such as a lid hinged at the wrong edge or a strap that crosses an opening. Read `references/modeling-cookbook.md` for the shape recipes and `references/animation-cookbook.md` for pivots and clip recipes.

5. **Write the spec** to `<name>.json`. Start from the closest file in `examples/` (`treasure_chest.json`: rigid parts, hinge, hollow container, mirrored parts; `fish.json`: lofted body traced from a reference, skinned spine, fins, travelling-wave swim, one-shot death).

6. **Build:** `node <skill>/scripts/rmodel.cjs build <name>.json --out out` (several specs become tabs in one preview; `--fast` skips the PNG sheets).

7. **Read the test report** on stdout. Every FAIL needs a fix; a WARN needs a fix or a reason. The suite:
   - **geometry**: every part watertight and outward-facing, no zero-area or paper-thin parts, triangle budget.
   - **z-fighting**: no two parts with coplanar, same-facing, overlapping faces, at rest and at the end of each clip. These flicker in every engine.
   - **assembly**: every part touches the rest (nothing floats); **ground**: lowest point at y = 0 (set `"ground": false` for swimming / flying things).
   - **dimensions** against `reference.dimensions`, and **silhouette** checks against a reference image (`compare-<Name>-<view>.png` shows green = both, red = reference only, blue = model only).
   - **per animation**: something moves, loops are seamless, nothing goes below the floor, no parts pass through each other (pairs that do not overlap at rest), **attached parts stay welded** (every vertex where a part meets its parent, or the skinned body its bone drives, at rest must stay in contact in every frame: catches fins, lids, wings and limbs that swing off their joint), no popping-fast rotations.
   - your own **checks** (angle at a time, poses that must match, gaps, ratios, parts kept apart through a clip).

8. **Look at the sheets** with the Read tool: `sheet-<Name>.png` (three perspective views plus front / side / top orthographic blueprints with a metric grid and the overall size) and `anim-<Name>-<Clip>.png` (eight moments plus top views). Compare them with the reference images, not just with the plan: proportions, silhouette, where each part sits, how the motion reads. For a close look at a detail use `rmodel.cjs render <spec> --clip Open --time 0.4 --yaw 120 --highlight Lid`.

9. **Fix and rebuild** until the tests pass and the renders match the references. Two to four rounds is normal. Tighten your own checks as you learn (for example add an `apart` check for a lid you saw clipping).

10. **Deliver**: `out/<Name>.glb` (the main asset), `out/preview.html` (interactive three.js viewer: clips, orthographic views, wireframe, dimensions, test results, drag-in reference overlay; publish it as an artifact or send the file), `<Name>.blender.py`, `<Name>.three.js`, `<Name>.obj/.mtl`, the review sheets, and the reference list with licences. Tell the user, briefly: size and triangle count, the clips and their lengths, which references it was measured from, anything you approximated, and how to use it (read `references/integration.md` for Blender, three.js / React Three Fiber, Roblox, Godot and Unity steps).

## Model spec

```json
{
  "name": "TreasureChest",                 // file and root node name (letters, digits, _)
  "title": "Low-poly treasure chest",
  "description": "Shown in the preview.",
  "ground": true,                          // false for things that swim or fly (skips the floor checks)
  "budget": 1500,                          // triangle budget
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

**Coordinates.** Metres, +Y up, the model's **front faces +Z**, its right is +X, and the floor is y = 0. Every position in the spec (`at`, `pivot`, outlines, stations, points) is in this one **model space at the rest pose**, whatever the hierarchy. That keeps measurements from the reference directly usable. These are glTF's conventions, so three.js and Blender's importer read them unchanged.

### Parts

Common fields: `name`, `shape`, `color` (hex or palette key), `material` (`roughness`, `metalness`, `emissive`), `parent` (default: the root), `pivot` (the point the part rotates about; default the part's centre), `at` (move), `rot` (degrees, applied X then Y then Z around the pivot when the part has one, so a fin posed at an angle stays on its hinge, otherwise around the shape's own centre), `scale`, `mirror: "x"` (adds a left/right copy: `FinL` → `FinR`, mirrored children follow), `jitter` (metres of seeded random wobble for organic or rocky looks), `hidden`, `note`.

| shape | fields | use for |
|---|---|---|
| `box` | `size [w,h,d]`, `taper [x,z]` (top face scale), `chamfer` (bevel size), `hollow` (wall thickness: open-top container), `open: "both"` (open at top and bottom: a frame or rim) | crates, chest bases, planks, rims, buildings |
| `wedge` | `size` (full height at the back, sloping to the front) | roofs, ramps, blades |
| `cylinder` / `cone` | `radius` or `[bottom, top]`, `height`, `segments` (5-8 reads as low-poly), `axis` | barrels, posts, bottles, horns |
| `sphere` | `radius` or `[rx, ry, rz]`; `detail 0-2` (icosphere) or `segments [lon, lat]` | eyes, heads, fruit, gems |
| `torus` | `radius`, `tube`, `segments [major, minor]`, `arc` (degrees), `axis` | rings, handles, hoops |
| `lathe` | `profile [[r, y], ...]` bottom to top, `segments`, `axis` | vases, bottles, mushrooms, goblets, tree trunks |
| `loft` | `stations [{at, w, h, dx?, dy?, shape?}]` along `axis` (default z), `sides` | fish, birds, boats, bodies, limbs: anything traced from a profile |
| `extrude` | `outline [[u, v], ...]` (concave is fine), `plane` (`xy` front outline, `zy` side outline, `xz` top outline), `depth`, `taper` | fins, blades, lids with arched profiles, signs, U-shaped straps |
| `hull` | `points [[x,y,z], ...]` (convex hull) | rocks (+ `jitter`), gems, treasure piles, chunky custom forms |
| `mesh` | `vertices`, `faces` (polygons) | anything else, as a last resort |
| `none` | `pivot` | empty pivots and skeleton bones |

**Skinned parts**: `"skin": { "bones": ["Head", "Spine1", "Spine2", "Tail"], "axis": "z" }` on a loft (or any mesh) weights each vertex between the two nearest bones along the axis, so the surface bends smoothly. Bones are `none` parts chained parent to child; animate the bones, never the skinned part, and parent fins and eyes to bones, not to the skinned part.

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
| `silhouette` | `image` (path relative to the spec), `view` (`side`, `front`, `top`), `min` (0.75-0.85), `crop`, `flip`, `threshold` | side profile matches the traced photo |

Every check takes an optional `label`. Add checks for every promise the user's request makes ("opens", "swims", "dies belly-up").

## Limits to be honest about

- Models are flat-shaded, vertex-coloured low-poly: no textures, UV maps, normal maps or subdivision. Detail comes from shape and palette.
- Animation is per-part transforms plus simple bone chains with automatic linear weights along one axis. No IK, no blend shapes, no hand-painted weights, no full humanoid rigs (for Roblox character animation, the `roblox-animation` skill does that).
- The silhouette score compares outlines only, and a photo in perspective never matches an orthographic view exactly. Use it with views that are close to straight-on, and treat 75-85% as a good match for stylised low-poly. Always look at the overlay.
- The review sheets come from a simple software renderer (no shadows except a soft floor contact, no reflections). `preview.html` shows the real three.js look.
- Reference search depends on the network and on Wikimedia / Openverse rate limits (HTTP 429: wait a minute, use the other source, or use the browser to find images). Respect licences: references are for measuring, not for copying textures or reproducing a specific copyrighted design.
- The Blender script was generated for Blender's built-in glTF importer (3.6+). It runs without Blender-specific setup, but the NLA arrangement differs between Blender versions and is best effort.

## Files

- `scripts/rmodel.cjs`: CLI (`build`, `test`, `trace`, `compare`, `render`); also a module (`require(...).MD.compile(spec)` etc.).
- `scripts/refsearch.cjs`: reference image search, download, sources file and contact sheet.
- `scripts/lib/`: `geometry` (shape generators, hull, triangulation), `model` (parts, hierarchy, skins, animation sampling), `checks` (the test suite), `render` (rasteriser, sheets, PNG), `reference` (PNG decode, silhouette extraction, profile, comparison), `export` (glb, obj, Blender, three.js), `preview` (three.js viewer).
- `scripts/selftest.cjs`: checks the maths, every generator, hierarchy and skinning, that the test suite catches floating parts / z-fighting / clipping lids / broken loops, the exports and the tracer. Run it after editing the engine.
- `examples/`: `treasure_chest.json`, `fish.json` (+ `refs/sea-perch-side.jpg`, CC BY 2.0, source in the spec).
- `references/reference-research.md`: finding, choosing and measuring references; common real-world sizes.
- `references/modeling-cookbook.md`: low-poly style rules, shape recipes by object type, pitfalls.
- `references/animation-cookbook.md`: pivots, hinges, waves, skinned chains, clip recipes (open/close, swim/idle/die, fly, walk, spin, bob, hit).
- `references/integration.md`: using the exports in Blender, three.js / React Three Fiber, Roblox, Godot and Unity.
