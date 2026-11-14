# Modeling cookbook

## Low-poly style rules

- **Silhouette first.** At game distance only the outline and the two or three big colour areas read. Get the outline right against the reference before adding any detail part.
- **Few segments, chosen on purpose.** Cylinders 6-8 sides (5 for chunky), spheres `detail 0` (20 triangles) or `1` (80), lofts 6-8 sides, lathes 6-10. More segments stop looking low-poly and cost triangles.
- **Facets are the shading.** Flat shading lights each face differently; a shape needs enough distinct facets to catch light (a 4-sided loft looks like a box, 6-8 reads as round).
- **Bevel the big edges** with `chamfer` on boxes (2-5% of the size). Sharp 90° boxes look like placeholders.
- **3-6 colours per object**, from a palette: a main colour, a darker variant for secondary parts, an accent (gold, red), near-black for holes / pupils. Avoid pure black and white.
- **Exaggerate a little** for stylised games: bigger heads, eyes, handles, locks, thicker rims (10-30%). Keep the overall size true.
- **Organic and natural things get `jitter`** (1-3% of size): rocks, trees, piles, terrain. Never on manufactured parts. Jitter moves the bottom vertices too, so a jittered part on the floor needs lifting by the jitter amount (the ground test reports by how much).
- **Budget:** small props 100-600 tris, hero props 500-1500, creatures 300-2000. The examples: chest 504, fish 322.

## Choosing the generator

| You see in the reference | Use |
|---|---|
| A profile that is the same all the way across (lid arch, sword blade, fin, sign, gear, letter) | `extrude` with the outline in the matching `plane` (side outline → `zy`) |
| Something round that changes radius along its height (vase, bottle, barrel, mushroom, tree trunk, goblet) | `lathe` with the radius profile |
| An elongated body whose cross-section changes along it (fish, bird, boat hull, limb, carrot, cucumber) | `loft` with stations from `trace` |
| A container or frame (chest, crate, drawer, cup, picture frame, rim) | `box` with `hollow` (+ `open: "both"` for a frame) |
| An irregular lump (rock, crystal, coin pile, cloud, bush) | `hull` of a handful of points + `jitter` |
| Ramps, roofs, wedge blades | `wedge`, or `box` with `taper` |
| Rings, handles, hoops, chain links | `torus` (use `arc` for a half handle) |

## Recipes

**Chest / crate / box with a lid** (see `examples/treasure_chest.json`): hollow base (`hollow` 0.03-0.04), plinth slightly larger than the base, rim as a hollow `open: "both"` box on top of the base, lid as an `extrude` of the arch (or a box) hinged with `pivot` on the back edge, a lid rim, straps as **U-shaped extrude outlines** (front-bottom-back only, so nothing crosses the opening) and arched bands on the lid (outer arch + inner arch reversed), handles as `torus` on mounting plates, a lock plate + hasp (hasp parented to the lid). Put something inside (a hull mound of gold, a dark floor) or the open state looks empty.

**Barrel**: `lathe` profile bulging in the middle (`[[0.26,0],[0.31,0.25],[0.32,0.45],[0.31,0.65],[0.26,0.9]]`), 8-10 segments; hoops as thin hollow `open: "both"` boxes are wrong (square), use `lathe` rings or `torus` with small tube; lid recess = smaller dark cylinder slightly below the top.

**Fish** (see `examples/fish.json`): trace a side view; loft body 8 sides with 8-10 stations (nose station `w: 0, h: 0`), width 0.4-0.5 × height; spine of 3-4 `none` bones from head to tail; body skinned along z; tail, dorsal and anal fins as thin `extrude` outlines in `zy` parented to the nearest bone; pectoral / pelvic fins mirrored, hinged at their front edge; eyes = two small `sphere detail 0` (white + pupil) mirrored, parented to the head bone. `"ground": false`.

**Bird**: loft body (shorter, rounder: height ≈ width), head sphere or loft continuation, beak `cone` 4-5 sides, wings as `extrude` outlines in `xz` (top view outline) hinged at the shoulder with `pivot`, split into inner + outer wing (outer parented to inner) for a better flap, tail `extrude` fan, legs thin `cylinder`s.

**Tree (stylised)**: trunk `lathe` or tapered `cylinder` 6 sides with `jitter`; canopy 2-4 `sphere detail 0/1` or `hull` blobs with `jitter`, overlapping, in two greens; optional roots as small `cone`s. Pivot the canopy at the trunk top for wind sway.

**Rock**: `hull` of 10-16 points roughly on an ellipsoid + `jitter` 3-6%; a flatter one for the ground; two greys.

**Sword / axe / tool**: blade `extrude` in `xy` (front outline) with small depth and `taper` < 1 for an edge; guard `box` with `chamfer`; grip `cylinder` 6 sides; pommel `sphere detail 0`. Put the pivot at the grip for swing animations. `"ground": false` if it is held, or lay it flat.

**House / building prop**: hollow walls are unnecessary unless it opens; `box` walls with `chamfer`, roof as two `box` slabs rotated or an `extrude` of the gable outline in `zy`, door and windows as slightly raised boxes (2-5 mm proud of the wall, never flush: flush = z-fighting).

**Lantern / lamp**: `lathe` frame, glass as a `cylinder` with `material.emissive`, handle `torus` with `arc: 180`.

## Pitfalls (and which test catches them)

| Problem | Test | Fix |
|---|---|---|
| Two parts' faces flush in the same plane (a door on a wall, a rim on a lid bottom) | z-fighting | Offset one face 2-5 mm, or make one part slightly smaller / bigger |
| A part does not touch anything (eyes in front of the head, coin above the pile) | assembly | Move it into contact or overlap 1-3 mm |
| Model hovers or sinks | ground | Lowest point at y = 0; set `ground: false` for swimming / flying things |
| Solid block where the user will look inside | only the renders | `hollow` containers |
| A strap, band or bar crossing an opening | only the renders | U-shaped `extrude` outlines instead of full boxes |
| Inside-out part (render shows holes) | geometry | Fix custom `mesh` face winding (counter-clockwise seen from outside) |
| Paper-thin part disappears edge-on | geometry (warn) | At least 3-5 mm thick, or accept for fins seen mostly side-on |
| Proportions drift from the reference | dimensions, silhouette | Re-measure, fix the regions the overlay marks |
| Rotation acts around the wrong point | renders, `apart`, `angle` | `pivot` is in model space; `rot` turns a shape around its own centre at build time only |
