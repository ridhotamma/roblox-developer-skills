# The layout spec, the checker and the CLI

## Contents
1. Coordinates
2. The spec file
3. Items
4. Macros: set, row, walls, scatter
5. Zones, paths, points of interest, route
6. Custom kinds and palettes
7. What the checker reports and how to fix it
8. Rules per layout type
9. CLI reference

---

## 1. Coordinates

Same as Roblox: studs, +Y up. In the plan view +X is right and +Z is down, so "north" is -Z.

- `pos` is `[x, y, z]`: the centre of the object's footprint, with **y at its base** (0 for something standing on a floor whose top is at 0). The exporters convert to Roblox part centres.
- `rot` is yaw in degrees, the same as `CFrame.Angles(0, math.rad(rot), 0)`. An object's **front is its local -Z**: `rot` 0 faces north (-Z), 90 faces west (-X), 180 faces south (+Z), 270 faces east (+X).
- A chair's front is where the sitter faces. A shelf's or counter's front is the customer side. A bed's head is at its back.
- `size` is `[width, height, depth]`: width along local X, depth along local Z.

To put something with its back against a wall: north wall (low z) `rot` 180, south wall 0, west wall (low x) 270, east wall 90.

## 2. The spec file

```json
{
  "name": "Corner Cafe",
  "type": "interior",
  "palette": "cozy",
  "seed": 1,
  "spawn": [20, 0, 33],
  "focus": [20, 4, 6],
  "metrics": { "walkSpeed": 16, "jumpHeight": 7.2, "gravity": 196.2 },
  "bounds": { "min": [-2, -2], "max": [42, 38] },
  "rules": { "empty": 20 },
  "zones": [], "paths": [], "pois": [], "route": [],
  "kinds": {},
  "items": []
}
```

| Field | Meaning |
|---|---|
| `type` | `interior`, `building`, `obby`, `tycoon`, `city`, `wilderness` or `custom`: picks the checker's thresholds (section 8). |
| `palette` | A palette name or a table of colour roles (section 6). |
| `spawn` | Where the player starts: the checker measures routes from here and the preview draws the avatar here. |
| `focus` | What the Player view looks at: the focal point. |
| `bounds` | Optional; worked out from the items when missing. |
| `rules` | Optional overrides of the type's thresholds: `pass`, `main`, `empty`, `coverage`, `cell`. Use sparingly and say why. |
| `seed` | Seeds `scatter` macros. |

## 3. Items

```json
{ "kind": "counter", "pos": [20, 0, 9], "rot": 180, "group": "service", "label": "Order here" }
```

| Field | Meaning |
|---|---|
| `kind` | A catalog kind (`rlayout.cjs kinds`), a custom kind, or any name for a plain block. |
| `pos`, `rot` | Section 1. |
| `id` | Optional, auto-numbered. Needed for obby `route`. |
| `group` | Objects in one group may sit at any distance from each other (a table and its chairs). Sets assign one automatically. |
| `scale` | Uniform scale for a catalog kind (trees: 0.8 to 1.25). |
| `size` | Overrides the catalog size (the parts stretch), or sizes a plain block. |
| `color`, `material`, `shape` | For plain blocks: a hex colour or a palette role (`"grass"`, `"wall"`), a Roblox material name, and `block`, `cylinder`, `ball` or `wedge`. |
| `role` | Overrides the kind's role: `floor`, `wall`, `window`, `ceiling`, `furniture`, `prop`, `decor`, `light`, `nature`, `building`, `platform`, `hazard`, `marker`, `structure`. Role decides the export folder and how the checker treats it. |
| `walkable` | True for things players walk over (rugs, pads, road paint): they never block. Defaults to true for `floor`, `decor` and `marker`. |
| `clear` | Free floor the object needs, `{ "f": 4, "b": 0, "l": 0, "r": 0 }`; overrides the catalog. |
| `label`, `zone`, `tags` | Carried into the export as attributes and `Layout_<tag>` tags. Tag `checkpoint` marks obby checkpoints. |
| `parts` | Inline geometry for one-off objects: a list of `{ "s": shape, "p": [x, y, z], "z": [w, h, d], "c": colour, "m": material, "r": yaw }`, positions relative to the base centre. |

A plain block with no catalog kind:

```json
{ "kind": "stage", "role": "floor", "pos": [0, 0, -30], "size": [40, 2, 20], "color": "#3B3F46", "material": "WoodPlanks" }
```

Things above 6.5 studs (pendant lights, signs) don't block movement. Things stacked on top of each other aren't compared as neighbours.

## 4. Macros: set, row, walls, scatter

Macros are items that expand into several items. They do the arithmetic that keeps spacing even.

**set**: a ready-made group (`rlayout.cjs sets`).

```json
{ "set": "dining4", "pos": [12, 0, 20], "rot": 0 }
{ "set": "lounge", "pos": [8, 0, 30], "rot": 270, "opts": { "single": true } }
```

Sets: `dining2`, `dining4`, `dining6`, `booth`, `lounge`, `desk_set`, `desk_pair`, `meeting`, `bed_set`, `bar_stools`, `park_bench`, `camp`, `rocks`, `ruins`. A set's back is +Z, like a single object: `booth`, `bed_set` and `lounge` (sofa side) go back-to-wall with the wall rotations from section 1.

**row**: evenly spaced copies along a line.

```json
{ "row": { "kind": "lamp_post", "from": [0, 10], "to": [120, 10], "count": 4, "rot": 0 } }
{ "row": { "set": "dining4", "from": [10, 20], "to": [50, 20], "spacing": 12.6 } }
```

`count`, or `spacing` (the count is rounded from the length). The first and last sit on the end points; `"ends": false` insets them by half a step instead. Optional `y`, `rot`, `size`, `group`.

**walls**: a rectangular room with openings, plus its floor.

```json
{ "walls": { "rect": [0, 0, 40, 36], "height": 14,
    "openings": [
      { "side": "south", "at": 0.5, "width": 7, "kind": "door" },
      { "side": "east", "at": 0.3, "width": 6, "kind": "window" },
      { "side": "west", "abs": 22, "width": 9, "kind": "arch" } ] } }
```

`rect` is the inside of the room `[x0, z0, x1, z1]`; walls are 1 thick outside it. `at` is a fraction along the wall, or `abs` an absolute x (north and south walls) or z (east and west). Kinds: `door` (8.5 high), `arch` (10), `window` (sill 3.5, head 9.5, glass). Options: `sides` (a subset of north, south, east, west, for partitions), `flush` (don't extend into corners: use for interior partitions), `floor: false`, `ceiling: true`, `thickness`, `color`.

For a building, write one `walls` for the outside, then partitions as `walls` with a single side and `flush`, as the house generator does (`scripts/lib/interior.cjs`, `house`). Keep 5 studs clear inside every opening.

**scatter**: Poisson fill of an area.

```json
{ "scatter": { "kinds": ["oak", "pine"], "rect": [0, 0, 200, 200], "spacing": 14,
    "avoid": [[100, 100, 30], [40, 160, 18]], "seed": 3 } }
```

`rect` or `circle: [x, z, r]`; `spacing` is the minimum distance between results; `avoid` is a list of `[x, z, radius]` circles to stay out of (clearings, paths, buildings); rotation and scale are randomised.

## 5. Zones, paths, points of interest, route

```json
"zones": [
  { "id": "dining", "label": "Dining", "rect": [0, 16, 40, 30], "main": true },
  { "id": "plaza", "label": "Plaza", "circle": [0, 0, 30], "open": true },
  { "id": "lake", "label": "Lake", "circle": [200, 80, 50], "kind": "water" }
],
"paths": [ { "id": "trail1", "kind": "trail", "width": 7, "points": [[0, 0], [40, 12], [90, 10]] } ],
"pois": [ { "id": "tower", "label": "Watchtower", "pos": [300, 120] } ],
"route": ["p1", "p2", "p3"]
```

- **Zones** label areas in the preview, become invisible tagged parts in Studio, and tell the checker things: `main` (must be reachable by a main-route width), `open` (deliberately empty: plazas, arenas, build areas, clearings), `kind: "water"` (not walkable), `access: false` (don't test reachability).
- **Paths** are drawn and exported as flat strips (`trail` earth, anything else paving). They don't block.
- **Points of interest** must be reachable and are checked for spacing (6 to 15 seconds apart).
- **Route** is the ordered list of platform ids for an obby. Each consecutive pair is rated as a jump.

## 6. Custom kinds and palettes

Add kinds for one layout under `kinds`, in the catalog's format:

```json
"kinds": {
  "arcade_cabinet": { "size": [3, 7, 3], "role": "furniture", "clear": { "f": 3 },
    "parts": [ { "s": "block", "p": [0, 3.5, 0.3], "z": [3, 7, 2.4], "c": "dark", "m": "SmoothPlastic" },
               { "s": "block", "p": [0, 5, -0.95], "z": [2.4, 2, 0.2], "c": "accent", "m": "Neon" } ] }
}
```

To add a kind for every layout, edit `scripts/lib/catalog.cjs` and run `rlayout.cjs build-kit` to regenerate the kit's catalog. Give every usable object a `clear`; that is what makes the checker useful.

Part colours are palette roles or hex. A custom palette overrides roles on top of a base:

```json
"palette": { "base": "modern", "accent": "#FF5A5F", "fabric": "#2E4057", "wall": "#F7F4EF" }
```

Roles: `wall`, `floor`, `trim`, `wood`, `woodDark`, `fabric`, `accent`, `accent2`, `pot`, `metal`, `stone`, `glass`, `light`, `white`, `dark`, and outdoors `grass`, `leaf`, `leafDark`, `leafAlt`, `trunk`, `rock`, `rockDark`, `water`, `sand`, `dirt`, `road`, `sidewalk`, `line`.

## 7. What the checker reports and how to fix it

Errors must be fixed. Warnings should be fixed or justified. Notes are polish.

| Finding | Means | Fix |
|---|---|---|
| `overlap` (error) | two solid objects intersect | separate them: touching or 3.5+ apart |
| `unreachable` (error) | no walkable way from spawn to the object's front, a zone or a POI | open a 3.5+ route; turn the object to face open floor |
| `too-far`, `too-high` (error) | an obby jump nobody can make | shorten to the "hardest fair" value in the message |
| `dead-gap` | 0.6 to 3.4 studs between two objects | close it or open it to 3.5+ |
| `off-wall` | an object floats 0.6 to 3.4 studs off a wall | push it flush or pull it out |
| `blocked` | something sits in the floor an object needs | move the intruder, or rotate the object |
| `narrow-route` | the way to a zone or POI pinches below the wanted width | widen the pinch point (the Plan view's Walk width shows where) |
| `crowded` / `sparse` | floor coverage outside the band | remove pieces or enlarge; shrink the space or add groups |
| `empty` | a circle of empty floor larger than the type allows | give it a job, mark it as an open zone if deliberate, or shrink the space |
| `low-ceiling`, `small-door` | camera or avatar won't fit | 12+ ceilings, doors 6 x 8 |
| `isolated`, `crowded-poi` | POI over 16 s or under 4 s from its nearest neighbour | add something in between, or merge |
| `pixel-jump` | possible but frame-perfect | shorten slightly |
| `no-checkpoint` | 12+ jumps without one | add a checkpoint platform |
| `spike`, `hard-start` | difficulty curve jumps or starts too high | reorder stages or ease the gaps |
| `uneven` (note) | a row's gaps differ slightly | use one gap, or make the difference obvious |
| `near-aligned` (note) | two objects are a fraction of a stud off one line | snap to the same coordinate |
| `copy-paste` (note) | many natural objects share rotation or scale | randomise |
| `clumped` (note) | two natural objects jammed together | nudge or remove one |
| `long-walk` (note) | farthest point of an interior is over 12 s from the door | bring key things closer or shrink |

The verdict (too tight, balanced, too loose) comes from which kinds of findings dominate. The stats line gives floor coverage, the narrowest route, the median gap between neighbours and the widest empty circle: read them even when there are no findings.

`check --json` returns everything, including `near` (each object's closest neighbours and gaps) and `routes` (width and walking distance to every target).

## 8. Rules per layout type

| Type | Walkable gap | Main route | Empty circle over | Coverage band | Dead-gap rule |
|---|---|---|---|---|---|
| interior | 3.5 | 6 | 17 | 14 to 50% | yes |
| building | 3.5 | 5 | 17 | 12 to 50% | yes |
| tycoon | 4 | 8 | 48 | 2 to 50% | yes |
| city | 4 | 8 | 84 | 15 to 70% | yes |
| wilderness | 4 | 6 | 110 | 0.2 to 30% | no (nature may sit close) |
| custom | 3.5 | 6 | 40 | 3 to 55% | yes |
| obby | jumps only: `route` is rated, nothing else | | | | |

## 9. CLI reference

```bash
node scripts/rlayout.cjs new <type> [options] [-o layout.json]
node scripts/rlayout.cjs check <layout.json> [--json] [--all]
node scripts/rlayout.cjs preview <layout.json> [-o preview.html]
node scripts/rlayout.cjs export <layout.json> [--out dir] [--format rbxmx,script,module]
node scripts/rlayout.cjs build <type> [options] --out dir
node scripts/rlayout.cjs kinds [name]
node scripts/rlayout.cjs sets
node scripts/rlayout.cjs palettes
node scripts/rlayout.cjs jump [rise ...] [--speed n] [--height n] [--gravity n]
node scripts/rlayout.cjs build-kit
node scripts/selftest.cjs
```

Types: `restaurant`, `cafe`, `shop`, `living`, `bedroom`, `office`, `kitchen`, `bath`, `house`, `obby`, `tycoon`, `city`, `wilderness`.

Options: `--seed`, `--name`, `--palette`; rooms `--width --depth --height --ceiling`; obby `--stages --jumps --easy --hard`; tycoon `--plots --plot-width --plot-depth`; city `--blocks-x --blocks-z --block-width --block-depth --road`; wilderness `--size --pois --lakes`.

`check` exits with status 1 when there are errors, so it can gate a build script. Node 18+ is the only requirement; `selftest.cjs` also compares the kit with the tool when the `luau` CLI is installed.
