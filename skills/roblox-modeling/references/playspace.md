# Walkable models: room for the avatar, the camera and nothing to get stuck in

A model players walk into (a room, house, shop, cabin, barn, ruin, dungeon, cave, ship deck, bridge) is a place, not a prop. It is judged by how it plays: can the avatar get everywhere, does it fit through the doors, does the camera have room, can a player fall somewhere and never get out? Real-world sizes fail all of these in Roblox, so a walkable model gets two things in its spec: a Roblox scale (`roblox.studsPerMetre`) and a `playspace` block that the build tests.

For arranging furniture and rooms at natural distances (aisles, clearances, composition), use the roblox-layout skill. The numbers below are the same as its spacing metrics.

## Contents

1. Why real sizes feel cramped, and choosing the scale
2. The numbers (studs)
3. The playspace block
4. What each result means and how to fix it
5. Rules for safe spaces
6. How the test models Roblox, and its limits

---

## 1. Why real sizes feel cramped, and choosing the scale

Roblox's own conversion is 1 stud = 0.28 m (3.57 studs per metre), and the 3D Importer brings files in with Scale Unit = Stud, so the Roblox files this skill writes are already in studs. At 3.57 a real house is too tight for Roblox play. The R15 avatar is about 5 studs tall (1.4 m) but wide and blocky. The camera floats 12.5 studs behind it and pushes in through anything lower than about 12 studs. A real 0.9 m doorway becomes 3.2 studs, and a 2.7 m ceiling becomes 9.6.

So for a walkable model, set `"roblox": { "studsPerMetre": ... }` higher, and still widen what the avatar passes through:

| studsPerMetre | 0.9 m door | 1.2 m door | 2.7 m ceiling | 3.0 m ceiling | 0.9 m counter | Use for |
|---|---|---|---|---|---|---|
| 3.57 (default) | 3.2 | 4.3 | 9.6 | 10.7 | 3.2 | props, creatures, vehicles, outdoor set dressing |
| 4.0 | 3.6 | 4.8 | 10.8 | 12.0 | 3.6 | large open buildings (halls, barns, warehouses) |
| 4.5 | 4.1 | 5.4 | 12.2 | 13.5 | 4.1 | homes, shops, cabins, most interiors |
| 5.0 | 4.5 | 6.0 | 13.5 | 15.0 | 4.5 | tight interiors you can't widen (horror corridors, ships) |

Then model the openings at the size the avatar needs, not the real size. Interior doorways should be 1.1-1.3 m, ceilings at least 2.7 m clear, and corridors 1.4 m or wider. Furniture stays at real size: at 4.5 a counter at 4.1 studs reads as a big but believable kitchen. Write in the spec's `reference.notes` which dimensions you widened and why.

The main `<Name>.glb` (Blender, three.js, Godot, Unity) stays in metres. Only the `.roblox.glb` files are scaled, and the setup script `<Name>.roblox.lua` scales the model back if it was imported with another unit.

## 2. The numbers (studs)

| Thing | Minimum | Comfortable | Notes |
|---|---|---|---|
| Avatar | 2 wide (body), 5 tall | | 4 wide with arms; up to 6 tall with scaling and hats |
| Passage (furniture to furniture, furniture to wall) | 3.5 | 4 to 5 | Under 3.5 is a dead gap: close it to 0 or open it to 3.5 or more |
| Door opening | 5 wide, 7.5 high | 6 × 8 to 9 | 8 to 10 wide on busy routes |
| Ceiling | 12 | 14 (homes), 16 to 20 (halls) | Under 12 the camera clips into it |
| Corridor | 6 | 8 | 10 to 12 where players pass each other |
| Stair step | rise 1, run 1.5 to 2 | | The avatar climbs up to about 2 without jumping |
| Jump | 7.2 high | | Anything higher is a wall |
| Railing | 3.5 high | | On any edge with a drop over the avatar's height (5) |
| Clear inside a door | 5 deep × door width + 1 | | Nothing in the door's swing |
| Spawn / arrival area | 6 across | 10+ | Nothing to brush against on arrival |

## 3. The playspace block

Every position is in model metres (the spec's own coordinates); every size is in studs.

```json
"roblox": { "studsPerMetre": 4.5 },
"playspace": {
  "start": [0, 0.47, 3.0],
  "poses": [{ "clip": "FrontDoorOpen", "at": "end" }, { "clip": "BackDoorOpen" }],
  "spots": [
    { "name": "Kitchen", "at": [1.4, 0.47, -2.0] },
    { "name": "Back yard", "at": [1.2, 0, -6.0] }
  ],
  "avatar": { "width": 2, "height": 5, "step": 2, "jump": 7.2 },
  "minimum": { "passage": 3.5, "headroom": 7.5, "ceiling": 12, "drop": 5 },
  "area": [-8, -9, 8, 10],
  "cell": 0.25
}
```

| Field | Meaning |
|---|---|
| `start` | Required. A point on the floor where players arrive: inside the front door, the spawn, the top of the entry stairs. |
| `poses` | Moving parts are tested in these poses, and in the rest pose otherwise. List each door's open clip so the test walks through open doorways (`at` defaults to `end`). With no poses, closed doors block like walls. |
| `spots` | Places that must be reachable: one in each room, every exit, anything the game needs players to reach (a key, a switch, a bed to hide under). Put each on open floor. The test takes the best standable floor within 2 studs of it. |
| `avatar` | Optional overrides (studs): `width` (2), `height` (5), `step` auto-climb (2), `jump` height (7.2). Change them only if the game changes the avatar or `JumpHeight`. |
| `minimum` | Optional overrides (studs): `passage` (3.5), `headroom` for doorways and beams (7.5), `ceiling` for the camera (12), `drop` for unguarded edges (5). |
| `area` | Optional `[x0, z0, x1, z1]` to analyse; default is the model's footprint plus 6 studs all round. |
| `cell` | Optional grid size in studs (default 0.25). Very large models are coarsened automatically. |

## 4. What each result means and how to fix it

| Result | Means | Fix |
|---|---|---|
| `start ... does not fit` (FAIL) | The arrival point is inside something, under something lower than the avatar, or within 1 stud of a wall | Move `start` onto open floor, or clear the space |
| `reach X: cannot be reached` (FAIL) | No route, even with jumps | Look for a doorway or gap under 2 studs, a door left closed (add its open clip to `poses`), or a rise over 7.2 studs |
| `reach X: only with a jump` (WARN) | A riser over the auto-climb on the only route | Add a step (rise 1, run 1.5 to 2) or a ramp, or split a tall step in two |
| `reach X: narrowest gap ... under 3.5` (WARN) | The best route squeezes past furniture or through a narrow door | Move the furniture, widen the doorway, or close the gap entirely |
| `headroom: N studs at ...` (WARN) | Something hangs below 7.5 studs over walkable floor: a doorway head, beam, shelf, loft, lamp or stair underside | Raise it, or make it decoration (`"collision": "none"`) if players should pass under it |
| `ceilings: N% under 12 studs` (WARN) | The camera will push into the ceiling over much of the floor | Raise the ceiling or `studsPerMetre`; for a deliberately tight horror space, lower the camera's max zoom or use first person |
| `trap: ... can drop or jump into but not get out of` (FAIL) | A pit, a gap behind furniture, a walled yard or a well that players can enter but not leave: a stuck player | Close it (fill it, or make the gap 0), add a step or ramp out, or make the walls low enough to jump |
| `drops: ... no barrier` (WARN) | Walkable edges with a fall over 5 studs: balcony, loft, stair side, a deck over the void | Add a 3.5 stud railing or a wall, or keep it on purpose (a jump-down shortcut) and say so |

## 5. Rules for safe spaces

- **No dead gaps.** Furniture sits flush to a wall (0 gap) or 3.5+ studs away. A 1-3 stud gap behind a sofa or bed is where avatars and cameras get stuck.
- **Doors swing clear.** Test doors in their open pose. Keep the first 5 studs inside a door free, and keep the open door slab out of the main route.
- **Steps, not ledges.** Raised floors, porches and decks get steps with a rise of 1 stud. A 2-stud ledge is the most the avatar climbs; it will catch some players.
- **Decoration overhead does not collide.** Shelves, lamps, pictures, curtain rails and thin trim above head height get `"collision": "none"`. Otherwise they are invisible beams that snag the camera and the jump.
- **Every pit has a way out.** Anything lower than the floor around it (a sunken room, a pool, a basement hatch) needs steps out, or must be closed. A trap is the only playspace result that is always a FAIL.
- **Railings on real drops.** Any edge over 5 studs gets a railing at least 3.5 studs high, unless the jump-down is part of the design.
- **Leave arrival space.** The start point needs 6+ studs of open floor; spawn somewhere players can look around before the first corner.
- **Tension without squeezing.** For horror and stealth, get the pressure from light, fog, sound, clutter along the walls and short sightlines, not from 3-stud gaps the camera can't follow the avatar through.

## 6. How the test models Roblox, and its limits

- **Colliders.** The test uses what the setup script gives Roblox. Each collidable MeshPart counts by its collision class: Box is the part's bounding box, Hull its convex hull, and Default or Precise its real triangles. In a model with a `playspace` block, merged static groups and Default parts collide with PreciseConvexDecomposition (their real geometry). Roblox's Default fidelity approximates a concave mesh with a few convex hulls, which on a building fills doorways and rooms. Decoration (`"collision": "none"`) never blocks. Precise collision costs more physics memory than Box, so keep it for the shell and walk-around furniture, and give everything else `none`.
- **The avatar** is a 2-stud-wide body that climbs rises up to 2 studs, jumps 7.2 and drops any height. Ladders, TrussParts, seats, swimming and moving platforms are not modelled. Spots that need them will show as unreachable.
- **Ground.** With `"ground": true` (the default) the model stands on a baseplate at y = 0. With `"ground": false`, walking off an edge falls into the void: a drop of infinite height, and a trap if nothing below leads back.
- **Grid.** Sizes are measured on a grid (0.25 studs by default), so reported widths are accurate to about a quarter stud.
