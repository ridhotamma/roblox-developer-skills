# Economy, data and supply-chain security

## Contents
1. Duplication: how it happens, how to prevent it
2. Trading
3. Purchases (Robux)
4. Audit logs
5. Incident response
6. Backdoors in free models, plugins and packages
7. Secrets
8. Admin systems
9. Team and account security

---

## 1. Duplication

Dupes come from the same item existing in two places at once. Causes:

| Cause | Prevention |
|---|---|
| Two servers editing the same player's data (server hop during save, trade + rejoin) | Session locking: ProfileStore. Never load data without a lock. |
| Saving after a trade on one side only (crash between two saves) | Both players' profiles are session-locked and live in the same server; the swap mutates both live tables in one step, and ProfileStore saves both. For cross-server trades, use a single authority (MemoryStore queue + one server applying it) and unique item ids. |
| Yield in the middle of a check-then-act (`if has(item) then ... task.wait() ... remove(item)`) | Do the check and the mutation without yielding between them; mark items as locked first. |
| Client-sent item ids reused | Unique ids (GUIDs via `HttpService:GenerateGUID(false)`) for tradeable items; validate ownership by id. |
| Re-entrant remote calls | Per-player locks/busy flags, rate limits, state machines. |
| Granting before persisting purchases | See section 3. |

**Detecting dupes**: tradeable items carry unique ids and an origin record (who created it, when, how). A periodic job or an on-load check flags any id seen in two inventories. Logs of item creation by source show impossible amounts (one player creating 10,000 of an item that drops once an hour).

## 2. Trading

- Server-held trade session: both offers stored server-side, re-validated (ownership, tradeable, not locked) on every change and again at completion.
- Any change resets both confirmations; a short countdown (3–5 s) after both confirm, so last-second swaps can't trick a player.
- Items in a trade are locked (can't be sold, equipped, or put in another trade).
- Swap atomically, then log the trade with both inventories' item ids.
- Anti-scam UX: show exactly what each side gives, with values; warn on very uneven trades.
- Limits for new accounts (account age, time played) reduce bot and alt abuse; Roblox's Device Trust API can feed extra restrictions for low-trust devices.

## 3. Purchases (Robux)

- Developer Products are granted **only** in `MarketplaceService.ProcessReceipt`, which exists once in the whole server (one `PurchaseService`).
- Inside it: find the player's loaded profile (if not loaded, return `NotProcessedYet`; Roblox retries), check whether `receiptInfo.PurchaseId` is already recorded in the profile (if so, return `PurchaseGranted`), grant, record the `PurchaseId` (keep the last ~50), and return `PurchaseGranted` only once the grant is in the session-locked data. ProfileStore's docs show this pattern with `profile:Save()` / waiting for the save.
- `PromptProductPurchaseFinished` and `PromptGamePassPurchaseFinished` fire from client-observed events: they're for UI only. A grant there is free items for exploiters.
- Game passes: check ownership with `MarketplaceService:UserOwnsGamePassAsync` on the server (cache per session), plus the purchase-finished event for immediate unlock (verifying `wasPurchased` on the server).
- Never let the client say which product it bought or how much it paid.

## 4. Audit logs

Log, on the server, with player id, amounts and reason:
- every currency source and sink (`AnalyticsService:LogEconomyEvent`, plus your own log for large amounts)
- item creation (with source), trades, deletions
- purchases (PurchaseId, product, grant result)
- admin actions
- anti-cheat flags, kicks and bans

Keep logs where the team can query them (a DataStore keyed by day, or an external service through `HttpService` with a secret). Logs turn "someone has a billion coins" into "player X got them from source Y at time Z", which tells you which hole to fix.

## 5. Incident response

When an exploit is live (currency inflation, dupes, griefing waves):

1. **Stop the bleeding**: disable the vulnerable feature (a server-side kill switch flag in config, read live from a DataStore/MemoryStore, or a hotfix publish + migrate servers). Disabling a shop for an hour beats a ruined economy.
2. **Find the hole** from logs: which source produced the anomaly, which remote, which players first.
3. **Patch** with full validation (remote-security.md) and test on staging.
4. **Roll back** affected players: ProfileStore keeps DataStore versions (`ProfileStore:VersionQuery`, `GetAsync` with a version) so a profile can be restored to before the exploit. Remove duped items by id. Communicate clearly with honest players affected.
5. **Sanction** the exploiters with evidence (BanAsync), escalating for repeat offenders.
6. **Post-mortem**: add a test or a scanner rule so the same class of bug can't come back; add monitoring for the anomaly.

## 6. Backdoors in free models, plugins and packages

Backdoors give an attacker server-side code execution in your game (they can then do anything: give admin, insert inappropriate content that gets the game moderated, steal data).

How they hide:
- `require(123456789)` or `require(tonumber("..."))`: loads a module from the asset library that the attacker can update at any time.
- `getfenv`/`setfenv`, `loadstring`, string-built function names, `string.char`/escape-encoded strings, very long lines, `string.reverse`, names that look like Roblox internals (`Script`, `Vaccine`, `Anti-Virus`, `Fix`, `Weld`), scripts deep inside models (a part inside a mesh inside a tree).
- Plugins that insert scripts into the game when run, or that ask for script injection permission without reason.
- HttpService calls to unknown domains, especially sending `game.JobId`, player lists or running returned code.

Prevention:
- Prefer assets from trusted creators or made by the team. Before using any model, search it for Scripts (Explorer filter `ClassName = Script` / `LocalScript` / `ModuleScript`), and delete ones you don't need and understand.
- Run the scanner on the place file regularly (save as `.rbxlx`) and before each release.
- Keep `ServerScriptService.LoadStringEnabled` off.
- Review plugin permissions (script injection, HTTP domains) in Studio's plugin manager; uninstall plugins you don't use.
- Packages via Wally from known authors; pin versions; review diffs on updates.
- Keep `HttpService.HttpEnabled` on only if needed, and know every domain the game calls.

## 7. Secrets

- API keys, webhook URLs and tokens go in the experience's secrets store (Creator Hub) and are read on the server with `HttpService:GetSecret(name)`, which returns a `Secret` that can only be used in HTTP requests, not printed or sent to clients.
- Never put them in code, in a ModuleScript in ReplicatedStorage, in Attributes or in StringValues. Anything client-visible is public; a leaked Discord webhook gets spammed.
- Rotate any secret that has ever been in a client-visible place or a public repo.

## 8. Admin systems

- Admin authority is decided on the server from a server-side list or group rank, checked on every command.
- Admin UI on the client is fine (it's just UI); the remotes behind it validate the sender.
- Log every admin action; give moderation tools (kick, ban, rollback) only to people who need them.
- Popular admin script packages are fine from their official sources; copies from free models often carry backdoors.

## 9. Team and account security

Most "hacked games" are hacked accounts:
- 2-step verification on every account with edit access; prefer group-owned experiences with role-based permissions.
- Give collaborators the minimum role; remove access when people leave.
- Open Cloud API keys scoped to the minimum (only the place they publish, only needed permissions), stored as CI secrets, with IP restrictions and expiry where possible.
- Beware of "collaboration offers", fake plugin updates and Studio files from strangers.
