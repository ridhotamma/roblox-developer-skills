# Anti-cheat design

## Contents
1. Layers
2. Movement detection
3. False positives and how to avoid them
4. Combat validation
5. Auto-farming and macro detection
6. The response ladder
7. Bans
8. Logging and review
9. Client-side checks
10. Server authority

---

## 1. Layers

1. **Prevention**: server-authoritative design and validated remotes (remote-security.md). Stops the exploits that matter most, with no false positives.
2. **Detection**: server-side sanity checks where the client must be trusted a little (movement, timing, aim). Produces suspicion, with some false positives.
3. **Response**: proportional actions on suspicion (correct, ignore, kick, ban), logged and reviewable.
4. **Deterrence**: client-side checks and obscurity. Raises the effort for casual exploiters only.

Spend effort in that order.

## 2. Movement detection

Run on the server, every 0.25–0.5 s per player (kit: `AntiCheatService`). For each player with a live character, compare the root part's position with the last **valid** position:

| Check | Test | Notes |
|---|---|---|
| Speed | horizontal distance / elapsed > `WalkSpeed × tolerance + allowance` | Read the current `WalkSpeed`, so legit speed boosts are covered if they set it on the server. Tolerance ~1.4, allowance ~6 studs/s for latency jitter. |
| Teleport | horizontal distance in one check > ~60 studs | Strong signal. Server teleports must reset the baseline (kit `:Teleport`). |
| Fly | airborne (server raycast finds no ground below) for > ~3 s while not descending, or rising more than jump height + margin above the last ground | Use a server raycast, not `Humanoid.FloorMaterial` (that comes from the client). |
| Noclip | raycast from last valid to current position hits an anchored, collidable part | Use `RaycastParams.RespectCanCollide` and the character's collision group, so doors set non-collidable and team-only walls don't trigger it. |
| Vertical teleport / void | large upward jump in one check | Same as teleport. |

On a failed check: flag with a weight, and **rubber-band** (move the character back to the last valid position and zero its velocity). Rubber-banding alone removes the advantage even before any kick, and it's harmless to an honest player who was lagging.

Seated players (vehicles, seats) are skipped or checked against the vehicle's max speed.

## 3. False positives and how to avoid them

Honest players trigger naive checks all the time. Sources and fixes:

| Cause | Fix |
|---|---|
| Server-side teleports, respawns, spawn selection | Reset baseline (`AntiCheatService:Teleport`), grace period after `CharacterAdded` |
| Dashes, launch pads, knockback, explosions, jump pads, trampolines, conveyors | Call `AntiCheatService:Grant(player, seconds)` when the game causes it |
| Speed boosts / slows | Set `WalkSpeed` on the server; the check reads it |
| Ragdoll / physics flings | Grant while ragdolled |
| Falling from high places | Falling is never flagged (only rising/hovering/moving sideways too fast) |
| Lag spikes (position updates arrive in bursts) | Allowance in studs/s, average over the elapsed time since last valid, decay the score so single spikes don't accumulate |
| Moving platforms / elevators | Measure movement relative to the platform, or grant while standing on one |
| Swimming, climbing, ladders | Treat as grounded (raycast hits terrain water/truss) or skip vertical checks |
| Low-end devices with low frame rate | Same as lag: allowance and decay |

Rule: **launch in observe mode** (log only), collect flags from real players for a few days, fix the causes, then enforce. Raising thresholds until no one is flagged also hides the cheaters; fix the specific cause instead.

## 4. Combat validation

The `roblox-combat` skill's kit implements the melee and hitscan/projectile patterns below (server hitboxes, rate and ammo checks, origin checks) together with the client-side feel.

The client can aim and time its own attacks; the server decides whether they land.

**Melee**: client sends "I swung" (and optionally the target it thinks it hit). Server checks: weapon equipped (server-tracked), cooldown on server clock, target alive and not on the same team, distance from attacker's root to target's root ≤ range + latency margin (3–5 studs), optional facing check (`attackerLook:Dot(toTarget.Unit) > 0.3`) and line of sight raycast. Or the server runs its own hitbox query at swing time (`workspace:GetPartBoundsInBox` in front of the attacker); this is the most secure but feels laggy to high-ping players.

**Hitscan (guns)**: client sends origin and direction (and the target it hit). Server checks: origin within a few studs of the attacker's weapon/head position, fire rate from server clock, ammo tracked on server, then raycasts itself from the validated origin along the direction (with a small cone tolerance toward the claimed target) and applies damage only if the server ray, or a lag-compensated check against recent target positions, agrees.

**Projectiles**: server spawns or simulates them (or validates client-simulated hits by recomputing the trajectory from the validated launch time, origin and velocity).

**Lag compensation**: keep a short history (≈ 1 s) of each character's positions on the server and check hits against where the target was `ping` seconds ago (`player:GetNetworkPing()`), capped (e.g. 250 ms) so high ping can't be abused.

**Aimbots** can't be fully detected on the server. Signals: inhuman accuracy over many shots, snapping (angle change per shot), headshot ratios far above the population. Use these for review queues, not automatic bans.

## 5. Auto-farming and macro detection

Exploiters fire farm remotes in loops; macro users play AFK.
- Rate limits and cooldowns cap the gain.
- Require presence: rewards need the character near the resource (server check).
- Diminishing returns per minute for the same activity.
- Flag sustained perfect intervals (variance of time between requests near zero over hundreds of requests).
- Decide whether AFK grinding is acceptable for the genre (many simulators allow it with an idle timer); punish only remote abuse.

## 6. The response ladder

| Certainty | Example | Response |
|---|---|---|
| Low (could be lag) | single speed spike | rubber-band, small flag weight |
| Medium | repeated speed/fly flags, melee out of range many times | rubber-band, accumulate; kick when the decaying score crosses a threshold |
| High | teleport across the map, noclip through a sealed wall | heavy flag; kick |
| Certain | honeypot remote fired, impossible remote values (NaN positions, item ids that don't exist, 500 req/s) | ban (enforce mode) |

Score with decay (kit: half-life 60 s by default) so honest players' rare spikes fade, while continuous cheating crosses the threshold fast. Never ban on heuristics alone; ban on certain evidence or after human review of logs.

## 7. Bans

`Players:BanAsync` bans across the experience (all places with `ApplyToUniverse = true`), for a `Duration` in seconds (`-1` = permanent), with a `DisplayReason` shown to the player and a `PrivateReason` for your records. `ExcludeAltAccounts = false` lets Roblox's alt-account detection extend the ban to suspected alts. `UnbanAsync` reverses; `GetBanHistoryAsync` lets you escalate repeat offenders (first ban 1 day, then 7 days, then permanent).

- Always pcall it; it yields and can fail.
- Never ban in Studio or for staff/test accounts (kit checks both).
- Write the reason and evidence to a log the team can review, and have an appeal path (group/community form) for mistakes.
- Old DataStore-based ban lists still work for custom logic (e.g. trade bans) but the Ban API is the default for game bans.

## 8. Logging and review

- Log every flag with player id, reason, weight, score, position, and a short detail string (kit: `[AntiCheat]` warn lines plus `AnalyticsService:LogCustomEvent`).
- Server logs are visible in the Developer Console (F9 → Server) and Creator Hub error/log reports. For a persistent audit trail, write important events (bans, big trades, large currency changes) to a DataStore or an external service via `HttpService` with a secret key (never a client-visible webhook).
- Review the top flagged players and the most common flag reasons weekly. A reason that flags many players is a false-positive bug.

## 9. Client-side checks

They can be removed by an exploiter, so they're only worth it when cheap and quiet:
- Detecting obviously modified state (unexpected GUIs in CoreGui aren't readable; but unexpected instances in the character, impossible local WalkSpeed/JumpPower values, removed client scripts) and reporting through an innocuous remote.
- Never put the response logic, thresholds or the list of checks in a readable place with obvious names.
- Treat client reports as hints for the server (flag weight 1–2), never as ban evidence. A client report is only ever about the player who sent it (the remote's `player` argument), so one player can't get another punished this way; make sure the handler never takes a target player from the arguments.

## 10. Server authority

Roblox offers an engine-level server authority model: the server simulates the game, clients send only inputs and predict locally, and the server corrects them. With it, movement exploits (speed, fly, noclip, teleport) stop working, because the client's position is not trusted. It's recommended for competitive genres (shooters, fighting, racing, sports). Check the current Roblox documentation for availability and setup; when a game uses it, the movement checks in the kit become unnecessary, but remote validation remains essential.
