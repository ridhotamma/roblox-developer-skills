# Hit reactions and injuries

Making a character show where it was hit, how hard, and that it is still hurting, without taking control away from the player.

## 1. The ladder

Pick the lightest rung that sells the hit. Each rung includes the ones above it.

| Rung | Trigger | Player keeps control? |
|---|---|---|
| Flash, sound, number | Every hit | Yes (the `roblox-combat` skill) |
| **Flinch** | Every hit that connects with a body | Yes |
| **Injury pose** | Accumulated damage to one zone | Yes, slower if it's a leg |
| **Dangling arm** | Arm injury ≥ 0.85 | Yes |
| Stagger animation | Poise broken (combat skill) | Briefly no |
| **Knockdown ragdoll** | Finishers, cars, explosions, falls | No, 1.5–3 s |
| **Death ragdoll** | Health 0 | n/a |

Taking control away is the expensive part of the design budget: in PvP, a knockdown is a guaranteed follow-up kill. Keep knockdowns for heavy, telegraphed hits and give a short invulnerability window on get-up if players complain about chain-knockdowns.

## 2. Zones

`BodyZones.FromHit(character, part, position)` turns the server's own raycast or hitbox result into one of seven zones:

`Head` · `Chest` · `Stomach` · `LeftArm` · `RightArm` · `LeftLeg` · `RightLeg`

- R15 parts map by name (`LowerTorso` is the stomach, `LeftFoot` is the left leg).
- R6's single `Torso` is split by hit height: above its centre is chest, below is stomach.
- Accessories, tools and unknown parts use the nearest known body part.
- Custom rigs: set a `Hitzone` attribute on any part.

The hit **direction** is the way the blow was travelling (bullet direction, attacker → victim for melee). The server converts it to the victim's own space before sending, so `+Z` means "came from the front" and `+X` means "came from the character's left" on every client.

Left and right are the character's own: a shot that enters the left of your screen while the enemy faces you hits their **right** side.

## 3. Flinches

A flinch is a velocity kick on a few joints, returned by a damped spring:

```
acceleration = −ω²·angle − 2ζω·velocity        ω = 2π·Frequency
```

With `Frequency = 3` Hz and `Damping = 0.5` the joint reaches its peak in about 0.06 s, overshoots slightly on the way back, and is still by 0.4 s. The kick is scaled so the peak equals the recipe's angle exactly.

| Tuning | Effect |
|---|---|
| `Frequency` 2 | Heavy, sluggish bodies (brutes, armour) |
| `Frequency` 4–5 | Snappy, arcade |
| `Damping` 0.3 | Wobbly, drunk, comedic |
| `Damping` 0.8–1 | One clean jolt, no bounce (tactical shooters) |
| `Strength` 0.5 | Subtle (competitive, where aim disruption matters) |

Recipes (peak angles at full strength; `dz`, `dx` are the local direction components):

| Zone | What moves |
|---|---|
| Head | Neck snaps along the blow (28° pitch, 22° roll); chest follows 8° |
| Chest | Waist driven back 16°; head lags 12° the other way; arms swing |
| Stomach | From front or side: waist folds **forward** 26°, head drops 14°, arms come in, knees dip. From behind: back arches 13° |
| Arm | That shoulder thrown back or forward 32°, elbow bends 22°, shoulders twist 12° toward the hit side |
| Leg | That hip lifts 20° and knee buckles 42°; the chest leans 9° over the **other** leg, which bends slightly to take the weight |

Strength comes from damage: `clamp(damage / FullDamage, MinStrength, 1)`. A pistol round (15) flinches at half strength; a shotgun blast (40+) at full.

Flinches stack (automatic fire keeps the body shaking) but each joint's kick is capped, so nothing spins. They are sent on an **unreliable** remote to players within `MaxDistance` only: a dropped flinch is invisible, a late one is worse than none.

### Why additive, not an animation

- An authored "hit" animation interrupts the run, the reload, the swing. An additive offset doesn't.
- One recipe works from every direction, because direction is an input.
- It costs a few multiplications per joint on clients that can see it.

Authored hit animations still have a place for big staggers. Use both: procedural for every hit, authored for poise breaks (the `roblox-animation` skill's hit-reaction timing applies).

### Aim punch (optional)

For the **local** player, add camera kick on a flinch (the combat kit's `CameraFx` recoil spring is the tool). Keep it small in competitive games, where flinch that moves the crosshair is a contested mechanic; offer a setting.

## 4. Injuries

The server keeps a 0–1 injury per key and publishes it as attributes (`InjuryLeftLeg` and so on, in steps of 0.05 so healing doesn't replicate every tick):

`Head` · `Torso` (chest and stomach) · `LeftArm` · `RightArm` · `LeftLeg` · `RightLeg`

- Each hit adds `damage × PerDamage` (0.025: 40 damage to one zone = fully injured).
- `HealDelay` (5 s) after the last hit, every zone heals at `HealPerSecond` (0.04: a full injury fades in 25 s).
- `RagdollService:Heal(character, zone?)` for medkits, bandages, safe zones.
- `RagdollService.GetInjury` to gate gameplay (can't sprint, can't aim down sights, weapon sway).

Design choices to make deliberately:

| Question | Arcade answer | Survival / tactical answer |
|---|---|---|
| Do injuries heal alone? | Yes, quickly | Slowly or only with items |
| Do they affect gameplay? | Cosmetic, mild slow | Slow, sway, no sprint, bleed |
| Can enemies be crippled? | Yes: it's fun and readable | Yes, and the AI should change (crawl, retreat) |
| Do they persist through death? | No | No (reset on respawn; the kit does) |

A lasting penalty the player can't see or cure feels like a bug. Show it (the pose is the main channel; a small body-outline HUD icon helps) and give a cure.

## 5. The limp

"Shot in the left foot, so the right leg carries the body." What the kit poses, scaled by the injury `i`:

| Part | Offset | Reads as |
|---|---|---|
| Injured hip | 14°·i forward, 4°·i out | Leg held off the ground |
| Injured knee | 30°·i bent | Foot barely touching down |
| Pelvis (root joint) | 0.22·i studs sideways toward the healthy leg | Weight over the good foot |
| Waist | 7°·i lean toward the healthy leg, 5°·i forward | Balancing over it |
| Neck | 4°·i back the other way | Head stays level |
| Pelvis while walking | drops 0.2·i studs once per stride | The hobble |
| `WalkSpeed` (server) | × (1 − 0.45·i), both legs capped at −60% | Actually slower |

The hobble's rhythm follows walking speed (about two steps a second at 16 studs/s), not the animation's real footfalls, so it reads as a limp without being frame-accurate.

**For exact sync**, author a limp walk and swap it in (set the walk and run ids on the `Animate` script, or play it at `Movement` priority, when leg injury passes about 0.4), and keep the procedural lean and speed penalty on top. That hybrid is what most shipped games do: authored cycle for the feet, procedural for direction and severity.

The speed change is multiplicative on the current `WalkSpeed`, so sprint and slow effects from other systems keep working. If the game sets `WalkSpeed` to absolute values elsewhere, multiply by `1 − penalty` there instead and set `LegSpeedPenalty = 0`.

## 6. Arms, torso and head

**Arm.** The injured arm's joints are blended toward a held pose (upper arm slightly forward and in, elbow at 70°) with weight 0.85·i, so it stops swinging with the run. At `DangleArmAt` (0.85) the server makes that arm's three joints physical while everything else stays animated: the arm hangs and swings with the body's movement. It re-locks when the injury heals below 0.65. Gameplay hooks worth adding: slower reload, more weapon sway, can't use two-handed weapons.

**Torso.** Waist hunched 16°·i with slow breathing, head down, knees soft, and the less-injured arm folded across the stomach. This is the "sick in the stomach" look; the flinch on the hit itself is the sharp fold, the injury pose is what stays.

**Head.** A slow sway of the neck and waist. Pair it with a local screen effect for the injured player (blur, tinnitus, desaturation: the `roblox-atmosphere` skill's grading presets).

Arm and stomach hold poses are the most rig-dependent numbers in the kit. Tune them in Studio by setting an injury attribute by hand on a standing dummy and adjusting the `hold(...)` angles in `ProceduralPose.injuryPose`.

## 7. Real active ragdolls

A true active ragdoll keeps the body physical all the time and drives each joint toward the animation pose with motors (`AlignOrientation` or constraint servos per joint), plus a balance controller that moves the feet under the centre of mass. Hits then disturb it physically and it recovers on its own.

Why the kit doesn't do it:
- Roblox's Humanoid is a floating capsule controller. It can't be told "you are off balance"; a physical character means replacing it, including movement, jumping, climbing, slopes, stairs and netcode.
- Motor-driven poses at Roblox's physics rate are soft and jittery under load, and a crowd of them is expensive.
- The owner-simulates model means every client would see slightly different stumbles.

A workable middle ground if the user insists: a **partial** active ragdoll for the upper body only. Make spine, neck and arms physical (as the dangling arm does), and pull each toward its animated orientation with an `AlignOrientation` of limited torque. The legs and root stay on the Humanoid. Hits then shove the torso physically while locomotion stays reliable. Budget a week of tuning, and keep it to the local player and nearby enemies.

## 8. With the combat kit

`RagdollService` connects to `CombatService.Damaged` when both kits are installed:

| Combat event | Ragdoll response |
|---|---|
| Any hit | Flinch by zone, direction and damage; injury added to the zone |
| Weight in `KnockdownWeights` (default `Finisher = 1.4` s) | Knockdown; the combat knockback carries the body |
| Kill | Death ragdoll pushed along the blow, with extra on the struck part |

Guns pass the exact part they hit; melee hitboxes don't have one, so melee reactions use the hit position or the attacker → victim direction (usually chest).

Order on the contact frame, to match the combat skill's feedback stack: sound, hitstop, flash and flinch together; knockback and ragdoll launch after the hitstop.

Enemies that should react differently (bosses that never flinch, armoured zones) are a `Strength` multiplier away: scale by an attribute on the model before calling `HitReact`, or skip it.
