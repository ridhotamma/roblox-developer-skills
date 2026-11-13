# Performance audit checklist

Collect evidence before judging: numbers from a real device (Performance Stats, Developer Console, Creator Hub dashboard), the scanner output for the source or place file, the Studio command-bar audit, and a MicroProfiler capture of the worst moment. Then grade each area and cite paths.

Severity: **High** (crashes, unplayable FPS on a target device, server heartbeat collapse, joins over ~30 s) → **Medium** (noticeable FPS loss, hitches, memory growth, ping spikes) → **Low** (waste that adds up) → **Info** (worth knowing).

## Place and content (`perfscan.cjs` on .rbxlx and `assets/studio/PerfAudit.luau`)

Both tools use the same ids and thresholds.

| Id | Fires when | Severity | Fix |
|---|---|---|---|
| `streaming-off` | StreamingEnabled off with > 3,000 parts | Medium; High > 20,000 | Turn streaming on; make client code streaming-safe |
| `shadowed-lights` | > 8 enabled lights with Shadows | Medium; High > 25 | Shadows on a few key lights only |
| `small-shadow-casters` | > 500 parts under 1.5 studs with CastShadow | Low; Medium > 5,000 | CastShadow off on small props |
| `semi-transparent` | > 300 parts with 0 < Transparency < 1 | Low; Medium > 2,000 | Opaque or fully invisible; no stacked layers |
| `precise-collision` | > 100 parts with PreciseConvexDecomposition | Medium | Box/Hull for decor |
| `precise-collision-unused` | precise collision on parts with CanCollide, CanQuery and CanTouch all off | Low | CollisionFidelity Box |
| `precise-render` | > 200 parts with RenderFidelity Precise | Low | Automatic except hero meshes |
| `unanchored-parts` | > 500 unanchored parts in Workspace | Medium; High > 3,000 | Anchor; weld into few assemblies |
| `humanoid-npcs` | > 50 Humanoids in Workspace | Medium; High > 150 | AnimationController NPCs; crowd pattern |
| `particle-load` | > 5,000 particles alive from always-on emitters | Medium; High > 20,000 | Lower Rate/Lifetime, LOD-disable far emitters |
| `workspace-scripts` | > 20 Scripts/LocalScripts in Workspace | Medium | Tag + one component |
| `replicated-heavy` | > 20,000 instances in replicated containers outside Workspace | Medium; High > 60,000 | Move to ServerStorage; load on demand |
| `unique-meshes` | > 500 different MeshIds in Workspace | Medium | Reusable mesh kit |
| `unique-textures` | > 300 different textures in Workspace | Medium | Shared textures, atlases, smaller sizes |
| `surface-guis` | > 150 SurfaceGuis | Medium | Decals for static signs; MaxDistance |
| `billboards-no-limit` | > 50 BillboardGuis with no MaxDistance | Low | Set MaxDistance |
| `viewport-frames` | > 20 ViewportFrames | Low | Images for static icons; few live viewports |
| `looped-sounds` | > 30 looped sounds playing in Workspace | Low | Client-side, nearby-only ambience |
| `persistent-models` | Persistent models holding > 2,000 parts | Medium | Persistent only for essentials |
| `terrain-decoration` | Terrain decoration on | Info | Keep if it matters; measure on a phone |

## Code (`perfscan.cjs` on source)

| Id | Pattern | Severity | Fix |
|---|---|---|---|
| `remote-in-frame` | FireServer / FireClient / FireAllClients in a per-frame handler or loop | High | Throttle to 10–20 Hz, send on change, batch, Unreliable |
| `load-animation-in-frame` | LoadAnimation in a per-frame handler or loop | High | Load once per character |
| `handler-per-join` | remote handler connected inside PlayerAdded/CharacterAdded | High | Connect once at startup |
| `preload-everything` | PreloadAsync on game / workspace / GetDescendants | High | Preload the first screen only |
| `renderstepped-on-server` | RenderStepped / PreRender / BindToRenderStep in server code | High | Heartbeat / PostSimulation on the server |
| `per-object-frame-loop` | a per-frame connection made per tagged object, per child or inside a component | Medium | One loop per system (Scheduler) |
| `server-animation` | server code changing CFrame/Color/Transparency/Size... every frame | Medium | Animate on clients |
| `server-tween` | TweenService on the server | Medium | Tween on clients; set the end state on the server |
| `alloc-in-frame` | Instance.new / Clone every frame | Medium | Create once, Pool |
| `descendants-in-frame` | GetDescendants every frame | Medium | Keep a list updated by signals |
| `tween-in-frame` | TweenService:Create every frame | Medium | Create once, :Play() |
| `yield-in-frame` | WaitForChild / task.wait inside a per-frame handler | Medium | Resolve before connecting |
| `nested-player-loop` | loop over players inside a loop over players | Medium | Spatial grid, or only occasionally |
| `connection-leak` | connection to a long-lived signal made per join/spawn, no cleanup in the file | Medium | Trove per lifetime |
| `player-table-leak` | `t[player] = ...` with no PlayerRemoving / Destroying / weak table | Medium | Clear on PlayerRemoving |
| `legacy-wait` | wait() / spawn() / delay() | Medium | task.* |
| `deprecated-spatial` | FindPartsInRegion3*, FindPartOnRay* | Medium | Raycast / GetPartBoundsIn* |
| `polling-loop` | a `while` loop that waits one frame per iteration | Low | Events, or one system loop |
| `children-in-frame` | GetChildren / GetTagged every frame | Low | Keep a list |
| `params-in-frame` | RaycastParams.new / OverlapParams.new every frame | Low | Create once |
| `getservice-in-frame` | GetService every frame | Low | Top of the script |
| `text-in-frame` | `.Text =` every frame (client) | Low | Write only on change |
| `bulk-move` | moving objects one by one in a loop every frame | Low | workspace:BulkMoveTo |
| `touched-in-loop` | Touched connected per part in a loop | Low | CanTouch off / spatial queries |
| `instance-new-parent-arg` | Instance.new("X", parent) | Low | Parent last |
| `set-primary-part-cframe` | SetPrimaryPartCFrame / GetPrimaryPartCFrame | Low | PivotTo / GetPivot |
| `humanoid-load-animation` | Humanoid:LoadAnimation | Low | Animator, cached tracks |
| `queue-shift` | table.remove(t, 1) / table.insert(t, 1, x) | Low | Ring buffer / head index |

Suppress a reviewed finding with `-- perf:ignore <id>` on its line.

## Checked by hand (no tool can)

| Area | Look for | Severity |
|---|---|---|
| Measured FPS | Median under the device budget, or 1% low under a third of the median (hitches) | High/Medium |
| Server heartbeat | Under 45 Hz with a full server | High |
| Memory trend | Client or server memory rising with session/server age | High |
| Join time | Over ~20 s to playable on a phone | High/Medium |
| Bandwidth | Steady receive over ~50 KB/s, or bursts at events | Medium |
| GUI | Thousands of elements built at once; lists not virtualised; HUD text rewritten per frame | Medium |
| NPC design | Humanoid per unit, server-side animation, per-unit threads | High at scale |
| Projectiles | Physics parts for fast bullets; a new part per shot | Medium |
| Post effects | DoF/Blur/SunRays always on, no low-quality path | Low/Medium |
| Lighting | Future lighting + many shadowed lights in the main play area | Medium |

## Report format

```
## Summary
One paragraph: which budget is blown (client FPS / server heartbeat / memory / network / loading),
on which devices, and the one or two changes that fix most of it.

## Measurements
| Metric | Device | Value | Budget | Status |
| Median FPS | Galaxy A13, graphics 3 | 24 | 30+ | act |
...

## Fix first
1. <finding> — where (path:line or instance path), why it costs (in player terms), the fix.
...

## Plan
Stage 1 — settings and flags (hours): streaming, CastShadow, collision fidelity, light shadows, MaxDistance.
Stage 2 — hot code (days): per-frame loops into systems, server animation to clients, remote throttling, leaks.
Stage 3 — content (art passes): mesh kit reuse, texture sizes and atlases, detail/LOD, particle budgets.
Stage 4 — architecture (when scale demands it): crowd pattern for NPCs, packed networking, Parallel Luau.
Each stage: what to measure before and after, on which device.
```

Order fixes by player impact, not by how easy they are: crashes and unplayable frame rates on the most common devices first, then server-wide lag, then hitches, then waste.
