---
name: roblox-security
description: Protect Roblox games from exploiters and cheaters - threat-model features against what an exploit client can really do, harden RemoteEvents and RemoteFunctions (type, NaN, range, ownership, distance, cooldown and rate checks), make combat, shops, trading and currencies server-authoritative, detect speed, fly, noclip and teleport hacks on the server, catch exploiters with honeypot remotes, respond with a flag-score ladder and the Roblox Ban API, prevent item duplication and purchase abuse, and find backdoors in free models and plugins. Ships a server-side anti-cheat kit (Validate, Sanctions, AntiCheatService) and a scanner that audits Rojo source folders or .rbxlx place files for backdoors, unsafe remotes, leaked secrets and other exploitable patterns. Use this whenever the user mentions exploiters, hackers, cheaters, anti-cheat, anti-exploit, securing remotes, "never trust the client", duplication glitches, someone giving themselves money, flying or speed hackers, free-model viruses or backdoors, banning players, or asks whether a script is safe, even if they don't say "security".
---

# Roblox security and anti-cheat

An exploiter controls their own Roblox client completely. They can read every LocalScript and every ModuleScript in ReplicatedStorage, run their own code, fire any remote with any arguments at any rate, move their character anywhere, and trigger Touched events and ProximityPrompts from across the map. What they cannot do is run code on the server or change server state directly. So security on Roblox is one idea applied everywhere:

**The server owns every decision that matters. The client only sends requests and shows results.**

Client-side anti-cheat is a speed bump (exploiters delete or hook it). Real protection is server code that would be correct even if every client were hostile. Detection and bans are a second layer, for the cases where the server must give the client some trust (character movement, timing).

## Decide the mode

| The user wants... | Do this |
|---|---|
| To know if their game is exploitable | Run the scanner on their source or place file (below), then review the remotes and money paths by hand with `references/remote-security.md`. Report findings by severity with file and line, and the fixed code. |
| To secure a feature (shop, combat, trade, quest, admin panel) | Threat-model it with the questions below, then write the server handler with full validation. Show the vulnerable version only if they wrote one. |
| An anti-cheat system | Install the kit (below), configure it, launch in **observe** mode, read the flags, tune, then switch to **enforce**. Explain why movement detection needs tolerances. |
| To deal with an active incident (dupes, someone giving themselves money, flyers everywhere) | Follow the incident steps in `references/economy-data-supply-chain.md`: stop the bleeding (patch or disable the remote), find the hole from logs, roll back affected data, ban, then fix properly. |
| To check a free model, plugin or script for backdoors | Scan it, then read every flagged line. Explain what the code does in plain words. When in doubt, remove it. |

## Threat-model every feature

For each thing a client can trigger, answer these. If any answer is "the exploiter wins", the server is trusting the client.

1. **What if they send any value?** Wrong type, `nil`, NaN, ±inf, a negative number, a 10 MB string, a deeply nested table, an Instance they shouldn't touch, another player's id.
2. **What if they send it 1,000 times a second?** Rate limits, cooldowns on the server clock, debounce per player.
3. **What if they skip steps?** Calling "claim reward" without finishing the quest; "sell" without "buy"; "end round" mid-round. The server must track state and reject out-of-order requests.
4. **What if they're somewhere else?** Touching the coin from 500 studs away, using a shop without standing at it, hitting someone behind a wall.
5. **What if two requests race?** Two trades of the same item, a purchase during a server shutdown, two servers editing the same data (that's what ProfileStore's session lock prevents).
6. **What do they learn by reading the client?** Everything in ReplicatedStorage, ReplicatedFirst, StarterGui, StarterPlayer and Workspace is readable. Secrets, admin lists, webhook URLs, server logic, and anti-cheat thresholds never go there.

`references/threat-model.md` lists exactly what replicates from client to server and what an exploit can and can't do. Read it when unsure whether something is trusted.

## Rules that stop most exploits

1. **Requests, not results.** `BuyItem(itemId)`, never `AddCoins(500)`. `Attack(targetId)` or `Swing()`, never `DealDamage(target, 50)`. The server looks up prices, damage and rewards in its own config.
2. **Validate every argument** with `typeof`, ranges that reject NaN and infinity, string length limits, and allow-lists (`Validate` in the kit does this in one line per argument). Reject silently; don't explain the check to the client.
3. **Check context on the server:** alive, owns the item, can afford it, within range of the target or shop, has line of sight, off cooldown, in the right state.
4. **Rate-limit every client → server remote** (the scaffold's `Net.Handle` does this) and cap payload size.
5. **Never `InvokeClient`.** A client can hang or error the server thread. Server → client is events only.
6. **Touched, ProximityPrompt and ClickDetector rewards get a distance check** on the server, because exploits fire them from anywhere.
7. **Money, items and stats live only in server data** (ProfileStore, session-locked). Attributes, leaderstats and UI are displays.
8. **Grant purchases only in `ProcessReceipt`**, idempotently (store the `PurchaseId`), never from `PromptProductPurchaseFinished`.
9. **Server-only code stays server-only:** ServerScriptService and ServerStorage. Secrets go in Creator Hub secrets (`HttpService:GetSecret`), not in code.
10. **No `require(assetId)`, `getfenv`, `loadstring` or obfuscated code** from free models or plugins. These are the backdoor patterns; `LoadStringEnabled` stays off.

## The anti-cheat kit

`assets/kit/` holds drop-in server modules that fit the `roblox-project-structure` layout (they also work standalone; adjust the `require` paths):

| File | Put it at | Does |
|---|---|---|
| `SecurityConfig.luau` | `ServerScriptService.Server.Security` | Mode (`observe` / `enforce`), thresholds, exempt user ids, honeypot names. Server-only so exploiters can't read the thresholds. |
| `Validate.luau` | `...Server.Security` | Argument checks that return a cleaned value or `nil`: `Number`, `Integer`, `String`, `OneOf`, `Vector3`, `Instance`, `Array`, `Near`, `Cooldown`. |
| `Sanctions.luau` | `...Server.Security` | Decaying suspicion score per player, logging and analytics, kick at a threshold, `Ban` through `Players:BanAsync`. Never kicks or bans in Studio or for exempt users; in observe mode it only logs what it would have done. |
| `AntiCheatService.luau` | `...Server.Services` | Movement checks every 0.5 s (speed, teleport, fly, noclip with server raycasts), rubber-banding to the last valid position, honeypot remotes, and `:Grant()` / `:Teleport()` so the game's own dashes, knockback and teleports don't trigger it. |

Install steps to give the user:
1. Copy the four files into place (the Services one is picked up by the Loader automatically).
2. Set `ExemptUserIds` to the developers and testers, keep `Mode = "observe"`.
3. Call `AntiCheatService:Teleport(player, cframe)` instead of moving characters directly, and `AntiCheatService:Grant(player, seconds)` before any legit fast movement (dash, launch pad, knockback, vehicle exit). Games that change `WalkSpeed` need nothing extra: the check reads the current value.
4. Play normally for a while (and let real players play) and read the `[AntiCheat]` lines in Output / the server logs. Every flag on an honest player is a false positive to fix by granting or tuning, not by raising the threshold blindly.
5. Switch to `Mode = "enforce"`.

Use `Validate` and `Sanctions.Flag` inside the game's own remote handlers: a request with an impossible value (NaN position, item they don't own, attack from 200 studs) is evidence; flag it with a weight that matches how certain it is.

For competitive games (shooters, fighting, racing, sports), also tell the user about Roblox's **server authority** model (the engine simulates authoritatively and clients only send input), which removes whole classes of movement exploits; check the current Roblox docs for its status and setup. `references/anticheat.md` covers combat hit validation, response design and what client-side checks are still worth having.

## Scanning code for problems

```bash
node <skill>/scripts/scan.cjs <path> [--json] [--min low|medium|high|critical]
```

`<path>` is a Rojo `src` folder, a single `.lua`/`.luau` file, or a place/model saved as XML (`.rbxlx` / `.rbxmx`; binary `.rbxl` files can't be read, so ask the user to File → Save As `.rbxlx` or right-click → Save to File for a model). Needs only Node.

It reports by severity with path and line:
- **critical**: backdoor patterns (`require(<asset id>)`, `getfenv`/`setfenv`, `loadstring`, `LoadStringEnabled` on, heavily obfuscated strings), granting purchases from `PromptProductPurchaseFinished`
- **high**: `InvokeClient`, remotes whose names say the client decides outcomes (`GiveCoins`, `SetLevel`, `DealDamage`), webhook URLs or API keys in code, server-only APIs in client-visible code, `ProcessReceipt` without a `PurchaseId` check
- **medium**: remote handlers with no visible type checks, Touched/ProximityPrompt rewards with no distance check, `_G`/`shared` state
- **low/info**: external HTTP domains, Scripts inside Workspace models (where free-model backdoors hide)

It's a fast pattern scan, not a proof of safety: zero findings doesn't mean secure. Always read the flagged code yourself, review every `OnServerEvent` / `OnServerInvoke` handler and every money path by hand, and say plainly which findings are confirmed and which are heuristic.

## Output style

- Lead with the worst problem and its consequence in player terms ("anyone can give themselves unlimited coins").
- For each finding: where (path:line), why it's exploitable (what the exploiter sends), the fixed code.
- Don't publish or explain working exploit code. Describe attacks at the level needed to fix them ("an exploit can fire this remote with amount = 1e9").
- Give a ranked fix list: data loss and free currency first, then griefing other players, then cosmetic cheating.

## References

- `references/threat-model.md` — what exploit clients can and can't do, what replicates, network ownership, the trust boundary for each Roblox feature.
- `references/remote-security.md` — validation patterns, vulnerable → fixed examples (shop, damage, tools, teleports, trades, admin commands, chat/text), payload limits, state machines, idempotency, honeypots.
- `references/anticheat.md` — movement detection design and false positive sources, combat hit validation (melee, hitscan, projectiles), response ladder, bans and appeals, logging, client-side checks, server authority.
- `references/economy-data-supply-chain.md` — duplication and how to prevent it, trading, purchases, rollbacks, audit logs, incident response, backdoors in free models and plugins, secrets, admin systems, team account security.
- `assets/kit/` — the server modules described above.
- `scripts/scan.cjs` — the scanner. `scripts/selftest.cjs` checks its rules; run it after editing the scanner.
