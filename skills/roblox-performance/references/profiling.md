# Profiling: finding what is actually slow

Optimising without measuring fixes the wrong thing. This file is the measuring half: which tool answers which question, how to read it, and a routine that turns "my game lags" into a named bottleneck.

Tool names and menu locations below match Roblox Studio and the client as of late 2026. If something has moved, the Creator Docs pages for "MicroProfiler", "Developer Console" and "Performance dashboard" are the current source.

## The 15-minute routine

Use it when someone says "the game lags" and nobody knows why yet.

1. **Pick devices.** The weakest device you support (usually an older Android phone) and one desktop. Studio on a developer PC hides most rendering and memory problems; Studio's device emulator changes the screen size, not the hardware.
2. **Join a live server**, not Studio. Studio play adds editor overhead and runs scripts at a lower Luau optimisation level than live servers.
3. **Turn on Performance Stats** (Esc → Settings → Performance Stats). It shows CPU and GPU frame time, memory, network send/receive and ping along the top. Note them at spawn, after 5 minutes, in the busiest area, and during the busiest moment (boss fight, round start, 30 players in the lobby).
4. **Developer Console** (F9, or `/console` in chat). Client side: Memory (sort the PlaceMemory categories by size), Network, Scripts. Then switch the top dropdown to **Server**: Server Stats (heartbeat), Scripts (which server scripts are busy), Memory, Network.
5. **MicroProfiler at the worst moment** (below). Pause, find the tallest frames, open them in detailed mode, note the widest labels.
6. **Server profile** if the server heartbeat was low (record from the console's MicroProfiler tab).
7. **Creator Hub → your experience → Analytics → Performance** for the last 7–30 days, split by platform. This shows what real players get (frame rate, memory, crash rate, server heartbeat, server memory), which no test session can.

Then classify with the triage table in `SKILL.md` and go to the matching reference.

## MicroProfiler

The frame-by-frame timeline of everything the engine and your scripts do.

- **Open:** Ctrl+Alt+F6 (⌘⌥F6 on Mac) in Studio or the client, or Esc → Settings → MicroProfiler. On phones turn it on in the settings menu; the settings screen then shows an address and port you can open from a computer browser on the same network to see the phone's profiler.
- **Pause:** Ctrl+P (or the Pause button) to freeze the last few seconds of frames. Always pause before reading.
- **Frame bar graph** (top): one bar per frame. A steady row of tall bars = consistently slow. One tall bar every few seconds = a hitch (GC, a timer doing a lot at once, instance creation, a big replication burst).
- **Detailed mode** (Mode → Detailed, or click a frame): the timeline of each thread for that frame. Labels nest; wider = longer. Hover a label for its time. The main thread does scripts, physics stepping and engine jobs; the render thread prepares and submits drawing; worker threads do physics, streaming, decoding and more in parallel.
- **Dump:** "Dump" saves the recorded frames to an HTML file you can share and open in any browser (Studio and the client write them to the Roblox logs folder; the console prints the path).
- **Server:** Developer Console → MicroProfiler tab → set frames per second and seconds → Start Recording. The dump opens the same way.

### CPU-bound or GPU-bound?

- Main/render threads finish early and the frame waits on presenting or the GPU → **GPU-bound**: pixels and overdraw (transparency, big particles, post effects, shadows, resolution). Fix content, not scripts. Performance Stats shows GPU time above CPU time.
- The main thread is long → **CPU-bound**. Look at what fills it:

| Widest labels (names vary a little between versions) | Means | Go to |
|---|---|---|
| Your script names, `$Script`, Heartbeat / RenderStepped / Stepped / PreRender jobs, your own `debug.profilebegin` labels | Luau work | `scripting.md` |
| `LuaGC` / GC | Garbage collection: too many short-lived tables, closures, strings, Instances | `scripting.md` (allocation) |
| Physics / `worldStep` / `stepContacts` / `Simulation` / assembler | Physics: unanchored parts, contacts, Humanoids, constraints | `network-physics-streaming.md` |
| `updateInvalidatedFastClusters` | Render geometry being rebuilt because parts changed (moved, recoloured, resized, created) | `rendering-and-assets.md`, move animation to clients |
| Render → Perform/Scene/… (`computeLighting`, shadows, particles, `queryFrustum`) | CPU side of rendering: draw calls, culling, lights, shadows | `rendering-and-assets.md` |
| `Replicator`, `ProcessPackets`, deserialise | Receiving a lot of replication (server changing many properties, cloning big models) | `network-physics-streaming.md` |
| `Humanoid`, `stepHumanoid`, animation | Many Humanoids or animated rigs | `rendering-and-assets.md` (characters) |
| `waitForRenderThread`, `Present`, `GPU` | The CPU is waiting on the GPU | GPU-bound, above |
| Streaming, `StreamingJob` | Streaming instances in/out | `network-physics-streaming.md` (streaming) |
| Navigation / pathfinding | `PathfindingService:ComputeAsync` calls | Fewer recomputes, cache paths, stagger |

### Your own labels

```lua
debug.profilebegin("Npc.Think")
-- work
debug.profileend()
```

Labels must be balanced in the same thread with no yield in between, and should be fixed strings (a string built per call creates a new label every time). The kit's `Profiler.Wrap(label, fn)` and `Scheduler` add these for you and can also sum milliseconds per label in game (`Profiler.Report`).

## Developer Console (F9)

Every tab has a Client/Server switch at the top (server tabs need edit permission on the experience).

- **Memory**: CoreMemory is the engine itself (mostly not yours). **PlaceMemory** is yours; the categories that matter:

| Category | What it is | Usual fix |
|---|---|---|
| GraphicsTexture | Textures, decals, SurfaceAppearance maps, UI images | Fewer unique textures, smaller sizes, atlases (`rendering-and-assets.md`) |
| GraphicsMeshParts / GraphicsParts / GraphicsSolidModels | Render geometry for meshes, parts, unions | Reuse meshes, fewer unique ones, streaming |
| PhysicsParts / PhysicsCollision | Physics data for parts and collision geometry | Box/Hull collision on decor, CanCollide/CanQuery/CanTouch off where unneeded |
| Instances | The Instance objects themselves | Fewer instances (streaming, ServerStorage, merge decor) |
| LuaHeap | Luau tables, closures, strings | Leaks and caches (`memory-and-loading.md`) |
| Sounds / StreamingSounds | Loaded audio | Shorter/streamed sounds, unload unused ones |
| Animation | Loaded animations and tracks | Load each track once per character |
| Gui | UI instances and their render data | Destroy closed screens, virtualise long lists |
| TerrainVoxels / GraphicsTerrain | Terrain data and its render mesh | Smaller terrain, streaming |
| Navigation | Pathfinding data | Fewer agents/paths, smaller areas |

- **Network**: data received/sent per second. Click the counters to see which remotes and which replication categories dominate.
- **Scripts**: per script, *Activity* (share of CPU time) and *Rate* (resumes per second). A script steadily above a few percent activity, or with a rate in the thousands, is where to look first.
- **Server Stats / Server Jobs**: heartbeat (the server's frames per second, target 60), and per-job timings.
- **ScriptProfiler**: record N seconds on client or server, then see time per function, as a tree or flat list. The fastest way to find the hot function inside a busy script. (Studio also has a Script Profiler window for play tests.)
- **Luau Heap**: snapshots of Luau memory by script, by type and by references. Take one, play for a few minutes, take another and compare: what grew is the leak. "Unique references" also shows Instances that scripts still hold after they were destroyed.

## Creator Hub performance dashboard

Analytics → Performance shows, from real sessions: client frame rate, client memory, crash rate, server heartbeat, server CPU and server memory, broken down by platform and device. Use it to:

- choose the device to test on (where frame rate is worst and crash rate highest),
- confirm a fix (compare the week before and after a release),
- spot leaks (server memory climbing over a server's lifetime; client memory climbing with session length).

## Stats API (for in-game overlays and telemetry)

`game:GetService("Stats")`:
- `GetTotalMemoryUsageMb()`, `GetMemoryUsageMbForTag(Enum.DeveloperMemoryTag.X)` with tags such as `LuaHeap`, `Instances`, `GraphicsTexture`, `PhysicsParts`.
- Properties such as `DataReceiveKbps`, `DataSendKbps`, `PhysicsReceiveKbps`, `PhysicsSendKbps`, `HeartbeatTimeMs`, `PhysicsStepTimeMs`, `InstanceCount`, `PrimitivesCount`, `MovingPrimitivesCount`, `ContactsCount`, and render counters like `SceneDrawcallCount` / `SceneTriangleCount` / `RenderCPUFrameTime` / `RenderGPUFrameTime`. Availability differs by side and version, so read them inside `pcall` (the kit's PerfHud does) and show "-" when missing.
- `Player:GetNetworkPing()` for ping.

## Benchmarking a piece of Luau

- Put `--!optimize 2` at the top when timing in Studio (live servers already use it; Studio defaults lower so the debugger works).
- Warm up, then time many iterations with `os.clock()`; report per-call microseconds and compare against the frame budget (16.7 ms at 60 FPS).
- Benchmark the realistic case (500 NPCs, not 5). A change that saves 0.01 ms per frame is not worth readability.
- In-game numbers beat micro-benchmarks: wrap the system with `Profiler.Wrap`, play, read `Profiler.Report`.

## What to ask a player who reports lag

1. Device and model (phone/tablet/PC/console) and graphics setting.
2. Is it everyone in the server at once (server) or just them (client/network)?
3. From the start, or after playing a while (leak)? In one place or one moment (content or event)?
4. FPS and ping from Performance Stats, or a screenshot of it.
5. Did it start with a particular update?
