---
name: roblox-ragdoll
description: Ragdoll physics and procedural hit reactions for Roblox characters (R15, R6 and custom Humanoid rigs) - full ragdolls that switch on from any animation (knockdowns, death, getting hit by a car mid-run, hard falls, explosions) with joint limits, limb colliders, launch velocity, settle detection and a blended get-up; location-aware flinches (a stomach shot doubles the character over, a head shot snaps the neck, an arm or leg hit throws that limb) layered on top of the playing animation; and lasting per-limb injuries (a leg wound makes the character limp and carry its weight on the healthy leg, an arm wound is held against the body or hangs physically limp, a gut wound hunches and clutches, with walk-speed penalties and healing). Ships a server-authoritative Luau kit (RagdollRig, RagdollService, ImpactService for vehicles and falls, ProceduralPose, BodyZones) that hooks into the roblox-combat and roblox-vehicles kits. Use this whenever the user wants ragdolls, knockdowns, death physics, hit reactions, flinching, staggering, limping, wounded or injured characters, limb damage, body-part damage reactions, active ragdoll or euphoria-style behaviour, pedestrians being run over, characters reacting to where they were shot, or asks why their ragdoll flings, stretches, falls through the floor, kills the player or won't get up, even if they only say "make the character react when it gets hit".
---

# Roblox ragdoll and hit reactions

A character that gets hurt should show **where** and **how hard**. This skill does it with three layers that stack, from cheapest to heaviest:

| Layer | What the player sees | How it works | Lasts |
|---|---|---|---|
| **Flinch** | Shot in the stomach: doubles over. Head: snaps back. Arm or leg: that limb is thrown. | Every client adds a spring-driven rotation to a few `Motor6D.Transform`s on top of the playing animation. | 0.3–0.5 s |
| **Injury** | Shot in the left leg: limps, hips over the right leg, slower. Arm: held to the body, or hanging limp. Gut: hunched, clutching. | Server keeps a 0–1 injury per body zone as attributes; clients pose from them every frame; the server slows `WalkSpeed`. | Until healed |
| **Ragdoll** | Hit by a car mid-run, finisher, fall, death: the body goes fully physical and is thrown. | Server disables the Motor6Ds and enables matching ball-socket and hinge constraints; the body's owner sets the Humanoid to `Physics`. | Until it settles, then a blended get-up |

All three work **mid-animation** without stopping anything: flinches and injuries are added after the Animator runs, and a disabled Motor6D simply stops applying its animation (the run cycle resumes the moment it is re-enabled).

## What is real physics and what is posed

Be straight with the user about this, because "the right foot balances the character" can mean two things:

- **Posed balance (what the kit does).** The Humanoid is a controller that always stands. The limp, weight shift, hunch and flinch are procedural joint offsets that *look* like the body compensating. Cheap, stable, works for 50 characters, replicates as six numbers.
- **Simulated balance (not available).** True active ragdolls, where motors hold the body up and it physically stumbles and recovers, need a physics-driven character controller. Roblox Humanoids don't work that way and a custom one is a project of its own; `references/hit-reactions.md` §7 says what it would take and why most games fake it.

What *is* physical: the full ragdoll, and the **dangling arm** (a badly injured arm goes limp on its constraints while the rest of the character keeps walking and animating).

## Decide the mode

| The user wants... | Do this |
|---|---|
| Ragdoll on death / knockdown | Install the kit. Death ragdolls by default; call `RagdollService:Ragdoll(character, { Seconds = 2, Velocity = ... })` for knockdowns. `references/ragdoll-physics.md`. |
| Characters react to where they're hit | Kit + `references/hit-reactions.md`. With `roblox-combat` installed it's automatic; otherwise call `RagdollService:HitReact` and `:Injure` from the damage code with the hit part. |
| Limping / wounded limbs / limb damage | Injuries (`references/hit-reactions.md` §4–6): zones, limp, held or dangling arm, speed penalty, healing, medkits. |
| Run over by cars, hit by boulders, fall damage | `ImpactService` (`references/impacts.md`): tag the object `Vehicle` or `Impactor`. The `roblox-vehicles` kit's cars are already tagged. |
| Explosions, traps, tackles, slippery floors | Call `RagdollService:Ragdoll` with a velocity from the trigger (`references/impacts.md` §4). |
| "My ragdoll flings / stretches / falls through the floor / kills the player / won't get up" | Troubleshooting table in `references/ragdoll-physics.md` §8. |
| Active ragdoll / euphoria / self-balancing | Explain the two kinds of balance above, then deliver the posed version; `references/hit-reactions.md` §7 for the honest scope of the real thing. |
| A ragdoll physics toy / sandbox game | Kit + limits in `references/ragdoll-physics.md` §7 (budget), and `roblox-game-research`'s note on that genre's retention problem. |

## The rules that make it work

1. **The server switches joints, the owner moves the body.** Motor6D and constraint toggles replicate from the server. Humanoid state changes and velocities must come from whoever owns the physics: the server for NPCs, the player's own client for their character. Getting this wrong is the top cause of ragdolls that stand frozen or ignore the launch.
2. **Disable Motor6Ds, never destroy them.** `Motor6D.Enabled = false` keeps the rig intact, so getting up is one property flip and animations resume.
3. **Build once, toggle often.** Constraints and colliders are created when the character spawns (disabled). Knocking someone down costs a handful of property changes, not 80 new Instances mid-fight.
4. **Limbs need their own colliders.** Humanoids force `CanCollide` off on limbs. Without welded collider parts a ragdoll's arms and legs sink through the floor.
5. **Set `RequiresNeck = false` and `BreakJointsOnDeath = false`.** Otherwise disabling the neck joint kills the character, and death scatters loose parts instead of ragdolling.
6. **Never trust the client about who got hit or hurt.** The server picks the zone from its own raycast or hitbox result. Clients only draw.
7. **Budget it.** Cap live ragdolls (`MaxActive`), skip procedural poses beyond `MaxDistance`, and let dead bodies be cleaned up. The `roblox-performance` skill has the wider budget.

## The kit

`assets/kit/` follows the `roblox-project-structure` layout (`shared` → `ReplicatedStorage.Shared`, `server` → `ServerScriptService.Server`, `client` → `StarterPlayerScripts.Client`). Services and Controllers are started by the scaffold's Loader, components by its binder; it uses the scaffold's `Net` module and the Signal package.

| File | Side | Does |
|---|---|---|
| `shared/Ragdoll/RagdollConfig.luau` | both | Joint limits, collider and friction settings, ragdoll timings, impact and fall thresholds, flinch spring, injury rates, combat knockdowns. All tuning lives here. |
| `shared/Ragdoll/BodyZones.luau` | both | Body part → zone (`Head`, `Chest`, `Stomach`, `LeftArm`, `RightArm`, `LeftLeg`, `RightLeg`) for R15, R6 and `Hitzone`-tagged custom parts; nearest-part fallback for accessories. |
| `shared/Ragdoll/RagdollRig.luau` | both | Builds constraints and colliders from the rig's own Motor6Ds (any rig), switches them, launches a body, captures the pose for get-up, stands a root upright. |
| `server/Services/RagdollService.luau` | server | `Ragdoll`, `Recover`, `Push`, `HitReact`, `Injure`, `Heal`. Builds players and tagged NPCs, ragdolls on death, settle detection and auto get-up, injuries with healing, leg speed penalty, dangling arms, the live-ragdoll cap, anti-cheat grants, the combat hook. |
| `server/Services/ImpactService.luau` | server | Sweeps fast `Vehicle` / `Impactor` objects against characters (no tunnelling, no `Touched`), skips seated riders, launches by closing speed, optional damage; hard-landing detection. `Hit` and `Fell` signals. |
| `client/Ragdoll/ProceduralPose.luau` | client | Flinch springs per joint, injury poses (limp, held arm, hunch and clutch, dizzy head), get-up blend. Runs for every visible character, culled by distance. |
| `client/Components/RagdollVisuals.luau` | client | Binds `ProceduralPose` to everything tagged `Ragdollable`. |
| `client/Controllers/RagdollController.luau` | client | Own character: `Physics` state while down, `GettingUp` and optional get-up animation after, launch impulses from the server. Routes flinch events. `IsDown()` for other controllers. |

Install steps to give the user:
1. Copy the kit folders into `src` (merge with the scaffold).
2. Add the remotes to `REMOTES` in `src/shared/Net/init.luau`: `HitReact = "Unreliable"` and `RagdollImpulse = "Event"` (both server → client; arguments are listed at the top of `RagdollConfig.luau`).
3. Players need nothing else. NPCs: tag the model `Ragdollable` (models tagged `Enemy` by the combat kit are picked up already).
4. Things that should run characters over: tag them `Vehicle` or `Impactor` (Model with a `PrimaryPart`, or a single part).
5. Without the combat kit, report hits yourself from the server's damage code:
   ```lua
   RagdollService:HitReact(victim, result.Instance, result.Position, direction, damage / 30)
   RagdollService:Injure(victim, BodyZones.FromHit(victim, result.Instance, result.Position), damage * 0.025)
   ```
   With the combat kit this happens automatically through `CombatService.Damaged`, and weights listed in `RagdollConfig.Combat.KnockdownWeights` knock down.
6. Optional: get-up animation ids in `RagdollConfig.GetUpAnimations` (the `roblox-animation` skill can make both; start each from a lying pose).
7. Play with two clients (Test → Clients and Servers) and run the checklist in `references/ragdoll-physics.md` §9: knees bend backwards, elbows forwards, nobody dies when ragdolled, limbs rest on the floor, the get-up doesn't pop.

When writing new code for a project, keep the same split: only `RagdollService` toggles joints and injuries, only clients draw poses, tuning only in `RagdollConfig`.

## What good looks like

- **You can tell where they were hit.** A stomach shot and a shoulder shot read differently from across the street, without a UI.
- **Reactions never interrupt control.** Flinches are additive and short; the player keeps running, aiming and reloading through them. Only real knockdowns take control away, and they are rare and earned.
- **Injuries tell a story.** A limping enemy is visibly the one you shot in the leg. Wounds fade (or need a medkit); they never leave a player stuck at half speed forever without a way out.
- **Ragdolls carry momentum.** A runner hit by a car keeps their own speed plus the car's, rolls over the bonnet, lies still, then gets up. No freeze, no pop to T-pose, no launch into orbit.
- **Getting up is smooth.** Limbs blend from where they landed into the stand-up, facing the way the body was lying.
- **It holds at scale.** Thirty characters on screen, a few flinching and a few down, with no visible frame cost.

## Limits to be honest about

- The kit's Luau is reviewed but has not been run in Studio as part of building this skill. The joint-sign conventions (knee and elbow hinge directions, flinch directions on R6) are the first thing to check in play; each is a one-line change in `RagdollConfig` or `ProceduralPose`.
- Balance is posed, not simulated (see above). The limp's hobble follows walking speed, not the animation's actual footfalls; for perfect sync, swap in an authored limp walk and keep the procedural lean on top (`references/hit-reactions.md` §5).
- A player's ragdoll is simulated on that player's client, so a car impact shows up a moment late for the victim (server detection plus one round trip). `references/impacts.md` §5 covers what can be predicted.
- Humanoid `GettingUp` occasionally fails under low ceilings or on steep slopes; `SnapUpright` trades a visible pop for reliability.
- Layered clothing and very large or tiny avatar scales may need `ColliderScale` adjusted; call `RagdollService:Rebuild(character)` after any rescale.

## References

- `references/ragdoll-physics.md` — how the ragdoll is built (joints, limits, colliders, collision groups), ownership and Humanoid states, launching, settling and getting up, death, NPCs, performance budget, troubleshooting table, test checklist.
- `references/hit-reactions.md` — zones, the flinch spring and per-zone recipes, injuries and healing, the limp and weight shift, held and dangling arms, authored vs procedural, combat integration, what a real active ragdoll would take.
- `references/impacts.md` — vehicles and impactors, closing speed and launch maths, falls, explosions and other triggers, latency and prediction, anti-cheat and abuse.
