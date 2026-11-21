# Terrain

How to give a layout real ground: hills, mountains, mesas, valleys, lakes, rivers, a sea, flat pads for buildings, plowed fields, rock outcrops and painted areas, written into Roblox Smooth Terrain. The layout stays a 2D plan; the terrain block describes the ground under it, and every object is set on that ground when it is built.

## Contents
1. When to use terrain
2. The terrain block
3. Features, with sizes that work
4. Surface materials
5. How objects sit on the ground
6. Recipes: village, farm, river crossing, lake with a dock, canyon, island, mountain pass
7. What the checker adds
8. Building it in Studio and at runtime
9. Limits

---

## 1. When to use terrain

| Want | Use |
|---|---|
| Outdoor map, survival / exploration / open world, anything with "hills", "lake", "river", "mountain", "beach", "field" | Terrain. `build wilderness` already makes it; for a designed map write a terrain block. |
| A town, hub or park that should not look like a table top | Terrain with a low `relief` (3 to 6) and `flatten` pads under the built parts. |
| Obby, interior, tycoon plot, city grid | Usually no terrain: these are built on parts. Add a `sea` or rim around an obby island if it helps. |

Terrain is the ground. Trees, rocks you can mine, buildings and props stay layout items (parts or prefabs). Rock *formations* (outcrops, cliffs, mesas) are terrain.

## 2. The terrain block

```json
"terrain": {
  "relief": 8, "scale": 220, "edge": { "height": 40, "width": 60 }, "snow": 50,
  "features": [
    { "type": "hill", "at": [300, 200], "radius": 70, "height": 18 },
    { "type": "lake", "id": "lake", "at": [120, 320], "radius": 45 }
  ]
}
```

| Field | Default | Meaning |
|---|---|---|
| `seed` | layout `seed` | Seeds the noise. Same spec, same ground, on every machine. |
| `bounds` | layout `bounds` | `[x0, z0, x1, z1]`: the area covered. |
| `base` | 0 | Height of the average ground (layout y 0 is "on the ground" wherever the ground is). |
| `relief` | 0 | Rolling ground, in studs up and down. 3 to 6 gentle, 8 to 12 hilly, 15+ rough. |
| `scale` | 200 | Size of the rolls in studs. 150 to 250 reads as natural at avatar scale. |
| `ridges` | 0 | 0 to 1: adds sharp ridgelines on top of the rolls. |
| `edge` | none | `{ height, width }` or `true` (40, 60): a rim of high ground round the map. It frames the world and hides the void; make it steep (height 40+ over 50 to 70) so it reads as a boundary. |
| `sea` | none | Sea level: all ground below it is water, with a sand beach band 1.5 studs above it. |
| `snow` | none | Height above which flat ground turns to snow. |
| `rock`, `dirt` | 40, 30 | Slopes (degrees) above which ground turns to Rock, and to Ground (dirt). |
| `ground` | `Grass` | The default surface material. |
| `depth` | 16 | How far below the lowest surface the terrain is filled. |
| `paths` | true | Give the layout's paths a level bed and paint them (`Ground` for trails, `Cobblestone` for other paths; a path's own `material` and `blend` override). |
| `colors` | | `{ "Grass": "#6E8B3D" }`: Terrain:SetMaterialColor in game, and the preview's colours. |
| `water` | | `{ color, transparency, waveSize, waveSpeed, reflectance }` for Terrain's water properties. |
| `cell` | 4 | Grid size in studs. Keep 4: it is Terrain's voxel size. |

## 3. Features, with sizes that work

Features apply in the order listed; later ones work on the result of earlier ones. Put shapes first (hills, mountains), then water, then pads and fields, then outcrops and paint. Every feature takes an optional `id`.

| Type | Fields | What it makes |
|---|---|---|
| `hill` | `at`, `radius`, `height` (14), `flat` (0), `rough` (0) | A smooth rounded hill with a wobbly outline. Radius 40 to 100, height 8 to 25. Slopes stay walkable when height is under a third of the radius. |
| `mountain` | as hill, height 60, rough 0.35 | A craggy peak. Radius 80+, height 40 to 90. Steep parts become rock, the top snow if `snow` is set. |
| `mesa` | as hill, height 24, flat 0.72 | A flat top with cliff sides (rock). A lookout, a fortress, an unreachable backdrop. Needs a ramp (a `flatten` strip or a path) to be climbed. |
| `dip` | as hill, height -8, flat 0.3 | A hollow, crater or valley floor. |
| `lake` | `at`, `radius`, `depth` (8), `shore` (8), `level`, `bed`, `beach` | A basin of Terrain water with a beach. The level defaults to just under the lowest point of the rim, so the water never needs a dam. Radius 30 to 70; depth 6+ to swim, under 3 to wade. |
| `river` | `points`, `width` (12), `depth` (4), `bank` (8), `level`, `joins` | A channel along a polyline, filled with water at one level (the lowest point along it, or `joins: "<lake id>"` to share a lake's level). Width 10 to 20. Through high ground it cuts a gorge. |
| `flatten` | `at` + `radius`, or `rect`, or `at` + `size` + `rot`; `height`, `blend` (12), `material` | A level pad blended into the slope round it. Under every building, camp, plaza, arena and spawn. `height` defaults to the ground at its centre. |
| `field` | as flatten, `rows` (4), `material` (`Mud`), `alt` (`LeafyGrass`), `flatten` | A plowed field: level, with alternating rows across its local x. Turn it with `rot`. |
| `outcrop` | `at`, `radius` (8), `height` (5), `material` (`Rock`) | A rocky knoll. Put a `rocks` set or ore on it; they sink in and look embedded. |
| `paint` | `material`; `at` + `radius` or `rect`; optional noise `scale`, `above`, `below` | Paints the surface: a plaza, a sandy clearing, a scorched area. |
| `patches` | `material`, `scale` (120), `octaves` (2), `above` (0.55), `below`, `offset` | Noise patches over the whole map: forest floor, meadows, rocky ground. Lower priority than slopes. |

Rules of thumb:
- Terrain voxels are 4 studs: anything narrower than 8 studs won't show. A trail is 6 to 8 wide.
- One big shape per area. A mountain, a lake and a mesa in one 400-stud map is a lot; leave plains between them for play.
- Leave 20+ studs between a pad's edge and a steep feature, or the blend squeezes the slope into a cliff.
- Keep water bodies 25+ studs from hills or they eat into each other.

## 4. Surface materials

Each grid node gets one material, picked in this order:
1. **Painted**: lake and river beds and beaches, path beds, pads with a `material`, fields, outcrops, `paint`.
2. **Slope**: steeper than `rock` (40) is `Rock`; steeper than `dirt` (30) is `Ground`. Cliffs and steep banks look right without painting.
3. **Snow line**: above `snow` is `Snow`.
4. **Patches**, in order.
5. **`ground`** (Grass).

Water is its own material: lakes, rivers and the sea fill with Terrain water up to their level.

## 5. How objects sit on the ground

Item `y` stays relative to the ground; the ground height (`gy`) is added when the layout is loaded, previewed, exported or built.

| Item | Sits on |
|---|---|
| Structures (buildings, furniture, walls, props) | The lowest point under its footprint: nothing floats; the uphill side is buried if the ground isn't level (the checker says so). |
| Nature (trees, bushes) | The ground at its centre. |
| A `group` (a set: camp, ruins, rock cluster) | The lowest base of its members, so the set stays together. |
| `"ground": "high"` (the `bridge` kind) | The highest point under it: spans a river from bank to bank. |
| `"ground": "water"` (the `dock` kind) | The water surface where it stands. |
| `"abs": true` | Its `y` exactly, ignoring the ground. |

`scatter` macros on terrain also keep off paths and drop points in water or on slopes over `maxSlope` (35).

## 6. Recipes

**Village on a slope**: `flatten` radius = the village's radius, blend 16; `paint` Cobblestone radius 10 at the square; houses facing the square; trails out from the pad. The pad also keeps trails from re-levelling the ground under the houses.

**Farm**: `field` 50 to 70 by 40 to 50, `rows` 4, turned 10 to 20 degrees off the grid so it looks surveyed rather than placed; a `row` of fences along one edge with the same `rot`; the farmhouse on its own pad beside it.

**River crossing**: a river through the map, a trail across it, and a `bridge` (26 long) where they cross, turned along the trail. Without the bridge the checker reports the far bank as unreachable.

**Lake with a dock**: `lake` radius 45; a `dock` with its centre 8 to 10 studs inside the shore, pointing out over the water; a trail ending at the shore behind it. The dock sits on the water by itself.

**Canyon**: a `river` through a `mountain`'s foot or between two `mesa`s: the bank band turns into rock walls. Use `relief` 4 so the floor stays walkable.

**Island**: `base` -6, `sea` 0, one or two `hill`s (radius 80+, height 18+) that rise above the water: everything below 0 floods and the shore gets a beach. Leave out `edge`.

**Mountain pass**: two `mountain`s 150 to 200 apart, a `dip` between them, a trail through the dip. Check the steepest-path stat: under 20 degrees for the main route.

`examples/valley.json` uses all of these: mountain, mesa, hill with a watchtower pad, lake with a dock, a river joining it under a bridge, a village pad with a square, a field with a fence, outcrops with rocks, forest scatter and flowers.

## 7. What the checker adds

| Finding | Means | Fix |
|---|---|---|
| `underwater` (error) | an object stands in water | move it to dry ground, or move the water |
| `on-slope` | the ground rises more than 1.5 studs under a structure (one finding per group) | the fix gives a `flatten` feature to add, sized to the object |
| `steep-path` | a path climbs steeper than 30 degrees | run it along the slope (switchbacks), lower the hill, or route round it |

The walkability grid also treats water and slopes steeper than `cliff` (55 degrees) as walls, except under walkable floors (bridges, docks). That is how unreachable mesa tops and cut-off river banks show up as `unreachable`. The stats line adds the ground range and the steepest path. Rules `cliff`, `slopeDrop`, `steepTrail` can be overridden in `rules`.

The Humanoid default MaxSlopeAngle is 89, so players *can* climb most slopes; the limits are about what feels good: main routes under 20 degrees, paths under 30, anything over 55 reads as a wall.

## 8. Building it in Studio and at runtime

| Route | Terrain |
|---|---|
| `export --format script` (`.lua`) | The command-bar script builds the terrain and the objects in one undo step. |
| `.rbxmx` | A model file can't carry terrain voxels: run `<Name>.terrain.lua` in the command bar first, then insert the model (its parts are already at ground height). |
| `.module.luau` + `LayoutBuilder.Build` | Builds the terrain, then the objects. Pass `Terrain = false` to skip writing voxels (when the terrain is already there). |
| `WorldGen.Generate({ seed })` + `LayoutBuilder.Build` | The generated map carries its terrain spec; Build writes it. `flat = true` (or `terrain = false`) for the old flat map. |
| `TerrainGen.Sample(spec, paths)` | Heights without building anything: `sampler:Height(x, z)`, `:Slope`, `:Water`, `:Wet`, `:Material`, `:Ground(x, z, w, d, rot)`, `:Relief(x, z, r)`. Use it to drop NPCs, loot or vehicles on the ground without raycasts, on server or client. |
| `TerrainGen.Write(sampler, { Origin, YieldEvery })` | Writes it with `Terrain:WriteVoxels` in 128-stud chunks. |

- Writing replaces all terrain inside the area, the air above the ground included.
- Terrain is axis aligned: `Origin` can move the layout, not turn it.
- A 640 by 640 map is about 26,000 columns. Sample once and reuse the sampler; write on the server, and pass `YieldEvery` when building during play so the write spreads over frames.
- Store or replicate the spec (or the seed), not the voxels: the same spec gives the same ground everywhere.

## 9. Limits

- It is a height field: no caves, overhangs, arches or tunnels. Carve those by hand in Studio afterwards (Terrain Editor) or with `Terrain:FillBall` with Air.
- Rivers hold one water level along their length: no waterfalls or rapids. Split a river into two rivers at different levels and hide the step with an outcrop.
- The browser preview shades the same grid but not Roblox's terrain rendering (grass blades, water waves, material textures).
- The Luau and JavaScript versions are checked against each other by `selftest.cjs` only when the `luau` CLI is installed; `TerrainGen.Write` itself runs only inside Roblox.
