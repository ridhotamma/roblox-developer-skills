---
name: roblox-layout
description: Design the layout of Roblox rooms, buildings and maps so everything is placed nicely at natural distances, not too tight and not too loose. Covers interiors (restaurant, cafe, shop, house, office), obbies, tycoon plots, cities, simulator hubs and procedural survival maps. Ships a tool that generates a layout, measures it (dead gaps, blocked furniture, unreachable spots, narrow aisles, empty floor, impossible jumps), renders a 3D and floor-plan preview, and exports a Studio model, command-bar script or ModuleScript; plus a Luau kit for runtime generation (seeded world and obby generators, Poisson scatter, build-mode placement rules). Use this whenever the user wants to lay out, furnish, arrange, decorate, block out or generate a room, building, lobby, map, level, obby, tycoon, city or world in Roblox, asks where to put things or how far apart, wants a random or procedural map, or says a build looks cramped, empty, cluttered or unnatural, even if they only say "build me a cafe" or "make my map look better".
---

# Roblox layout

A layout is good when a player never thinks about it: they can see where to go, walk there without squeezing past anything, use every object they reach, and nothing looks stranded or jammed. All of that is measurable in studs. This skill gives the rules, a tool that checks them, and a preview so the user can judge the look before anything is built in Studio.

Do not place objects by guessing coordinates. Generate or write a layout spec, run the checker, fix what it reports, show the preview, then export.

## The rules that make spacing feel natural

1. **A gap is closed or open, never in between.** Two objects either touch (under 0.5 studs: they read as one group) or leave room to walk (3.5 studs or more; 4 is comfortable). Gaps of 1 to 3 studs are the main reason builds look amateur: too narrow to use, too wide to look intentional. The same holds against walls: flush, or 3.5+ away.
2. **Every usable object owns the floor in front of it.** A counter needs 5 studs for customers and 4 behind for staff; a shelf, fridge or wardrobe needs 4; a chair needs 1.5 behind to pull out. Nothing else may sit in that space. The catalog records it per kind (`clear`).
3. **Size the space from what goes in it.** Work out the modules first (a 4-seat table set is 8.1 studs, plus a 4.5 aisle), then choose a room width that fits a whole number of them. Leftover space is shared out evenly, never dumped at one end. A room that is too big for its contents is loose no matter how the contents are arranged.
4. **Aisles have a hierarchy.** Main route (door to counter, spawn to hub) 6 to 8 studs; secondary aisles 4.5 to 5; working gaps 3.5 to 4. If two widths differ, make them differ clearly (by a quarter or more) so it reads as a decision.
5. **Group, then space the groups.** Furniture comes in sets (table and chairs, sofa and coffee table and rug, bed and nightstands). Inside a set things nearly touch; between sets there is an aisle. Single props scattered evenly across a floor look like clutter.
6. **One focal point, visible from the entrance.** The counter, the fountain, the landmark tower, the first jump. The main route leads to it. Everything else is quieter.
7. **Rhythm for built things, irregularity for nature.** Lamps, shelves, tables: equal spacing, aligned, rotated in 90 degree steps. Trees, rocks, bushes: even-but-irregular spacing (Poisson, not random), random rotation, size varied by about 15%, dense in places and open in others.
8. **Scale to the avatar and the camera.** The avatar is about 4 wide and 5 tall; the camera sits 12.5 studs behind it. Doors 6 wide and 8 high, ceilings 14 (under 12 the camera clips), 16 studs is one second of walking. Points of interest sit 6 to 15 seconds apart.

`references/spacing-metrics.md` has every number; `references/composition.md` covers the look (hierarchy, palettes, height, sight lines, dressing).

## Decide the mode

| The user wants... | Do this |
|---|---|
| A room or interior (restaurant, cafe, shop, living, bedroom, office, kitchen, bath) | `rlayout.cjs build <theme>` as a starting point, adjust `--width --depth --palette`, then edit the spec for anything custom. |
| A building with several rooms | `build house` for the pattern (outer walls, partitions, door openings, one recipe per room). For other buildings write the spec with `walls` macros per room: see `references/layout-spec.md`. |
| An obby | `build obby --stages n --jumps n --easy 0.15 --hard 0.85`. Check the difficulty curve in the report. Read `references/genre-layouts.md` (obby) before changing gaps by hand; `rlayout.cjs jump` prints the reach table for the game's WalkSpeed and JumpHeight. |
| A tycoon | `build tycoon --plots n`. The plot layout (line on one side, buttons lined up with what they buy, build area kept open) is the part to adapt. |
| A city or town | `build city --blocks-x n --blocks-z n`. Blocks, lots, setbacks, alleys, kerb furniture rhythm, a park and a plaza. |
| A procedural / random map (survival, exploration) | Preview seeds with `build wilderness --seed n --size n`, then install the kit and call `WorldGen.Generate({ seed = n })` at runtime: it builds the same map as the preview. Read `references/procedural.md`. |
| Something else (lobby, simulator hub, arena, dungeon, custom building) | Write a spec by hand using sets, rows, walls and scatter (start from `examples/simulator_hub.json`), then check and preview it like any other. |
| "Why does my build look cramped / empty / messy?" | Rebuild the area as a spec (measure the real positions) and run `check`; or apply the rules above by eye and explain which one is broken. |
| Players place objects at runtime (build mode, furniture, plots) | The kit's `Spacing.CanPlace` and `Spacing.SnapOffset` enforce rules 1 and 2 live. |

## Workflow

1. **Pin down the brief.** Genre, what the space is for, rough size or player count, style (pick a palette: `rlayout.cjs palettes`), and for outdoor maps how long a walk should feel. Start straight away on a clear request and state what was assumed.
2. **Get a first layout.**
   ```bash
   node <skill>/scripts/rlayout.cjs build restaurant --width 68 --depth 50 --out <project>/layouts
   ```
   `build` writes `<Name>.layout.json` (the spec), `<Name>.preview.html`, and the exports. `new <type> -o file.json` writes only the spec. `kinds`, `sets` and `palettes` list what is available.
3. **Shape it.** Edit the spec: move or add items, sets, rows, walls and scatter areas (format in `references/layout-spec.md`). Keep to the rules above; let `row` and `distribute`-style even spacing do the arithmetic.
4. **Check until it is balanced.**
   ```bash
   node <skill>/scripts/rlayout.cjs check <file>.layout.json
   ```
   The report gives a score, a verdict (too tight / balanced / too loose) and each finding with a fix. Errors (overlap, unreachable, impossible jump) must go. Warnings should go or be a conscious choice; say so when leaving one. Don't chase the score by deleting things: a layout with nothing in it has no dead gaps and is still bad (the looseness findings exist for that reason).
5. **Show it.**
   ```bash
   node <skill>/scripts/rlayout.cjs preview <file>.layout.json -o <file>.preview.html
   ```
   One self-contained HTML file: orbit 3D view with a scale avatar, cutaway walls, a "Player view" from spawn, and a Plan view with walk-width colouring, clearance zones, gap measurements on hover and the findings list. Publish it as an artifact or send the file. Ask for feedback on the look before exporting.
6. **Export to Studio.**
   ```bash
   node <skill>/scripts/rlayout.cjs export <file>.layout.json --out <dir> --format rbxmx,script,module
   ```
   - `.rbxmx`: drag into Studio (or right-click Workspace > Insert from File). Easiest.
   - `.lua`: paste into the command bar; builds the model with one undo step.
   - `.module.luau`: a ModuleScript for `LayoutBuilder.Build` when the layout is built at runtime (one tycoon plot per player, obby stages loaded on demand).
   The result is a blockout: anchored parts in the right place at the right size, grouped as one Model per object in folders (Structure, Furniture, Props, Nature, Buildings, Gameplay), each tagged `Layout_<kind>`. Art replaces blockout object by object without moving anything.

## The kit (runtime)

`assets/kit/shared/Layout/` goes in `ReplicatedStorage.Shared.Layout` (it mirrors the `roblox-project-structure` layout; any location works, the modules only require each other).

| Module | Does |
|---|---|
| `LayoutBuilder.luau` | `Build(layout, { Parent, Origin, Prefabs, SnapToGround, YieldEvery, Catalog })`: builds an exported module or a generated layout. `Prefabs` is a Folder of models named after kinds (`chair`, `oak`): they replace the blockout shapes. `SnapToGround` drops objects onto terrain. |
| `WorldGen.luau` | `Generate({ seed, size, lakes, pois })`: the wilderness generator. Same seed, same map as `rlayout.cjs new wilderness --seed n`. |
| `ObbyGen.luau` | `Generate({ seed, stages, jumps, easy, hard, metrics })`: always-beatable obby courses, same as the preview. |
| `Scatter.luau` | `Poisson` (even-but-irregular fill with spacing that can vary by place), `JitterCell` / `JitterRect` (deterministic per-cell points for endless or streamed worlds), `Occupied` (keep kinds apart). |
| `Spacing.luau` | `CanPlace` (overlap, dead gap, blocked working space, keep-out, bounds), `SnapOffset` (magnetic snap that closes a dead gap), `Distribute`, `FitCount`, `JumpReach`, `JumpBand`, `JumpDifficulty`. |
| `Rng.luau` | Seeded random and noise, identical to the tool's. |
| `LayoutCatalog.luau` | Generated: every kind's blockout parts, size, footprint, role and clearances, plus the sets. Regenerate with `rlayout.cjs build-kit` after editing `scripts/lib/catalog.cjs`. |

Build on the server. A generated map is a pure function of its options, so store or replicate the seed, not the parts. For big maps pass `YieldEvery = 50` so the build spreads over frames, and turn on StreamingEnabled.

```lua
local Layout = ReplicatedStorage.Shared.Layout
local WorldGen, LayoutBuilder, Catalog = require(Layout.WorldGen), require(Layout.LayoutBuilder), require(Layout.LayoutCatalog)
local map = LayoutBuilder.Build(WorldGen.Generate({ seed = seed, size = 640 }), { Parent = workspace, Catalog = Catalog, Prefabs = ServerStorage.Prefabs, SnapToGround = true, YieldEvery = 50 })
```

The modules use string requires (`require("./Rng")`). On tooling that predates them, change those lines to `require(script.Parent.Rng)`.

## Limits to be honest about

- The output is a blockout and a plan, not finished art. It fixes placement and proportion; models, textures and lighting come after (see `roblox-atmosphere` for the mood).
- The checker reasons in 2D footprints on one floor level. Multi-storey buildings are checked one floor per spec; ramps and stairs between levels are not routed.
- The preview approximates Roblox rendering. Wedge parts (pitched roofs, tents) follow Roblox's wedge orientation but have not been verified in Studio by this skill: glance at roofs after import.
- Generators give a sound starting point per genre, not the only good layout. Expect to adjust sizes, counts and the focal point to the game.
- `Spacing.CanPlace` is a rule check, not pathfinding: for "can players still reach everything" after a player places an object, also test a path with PathfindingService.
- The kit is a reviewed starting point, not battle-tested in a live game.

## References

- `references/spacing-metrics.md` — every number in studs: avatar and camera, doors and ceilings, aisles, clearances per object, seating, shops, kitchens, streets, lots, plots, nature spacing, walking times, jump table.
- `references/composition.md` — making it look good: focal point, hierarchy, grouping, rhythm and variation, alignment, height and skyline, palettes (60-30-10), dressing, the first view from spawn, common mistakes.
- `references/genre-layouts.md` — per genre: obby, tycoon, restaurant and shop, house and interiors, city, simulator hub, survival map, horror, with the layout pattern and the numbers that matter.
- `references/procedural.md` — generating maps at runtime: the layer order, Poisson and jittered scatter, noise for biomes, points of interest and trails, fairness, chunks and streaming, seeds, using the kit.
- `references/layout-spec.md` — the JSON spec, the macros (set, row, walls, scatter), custom kinds, the checker's findings and how to fix each, the CLI.
