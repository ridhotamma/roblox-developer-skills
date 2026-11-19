# Finishers: executions, takedowns, glory kills and grabs

A finisher is a short paired animation that ends a fight with an enemy: Resident Evil 4's kicks and suplexes, Call of Duty's finishing moves, Doom's glory kills, God of War's and Sekiro's executions, Batman Arkham's takedowns. Done well it's punctuation: a reward for creating an opening, a breather, a show of power. Done badly it's an unskippable interruption that plays twenty times an hour.

Contents: 1 What makes one work · 2 Reference designs · 3 Openings · 4 Choosing the move · 5 Camera · 6 Feel on the contact frame · 7 Multiplayer and fairness · 8 The kit's flow · 9 Writing a new move · 10 Integration with the combat and ragdoll kits · 11 Troubleshooting

---

## 1. What makes one work

1. **Earned, not random.** The player creates the opening (a headshot, a leg shot, a parry, sneaking behind), so the finisher is a reward for skill.
2. **Readable opening.** The enemy visibly changes state (staggers, drops to a knee, glows) and a prompt appears on it with the move's name: "[F] Suplex". The player always knows why it's available.
3. **Short.** 0.8–2.5 s. A finisher you'll see a hundred times must not outstay its welcome. Doom glory kills are around a second; long cinematic ones are kept rare (bosses, stealth).
4. **Variety without randomness that confuses.** Different moves for different positions and postures (front, back, kneeling), and no immediate repeats.
5. **A payoff beyond spectacle.** Doom drops health, RE4's kick clears a crowd, stealth kills are silent. The reward makes players seek openings.
6. **Never accidental.** It shouldn't fire when the player meant to attack. Use a dedicated key or a short hold (CoD).
7. **Respect the fight.** Invulnerability or not is a design decision (§7); either way, other enemies shouldn't hit an invisible target or wait politely forever.

## 2. Reference designs

| Game | Opening | Input | Notes |
|---|---|---|---|
| Resident Evil 4 (2005 / 2023) | shoot the head (stagger) or the leg (drops to a knee); parry in the remake | context prompt, one press | standing stagger → roundhouse kick that hits everyone near; kneeling and you're **behind** → suplex; the move depends on posture and side |
| Call of Duty (MW 2019 onwards) | approach from behind | **hold** melee | instant kill, third-person camera for the duration; you're exposed while it plays, so it's a risk/reward choice |
| Doom (2016, Eternal) | low health → enemy staggers and glows | melee while glowing | ~1 s, first person, invulnerable, drops health; the core loop of the combat |
| Sekiro | break the posture bar or stealth | attack on the deathblow mark | first person in the gameplay camera, short |
| Batman Arkham | stun / knockdown, or from behind (silent) | context button | camera often slows and orbits for the last hit of a fight |
| God of War (2018) | stun meter full | context button | executions kept in the one-take camera |

The kit ships one move per pattern: `Kick` (RE4 stagger, front, crowd knockback, non-lethal), `Suplex` (RE4 kneel, from behind, lethal, cinematic cuts), `BackStab` (CoD, unaware, from behind, hold), `GloryKill` (Doom, low-health stagger, front, heals) and `Grab` (enemy-initiated with struggle and counter QTEs).

## 3. Openings (postures)

Moves require a **posture** on the victim; the server sets the `Posture` attribute for a few seconds:

| Posture | Set by (kit default) | Duration |
|---|---|---|
| `Stagger` | a head hit (`HeadshotStagger`), the combat kit's own stagger state, or dropping under `LowHealth` (once per life) | 2.5 s (3 s low health) |
| `Kneel` | a leg hit (`LegHitKneel`) | 2.5 s |
| anything you like | `FinisherService:SetPosture(model, "Down", 3)` from your code (knockdowns, parries, stun grenades) | your choice |

Plus **awareness** for stealth moves: an enemy whose `State` attribute is in `UnawareStates` (`Idle`, `Patrol`) counts as unaware (the combat kit's EnemyService sets `State`).

Show the opening on the enemy itself, not only in the prompt: a stagger/kneel animation (`PostureAnimations`), a glow (Doom's orange/blue flash), a sound. The prompt alone makes players stare at UI.

## 4. Choosing the move

`Finisher.Choose` runs on the client (to label the prompt) and again on the server (to decide), with the same rules:

1. Filter by the move's `Requires`: posture, side (front/back/left/right, 90° each), health fraction, awareness, range, height difference, victim kinds.
2. Highest `Priority` wins (so `GloryKill` (2) beats `Kick` (1) when a staggered enemy is also nearly dead).
3. Among equal priority: not the move this player just did, then by `Weight` (random on the server).

The server adds tolerance: range slack (`RangeSlack`, 2.5 studs) and side tolerance (`SideTolerance`, 20°), because the client chose a frame or a round trip ago. It still re-checks everything, and checks there's room around the attacker's mark (`Clearance`), so you can't suplex someone into a wall.

## 5. Camera

Three styles, by how often the move is seen:

| Style | How | When |
|---|---|---|
| Gameplay-continuous | one shot close to the gameplay camera (over the shoulder), a little arc or pull-out, short blend in and out | frequent moves (Kick, CoD-style) |
| First person | `POV` from the attacker, then a cut on impact | Doom/Sekiro feel, first-person games |
| Cinematic | 2–3 cuts: wide, then the action, then a cut on impact | rare, big moves (Suplex, boss kills) |

Rules:
- Only the attacker (and a player victim) get the camera. Everyone else keeps their camera and simply sees it happen in the world (observers).
- Blend in fast (0.15–0.3 s) and out a little slower (0.35–0.6 s).
- No letterbox: it signals "you've lost control for a while", which is wrong for a 1-second move.
- Keep to one side of the attacker–victim line, judged at each cut (the coverage check handles throws where they swap places).
- Cut on the impact frame if you cut at all.

## 6. Feel on the contact frame

Stack these on the same frame (the roblox-combat skill explains the stack in depth):

- **Hit freeze** `Freezes = { { At = contact, Hold = 0.06..0.1 } }`: scene time stops for the whole scene, stand-ins included.
- **Shake** `Shakes = { { At = contact, Trauma = 0.4..1 } }`.
- **Sound**, close and dry, on the contact frame.
- **Slow motion** around the peak just before contact (`SlowMo`, 0.3–0.4× for 0.2–0.3 s), never across the whole move.
- **Ragdoll** the victim's stand-in just after contact (`Events: Ragdoll`), so it falls with physics (needs the roblox-ragdoll kit; without it the stand-in holds its last frame).

## 7. Multiplayer and fairness

- **Server decides.** The client only asks "finish this one"; the server picks the move from its own positions and attributes.
- **Invulnerability** (`AttackerInvulnerable`, `VictimInvulnerable`): an invisible ForceField on both during the move. The scene's own damage (Hit, Kill) bypasses it. Turn the attacker's off for CoD-style risk.
- **Others keep playing.** Observers see stand-ins; nothing about their camera or controls changes. Far-away players (`ObserverRange`) skip it.
- **The real bodies are frozen and hidden.** Enemy AI must not keep attacking from an invisible body: skip models with an `InCutscene` attribute in the AI's think loop (one line, see §10).
- **Cooldown** per attacker (`Cooldown`) stops chaining exploits; the request remote is rate limited.
- **PvP finishers** work the same (a player as victim gets the camera too); decide whether players can be finished at all with `Tags`.
- **Kill credit**: listen to `FinisherService.Performed (attacker, victim, moveName, killed)` for XP, quests and kill feeds.

## 8. The kit's flow

```
Enemy hit in the leg ─► FinisherService sets Posture = "Kneel" (2.5 s), plays the kneel clip
Client (every 0.1 s) ─► Finisher.Choose(...) for enemies in range ─► "[F] Suplex" over the enemy
Player presses F    ─► FinisherRequest(victim)
Server              ─► re-checks, chooses, checks clearance, Finisher.Align(...)
                    ─► CutsceneService:Play(move, { Origin, Actors = { Attacker, Victim },
                                                  CameraFor = both, Observers = true })
All clients         ─► hide real bodies, clone stand-ins, play both clips on the shared clock
Server timeline     ─► Kill at 1.75 s (Health = 0, FinisherKilled attribute)
End                 ─► real attacker placed at its end mark and unfrozen; the killed victim's
                       stand-in stays as the corpse until the real body is removed
```

Grabs run the other way: your enemy AI calls `FinisherService:Grab(enemy, player)` when its grab attack connects; the player is the scene's victim and gets the QTE.

## 9. Writing a new move

1. Copy the closest shipped move in `shared/Cutscene/Finishers/`. Rename the file and its `Name` (they must match).
2. Write the beat sheet (choreography.md §8), then the marks: victim at the origin facing -Z, attacker where the move starts. Finisher marks use `Position` and `Yaw` (not `Face`).
3. Fill `Finisher.Requires` (posture, side, range...), `Priority`, `Prompt`, `Input`, `Lethal`, `Clearance`.
4. Shots (1–3), then `Freezes`, `Shakes`, `SlowMo`, `Events` (`Hit` with `Damage` and optional `Splash`, `Kill`, `Heal`, `Ragdoll`) on the contact frames.
5. `Moves` for root motion until the clips exist; then add the two animation ids (roblox-animation skill, both from the same origin).
6. `node scripts/previs.cjs Finishers/MyMove` and look at it; `node tests/run-luau.cjs` checks it compiles and passes coverage.

## 10. Integration with the combat and ragdoll kits

- **roblox-combat**: FinisherService listens to `CombatService.Damaged` for head and leg hits and to EnemyService's `State` attribute for staggers; `Hit` events with `Splash` knock other enemies back through `CombatService:Hit`. Add one line at the top of EnemyService's `update(brain, now)` so frozen, hidden enemies don't attack: `if brain.model:GetAttribute("InCutscene") then return end`. Pause the combat kit's input while `Players.LocalPlayer:GetAttribute("InCutscene")` is true.
- **roblox-ragdoll**: victims' stand-ins ragdoll with its `RagdollRig` (client-side, on the local clone), and real characters that end a scene lying down are ragdolled briefly with `RagdollService:Ragdoll` so they get up with its blended get-up. Deaths from `Kill` ragdoll the (hidden) real body through the ragdoll kit's death handling as usual.
- **roblox-animation**: makes the paired clips; give it the shared origin, both marks and the contact times.

## 11. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Prompt never appears | the enemy has no tag from `Finisher.Tags`, no `Posture`, or you're outside `Range`/side; check attributes in the Explorer while testing |
| Prompt shows but nothing happens | the server refused: clearance blocked (move away from walls or lower `Clearance`), cooldown, the enemy is already in a scene, or the move compiles with errors (Output shows `[Finisher]` warnings) |
| Bodies don't line up | the clips weren't authored from the same origin, or the marks don't match the clips; fix the marks to the clips' start roots |
| Pop at the end | the clip doesn't end on its end mark; adjust the last `Moves` target or the clip |
| The dead enemy reappears standing | the real body was respawned or revived in place: the stand-in corpse is removed when the real Humanoid's health goes back above 0 |
| Enemy keeps hitting players while hidden | add the `InCutscene` check to your AI (§10) |
| Finisher fires when I wanted to attack | give the move `Input = "Hold"` or move the finisher key off the attack key |
