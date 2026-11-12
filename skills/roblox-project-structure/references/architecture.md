# Architecture reference

Read the section the question is about. Each section ends with the recommendation to give by default.

## Contents
1. Lifecycle and loaders (and why not Knit)
2. Services, Controllers, Components, ECS
3. Networking
4. Player data
5. State and UI
6. Signals, cleanup, async
7. Types and module conventions
8. Errors, logging, analytics
9. Performance and scale
10. Monorepo / multi-place games

---

## 1. Lifecycle and loaders

Every serious codebase ends up with the same shape: one Script per side requires all system modules, runs a setup phase, then a start phase. The details that matter:

- **Init is synchronous and local.** No yielding, no calling other modules. If Init yields, everything after it waits; if it calls another module, that module may not be initialised.
- **Start runs in its own thread per module.** One module's infinite loop or yield must not block the others. Errors are caught and reported with the module name.
- **Order is deterministic** (alphabetical in the scaffold's `Loader`). Code must not depend on Start order; when it does, use an "observe" API (`DataService:ObserveProfiles`) or a Signal instead.
- **Modules are plain tables.** No framework base classes, no string lookups like `GetService("DataService")`. A direct `require` gives autocomplete, types and go-to-definition.

**Knit** (sleitnick) popularised this pattern but is archived and no longer maintained. Its networking (auto-created remotes from `Client` tables) hides the attack surface and has no types across the boundary. For existing Knit games: keep it running, stop adding Knit-specific features, and migrate system by system (a Knit service is already 90% of a plain module: remove `Knit.CreateService`, replace `Knit.GetService` with `require`, move `Client` methods into declared remotes).

**Default:** the scaffold's `Loader` (about 60 lines, no dependency). Alternatives worth naming only if asked: plain modules with a hand-written start order in `Main` (fine for tiny games).

## 2. Services, Controllers, Components, ECS

| Unit | Lives | One per | Owns |
|---|---|---|---|
| Service | server | system (Data, Combat, Shop, Round) | authoritative state and rules for that system |
| Controller | client | system (Input, Camera, Hud, Sound) | local presentation and input |
| Component | either | tag (Door, CoinPickup, Spinner) | behaviour of one tagged Instance, cleaned up with it |
| Config | shared | domain (Items, Shop, Levels) | static data |

Size guide: a Service over ~400 lines usually contains two systems; split along data ownership ("who writes this field?"), not along verbs.

**Components via CollectionService tags** replace Scripts inside parts. Builders tag in Studio (Tag Editor, or the Properties panel's Tags section); code binds once. Use Attributes on the tagged Instance for per-instance tuning (`Value = 10` on a specific coin), read in `Setup`. Bind under `workspace` only, so templates in storage stay inert. For stateful components with many methods, the Component module can return a class (`Setup` constructs an object and adds its `Destroy` to the trove).

**ECS** (jecs, Matter) pays off when thousands of entities share behaviour every frame: bullet-hell projectiles, large NPC crowds, tower-defense enemies, simulation games with many ticking objects. It is a different mental model and harder for designers to read. Recommend it for the hot simulation only, inside a Service, not as the whole architecture, unless the team already knows ECS.

**Default:** Services + Controllers + tag Components. ECS only for a measured hot path.

## 3. Networking

Principles that hold regardless of library:

1. **One declaration list** for all remotes, with direction and argument comments (scaffold: `shared/Net`).
2. **Client → server is a request.** Validate: `typeof` every argument, range-check numbers (and reject NaN: `x ~= x`), check the player owns what they reference, check distance for world interactions (`(root.Position - target.Position).Magnitude < 12`), check cooldowns on the server clock, and rate-limit. Never accept positions, damage, prices, currency amounts or "I won" from the client.
3. **Server → client sends facts the client may show.** Prefer replicating state (Attributes on the Player or relevant Instance, or a replicated state library) over firing an event for every change: late joiners and respawned UIs read the current value instead of missing an event.
4. **Batch and throttle.** Do not fire per frame per player. Coalesce updates (send on Heartbeat at most, usually far less). Use `UnreliableRemoteEvent` for high-frequency, loss-tolerant data (cosmetic positions, aim direction); its payload is size-limited, so keep it small.
5. **RemoteFunctions server → client are forbidden** (a client can hang the server thread forever). Client → server RemoteFunctions are fine for request/response (shop purchase result), with the same validation.

Libraries:
- **Blink** and **Zap**: IDL files compiled to typed Luau with compact binary serialisation. Best types and bandwidth; adds a codegen step to the toolchain. Recommend for games with heavy traffic (combat, many entities) or teams that want typed remotes end to end.
- **ByteNet**: runtime-defined typed packets with buffer serialisation, no codegen.
- **Built-in remotes behind a declared module** (the scaffold): zero dependencies, easy to read. Enough for most games until profiling shows network cost.

**Default:** the scaffold's `Net` module; move to Blink or Zap when bandwidth or type safety across the boundary becomes a real problem. Migration is mechanical because every remote is already in one list.

## 4. Player data

- **Use ProfileStore** (lm-loleris, successor to ProfileService). It session-locks (one server at a time owns a profile, which is what prevents item duplication via trading and server hopping), autosaves, and handles shutdown. Rolling your own `UpdateAsync` layer is a common source of data loss; only do it with session locking and a reason.
- **One owner.** Only `DataService` touches the store. Other Services read and write the live `profile.Data` table through `DataService:Get(player)`, and each field has exactly one Service that writes it.
- **Template plus Reconcile.** Adding fields is free. Renaming, retyping or restructuring needs a migration: keep a `DataVersion` field, and in `DataService` after `Reconcile()` run ordered migration functions `[1] = function(data) ... end` until `data.DataVersion` is current.
- **Never change the store name to "reset"** a field; that wipes everyone. Migrate instead.
- **Keep it small.** Save ids and counts, not Instances or derived values. A profile near the DataStore value limit (about 4 MB) is a design bug; inventories of thousands of unique items need compact encoding.
- **Separate stores per environment** happen automatically when dev, staging and production are different experiences (see tooling.md). Never test destructive migrations on the production experience.
- **Global/cross-server data** (leaderboards, guilds, trading posts) use OrderedDataStores, MemoryStoreService (queues, sorted maps, short-lived shared state) and MessagingService (cross-server events); each has its own quotas. Leaderboards: write on a timer, not on every change.
- **Purchases:** handle Developer Products in `MarketplaceService.ProcessReceipt` inside a single `PurchaseService`, grant into the profile, record the `PurchaseId` in the profile to make the grant idempotent, and return `PurchaseGranted` only after the grant is in the session-locked data. ProfileStore's docs show the pattern.

## 5. State and UI

UI is where codebases rot fastest. Separate **view** (Instances, layout) from **behaviour** (controllers deciding what to show) from **state** (the data shown).

UI libraries, all on Wally:
- **React (react-lua, jsdotlua)**: Roblox's own port, used in the Roblox app itself. Largest ecosystem, familiar to web developers, hooks. Recommend for UI-heavy games and teams with web experience.
- **Fusion** (elttob): reactive state objects and declarative Instances, very Roblox-native. Version 0.3 changed the API (scopes); make sure examples match the installed version.
- **Vide**: small, fast, fine-grained reactivity (Solid-like).
- **Plain Instances built in code or authored in Studio**: fine for small HUDs. Authored-in-Studio UI kept in `ReplicatedStorage.Assets.UI` and cloned by controllers is the pragmatic choice when UI artists work in Studio.

Shared state:
- **Charm** (atoms) or **Reflex** (Redux-like producers) hold client state and can sync server state to clients in a structured way.
- For small games, Attributes on the Player plus a Controller that reads them are enough.

UI rules regardless of library: scale-based sizing with min/max constraints, 44 px minimum touch targets, nothing important under the top bar or the mobile thumbstick/jump zones, and test on the phone emulator (most players are on mobile).

**Default:** React for teams that will build a lot of UI; plain Instances or Studio-authored UI for small HUDs. Pick one per project.

## 6. Signals, cleanup, async

- **Signal** (sleitnick/signal, or GoodSignal/LemonSignal): module-to-module events. Don't use BindableEvents for that (they copy tables and lose metatables).
- **Trove** (sleitnick), or Janitor / Maid: collect connections, Instances and cleanup functions; destroy once. Per-player troves created on join and destroyed on leave remove a whole class of leaks.
- **Promise** (evaera/promise): composable async with cancellation, useful for chains of yielding calls (load, then purchase, then grant) and timeouts. Many teams use plain `task` functions instead; pick one style per codebase.
- `task.spawn`, `task.defer`, `task.delay`, `task.wait` only: never the deprecated `spawn`, `delay`, `wait`.
- Every `while true do` loop needs an exit condition tied to the thing it serves (the player, the round, the instance).

## 7. Types and module conventions

- `--!strict` on every file (the scaffold sets it in `.luaurc`). Use luau-lsp with a Rojo sourcemap so Instance paths (`script.Parent.Services`) are typed.
- Export shared types from `shared/Types.luau` (or next to the module that owns them) and import with `require` for `Types.PlayerData`.
- Module shape: services first at the top (`local Players = game:GetService("Players")`), then requires sorted, then constants, then the module table, private functions, public methods, `return`.
- Public API on the returned table, PascalCase methods. Private helpers as `local function` above.
- `table.freeze` config tables so nobody mutates shared data by accident.
- Avoid deep inheritance; prefer composition and small modules.

## 8. Errors, logging, analytics

- Errors in one module must not kill others: the Loader and Component binder catch and report with names.
- Log with context: `warn(`[Shop] {player.UserId} bought {itemId} failed: {err}`)`. Studio Output and the Creator Hub error report (Error Report / Logs in Analytics) are where you'll read them.
- Instrument with `AnalyticsService`: `LogOnboardingFunnelStepEvent` (first-time user flow), `LogFunnelStepEvent` (shops, recurring flows), `LogEconomyEvent` (every source and sink of each currency, done in one place like `CurrencyService`), `LogProgressionEvent`, `LogCustomEvent`. Put the calls in the owning Service, not scattered in UI.
- Feature flags: a `Config/Flags.luau` for code-level switches; for live toggles without a deploy, read a value from a DataStore/MemoryStore or Roblox's experience configs if your team uses them, on the server, with a safe default.

## 9. Performance and scale

- **StreamingEnabled on** for anything bigger than a small map. Client code must expect instances to be missing (`WaitForChild` with care, or components bound by tags, which stream in and out cleanly). Use `ModelStreamingMode` (Atomic/Persistent) for models clients must have whole.
- Server: avoid per-frame work per player; prefer events and timers. Hitboxes with spatial queries (`GetPartBoundsInBox`, `Raycast`) on the server, cosmetic VFX on clients.
- Client: one RenderStepped/Heartbeat connection per system, not per object, when there are hundreds of objects (move the loop into a Controller that iterates a set).
- Don't create and destroy hundreds of Instances per second; pool them.
- Profile with the MicroProfiler (Ctrl+F6) and Developer Console (F9: memory, network, scripts) before optimising.
- Parallel Luau (Actors) for heavy, independent computation (pathfinding batches, procedural generation); not a default.

## 10. Monorepo / multi-place games

Games with a lobby plus match places, or several worlds, use one repo with several Rojo project files:

```
default.project.json         lobby place
places/match.project.json    match place
src/shared/                  shared by every place
src/lobby/{server,client}/
src/match/{server,client}/
```

Each project file maps `src/shared` plus its own folders. Teleport with `TeleportService:TeleportAsync` and `TeleportOptions:SetTeleportData` for non-sensitive data only (the client can read and forge teleport data; anything that matters goes through DataStores/MemoryStores keyed by the player or a reserved server code).
