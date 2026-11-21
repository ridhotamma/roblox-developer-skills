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

## Appendages: weld first, then rig

Fins, wings, ears, leaves, straps and limbs are plates or stubs growing out of a body. Two things decide whether they read as part of it:

- **The root is buried, not pasted.** Build the root edge from 2-4 outline points that follow the body contour, every point 3-5 mm inside the surface (scale it: about 1-2% of the body's smallest dimension). A straight root chord across a curved back leaves its corners outside; the `seam` test reports that gap and asks for a point on the contour.
- **The hinge is on the root.** `"pivot": "weld"` finds it on the contact centroid; an explicit pivot must lie on the root line. A fin posed about its bounds centre lifts its root out of the body — the classic "card stuck on the side".
- **The root must move like the surface under it.** Where the body blends two bones, a rigid part on one bone drifts (the `sync` test measures it). Skin the fin with the body's own bones/axis when it spans the blend, `bind` it for a small rigid fin, or place it where one bone owns 100% of the root and parent it there.
- **Thickness and taper:** extruded fins at `depth` 4-6 mm with `taper` 0.7 read as bevelled sheets; zero thickness flickers and vanishes edge-on. Put `taperAt` on the root line, otherwise the outer face shrinks toward the outline centre and can pull the root edge back out of the body.
- **A plate is edge-on from some views.** That is fine in low-poly; pose it (`rot` about the root) so the readable views show its face, and don't add thickness just to make it visible from the front.

## Recipes

**Chest / crate / box with a lid** (see `examples/treasure_chest.json`): hollow base (`hollow` 0.03-0.04), plinth slightly larger than the base, rim as a hollow `open: "both"` box on top of the base, lid as an `extrude` of the arch (or a box) hinged with `pivot` on the back edge, a lid rim, straps as **U-shaped extrude outlines** (front-bottom-back only, so nothing crosses the opening) and arched bands on the lid (outer arch + inner arch reversed), handles as `torus` on mounting plates, a lock plate + hasp (hasp parented to the lid). Put something inside (a hull mound of gold, a dark floor) or the open state looks empty.

**Barrel**: `lathe` profile bulging in the middle (`[[0.26,0],[0.31,0.25],[0.32,0.45],[0.31,0.65],[0.26,0.9]]`), 8-10 segments; hoops as thin hollow `open: "both"` boxes are wrong (square), use `lathe` rings or `torus` with small tube; lid recess = smaller dark cylinder slightly below the top.

**Fish** (see `examples/fish.json`): trace a side view; loft body 8 sides with 8-10 stations (nose station `w: 0, h: 0`), width 0.4-0.5 × height; spine of 3-4 `none` bones from head to tail; body skinned along z (`loops: 3` if it bends hard). Fins as thin `extrude` outlines in `zy`, `depth` 4-6 mm, `taper` 0.7, root points following the body 3-5 mm inside it. **Rig them to the surface:** dorsal and anal `skin` with the body's four bones + axis (their roots span several bones); pelvic fins `"bind": "Body"` + `"pivot": "weld"` (small, rigid, still follows the belly); pectoral fins rigid on `Head` with the root at z > the Head pivot, where the body is 100% Head, so they can flap; tail rigid on `TailBone` with its root behind that bone's pivot. Body stations taper to a point inside the tail fin. Eyes = two small `sphere detail 0` (white + pupil) mirrored, parented to the head bone. `"ground": false`.

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
| A fin, lid or limb swings off its joint during a clip (looks cut off or floating) | anim attachment ("come apart") | Put the `pivot` on the edge where the part meets its parent (`"pivot": "weld"`), embed the root 3-5 mm into the parent, and on skinned bodies hang the part from the bone nearest its root, or bind/skin it with the body weights |
| A fin looks like a card pasted on, with a visible cut line | weld / seam | Sink the whole root line 3-5 mm inside the body, with 2-4 points on the contour; the straight chord between two points cuts through the air |
| Fins stay straight while the body bends, or slide along it | sync (fails with mm) | Skin the fin with the body's bones + axis, use `"bind": "Body"` for a small rigid fin, or move the root where one bone owns 100% |
| A posed fin's root lifts out of the body after `rot` | weld / attachment | `"pivot": "weld"`, or put the explicit pivot on the root line |
| A bound fin still drifts slightly | sync / render | Its 3-5 mm root is too small for the weight gradient: use `skin` instead |
| A lofted body ends in a flat cap where a thin tail or fin begins (reads as a cut stump) | only the renders | Add stations that taper the body to a point inside the fin |
| Rotation acts around the wrong point | renders, `apart`, `angle` | `pivot` is in model space; `rot` turns a shape around its own centre at build time only |
| A skinned body bends in straight, faceted kinks or collapses at a joint | rig (loops), deform (pinch, volume) | Edge loops at the joint (`skin.loops`), `"weights": "joints"` for limbs, bulge the joint station 5-10% |
| A tail or limb folds inside out at full bend | deform (fold) | More loops, a wider `blend`, a half-bent rest pose, or split the bend over two bones |
| One side of a bend stretches while the other crushes | rig (off-centre bone) | Put the bone pivot at the centre of the cross-section (`dy` of the station there) |
| Rigid limb segments show a gap or a corner poking out when bent | anim attachment, passes through | A ball (sphere) or hinge (cylinder) centred on the pivot, overlapping both segments 2-5 mm; rounded inner corners |

For anything that bends, read `topology-and-rigging.md` before writing the spec.
