# Procedural maps

How to generate a map at runtime that still looks placed by hand, and how the kit does it.

## Contents
1. The idea: layers, each avoiding the last
2. Seeds and determinism
3. Scatter: Poisson, not random
4. Noise for biomes and density
5. Points of interest and trails
6. Fairness
7. Building it: LayoutBuilder, prefabs, terrain
8. Chunks, endless worlds and streaming
9. Procedural rooms, obbies and plots
10. Tuning checklist

---

## 1. The idea: layers, each avoiding the last

Random placement looks random. Generated maps look designed when they are built in the order a designer would work, with every layer keeping clear of what is already there:

1. **Water and terrain features** (lakes, cliffs): the big shapes everything else works around.
2. **Places**: spawn, points of interest, each with a clearing.
3. **Routes** between places.
4. **Resources**, spread for fairness.
5. **Big decoration** (trees, rock clusters) by biome.
6. **Small decoration** (bushes, flowers) in what is left.

Because trees are placed after trails and clearings and are told to keep away from them, nothing ever has to be deleted or fixed afterwards. `WorldGen.luau` is exactly this list.

## 2. Seeds and determinism

`Rng.new(seed)` gives the same numbers on every machine, and `Rng.Noise(seed)` the same noise field. `WorldGen.Generate({ seed = n })` is a pure function of its options, so:

- **Store the seed, not the map.** A private-server world, a daily map or a player's island is one number in a DataStore.
- **Preview before shipping.** `node scripts/rlayout.cjs build wilderness --seed n` shows the same map the server will build (the kit is a port of the tool's generator and the self-test compares them object by object). Reject seeds you don't like, or keep a list of good ones.
- Don't call `math.random` or `Random.new()` inside generation, and don't depend on iteration order of dictionaries: either breaks reproducibility.
- Generate on the server. Clients receive parts through normal replication or streaming.

## 3. Scatter: Poisson, not random

Uniform random points clump and leave holes. A grid is even but obviously artificial. Poisson-disc sampling gives every point a minimum distance from its neighbours with no pattern, which is how trees in a wood and tables in a food court both look.

```lua
local points = Scatter.Poisson(rng, x0, z0, x1, z1, function(x, z)
	return spacingAt(x, z) -- studs between neighbours here; 0 = place nothing
end, { rMin = 10, rMax = 44 })
```

- The callback makes spacing vary by place: 10 in deep forest, 28 at its edge, 44 in a meadow, 0 on trails, in clearings and in water. One call produces forest that thins out naturally.
- `rMin` and `rMax` must bracket what the callback returns.
- Keep different kinds apart with `Scatter.Occupied`: add each placed thing with a radius, and return 0 from later callbacks where `occupied:Any(x, z, margin)` is true.
- Typical spacings are in `references/spacing-metrics.md` section 11.

After placing: random yaw for every natural object, scale between 0.8 and 1.25, and clusters for rocks (one big, two small, touching).

## 4. Noise for biomes and density

`noise(x, z, scale, octaves)` returns 0..1 and changes smoothly; `scale` is the size of its features in studs.

- **Forest density**: scale 150 to 200, 3 octaves. Above 0.5 is forest (denser as it rises), 0.43 to 0.5 the thinning edge, below that meadow.
- **Rocky ground**: a second field (offset the coordinates), scale 130; ore and rock clusters above 0.55 to 0.6.
- **Species**: a third, slow field (scale 240) so pines and oaks form stands instead of alternating.
- Thresholds set the proportions: raising the forest threshold from 0.5 to 0.55 turns a wooded map into parkland.
- Blend at the borders. A biome that ends on a hard line looks generated; the edge band with its wider spacing is what sells it.

For height, use Roblox Terrain with its own noise or a hand-made heightmap and build with `SnapToGround = true`; the layout stays 2D.

## 5. Points of interest and trails

- **Count**: about one per 60,000 square studs (7 on a 640 map), plus the spawn camp.
- **Spacing**: Poisson with a 150 stud radius gives 6 to 15 seconds of walking between neighbours. Keep them 130+ from spawn so the first trip feels like going somewhere, and 70 from the map edge.
- **Each gets a clearing** (radius 20 to 28) registered before any scatter, and a small composed group: a tower, a ruin made of two walls and three pillars, a ring of standing stones.
- **Trails**: connect everything with a minimum spanning tree (no place is cut off), then add a few extra edges between near neighbours so there are loops. Bend each trail with noise (offset the midpoints sideways by up to 15% of its length) and push points out of lakes. Trails are 7 wide and scatter stays 5 clear of them.
- **A landmark**: at least one tall thing visible over the trees.

## 6. Fairness

Looks aside, a generated map has to be fair on every seed:

- **Guaranteed start**: place wood, stone and food by hand within 50 studs of spawn before any random scatter.
- **Resources by Poisson**, not by chance per tree: spacing guarantees both a minimum distance (no pile of ore in one corner) and coverage (no quarter of the map without any).
- **Reachability**: nothing important on an island or behind water. Docks and POIs are placed on the land side; the checker's reachability test catches the rest in preview.
- **Test many seeds** in the tool (`for seed in 1..20`) and read the reports: POI spacing, widest empty area, unreachable targets.

## 7. Building it: LayoutBuilder, prefabs, terrain

```lua
local model = LayoutBuilder.Build(layout, {
	Parent = workspace,
	Catalog = require(Layout.LayoutCatalog),
	Prefabs = ServerStorage.Prefabs, -- models named "oak", "pine", "rock_big", "cabin"...
	SnapToGround = true,
	YieldEvery = 50,
})
```

- Without `Prefabs` you get the blockout shapes: good for prototyping and for reading the layout.
- A prefab must face -Z and have its pivot at the centre of its base. It is cloned, scaled by the object's scale and pivoted into place. Give trees 2 to 4 variants by naming kinds `oak`, `oak2` and choosing between them in your own pass over `layout.items` before building.
- Every object is a Model with `Kind`, `Role` and `Zone` attributes and a `Layout_<kind>` tag: bind gameplay with CollectionService (`Layout_ore_node` becomes a mineable node, `Layout_berry_bush` a food source).
- Zones are built as invisible, non-colliding parts tagged `LayoutZone` (the clearings, the lakes): use them for atmosphere zones, safe areas or minimap labels.
- `model:GetAttribute("Spawn")` is where to put the SpawnLocation.
- Performance: a 640 map is about 1,700 objects and several thousand parts as blockout. Use real meshes (one MeshPart per tree), anchor everything, turn off CanCollide, CanTouch and CanQuery on decoration, and enable StreamingEnabled. See `roblox-performance`.

## 8. Chunks, endless worlds and streaming

`WorldGen` makes a bounded map in one go. For worlds too big to build at once, generate per chunk with placement that doesn't depend on the order chunks load:

```lua
for _, p in Scatter.JitterRect(seed, chunkX0, chunkZ0, chunkX1, chunkZ1, 14, function(x, z)
	return densityAt(x, z) -- 0..1 chance that a cell holds a tree
end) do
	placeTree(p.x, p.z, p.u * 360) -- u is a spare random number per point
end
```

`JitterCell` hashes (seed, cell) into one point per grid cell, pushed off-centre. Neighbouring chunks agree with no shared state, spacing can never drop below about a quarter of the cell, and there is no visible grid. It is less even than Poisson; use it for decoration and keep Poisson for bounded areas and for anything that affects fairness.

Decide points of interest per large region the same way (hash the region to choose whether and where it has one), then let chunk scatter avoid them.

Unload chunks by destroying their model; regenerate from the seed when players return. Persist only what players changed.

## 9. Procedural rooms, obbies and plots

- **Obby**: `ObbyGen.Generate({ seed, stages, jumps, easy, hard, metrics })`. Endless mode: generate a few stages ahead with `origin` set to the last checkpoint and a new seed per section. Pass `metrics` if the game changes WalkSpeed, JumpHeight or Gravity, or the gaps will be wrong.
- **Rooms**: the tool's room recipes run at design time. For runtime rooms (roguelike dungeons), design a handful of room layouts in the tool, export each as a module and pick between them by seed; connect doors on a grid. Hand-checked variety beats live generation for interiors.
- **Player building**: `Spacing.CanPlace(footprint, others, { bounds, keepOut })` returns whether a placement is allowed and why not (overlap, dead-gap, blocks, blocked, keepout, outside). Show the ghost red with the reason, and offer `Spacing.SnapOffset` to close a dead gap automatically. Footprints and clearances for catalog kinds are in `LayoutCatalog.info`.
- **Tycoon plots**: design one plot, export it as a module, build one per player with `Origin` set to their plot's CFrame.

## 10. Tuning checklist

- Same seed twice gives the same map; different seeds look different.
- Wood, stone and food within 50 studs of spawn on every seed tried.
- Every point of interest reachable; none closer than 80 or farther than 260 from its nearest neighbour.
- No tree or rock on a trail or in a clearing.
- Forests thin at the edges; no straight biome borders; no tree rows.
- A landmark visible from spawn or from the first trail.
- Build time acceptable with `YieldEvery`; part count within budget for phones.
