# Enemy design

## Contents
1. What enemies are for
2. Archetypes
3. Telegraphs: the visual language of danger
4. Attack patterns and timing
5. Behaviour: the state machine
6. Groups: attack tokens and spacing
7. Spawning, waves and encounters
8. Difficulty scaling
9. Bosses
10. Readability checklist
11. Performance on Roblox

---

## 1. What enemies are for

Enemies exist to make the player's verbs meaningful. Each enemy type should ask the player a different question ("can you dodge?", "can you prioritize?", "can you break a guard?") and be answerable with the tools the player has. An enemy is good when beating it feels earned and losing to it feels fair: the player saw it coming.

## 2. Archetypes

A small, readable cast beats many similar enemies. Each archetype has a role, a silhouette, and one main behaviour.

| Archetype | Role | Stats | Behaviour | Teaches |
|---|---|---|---|---|
| **Fodder / grunt** | Volume, power fantasy | low HP, no poise, fast-ish | approach, short telegraph, single swing | basic combat, combos |
| **Bruiser / brute** | Threat in melee | high HP, high poise, slow | long telegraph, big hitbox, knockback slam | dodging, reading wind-ups, staggering with heavies |
| **Ranged** | Area denial, priority target | low HP | keeps distance, aims (visible), fires slow projectiles | closing distance, using cover, target priority |
| **Rusher / dasher** | Pressure | low–mid HP | long-range lunge with a clear charge-up, then vulnerable | timing dodges, punishing recovery |
| **Tank / shielded** | Puzzle | front shield | blocks from the front | flanking, guard-break moves |
| **Support / healer / summoner** | Priority | fragile | buffs or spawns others from the back | target priority |
| **Swarm / exploder** | Panic | very low HP | runs in, explodes after a visible fuse | movement, area attacks |
| **Elite** | Mini-test | buffed version with one extra ability, visible aura | combines lessons | mastery |
| **Boss** | Climax | phases | patterns, arena use | everything |

Silhouettes and colors should identify the archetype at a glance from the camera's distance, on a phone. Size is the strongest cue (brutes are big), then shape, then color.

Mix archetypes so they complement each other: a brute up front with ranged at the back forces the player to decide what to deal with first.

## 3. Telegraphs

A telegraph is the warning before an attack. It's what makes combat fair.

Layers (use 2–3):
- **Animation**: wind-up pose held a beat (the `roblox-animation` anticipation phase, exaggerated for enemies).
- **Color/flash**: the enemy glows or outlines red (the kit's `EnemyVisuals` uses a red `Highlight` pulse).
- **Ground indicator**: a decal/part/beam on the floor showing the danger area (cones, circles, lines), filling up to the moment of impact. Essential for area attacks and bosses.
- **Icon**: a "!" `BillboardGui` above the head for unblockable or special attacks.
- **Sound**: a distinct wind-up sound per dangerous attack; players learn them.

Timing guide (from telegraph start to hit):

| Attack | Telegraph |
|---|---|
| Grunt swing | 0.4–0.5 s |
| Brute slam | 0.7–1.0 s |
| Lunge / charge | 0.6–0.9 s (with a clear line indicator) |
| Projectile | 0.4–0.6 s aim, slow projectile (≤ 40 studs/s) |
| Boss big attack | 1.0–2.0 s with a ground indicator |

Telegraphs should be longer than human reaction time plus network latency (~0.25 s + ping). Players on phones with 150 ms ping need the generous end.

**Commit direction at telegraph start.** The enemy picks its aim when the wind-up begins and doesn't track the player during it, so dodging sideways works. Tracking telegraphs feel unfair.

## 4. Attack patterns and timing

- **Rhythm**: a pattern of attack → recovery (the player's window to punish) → reposition. Recovery after an enemy attack should be long enough for the player to land 1–3 hits.
- **Variation**: give mid and high-tier enemies 2–3 attacks with different telegraphs and ranges (close swing, lunge, area slam), chosen by distance to the target.
- **Cooldowns per attack** plus a global attack cooldown per enemy so they don't chain attacks.
- **Commitment**: enemies shouldn't cancel their own attacks (except into stagger), so punishment windows are reliable.

## 5. Behaviour: the state machine

Most Roblox enemies are best as a simple finite state machine, updated on the server at 10–20 Hz:

```
          see target              in range + token + cooldown ready
 Idle ───────────────► Chase ───────────────────────────────► Telegraph
  ▲                     ▲  │ no token: hover at distance          │ time up
  │ lost target         │  ▼                                       ▼
  └──────────────── (lost)  Hover                                Attack (hitbox once)
                        ▲                                          │
                        └──────────── Recover ◄────────────────────┘
 any state ── poise broken ──► Stagger ──► Chase
 any state ── health 0 ──────► Dead
```

- **Target selection**: nearest alive player within aggro range; keep the target until it's beyond a larger lose range (hysteresis prevents flip-flopping). Optionally prefer whoever damaged it most (threat).
- **Movement**: `Humanoid:MoveTo` straight at the target when there's line of sight; `PathfindingService` when blocked (compute paths at most every 0.5–1 s per enemy and reuse them). Many arenas are open enough that MoveTo alone works.
- **Leash**: return home if dragged too far from the spawn area, regenerating health, so players can't pull enemies across the map.
- **Expose state** as an Attribute (`State`) so clients can show telegraphs, stagger and death without remotes.

Behaviour trees or utility AI help for bosses and complex enemies; for the cast above, a state machine is clearer and easier to debug.

## 6. Groups: attack tokens and spacing

Without coordination, five enemies attack at once and the player gets stunlocked. Action games solve it with **attack tokens**:
- Each target (player) has N tokens (1–3 by difficulty).
- An enemy must hold a token to start an attack and releases it after recovery.
- Enemies without a token **hover**: circle at 8–12 studs, strafe, posture, look threatening.
- Big attacks can cost 2 tokens.
- With multiple players, spread enemies across targets.

This makes fights readable ("that one is coming at me now") and still feels like a crowd.

## 7. Spawning, waves and encounters

- **Placed enemies**: builders place tagged models in the map (kit: tag `Enemy`, attribute `Archetype`). They respawn after a delay at their original spot.
- **Waves**: a wave table (time or kill-count triggers) per arena: start easy, add a new archetype each wave, end with an elite or boss. Give a short break between waves (pick-ups, upgrades).
- **Spawn points out of sight** (or with a visible spawn effect) and never on top of players.
- **Encounter design**: combine archetypes to create a question (shield + ranged = flank under fire). Introduce each archetype alone first (teach → test → twist from the game-design skill).
- **Rewards** on defeat (currency, drops, XP) through the economy services; the kit fires `EnemyService.Defeated(model, archetypeName, killerPlayer)`.

## 8. Difficulty scaling

Scale with care; what you scale changes the experience:
- **Health**: more hits to kill. Raises fight length, not challenge. Scale it with the player's damage progression.
- **Damage**: punishes mistakes harder. Good for higher tiers.
- **Telegraph speed**: shorter wind-ups = real difficulty increase. Use sparingly.
- **Aggression**: more tokens, shorter cooldowns, smarter movement.
- **Composition**: more and nastier archetype mixes. The best lever.
- **Party size**: scale health by number of players nearby (e.g. +60% per extra player for bosses).

Zones or levels set a recommended power; show it, so players know when they're under-leveled.

## 9. Bosses

- **Arena** built for the fight: room to dodge, clear boundaries, maybe hazards the boss uses.
- **Phases** at health thresholds (66%, 33%): new attacks, faster tempo, arena changes. Transition with a short invulnerable animation (a breather and a spectacle).
- **Pattern library**: 4–8 attacks, each with a unique telegraph; pick by distance and phase with some randomness, never the same attack three times in a row.
- **Punish windows** after big attacks.
- **Health bar** at the top of the screen with the boss name; phase ticks on the bar.
- **Group scaling**: health by player count; attacks that target different players.
- **Finisher moment**: last hit with slow-mo, big VFX, and a reward reveal.

## 10. Readability checklist

- [ ] Each archetype recognizable by silhouette at a distance on a phone
- [ ] Every attack has at least two telegraph layers
- [ ] Telegraph time ≥ 0.4 s (≥ 0.7 s for heavy hits and area attacks)
- [ ] Direction committed at telegraph start
- [ ] Recovery windows after attacks
- [ ] Hit reactions on enemies (flash, knockback, stagger) for every player hit
- [ ] Attack tokens limit simultaneous attackers
- [ ] Death is clear (animation, fade, drop pop)
- [ ] Enemy damage numbers and the player's health bar readable during chaos

## 11. Performance on Roblox

- **Network ownership**: `root:SetNetworkOwner(nil)` so the server simulates NPCs (otherwise ownership hops to nearby players, giving them control and causing jitter).
- **One update loop** for all enemies (kit: `EnemyService`, 20 Hz), not a script or Heartbeat connection per enemy.
- **Sleep idle enemies**: skip updates for enemies with no player within aggro range × 1.5.
- **Humanoid cost**: Humanoids are expensive. Dozens are fine; hundreds aren't. For hordes, use simpler rigs (an `AnimationController` with anchored parts moved by CFrame on clients) and consider ECS (`roblox-project-structure` architecture reference).
- **Animate on clients**: server-owned Humanoids replicate animations automatically when played from the server through the Animator; for very large numbers, play animations client-side from the State attribute instead.
- **StreamingEnabled**: enemies far away stream out on clients; client visuals must handle models appearing and disappearing (the kit's components do).
- Pathfinding is the most expensive part: limit how often and how many enemies compute paths.
