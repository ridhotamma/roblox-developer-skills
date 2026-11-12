# Audit checklist and migration plan

Collect evidence before judging: the Explorer tree (screenshot or `rojo sourcemap` / file listing), every place RemoteEvents and RemoteFunctions are created or listened to, every `DataStoreService` / `GetDataStore` use, the biggest scripts, and anything in Workspace that is a Script. Then grade each area and cite paths.

Severity: **Critical** (players lose data/items, or exploiters can grant themselves things) → **High** (crashes, leaks, server lag, security weakness) → **Medium** (slows the team, causes bugs over time) → **Low** (tidiness).

## Smells

### Networking / security
| Smell | How to spot it | Severity | Fix |
|---|---|---|---|
| Client tells server outcomes (`GiveCoins:FireServer(100)`, `DealDamage:FireServer(target, 50)`, `SetStat`) | search `FireServer(` / `InvokeServer(` and read handler args | Critical | Turn into a request; server computes amounts from Config and state. |
| Handlers without type/range checks | `OnServerEvent:Connect(function(player, x)` then `x` used directly | Critical/High | `typeof` checks, NaN/inf rejection, ownership + distance checks. |
| No rate limiting on spammable remotes | handlers with no cooldown | High | Token bucket per player (scaffold `Net.RateLimiter`). |
| Server → client `InvokeClient` | search `InvokeClient` | High | Replace with an event; never wait on a client. |
| Remotes created in many scripts / stored all over | `Instance.new("RemoteEvent")` in several files, remotes inside tools and models | Medium | One declaration list (`shared/Net`). |
| Server-only code in ReplicatedStorage | data/anti-cheat/admin modules visible to clients | High | Move to ServerScriptService / ServerStorage. |

### Data
| Smell | How to spot it | Severity | Fix |
|---|---|---|---|
| Raw `SetAsync` / `GetAsync` without session locking | search `GetDataStore` | Critical | ProfileStore in one `DataService`. |
| Save on PlayerRemoving only, no BindToClose, no autosave | read the save code | Critical | ProfileStore handles all three. |
| Several scripts saving different keys for the same player | multiple `GetDataStore` calls | High | One profile per player, one owner. |
| Leaderstats `IntValue`s as the source of truth | data read back from `leaderstats` to save | High | Data table is truth; leaderstats/Attributes are a display mirror. |
| `ProcessReceipt` defined twice or granting without recording `PurchaseId` | search `ProcessReceipt` | Critical | One PurchaseService; idempotent grants stored in the profile. |

### Structure and lifecycle
| Smell | How to spot it | Severity | Fix |
|---|---|---|---|
| Scripts inside parts/models in Workspace (kill bricks, doors, coins each with a copy) | Explorer: Script icons under Workspace | Medium (High if hundreds) | Tag + one Component. |
| Many top-level Scripts/LocalScripts with implicit start order | count runnable scripts in services | Medium | One `Main` per side + Loader. |
| `_G` / `shared` globals, `wait()` / `spawn()` / `delay()` | search | Medium | Module returns; `task.*`. |
| Connections never disconnected; per-player loops that never end | `while true do` without exit, `.Touched:Connect` inside `CharacterAdded` with no cleanup | High | Troves tied to player/character/instance lifetime. |
| Duplicate copies of the same helper | same function body in several scripts | Medium | `shared/Util`. |
| Hard-coded numbers in logic (prices, cooldowns) | magic numbers in Services | Medium | `shared/Config`. |
| God script (one 2,000+ line Script) | line counts | Medium | Split by data ownership into Services. |
| Free-model scripts of unknown origin | odd names, `require(<number>)`, `getfenv`, obfuscated strings | Critical | Remove; `require(assetId)` of unknown modules is a backdoor pattern. |

### Performance
| Smell | How to spot it | Severity | Fix |
|---|---|---|---|
| Per-object RenderStepped/Heartbeat for hundreds of objects | many connections in components | Medium | One loop per system over a set. |
| VFX/tweens/sounds computed on the server | `TweenService` on cosmetic parts in server scripts | Medium | Fire to clients; animate there. |
| StreamingEnabled off on a large map; or on, with client code assuming everything exists | Workspace property; `workspace.Map.X.Y` on client without WaitForChild | High | Turn on, use components/WaitForChild with timeouts. |
| Remote spam (FireAllClients every frame) | Network tab in F9 console | High | Batch, throttle, replicate state instead. |

### Tooling
| Smell | Severity | Fix |
|---|---|---|
| No version control beyond Studio history, multiple scripters | Medium | Rojo + Git. |
| No formatter/linter | Low | StyLua + Selene, then CI. |
| Single experience for dev and prod | High | Separate staging experience. |

## Report format

```
## Summary
One paragraph: overall health, the one or two things that must change first.

## Scores
| Area | Grade | Evidence |
| Networking & security | broken | `ReplicatedStorage.Events.AddCash` handler in `ServerScriptService.Cash` adds the client-sent amount |
...

## Fix first (Critical/High)
1. ... (path, why it matters, the fix in one or two sentences)

## Migration plan
Stage 1..n as below, adapted to what was found.
```

## Staged migration (keeps the game shippable at every stage)

Each stage is one PR-sized change, testable on the staging experience before production.

0. **Safety net.** Back up the place (File → Save to File). Create a staging experience if there is none. Fix any Critical exploit or data issue immediately in place, even if ugly; structure can wait, exploits cannot.
1. **Tooling.** Add Rojo in partially managed mode mapping only new empty folders (`Shared`, `Server`, `Client`), plus Rokit, StyLua, Selene, Git. Nothing moves yet.
2. **Entry points.** Add the Loader and `Main` scripts. New code from now on goes in Services/Controllers. Old scripts keep running.
3. **Networking.** Create `shared/Net` and declare every existing remote in it (same names, so old scripts keep working). Add validation and rate limits to each server handler, worst first.
4. **Data.** Introduce `DataService` on ProfileStore. If the old data lives in a different DataStore, migrate lazily: on load, if the profile is new and the legacy key exists, import it once and mark `Migrated = true`. Keep the old store read-only; never delete it during the migration.
5. **Systems.** Move old scripts into Services/Controllers one system at a time, deleting the old script in the same PR. Move hard-coded numbers into Config while you're there.
6. **Components.** Replace Scripts-in-parts with tags: tag all instances (a command-bar loop over the old script's parents), add the component, delete the copies.
7. **UI.** Separate view and behaviour; adopt a UI library only when rebuilding screens anyway.
8. **CI and deployment.** Add the workflow, then automated publish to staging.

Order can bend (data before networking if data loss is the bigger fire), but each stage must leave the game working.
