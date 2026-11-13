# Memory, leaks and loading

Two kinds of memory problem: **too much** (the place is heavy: textures, meshes, instances; phones crash from the first minute) and **growing** (a leak: fine at first, worse every minute, then a crash or a laggy server after hours). The Developer Console Memory tab and the Creator Hub dashboard tell them apart: heavy places start high; leaks climb with session length or server age.

## Client memory budgets (rules of thumb)

| Device | Comfortable | Watch | Crash risk climbs |
|---|---|---|---|
| Low-end phone (2–3 GB RAM) | under ~800 MB | 800 MB–1.2 GB | above ~1.2 GB |
| Mid/high phone, tablet | under ~1 GB | 1–1.5 GB | above ~1.5 GB |
| Console | under ~1.2 GB | 1.2–1.8 GB | above ~1.8 GB |
| Desktop | under ~1.5 GB | 1.5–2.5 GB | above ~2.5 GB |

These are starting points, not Roblox limits: calibrate with your own crash rate by device in the Creator Hub dashboard.

## Where client memory goes, and what to do

1. **Textures** (GraphicsTexture): usually the largest. Fewer unique textures, 256–512 px for props, atlases, SurfaceAppearance only up close, icon sheets for UI. See `rendering-and-assets.md`.
2. **Meshes and parts** (GraphicsMeshParts, GraphicsParts, PhysicsParts, PhysicsCollision): reuse meshes, Box collision on decor, streaming to hold only nearby content.
3. **Instances**: everything outside Workspace that replicates (ReplicatedStorage, ReplicatedFirst, StarterGui, StarterPack, StarterPlayer, Lighting) is downloaded and kept by every client, streaming or not. Move server-only assets to ServerStorage. Keep a few maps in ServerStorage and parent only the active one to Workspace.
4. **Sounds**: long music tracks and many unique sound effects. Reuse sounds; stop and remove music that's not playing.
5. **Animations**: each loaded track. Load once per character and reuse.
6. **LuaHeap**: caches, big config tables, and leaks (below).
7. **Gui**: closed screens kept around with thousands of elements. Destroy or virtualise.

## Leaks

A leak is memory that's still referenced after it's no longer needed. In Luau that means some live table, connection or thread still points at it. The usual suspects, in rough order of how often they happen:

| Leak | Example | Fix |
|---|---|---|
| Per-player tables never cleared | `cooldowns[player] = {}` with no `PlayerRemoving` | Clear every per-player table in `PlayerRemoving` (or keep all per-player state in one module that does) |
| Connections to long-lived signals made per player/character/object | `RunService.Heartbeat:Connect(...)` inside `CharacterAdded`; `Players.PlayerRemoving:Connect` inside `PlayerAdded` | Keep connections in a Trove tied to the lifetime; disconnect on removal; `:Once` for one-shot listeners |
| Remote handlers connected per join | `remote.OnServerEvent:Connect` inside `PlayerAdded` | Connect once at startup; the first argument is the player |
| Instances parented to nil instead of destroyed | `effect.Parent = nil` | `:Destroy()` (disconnects its connections and lets it be collected); or pool it on purpose |
| Animation tracks loaded repeatedly | `animator:LoadAnimation(anim):Play()` on every attack | Load once per character, cache tracks in a table cleared with the character |
| Threads that never end | `task.spawn(function() while true do ... end end)` per NPC, never stopped | Loop condition checks the object is alive (`while model.Parent do`), or one system loop (Scheduler) |
| Unbounded caches and logs | a table of every hit ever recorded | Cap size (ring buffer), expire old entries |
| Closures holding big objects | callbacks stored in a module table that capture a character or a big table | Remove the callback when its owner goes away |
| Old characters and players | scripts keep references to previous characters after respawn | Clear references on `CharacterRemoving`; turn on `Workspace.PlayerCharacterDestroyBehavior` if your version has it, so old characters and player objects are destroyed |

### Finding a leak

1. **Confirm it grows**: Developer Console Memory over 10–20 minutes of normal play (client), or server memory over hours (Creator Hub, or the kit's PerfService, which warns when memory climbs with a steady player count).
2. **Which category grows?** LuaHeap → Luau references (tables, closures). Instances → instances kept alive or created and never destroyed. Animation → tracks. Gui → screens.
3. **Luau Heap tab**: snapshot, play a few rounds or rejoin-respawn a few times, snapshot again, compare. The script and type that grew is where the leak is; "unique references" shows destroyed Instances still held by scripts.
4. **Reproduce fast**: respawn 50 times, join/leave with test accounts, run 20 rounds in a row. Leaks per event show up quickly when the event repeats.
5. Fix, then re-run the same loop and confirm the growth is gone.

### The cleanup pattern

```lua
-- One Trove per lifetime: everything created for that player/character/object goes in it.
local Trove = require(ReplicatedStorage.Packages.Trove)
local troves: { [Player]: any } = {}

Players.PlayerAdded:Connect(function(player)
	local trove = Trove.new()
	troves[player] = trove
	trove:Connect(player.CharacterAdded, function(character)
		local charTrove = trove:Extend()
		charTrove:Connect(RunService.Heartbeat, function() --[[ per-character work ]] end)
		charTrove:AttachToInstance(character) -- cleaned when the character is destroyed
	end)
end)

Players.PlayerRemoving:Connect(function(player)
	local trove = troves[player]
	troves[player] = nil
	if trove then
		trove:Destroy()
	end
end)
```

(Better still: avoid per-character `Heartbeat` entirely and put characters in one system loop.)

## Server memory

- Servers live for hours or days. A leak of 1 MB per player who joins is invisible in testing and fatal after 3,000 joins.
- Per-player data: clear on leave (after the save completes). Session-locked data libraries (ProfileStore) release profiles for you when you call their release/end-session API.
- Logs and analytics buffers: flush and cap.
- Big generated content (procedural maps, round maps): destroy the old one before building the next.
- Servers that run out of memory crash and disconnect everyone; the limit is a few GB and depends on server size. Watch the Creator Hub server memory graph against server age.

## Loading and join time

What happens when a player joins:
1. The client downloads `ReplicatedFirst` and runs its LocalScripts (your loading screen goes here).
2. Then everything else that replicates: `ReplicatedStorage`, `StarterGui`/`StarterPack`/`StarterPlayer` contents, `Lighting`, and Workspace (all of it without streaming, or the area around the spawn with streaming).
3. `game.Loaded` fires; assets (textures, meshes, sounds) keep downloading in the background as they're used.

What makes joins slow:
- **Streaming off on a big map**: the whole Workspace downloads before play.
- **Huge ReplicatedStorage**: every client downloads every model and map stored there. Move what clients don't always need to ServerStorage.
- **`ContentProvider:PreloadAsync` on everything** (`game:GetDescendants()`, all of Workspace): players wait for every texture and sound before playing, and the preloaded assets stay in memory. Preload only what the first screen shows.
- **Heavy first frame**: a loading script that builds the whole UI and all VFX at once. Build the HUD first, the rest lazily.
- **Big StarterGui**: every screen of the game cloned into PlayerGui at spawn. Keep rarely used screens in ReplicatedStorage and clone them when opened, or build them on demand.

A good loading screen:
```lua
-- ReplicatedFirst/Loading.client.luau
local ReplicatedFirst = game:GetService("ReplicatedFirst")
local ContentProvider = game:GetService("ContentProvider")

ReplicatedFirst:RemoveDefaultLoadingScreen()
local screen = script.LoadingGui:Clone()
screen.Parent = game.Players.LocalPlayer:WaitForChild("PlayerGui")

-- Only what the first seconds of play need:
ContentProvider:PreloadAsync({ screen, script.FirstMusic })
if not game:IsLoaded() then
	game.Loaded:Wait()
end
screen:Destroy()
```
Give players a way in fast (a skip button after a few seconds) and finish loading in the background.

**Teleports between places** of the same experience: keep each place light, show a teleport loading screen (`TeleportService:SetTeleportGui`), and preload nothing big at the destination's first frame.

## Mobile specifics

- Phones have less memory, slower storage and weaker GPUs, and throttle when hot (FPS drops after 10–15 minutes of play). Test sessions of 20+ minutes on a real phone.
- Touch UI: keep the HUD light; avoid full-screen blur and transparency layers.
- Mobile connections are slower and lossier: keep bandwidth low and burst-free.
- Many mobile players run at the lowest graphics levels: your game must still be readable when shadows, post effects and detail are reduced.
