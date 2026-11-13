# Network, physics and streaming

Server lag and network lag look the same to players (rubber-banding, delayed hits, doors that open late) but have different causes. Check the server heartbeat first (Developer Console → Server Stats, or the kit's HUD): below ~45 Hz the server is overloaded; at 60 Hz with high or spiky ping, it's replication volume.

## What costs bandwidth

Everything the server changes on a replicated instance is sent to every client that has that instance (with streaming, only clients that have it streamed in):

- **Property changes** made by server scripts: a server-side spinning coin sends a new CFrame 60 times a second to every player.
- **Creating or cloning instances** on the server: the whole subtree is sent. Cloning a 2,000-part map piece for a round is a burst every client must download and build.
- **Physics replication** of moving unanchored parts (positions and velocities from whoever owns them).
- **Attributes** and value objects on replicated instances, every time they change.
- **Remote events**: every fire carries a header plus the arguments.

Measure in the Developer Console → Network (client and server) or Performance Stats "Recv". Rule of thumb: a steady receive of under ~30–50 KB/s per client is comfortable; sustained higher rates, or bursts of hundreds of KB/s during play, cause ping spikes on mobile connections.

## Remote design

- **Send intent and state changes, not streams.** "Started reloading", "door 12 is now open", "wave 5 started at server time T": one message each, and clients animate the rest.
- **Throttle continuous data** (aim direction, vehicle input, cursor, held charge) to 10–20 Hz, send only when it changed by a meaningful amount, and interpolate on the receiver. Never fire per frame.
- **UnreliableRemoteEvent** for continuous, replace-the-last-value data (positions, look direction, effects): no resend and no ordering wait, so a lost packet doesn't stall the rest. Keep payloads small (they are capped well under 1 KB; check the current limit).
- **Batch**: many small fires in one frame → one fire with an array. A client that receives 40 "enemy damaged" events in a frame should receive one event with 40 entries.
- **Shape payloads:** arrays instead of dictionaries with long string keys; numbers instead of strings; Instance references instead of paths. For high-volume data, pack into a `buffer` (`buffer.writeu16`, `writef32`...) to send a few bytes per entity instead of tables.
- **Only to who needs it:** `FireClient` to players near the event (or in the same match/zone) instead of `FireAllClients`.
- **Server time:** send `workspace:GetServerTimeNow()` with an event so every client can play it in sync and fast-forward if late, instead of streaming progress.
- **Don't replicate what clients can compute**: clients know the config tables (shared modules) and can derive cooldown bars, prices and animation timing locally.

### Interpolating throttled state on the client

```lua
-- Receive positions at ~15 Hz, render at full frame rate.
local entities = {} -- id -> { from: Vector3, to: Vector3, t0: number, t1: number, model: Model }

Net.Unreliable("EnemyPositions").OnClientEvent:Connect(function(packet: buffer)
	local now = os.clock()
	local count = buffer.len(packet) // 14
	for i = 0, count - 1 do
		local o = i * 14
		local id = buffer.readu16(packet, o)
		local p = Vector3.new(buffer.readf32(packet, o + 2), buffer.readf32(packet, o + 6), buffer.readf32(packet, o + 10))
		local e = entities[id]
		if e then
			e.from = e.model:GetPivot().Position
			e.to, e.t0, e.t1 = p, now, now + 1 / 15
		end
	end
end)
```

A per-frame loop (one, not per entity) lerps each model from `from` to `to`.

## Physics

- **Anchored parts are free to simulate.** Anchor everything that doesn't need physics. Welded groups form one assembly; each unanchored assembly costs simulation and replication.
- **Network ownership:** the engine gives unanchored assemblies to a nearby player's client to simulate, or keeps them on the server. Server-owned moving parts cost server CPU and are replicated to everyone. Give vehicles and player-held objects to their player (`part:SetNetworkOwner(player)`), keep authority-critical objects on the server (`SetNetworkOwner(nil)`) and validate client-owned motion (see `roblox-security`).
- **Sleeping:** resting assemblies sleep and cost little; constant tiny forces (a VectorForce that is never zero, a constraint fighting gravity) keep them awake.
- **Contacts:** piles of touching unanchored parts (debris, coins, ragdolls) are expensive. Limit debris count, anchor or delete it after it settles, give it `CanCollide = false` against other debris (collision groups).
- **Touched events** need contact processing; turn `CanTouch` off on parts nobody listens to. For zones, use spatial queries on a timer instead of Touched on many parts.
- **Collision geometry:** `CollisionFidelity = Box` or `Hull` for decor; PreciseConvexDecomposition only where players need exact collision.
- **Projectiles:** fast bullets as physics parts tunnel and replicate. Simulate them with raycasts per step (server for hits, client for visuals; the `roblox-combat` skill has a Ballistics module).
- **Humanoids** run their own physics and state machine each frame; see "Characters" in `rendering-and-assets.md`.
- `Workspace.PhysicsSteppingMethod = Adaptive` lets the engine step simple assemblies less often (60/120/240 Hz) instead of always at 240 Hz.
- **Ragdolls, destruction, physics toys:** budget them (max N active), and turn them back into anchored or deleted parts after a few seconds.

## Crowds: hundreds of NPCs or units

Tower defense, RTS, zombie hordes and simulators with many pets break if every unit is a Humanoid model simulated and replicated by the server. Split it:

1. **Server: units are data.** A table per unit (`id`, `pathProgress`, `speed`, `health`, `spawnTime`). No Humanoid, no physics, often no Instance at all. Movement along a path is maths: `position = path:PositionAt(speed * (now - spawnTime))`.
2. **Replicate compactly:** spawn events (`id`, type, spawn server time, path id) and changes (damage, death, speed change). With deterministic paths clients compute positions themselves; otherwise send packed positions at 10–20 Hz in an UnreliableRemoteEvent.
3. **Clients render:** pooled models (kit `Pool`), animated with AnimationController, moved by one loop with `BulkMoveTo`, far units animated less often (Scheduler delays) or as simple stand-ins.
4. **Hits and rules stay on the server**, using the server's own positions.

The difference is typically from tens of units to thousands.

## StreamingEnabled

Streaming sends clients only the part of Workspace near them and removes far parts when memory is needed. It cuts join time and client memory on any map bigger than a lobby, and is on by default for new places.

| Setting | What it does | Typical choice |
|---|---|---|
| `StreamingTargetRadius` | How far the client tries to keep content | Small dense maps 256–512; open worlds 512–1024. Smaller = less memory. |
| `StreamingMinRadius` | Always-loaded radius around the player | 64–128; bigger delays joins |
| `StreamOutBehavior` | `Default` / `LowMemory` streams out only under memory pressure; `Opportunistic` also removes content beyond the target radius | Opportunistic for big maps where memory matters |
| `StreamingIntegrityMode` | What happens when the player reaches unloaded area | `MinimumRadiusPause` or `PauseOutsideLoadedArea` for games where falling through unloaded floor is a problem |
| `Model.ModelStreamingMode` | `Default`/`Nonatomic`: parts stream individually. `Atomic`: the model streams in and out as a whole. `Persistent`: always sent, never removed. `PersistentPerPlayer`: persistent only for players you add with `Model:AddPersistentPlayer` | Atomic for anything scripts need whole (doors, vehicles, NPCs). Persistent only for a handful of essentials. |
| `Model.LevelOfDetail` | `StreamingMesh` draws a low-detail stand-in for streamed-out models | Buildings and landmarks on big maps |

Code that works with streaming:

- **Client code can't assume a part exists.** Use CollectionService tags (instances added on stream-in, removed on stream-out) with components that clean up (the `roblox-project-structure` Component binder does this), or `WaitForChild` with a timeout for things near the player.
- **Never** `workspace.Map.Zone3.Door` from a LocalScript without handling `nil`.
- Before teleporting a player across the map: `player:RequestStreamAroundAsync(position)` on the server, then move them.
- The server always has everything; server code is unaffected.
- Too many Persistent models defeat streaming (they are sent to every client and never removed).
- Test with streaming in Studio play and with a phone; watch for parts popping in at the edge (raise the radius, or use `LevelOfDetail`).

## Server heartbeat checklist

When everyone lags at once:
1. Server Stats heartbeat and Scripts tab (Server): which scripts are busy?
2. Server MicroProfiler recording: Luau vs physics vs replication?
3. Common causes: per-frame loops per player or per object on the server, server-side animation of parts, hundreds of server-owned unanchored parts or Humanoid NPCs, pathfinding recomputed every frame, O(n²) checks, a remote handler doing heavy work without rate limits, DataStore calls in loops.
4. The kit's PerfService warns with the heaviest Profiler labels when the heartbeat drops, once systems are wrapped with `Profiler.Wrap` or run through a `Scheduler`.
