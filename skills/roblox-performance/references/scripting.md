# Scripting performance (Luau)

Pure Luau maths is fast. What costs on Roblox is everything around it: calls into the engine (each property read or write crosses into C++), creating and destroying Instances, property changes that replicate or rebuild render data, allocation that feeds the garbage collector, and work that runs every frame for every object. Most script lag comes from doing reasonable work far too often.

## The frame budget

At 60 FPS a frame is 16.7 ms, shared by rendering, physics, the engine and all scripts. On a phone the whole frame may already be 25 ms before your code runs. A reasonable script budget for all your per-frame client code is 2–4 ms on a desktop, less on phones; for the server, keep total Luau work well under 10 ms per frame so the heartbeat stays near 60 with a full server.

## 1. Events, not polling

| Polling | Event instead |
|---|---|
| `while true do if part.Transparency == 1 then ... end task.wait() end` | `part:GetPropertyChangedSignal("Transparency"):Connect(...)` |
| Checking an attribute every frame | `instance:GetAttributeChangedSignal("State"):Connect(...)` |
| Re-scanning a folder for new things | `folder.ChildAdded` / `ChildRemoved`, or CollectionService `GetInstanceAddedSignal(tag)` |
| Checking `Humanoid.Health <= 0` | `humanoid.Died` / `HealthChanged` |
| Checking whether a player is in a zone every frame | A zone check from one loop on a timer (e.g. 5–10 Hz) with `GetPartBoundsInBox`, or a zone library |
| `.Changed` (fires for every property) | `GetPropertyChangedSignal("OneProperty")` |

When something must poll, poll at the slowest rate that still feels right (a shop-proximity prompt at 5 Hz, a minimap at 10 Hz) and spread the checks across frames.

## 2. One loop per system, not per object

The single biggest pattern fix. Instead of every coin, door, light, NPC or projectile connecting its own `Heartbeat`:

```lua
-- Bad: 500 coins = 500 connections, all running every frame
for _, coin in CollectionService:GetTagged("Coin") do
	RunService.Heartbeat:Connect(function(dt)
		coin.CFrame *= CFrame.Angles(0, dt, 0)
	end)
end
```

```lua
-- Good: one loop over a set, with a time budget and distance-based rates (kit Scheduler)
local coins = Scheduler.new("Coins.Spin", {
	BudgetMs = 0.5,
	Step = function(coin: BasePart, dt: number)
		coin.CFrame *= CFrame.Angles(0, dt * 2, 0)
		local far = (coin.Position - camera.CFrame.Position).Magnitude > 120
		return if far then 0.5 else nil -- far coins update twice a second
	end,
})
CollectionService:GetInstanceAddedSignal("Coin"):Connect(function(coin) coins:Add(coin) end)
CollectionService:GetInstanceRemovedSignal("Coin"):Connect(function(coin) coins:Remove(coin) end)
```

For hundreds of moving anchored parts, collect the parts and CFrames and call `workspace:BulkMoveTo(parts, cframes, Enum.BulkMoveMode.FireCFrameChanged)` once per frame; it is much faster than setting `CFrame` part by part. Spinning coins and bobbing pickups belong on the client: the server only decides who collected what.

## 3. The task library

- `task.wait`, `task.spawn`, `task.defer`, `task.delay` replace `wait`, `spawn`, `delay` (which are throttled, wait at least ~30 ms and are deprecated).
- `task.defer(fn)` runs at the end of the current resumption cycle: use it to **coalesce** many changes into one update ("mark dirty; flush once"):

```lua
local dirty = false
local function markDirty()
	if dirty then return end
	dirty = true
	task.defer(function()
		dirty = false
		rebuildInventoryUi() -- once, even if 50 items changed this frame
	end)
end
```

- Don't create a thread per object that loops forever (`task.spawn(function() while true do ... end end)` for each NPC). That's the per-object loop again, plus threads that keep running after the object is gone.

## 4. Allocation and the garbage collector

Short-lived tables, closures and strings created every frame pile up until the GC runs (`LuaGC` in the MicroProfiler, often as periodic hitches).

- Reuse tables in hot paths: `table.clear(t)` keeps the capacity. Pre-size with `table.create(n)`.
- Create `RaycastParams` / `OverlapParams` once; update `FilterDescendantsInstances` only when the list changes.
- Don't create closures per call in hot code (`for ... do task.delay(0.1, function() ... end) end` for every bullet).
- Build strings with `table.concat` or `buffer`, not `..` in a loop.
- `Vector3`, `CFrame` and `Color3` maths is native and cheap; you don't need to avoid it.
- Queues: `table.remove(t, 1)` shifts every element. Keep head/tail indices or a ring buffer (kit `RollingStats` is one).
- Instances are the most expensive allocation: pool them (kit `Pool`) instead of `Clone()`/`Destroy()` many times a second.

## 5. Caching engine lookups

```lua
-- in a hot loop, this does several engine calls per iteration:
for _, npc in npcs do
	local d = (npc.Model.PrimaryPart.Position - workspace.CurrentCamera.CFrame.Position).Magnitude
end

-- read once, keep references:
local cameraPosition = camera.CFrame.Position
for _, npc in npcs do
	local d = (npc.Root.Position - cameraPosition).Magnitude -- npc.Root cached when the NPC was added
end
```

- `game:GetService` once at the top of the script.
- Cache Instance references (`FindFirstChild` chains) when the object is set up, not on every use.
- Read a property once into a local when you use it several times.
- Keep config lookups (`Config.Items[id].Price`) out of inner loops when the value doesn't change.

## 6. Spatial queries instead of all-pairs checks

- `workspace:Raycast`, `Spherecast`, `Blockcast`, `GetPartBoundsInRadius`, `GetPartBoundsInBox`, `GetPartsInPart`. Pass params with a tight filter (collision groups or `FilterDescendantsInstances`) and a `MaxParts` when you only need a few.
- Raycasts are cheap individually (microseconds) but thousands per frame add up; budget them per system.
- Everyone-vs-everyone checks are O(n²): 100 enemies × 100 towers = 10,000 distance checks per update. Bucket entities into a grid and compare only neighbouring cells:

```lua
local CELL = 32
local grid: { [Vector3]: { any } } = {}

local function cellOf(position: Vector3): Vector3
	return Vector3.new(position.X // CELL, 0, position.Z // CELL)
end

local function rebuild(entities)
	table.clear(grid)
	for _, e in entities do
		local key = cellOf(e.Position)
		local bucket = grid[key]
		if bucket == nil then
			bucket = {}
			grid[key] = bucket
		end
		table.insert(bucket, e)
	end
end

local function near(position: Vector3, radius: number, out: { any })
	table.clear(out)
	local c = cellOf(position)
	local r = math.ceil(radius / CELL)
	for x = -r, r do
		for z = -r, r do
			local bucket = grid[c + Vector3.new(x, 0, z)]
			if bucket then
				for _, e in bucket do
					if (e.Position - position).Magnitude <= radius then
						table.insert(out, e)
					end
				end
			end
		end
	end
	return out
end
```

(Vector3 keys work because Vector3 is a value type in Luau; use string keys if you prefer.)

## 7. Server-side habits

- The server simulates rules, not visuals. Tweens, spinning, bobbing, colour pulses, particles, sounds and camera effects run on clients; the server sends an event or sets an attribute once.
- Per-player loops that run every frame on the server multiply by player count. Prefer events and timers; stagger per-player timers so they don't all fire on the same frame (`Scheduler.Every` adds random offset).
- DataStore, HTTP and MessagingService calls yield; never call them per frame or per remote without a cooldown.
- `PathfindingService:ComputeAsync` is expensive: compute when the goal changes meaningfully, cache paths, stagger recomputes across NPCs, and use simple steering for open ground.

## 8. Native code generation

- `--!native` at the top of a script, or the `@native` attribute on a single function, compiles that Luau to machine code where the platform supports it (servers, and an expanding set of clients; check the current docs). Elsewhere it silently falls back to the interpreter, so it's safe to add.
- It helps code that does a lot of Luau maths and table work: procedural generation, pathfinding grids, physics/ballistics maths, noise, compression, custom serialisation. It does little for code that mostly calls engine APIs.
- Type annotations help the compiler (`: number`, `: Vector3`, `: buffer`). Native code uses memory and has a size budget per experience: put it on the few hot modules, not everywhere.

## 9. Parallel Luau

For heavy, independent work per entity (sensing for hundreds of NPCs, procedural terrain chunks, crowd steering):

- Put scripts under **Actor** instances. In a handler, `task.desynchronize()` (or `:ConnectParallel`) moves into the parallel phase; `task.synchronize()` moves back.
- In the parallel phase you can read most of the world and do raycasts and spatial queries, but writing most Instance properties requires synchronising first. Compute in parallel, apply results in serial.
- Actors don't share Luau state; pass data with messages (`Actor:SendMessage`) or `SharedTable`.
- Split work into a handful of actors (one per few dozen entities), not one actor per entity.
- It only pays when the parallel part is substantial; measure before and after.

## 10. Avoiding hitches (one long frame)

- Loading a map, building a big UI or cloning a large model in one frame shows as a hitch. Spread it: process N items, `task.wait()`, continue; or budget with `os.clock()`:

```lua
local deadline = os.clock() + 0.004 -- 4 ms per frame
for i, item in items do
	build(item)
	if os.clock() > deadline then
		task.wait()
		deadline = os.clock() + 0.004
	end
end
```

- Timers created at the same moment fire on the same frame forever after; add a random offset.
- Periodic GC hitches mean too much short-lived allocation (section 4).

## 11. Benchmark checklist

Before keeping an optimisation: it shows up in the MicroProfiler or `Profiler.Report`, it was measured at realistic scale, and the gain is worth the complexity. If a change saves microseconds in a system that runs once a second, revert it in favour of the clearer code.
