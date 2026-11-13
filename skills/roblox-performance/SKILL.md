---
name: roblox-performance
description: Make Roblox games run smoothly on every device - fix low FPS, stutter, server lag (low heartbeat), high ping, memory growth, crashes on phones and slow joins. Covers profiling (MicroProfiler, Developer Console, Script Profiler, Luau Heap, Creator Hub performance dashboard), budgets per device, rendering (draw calls, instancing, textures, transparency, shadows, lights, particles, GUI, LOD), StreamingEnabled, physics and network ownership, remote and replication design, NPC crowds, Luau hot paths, native code, Parallel Luau, leaks, pooling and loading. Ships a scanner for Luau source and .rbxlx places, a Studio command-bar audit, and a Luau kit (profiler labels, frame-budget scheduler, object pool, distance LOD, adaptive quality, in-game perf HUD, server heartbeat and leak monitor, client telemetry). Use this whenever the user mentions lag, FPS, stutter, optimization, performance, memory, mobile crashes, slow loading, server lag or ping, or says their game runs badly, even if they never say performance.
---

# Roblox performance and optimization

"The game lags" means one of five different things, and the fix for one does nothing for the others:

1. **Client frame rate**: one player's device can't render or run the frame in time (rendering, client scripts, physics on their side).
2. **Server heartbeat**: the server can't keep up, so everyone lags together (rubber-banding, late hits, delayed doors).
3. **Network**: too much replication or remote traffic, so ping climbs during busy moments.
4. **Memory**: the place is too heavy for phones, or something leaks; it ends in crashes.
5. **Loading**: long joins, black screens, the map popping in.

So the method is always: **measure → find which budget is blown and which system blows it → fix the biggest cost → measure again on the same device.** Don't optimise from folklore: a game at 20 FPS because of 40 shadow-casting lights doesn't get faster by caching `GetService`.

## Triage

| Symptom | Usually | Measure with | Read |
|---|---|---|---|
| Low FPS for some players, worse on phones | Rendering (transparency, shadows, particles, draw calls) or client scripts | MicroProfiler on that device; Performance Stats (CPU vs GPU time) | `references/rendering-and-assets.md`, `references/scripting.md` |
| Everyone lags at once, server FPS under 60 | Server scripts, physics, server-side animation, Humanoid crowds | Developer Console → Server Stats and Scripts; server MicroProfiler recording | `references/scripting.md`, `references/network-physics-streaming.md` |
| Ping rises in busy moments, server heartbeat fine | Replication bursts, remote spam, cloning big models on the server | Developer Console → Network; Performance Stats "Recv" | `references/network-physics-streaming.md` |
| Phones crash or close, especially after a while | Texture/mesh memory, or a leak | Developer Console → Memory, Luau Heap; dashboard crash rate | `references/memory-and-loading.md` |
| Server gets laggier the longer it runs | Server leak (per-player tables, connections, threads) | Server memory over server age; PerfService leak warning | `references/memory-and-loading.md` |
| Long joins, map pops in | Streaming off, huge ReplicatedStorage, PreloadAsync on everything | Stopwatch on a phone; replicated instance count | `references/memory-and-loading.md` |
| A hitch every few seconds | GC from allocation churn, timers firing together, instance creation, big one-frame work | Pause the MicroProfiler on the tall frame | `references/profiling.md`, `references/scripting.md` |

`references/profiling.md` has a 15-minute measurement routine for when nobody knows which kind it is yet, how to read the MicroProfiler (CPU vs GPU bound, what each common label means) and the Developer Console memory categories.

## Decide the mode

| The user wants... | Do this |
|---|---|
| "My game lags" / "fix the lag" | Ask the four questions that split the cases (which device; everyone at once or just some players; from the start or after a while; one place or moment?). Run the scanner on their source or place and the command-bar audit. Read the findings with the triage table, then give a ranked fix list with code. If they have no numbers, give them the measurement routine. |
| A pre-launch / pre-update audit | Scanner + command-bar audit + the budget table below + a session on a real low-end phone. Report with the format in `references/audit-checklist.md`. |
| To optimise one system (NPCs, projectiles, coins, UI list, map) | Rewrite it in the shape from the references: one loop per system (Scheduler), visuals on clients, pooled instances, throttled/packed networking, the crowd pattern for many units. Show before/after cost in the units that matter (connections per frame, remote fires per second, instances created per second). |
| To build something big from scratch (open world, tower defense, bullet hell, 50-player server) | Design within budgets up front: streaming settings, a mesh/texture kit, the crowd pattern, remote rates. Cheaper than retrofitting. |
| Monitoring / "how do I know if it's laggy for players" | Install the kit (PerfService + PerfController): dev HUD, server heartbeat and leak warnings, per-device telemetry; plus the Creator Hub performance dashboard. |
| Phones crashing | Memory first: `references/memory-and-loading.md` (textures, replicated content, leaks), then rendering. |

## Budgets

Rules of thumb from common practice, to compare against; calibrate with the Creator Hub dashboard for your players' devices.

| Metric | Healthy | Act now |
|---|---|---|
| Client median FPS | ≥ 55 desktop/console, ≥ 30 low-end phone | under 45 desktop, under 28 phone |
| 1% low FPS (hitches) | at least half the median | under a third of the median |
| Server heartbeat | 57–60 Hz with a full server | under 45 Hz sustained (under 30 everyone feels it) |
| Client memory | phone < 800 MB, desktop < 1.5 GB | phone > 1.2 GB, desktop > 2.5 GB |
| Memory over time | flat after loading | rising with session length or server age |
| Receive bandwidth per client | < 30 KB/s steady | > 50 KB/s steady, or bursts of hundreds |
| Join to playable on a phone | < 10 s | > 20 s |
| Per-frame Luau (all your client code) | 2–4 ms desktop, less on phones | anything that shows as a wide label every frame |

## Rules that fix most Roblox performance problems

1. **Measure on the weakest device you support, in a live server.** Studio on a dev PC hides rendering and memory problems and runs Luau at a lower optimisation level.
2. **StreamingEnabled on** for any map bigger than a lobby, with client code that handles parts that aren't there (tags + components). Persistent models only for essentials.
3. **One loop per system, not per object.** Hundreds of `Heartbeat` connections (one per coin, door, NPC) is the most common script cost. Use one loop over a set, time-budgeted, with slower updates for far objects (kit `Scheduler`).
4. **The server simulates rules; clients do visuals.** Spinning coins, tweens, bobbing, colour pulses, VFX, sounds and UI run on clients. The server changes a part only when gameplay needs it, because every change replicates to every player.
5. **Events over polling.** `GetPropertyChangedSignal`, attribute signals, tag signals and `Died` instead of checking every frame.
6. **Reuse, don't churn.** Pool instances that come and go (bullets, hit markers, coins); reuse tables and params in hot paths; never `Clone`/`Destroy` many times a second.
7. **Fewer, shared assets.** A reused mesh kit instances into few draw calls; shared textures and atlases keep memory down; SurfaceAppearance only where it's seen up close.
8. **Decor is cheap by default:** Anchored, CastShadow off on small parts, CanTouch off, Box collision, RenderFidelity Automatic.
9. **Ration the expensive features:** shadow-casting lights, stacked transparency, big particles near the camera, Humanoids (AnimationController for simple NPCs), ViewportFrames, SurfaceGuis, full-screen post effects.
10. **Send less, less often.** No per-frame remotes; 10–20 Hz for continuous state, only on change, batched, packed, Unreliable, only to players who need it.
11. **Clean up everything you create or connect.** Per-player tables cleared on leave, connections in a Trove, tracks loaded once, `Destroy` not `Parent = nil`.
12. **Load the first screen, not the whole game.** Server-only assets in ServerStorage; preload only what the loading screen and spawn need.
13. **Big computations:** spread across frames, `--!native` on maths-heavy modules, Parallel Luau for independent per-entity work. Only after measuring.

## Scanning code and places

```bash
node <skill>/scripts/perfscan.cjs <path> [--json] [--min info|low|medium|high] [--fail-on <severity>] [--no-stats]
```

`<path>` is a Rojo `src` folder, a `.lua`/`.luau` file, or a place/model saved as XML (`.rbxlx`/`.rbxmx`). Binary `.rbxl`/`.rbxm` can't be read directly: convert with `lune run <skill>/scripts/rbxl-to-rbxlx.luau MyGame.rbxl` (Lune is pinned by the `roblox-project-structure` scaffold) or File → Save to File As `.rbxlx` in Studio. Needs only Node.

- **Code**: per-frame handlers and loops that fire remotes, load animations, create instances, walk descendants, create tweens or params, yield, or set text; a per-frame connection per object; server-side animation and tweens; nested player loops; remote handlers or long-lived connections made per join; per-player tables never cleared; legacy `wait`/`spawn`/`delay`, deprecated spatial queries, `PreloadAsync` on everything, `SetPrimaryPartCFrame`, front-of-array queues.
- **Places**: streaming off on big maps, shadow-casting lights, small shadow casters, semi-transparent parts, precise collision and render fidelity, unanchored parts, Humanoid counts, particle load, scripts inside parts, what replicates at join, unique meshes and textures, SurfaceGuis, BillboardGuis without MaxDistance, ViewportFrames, looped sounds, Persistent models; plus a stats summary and the heaviest models.

Every id, threshold and fix is in `references/audit-checklist.md`. It's a pattern scan, not a profiler: findings say where to look. Confirm the ones that matter with a measurement, and say which findings are measured and which are heuristic. `-- perf:ignore <id>` on a line suppresses a reviewed finding.

## Auditing in Studio (no export needed)

`assets/studio/PerfAudit.luau` is a command-bar script: paste it into View → Command Bar in Edit mode and press Enter. It prints the same place findings (same ids and thresholds) for the open place, the heaviest models and particle emitters, and the streaming and lighting settings. Set `SELECT = "<finding id>"` at the top and run again to select the offenders in Explorer, so the user can fix them all at once in Properties (for example every small part casting shadows). It changes nothing by itself. This is the fastest audit for users who work in Studio rather than Rojo.

## The kit

`assets/kit/` mirrors the `roblox-project-structure` layout (`shared` → `ReplicatedStorage.Shared`, `server` → `ServerScriptService.Server`, `client` → `StarterPlayerScripts.Client`); Services and Controllers are started by the scaffold's Loader. It uses the scaffold's `Net` module and the Signal package. The shared modules have no dependencies beyond each other and work in any project.

| File | Side | Does |
|---|---|---|
| `shared/Perf/PerfConfig.luau` | both | Budgets per device class, quality tiers, HUD access, telemetry, server thresholds, LOD settings. |
| `shared/Perf/Profiler.luau` | both | `Profiler.Wrap(label, fn)` / `Begin` / `End`: MicroProfiler labels, plus ms-per-frame totals per label (`Report`, `Format`) when accumulating. |
| `shared/Perf/Scheduler.luau` | both | One loop per system: round-robin over items with a per-frame time budget, per-item "skip me for N seconds" for distance-based update rates, error isolation; `Scheduler.Every` timers with random offset. |
| `shared/Perf/Pool.luau` | both (use on clients) | Instance pool: prewarm in chunks, park far away or unparent, cap and recycle, restores effects and clears trails on reuse, `ReleaseAfter`. |
| `shared/Perf/RollingStats.luau` | both | Allocation-free ring buffer with mean, min, max and percentiles (median FPS, 1% lows). |
| `client/Controllers/PerfController.luau` | client | Measures FPS, 1% low, memory, network, ping and render counters; picks and adapts a quality tier (sets `PerfQuality`, `PerfLodScale`, `PerfParticleScale` on the LocalPlayer); opens the HUD (F7 or `/perf`); sends telemetry. |
| `client/Perf/PerfHud.luau` | client | The dev overlay: colour-coded against the device budget, server heartbeat and memory, top client Profiler labels; only rewrites text that changed. |
| `client/Controllers/LodController.luau` | client | Distance LOD for instances tagged `PerfLod`: disables effects and lights, removes a `Detail` child, shows a `Simple` stand-in, culls beyond `CullDistance`, sets a local `LodLevel` attribute; one budgeted Scheduler loop scaled by the quality tier. |
| `server/Services/PerfService.luau` | server | Server heartbeat monitor (warns with the heaviest Profiler labels), memory leak detector (slope with a steady player count), publishes stats for the HUD, receives and validates client telemetry, logs per-device summaries, optional AnalyticsService events. |

Install steps to give the user:
1. Copy the folders over the project's `src`.
2. Add `PerfSample = "Unreliable", -- (sample) client perf telemetry; PerfService validates` to the `REMOTES` list in `shared/Net/init.luau` (without it everything works except telemetry, and Output says so).
3. Put developer user ids in `PerfConfig.Hud.AllowedUserIds` (or a group and rank). In Studio anyone can press F7.
4. Wrap the game's heavy systems: `RunService.Heartbeat:Connect(Profiler.Wrap("Npc.Think", step))`, or move per-object loops into a `Scheduler`. Then the HUD and PerfService's warnings name the expensive system.
5. Tag decorative models, effects and light clusters `PerfLod`, with a `Detail` child for small props; give heavy VFX a rate scaled by the `PerfParticleScale` attribute.
6. Optionally turn on `PerfConfig.Telemetry.AnalyticsEvents` to see per-device FPS and memory in Creator Hub analytics.

The server validates every telemetry field (types, NaN, ranges, allow-listed device and tier) and rate-limits it, as `roblox-security` recommends for any client → server remote.

## Output style

- Lead with which kind of lag it is and the single biggest cause, in player terms ("phones render 9,000 shadow-casting parts every frame", "every coin runs its own loop on the server, so the server drops to 35 Hz with 30 players").
- For each finding: where (path:line or instance path), what it costs and why, and the fixed code or the property change. Group mechanical fixes ("set CastShadow off on these 3,200 parts: run PerfAudit with SELECT = ...").
- Give a ranked plan in stages (settings → hot code → content → architecture), each with what to measure before and after on which device.
- Say what was measured and what is inferred from patterns. Never promise an FPS number you haven't measured.

## Related skills

`roblox-project-structure` (layout, Loader, Net, components, and its architecture notes), `roblox-vfx` (effects within particle budgets), `roblox-atmosphere` (lighting and post effects; read `PerfQuality` to drop expensive effects on Low), `roblox-combat` (raycast ballistics, hitboxes), `roblox-vehicles` (parked-car sleep, client physics), `roblox-security` (validation and rate limits for remotes, including telemetry).

## References

- `references/profiling.md`: the measurement routine, MicroProfiler (CPU vs GPU bound, label meanings, server and mobile profiling, dumps), Developer Console tabs and memory categories, Script Profiler, Luau Heap, Creator Hub dashboard, the Stats API, benchmarking.
- `references/rendering-and-assets.md`: draw calls and instancing, render clusters, geometry and LOD, textures and materials, transparency and overdraw, lighting and shadows, post effects, particles, GUI, Humanoids and animation, physics flags for decor, a builder's checklist.
- `references/scripting.md`: frame budget, events over polling, one loop per system, task library and coalescing, allocation and GC, caching, spatial queries and a spatial grid, server habits, native code generation, Parallel Luau, avoiding hitches.
- `references/network-physics-streaming.md`: what costs bandwidth, remote design, buffers and interpolation, physics and network ownership, the crowd pattern for hundreds of NPCs, StreamingEnabled settings and streaming-safe code, a server heartbeat checklist.
- `references/memory-and-loading.md`: memory budgets per device, where memory goes, leak patterns and how to find them, the Trove cleanup pattern, server memory, join time and loading screens, mobile specifics.
- `references/audit-checklist.md`: every scanner and audit id with thresholds and fixes, manual checks, the report format and the staged plan.
- `scripts/perfscan.cjs`: the scanner. `scripts/selftest.cjs` checks its rules, the kit and the docs; run it after editing any of them.
- `scripts/rbxl-to-rbxlx.luau`: Lune script converting binary places/models to XML for the scanner.
- `assets/studio/PerfAudit.luau`: the Studio command-bar audit.
- `assets/kit/`: the Luau modules above.
